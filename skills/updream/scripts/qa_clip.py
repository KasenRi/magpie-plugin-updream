#!/usr/bin/env python3
"""QA inspector for UPdream / Seedance raw video clips (qa_clip.py).

For each clip (single .mp4/.mov or a directory of clips), produces:
  1. <stem>_strip3.jpg          Start / Mid / End 3-frame strip (checks framing, camera move, safe margins)
  2. <stem>_first_last_full.jpg Full-resolution [First | Last | 4x Abs-Diff] comparison (catches slow blooming,
                                product scaling/morphing, or subtle push-in invisible in small thumbnails)
  3. Quantitative metrics:
     - Inter-frame motion via `ffmpeg -vf tblend=all_mode=difference,signalstats` (step_yavg_mean / p95 / max)
     - 5-point cumulative drift from first frame [25%, 50%, 75%, 100%]
     - Full-frame, center-ROI, and border pixel change percentages (|RGB_end - RGB_start| > 20)
     - Audio stream presence check (flags non-silent clips so Seedance native audio never leaks into final cuts)
     - Automatic anomaly flags:
         * NEAR_STATIC_STILL_FRAME           (step_yavg_mean < 0.30 and changed_px < 15%)
         * HIGH_MOTION_OR_CAMERA_MOVE        (step_yavg_mean > 4.5 or border_changed_pct > 55% with high step)
         * SUBJECT_GROWTH_OR_BLOOMING        (low frame-to-frame step, high monotonic cumulative drift in center)
         * HAS_SEEDANCE_AUDIO_TRACK          (audio stream present; strip with -an after Method B alignment)
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def probe_clip(clip_path: Path) -> Dict[str, Any]:
    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,r_frame_rate,duration,nb_frames:format=duration",
            "-of",
            "json",
            str(clip_path),
        ],
        text=True,
    )
    info = json.loads(raw)
    streams = info.get("streams") or []
    v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not v_stream:
        raise RuntimeError(f"No video stream found in {clip_path}")
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    dur_str = v_stream.get("duration") or (info.get("format") or {}).get("duration") or "0"
    duration_s = float(dur_str)
    fps_str = v_stream.get("r_frame_rate") or "24/1"
    if "/" in fps_str:
        num, den = fps_str.split("/", 1)
        fps = float(num) / max(float(den), 1.0)
    else:
        fps = float(fps_str)

    return {
        "width": int(v_stream["width"]),
        "height": int(v_stream["height"]),
        "fps": round(fps, 3),
        "duration_s": round(duration_s, 3),
        "nb_frames": int(v_stream["nb_frames"]) if v_stream.get("nb_frames") else None,
        "has_audio_stream": has_audio,
    }


def measure_tblend_motion(clip_path: Path) -> Dict[str, float]:
    out = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "info",
            "-i",
            str(clip_path),
            "-vf",
            "tblend=all_mode=difference,signalstats,metadata=print:file=-",
            "-f",
            "null",
            "-",
        ],
        stderr=subprocess.STDOUT,
        text=True,
    )
    yavgs: List[float] = []
    for line in out.splitlines():
        if "lavfi.signalstats.YAVG=" in line:
            try:
                yavgs.append(float(line.split("=", 1)[1].strip()))
            except ValueError:
                pass
    if not yavgs:
        return {"step_yavg_mean": 0.0, "step_yavg_p95": 0.0, "step_yavg_max": 0.0}
    arr = np.array(yavgs, dtype=np.float32)
    return {
        "step_yavg_mean": round(float(np.mean(arr)), 3),
        "step_yavg_p95": round(float(np.percentile(arr, 95)), 3),
        "step_yavg_max": round(float(np.max(arr)), 3),
    }


def extract_frame_rgb(clip_path: Path, t_sec: float, tmp_png: Path) -> np.ndarray:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{max(0.0, t_sec):.3f}",
            "-i",
            str(clip_path),
            "-frames:v",
            "1",
            str(tmp_png),
        ],
        check=True,
    )
    if not tmp_png.is_file():
        # Fallback near end-of-stream: seek slightly earlier
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-sseof",
                "-0.12",
                "-i",
                str(clip_path),
                "-frames:v",
                "1",
                str(tmp_png),
            ],
            check=True,
        )
    with Image.open(tmp_png) as im:
        return np.asarray(im.convert("RGB"), dtype=np.float32)


def _draw_banner(img: Image.Image, text: str) -> Image.Image:
    banner_h = 44
    canvas = Image.new("RGB", (img.width, img.height + banner_h), (20, 22, 26))
    canvas.paste(img, (0, banner_h))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    draw.text((12, 14), text, fill=(240, 240, 240), font=font)
    return canvas


def _label_tile(arr: np.ndarray, label: str) -> Image.Image:
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(im)
    font = ImageFont.load_default()
    box_w = min(im.width - 8, max(120, len(label) * 7 + 16))
    draw.rectangle([8, 8, 8 + box_w, 32], fill=(0, 0, 0))
    draw.text((14, 14), label, fill=(255, 230, 90), font=font)
    return im


def analyze_clip(
    clip_path: Path,
    out_dir: Path,
    write_images: bool = True,
    diff_gain: float = 4.0,
) -> Dict[str, Any]:
    meta = probe_clip(clip_path)
    dur = meta["duration_s"]
    motion = measure_tblend_motion(clip_path)

    t_start = min(0.05, dur * 0.05)
    t_end = max(t_start + 0.05, dur - 0.08)
    sample_times = [
        t_start,
        dur * 0.25,
        dur * 0.50,
        dur * 0.75,
        t_end,
    ]

    with tempfile.TemporaryDirectory(prefix="updream_qa_") as td:
        tmp_dir = Path(td)
        frames = [extract_frame_rgb(clip_path, ts, tmp_dir / f"f_{idx}.png") for idx, ts in enumerate(sample_times)]

    f_first = frames[0]
    f_mid = frames[2]
    f_last = frames[-1]

    drift_curve = [round(float(np.mean(np.abs(f - f_first))), 2) for f in frames[1:]]
    endpoint_mad = drift_curve[-1]

    abs_diff = np.abs(f_last - f_first)
    max_ch_diff = np.max(abs_diff, axis=2)
    changed_px_pct = round(float(np.mean(max_ch_diff > 20.0) * 100.0), 2)

    h, w = max_ch_diff.shape
    cy0, cy1 = int(h * 0.15), int(h * 0.85)
    cx0, cx1 = int(w * 0.20), int(w * 0.80)
    center_mask = np.zeros((h, w), dtype=bool)
    center_mask[cy0:cy1, cx0:cx1] = True

    by, bx = max(1, int(h * 0.12)), max(1, int(w * 0.12))
    border_mask = np.zeros((h, w), dtype=bool)
    border_mask[:by, :] = True
    border_mask[-by:, :] = True
    border_mask[:, :bx] = True
    border_mask[:, -bx:] = True

    center_changed_pct = round(float(np.mean(max_ch_diff[center_mask] > 20.0) * 100.0), 2)
    border_changed_pct = round(float(np.mean(max_ch_diff[border_mask] > 20.0) * 100.0), 2)

    d25, d50, d75, d100 = drift_curve
    monotonic_drift = bool(
        (d25 <= d50 <= d75 <= d100 and d100 > d25 * 1.25)
        or (d100 >= 0.93 * max(drift_curve) and d75 >= d25 * 1.25 and d100 >= d25 * 1.45)
    )
    step_mean = motion["step_yavg_mean"]
    drift_to_step_ratio = round(endpoint_mad / max(step_mean, 0.1), 2)

    flags: List[str] = []
    notes: List[str] = []

    if meta["has_audio_stream"]:
        flags.append("HAS_SEEDANCE_AUDIO_TRACK")
        notes.append("Clip contains an audio stream; strip with -an before final assembly.")

    if step_mean < 0.30 and changed_px_pct < 15.0:
        flags.append("NEAR_STATIC_STILL_FRAME")
        notes.append(f"Very low motion (tblend YAVG={step_mean:.2f}, endpoint changed={changed_px_pct:.1f}%): check if clip feels frozen.")

    if step_mean > 4.5 or (border_changed_pct > 55.0 and step_mean > 2.8):
        flags.append("HIGH_MOTION_OR_CAMERA_MOVE")
        notes.append(
            f"High frame-to-frame/border motion (tblend YAVG={step_mean:.2f}, border changed={border_changed_pct:.1f}%): "
            f"check strip3 for unwanted camera push/pull/pan/orbit or large action."
        )

    if (
        step_mean < 3.5
        and monotonic_drift
        and drift_to_step_ratio >= 11.0
        and (changed_px_pct >= 30.0 or center_changed_pct >= 35.0)
    ):
        flags.append("SUBJECT_GROWTH_OR_BLOOMING")
        notes.append(
            f"Gradual cumulative drift detected despite calm frame-to-frame motion "
            f"(drift={drift_curve}, center changed={center_changed_pct:.1f}%, border changed={border_changed_pct:.1f}%, "
            f"drift/step={drift_to_step_ratio:.1f}x): inspect first_last_full.jpg for plant blooming, product scaling/morphing, or slow zoom."
        )

    artifacts: Dict[str, str] = {}
    if write_images:
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = clip_path.stem

        # 1. Start / Mid / End 3-frame strip (scaled to 360px height for compact framing review)
        target_h = min(480, h)
        target_w = int(round(w * (target_h / h)))
        strip_tiles = []
        for lbl, frm in [
            (f"START {t_start:.2f}s", f_first),
            (f"MID {dur * 0.50:.2f}s", f_mid),
            (f"END {t_end:.2f}s", f_last),
        ]:
            t_im = _label_tile(frm, lbl).resize((target_w, target_h), Image.Resampling.LANCZOS)
            strip_tiles.append(t_im)
        strip_img = Image.new("RGB", (target_w * 3 + 8, target_h), (18, 18, 18))
        for i, t_im in enumerate(strip_tiles):
            strip_img.paste(t_im, (i * (target_w + 4), 0))
        strip_header = (
            f"{stem} | {w}x{h} {dur:.2f}s | tblend={step_mean:.2f} | "
            f"end_chg={changed_px_pct:.1f}% | flags={','.join(flags) or 'OK'}"
        )
        strip_out = out_dir / f"{stem}_strip3.jpg"
        _draw_banner(strip_img, strip_header).save(strip_out, quality=90)
        artifacts["strip3_jpg"] = str(strip_out.resolve())

        # 2. Full-resolution First vs Last vs 4x Amplified Diff comparison (never downscaled!)
        amp_diff = np.clip(abs_diff * diff_gain, 0, 255)
        p1 = _label_tile(f_first, f"FIRST {t_start:.2f}s (1:1)")
        p2 = _label_tile(f_last, f"LAST {t_end:.2f}s (1:1)")
        p3 = _label_tile(amp_diff, f"|LAST-FIRST| x{diff_gain:g} (chg>20: {changed_px_pct:.1f}%)")
        full_cmp = Image.new("RGB", (w * 3 + 8, h), (18, 18, 18))
        full_cmp.paste(p1, (0, 0))
        full_cmp.paste(p2, (w + 4, 0))
        full_cmp.paste(p3, ((w + 4) * 2, 0))
        full_header = (
            f"FULL-SIZE ENDPOINT QA: {stem} ({w}x{h}) | drift_from_t0={drift_curve} | "
            f"center_chg={center_changed_pct:.1f}% border_chg={border_changed_pct:.1f}% | flags={','.join(flags) or 'OK'}"
        )
        full_out = out_dir / f"{stem}_first_last_full.jpg"
        _draw_banner(full_cmp, full_header).save(full_out, quality=92)
        artifacts["first_last_full_jpg"] = str(full_out.resolve())

    return {
        "clip": str(clip_path.resolve()),
        "stem": clip_path.stem,
        "probe": meta,
        "motion": motion,
        "endpoint_drift": {
            "drift_from_start_25_50_75_100": drift_curve,
            "endpoint_mad": endpoint_mad,
            "changed_px_gt20_pct": changed_px_pct,
            "center_changed_pct": center_changed_pct,
            "border_changed_pct": border_changed_pct,
            "monotonic_drift": monotonic_drift,
            "drift_to_step_ratio": drift_to_step_ratio,
        },
        "flags": flags,
        "notes": notes,
        "artifacts": artifacts,
        "manual_visual_checklist": [
            "Person-to-product scale: compare product size against adult human head (~23 cm tall)",
            "Product integrity: exact 1 product only (no duplicate pot/item), no blooming/growing/morphing",
            "Hands & feet: 5 fingers, no plant/object clipping, shoes/props do not melt or vanish",
            "Gaze & framing: non-speaking shots never look or smile at camera; card/title safe area stays clear",
            "Clean image: no readable text/watermarks, no pets, no backlit oily/plastic skin glare",
        ],
    }


def collect_clips(inputs: List[Path]) -> List[Path]:
    clips: List[Path] = []
    for p in inputs:
        if p.is_dir():
            clips.extend(sorted(x for x in p.iterdir() if x.suffix.lower() in (".mp4", ".mov")))
        elif p.is_file():
            clips.append(p)
        else:
            raise FileNotFoundError(f"Input path not found: {p}")
    return clips


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract 3-frame strip, full-size first/last diff image, and tblend/drift QA metrics for UPdream clips"
    )
    parser.add_argument("inputs", nargs="+", type=Path, help="One or more video files (.mp4/.mov) or directories")
    parser.add_argument(
        "-o",
        "--out-dir",
        type=Path,
        default=Path.cwd() / "qa_out",
        help="Directory to write <stem>_strip3.jpg, <stem>_first_last_full.jpg, and qa_report.json (default: ./qa_out)",
    )
    parser.add_argument("--diff-gain", type=float, default=4.0, help="Amplification factor for |Last-First| diff panel (default: 4.0)")
    parser.add_argument("--no-images", action="store_true", help="Compute metrics only without writing JPG sheets")
    parser.add_argument("--json", action="store_true", help="Print full JSON report to stdout")
    args = parser.parse_args()

    clips = collect_clips(args.inputs)
    if not clips:
        print("No .mp4/.mov clips found in inputs.", file=sys.stderr)
        return 1

    reports = [
        analyze_clip(c, out_dir=args.out_dir, write_images=not args.no_images, diff_gain=args.diff_gain)
        for c in clips
    ]

    if not args.no_images:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / "qa_report.json").write_text(
            json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    if args.json:
        print(json.dumps(reports if len(reports) > 1 else reports[0], ensure_ascii=False, indent=2))
    else:
        for r in reports:
            ed = r["endpoint_drift"]
            mo = r["motion"]
            fl = ", ".join(r["flags"]) if r["flags"] else "OK"
            print(
                f"[{r['stem']}] {r['probe']['width']}x{r['probe']['height']} {r['probe']['duration_s']:.2f}s | "
                f"tblend={mo['step_yavg_mean']:.2f} (max {mo['step_yavg_max']:.2f}) | "
                f"drift={ed['drift_from_start_25_50_75_100']} | "
                f"end_chg={ed['changed_px_gt20_pct']:.1f}% (center {ed['center_changed_pct']:.1f}%, border {ed['border_changed_pct']:.1f}%) | "
                f"flags: {fl}"
            )
            for n in r["notes"]:
                print(f"  -> {n}")
            if r["artifacts"]:
                print(f"  -> strip3: {r['artifacts']['strip3_jpg']}")
                print(f"  -> first_last_full: {r['artifacts']['first_last_full_jpg']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
