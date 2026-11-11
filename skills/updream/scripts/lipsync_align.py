#!/usr/bin/env python3
"""Lip-sync envelope cross-correlation & pause-warp alignment tool (lipsync_align.py).

Implements UPdream Seedance Method B lip-sync alignment:
  1. Verifies the generated clip has a temporary Seedance audio track (`--lipsync-audio --ref-audio`).
  2. Extracts 10ms-hop bandpass (100-4000 Hz) log-dB speech envelopes for both video and reference voiceover.
  3. Computes normalized cross-correlation globally and per spoken clause (auto-split at pauses or via --clauses).
  4. Recommends either:
     - `single_offset`: constant `-ss <start>` trim when single-clause or inter-clause drift <= 0.06s
     - `piecewise_pause_warp`: keeps spoken clauses at 1.00x speed and stretches/compresses only inter-clause
       silent pauses (and optional post-speech closed-mouth smile hold), preventing jump cuts and mouth speed-up.
  5. Always strips Seedance native audio (`-an`) when generating commands or rendering `--render-out`.
"""
import argparse
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


def probe_streams(media_path: Path) -> Tuple[bool, bool, float]:
    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,duration:format=duration",
            "-of",
            "json",
            str(media_path),
        ],
        text=True,
    )
    info = json.loads(raw)
    streams = info.get("streams") or []
    has_v = any(s.get("codec_type") == "video" for s in streams)
    has_a = any(s.get("codec_type") == "audio" for s in streams)
    dur_s = float((info.get("format") or {}).get("duration") or 0.0)
    for s in streams:
        if s.get("duration"):
            dur_s = max(dur_s, float(s["duration"]))
    return has_v, has_a, dur_s


def extract_db_envelope(
    media_path: Path,
    tmp_wav: Path,
    start_s: float = 0.0,
    duration_s: float = 0.0,
    sr: int = 16000,
    hop_ms: int = 10,
) -> np.ndarray:
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if start_s > 0:
        cmd += ["-ss", f"{start_s:.3f}"]
    cmd += ["-i", str(media_path)]
    if duration_s > 0:
        cmd += ["-t", f"{duration_s:.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", str(sr), "-af", "highpass=f=100,lowpass=f=4000", str(tmp_wav)]
    subprocess.run(cmd, check=True)

    with wave.open(str(tmp_wav), "rb") as wf:
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

    hop = int(sr * hop_ms / 1000)
    win = int(sr * 0.030)  # 30ms RMS window
    padded = np.pad(pcm, (0, max(0, win)))
    n_steps = max(1, len(pcm) // hop)
    rms = np.array(
        [np.sqrt(np.mean(padded[i * hop : i * hop + win] ** 2) + 1e-10) for i in range(n_steps)],
        dtype=np.float32,
    )
    db = 20.0 * np.log10(rms)
    floor_db = max(-55.0, float(np.percentile(db, 10)) - 3.0)
    return np.clip(db, floor_db, 0.0) - floor_db


def detect_speech_clauses(
    ref_env: np.ndarray,
    hop_s: float = 0.01,
    min_pause_s: float = 0.12,
    min_clause_s: float = 0.40,
) -> List[Tuple[float, float]]:
    """Auto-segment reference speech envelope into spoken clauses separated by pauses."""
    if len(ref_env) == 0:
        return []
    peak = float(np.max(ref_env))
    if peak < 3.0:
        return [(0.0, round(len(ref_env) * hop_s, 3))]

    thresh = max(2.5, peak * 0.18)
    active = ref_env >= thresh

    # Bridge micro-gaps shorter than min_pause_s (e.g. unaspirated stops / plosives)
    min_pause_bins = max(1, int(round(min_pause_s / hop_s)))
    bridged = active.copy()
    i = 0
    n = len(bridged)
    while i < n:
        if not bridged[i]:
            j = i
            while j < n and not bridged[j]:
                j += 1
            if i > 0 and j < n and (j - i) < min_pause_bins:
                bridged[i:j] = True
            i = j
        else:
            i += 1

    min_clause_bins = max(5, int(round(min_clause_s / hop_s)))
    clauses: List[Tuple[float, float]] = []
    i = 0
    while i < n:
        if bridged[i]:
            j = i
            while j < n and bridged[j]:
                j += 1
            if (j - i) >= min_clause_bins:
                # Pad 30ms around speech edges for clean plosive/vowel onset correlation
                s0 = max(0, i - 3) * hop_s
                s1 = min(n, j + 3) * hop_s
                clauses.append((round(s0, 3), round(s1, 3)))
            i = j
        else:
            i += 1
    if not clauses:
        return [(0.0, round(len(ref_env) * hop_s, 3))]
    return clauses


def parse_manual_clauses(spec: str) -> List[Tuple[float, float]]:
    out: List[Tuple[float, float]] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        a, b = part.split(":", 1)
        out.append((float(a), float(b)))
    return out


def xcorr_segment(
    vid_env: np.ndarray,
    ref_env: np.ndarray,
    r0_s: float,
    r1_s: float,
    hop_s: float = 0.01,
    max_shift_s: float = 1.2,
) -> Tuple[float, float]:
    """Find shift_s such that video[t + shift_s] best matches ref[t] over t in [r0_s, r1_s]."""
    i0 = max(0, int(round(r0_s / hop_s)))
    i1 = min(len(ref_env), int(round(r1_s / hop_s)))
    r_seg = ref_env[i0:i1]
    if len(r_seg) < 10 or float(np.std(r_seg)) < 1e-5:
        return 0.0, 0.0
    r_norm = (r_seg - float(np.mean(r_seg))) / (float(np.std(r_seg)) + 1e-8)

    max_k = int(round(max_shift_s / hop_s))
    best_k = 0
    best_corr = -2.0
    for k in range(-max_k, max_k + 1):
        v0 = i0 + k
        v1 = v0 + len(r_seg)
        if v0 < 0 or v1 > len(vid_env):
            continue
        v_seg = vid_env[v0:v1]
        v_std = float(np.std(v_seg))
        if v_std < 1e-5:
            continue
        v_norm = (v_seg - float(np.mean(v_seg))) / (v_std + 1e-8)
        c = float(np.dot(v_norm, r_norm) / len(r_seg))
        if c > best_corr:
            best_corr = c
            best_k = k
    return round(best_k * hop_s, 3), round(best_corr, 3)


def build_piecewise_filter(
    clause_results: List[Dict[str, Any]],
    vid_dur: float,
    target_dur: float,
    fps: int,
    scale_spec: Optional[str],
) -> Tuple[str, List[Dict[str, Any]]]:
    """Construct an ffmpeg filter_complex that keeps spoken clauses at 1.0x and warps only pauses/tail."""
    segments: List[Dict[str, Any]] = []
    cur_ref = 0.0
    cur_vid = max(0.0, clause_results[0]["ref_start_s"] + clause_results[0]["shift_s"] - clause_results[0]["ref_start_s"])
    # Include pre-speech lead-in before Clause 1 at 1.0x if ref_start_s > 0
    first_c = clause_results[0]
    c0_vid_start = max(0.0, round(first_c["ref_start_s"] + first_c["shift_s"], 3))
    if first_c["ref_start_s"] > 0.03:
        lead_ref = first_c["ref_start_s"]
        lead_vid_0 = max(0.0, round(c0_vid_start - lead_ref, 3))
        if c0_vid_start - lead_vid_0 >= 0.03:
            pts_mul = round(lead_ref / max(0.02, c0_vid_start - lead_vid_0), 4)
            segments.append(
                {
                    "kind": "lead_in",
                    "ref_range": [0.0, round(lead_ref, 3)],
                    "vid_range": [lead_vid_0, c0_vid_start],
                    "pts_factor": pts_mul,
                }
            )
            cur_ref = lead_ref
            cur_vid = c0_vid_start

    for idx, cl in enumerate(clause_results):
        r0 = cl["ref_start_s"] if idx > 0 or cur_ref > 0 else 0.0
        r1 = cl["ref_end_s"]
        sh = cl["shift_s"]
        v0 = max(cur_vid, round(r0 + sh, 3))
        if idx == 0 and cur_ref == 0.0:
            v0 = max(0.0, round(sh, 3))
        dur_ref = round(r1 - r0, 3)
        v1 = min(vid_dur, round(v0 + dur_ref, 3))

        # Insert inter-clause pause warp if there is a gap from cur_ref -> r0
        if idx > 0 and (r0 - cur_ref) > 0.02:
            pause_ref = round(r0 - cur_ref, 3)
            pause_vid = max(0.03, round(v0 - cur_vid, 3))
            pts_mul = round(pause_ref / pause_vid, 4)
            segments.append(
                {
                    "kind": f"pause_{idx}",
                    "ref_range": [round(cur_ref, 3), round(r0, 3)],
                    "vid_range": [round(cur_vid, 3), round(v0, 3)],
                    "pts_factor": pts_mul,
                }
            )

        pts_c = round(dur_ref / max(0.03, v1 - v0), 4) if (v1 - v0) < dur_ref - 0.02 else 1.0
        segments.append(
            {
                "kind": f"clause_{idx + 1}",
                "ref_range": [round(r0, 3), round(r1, 3)],
                "vid_range": [round(v0, 3), round(v1, 3)],
                "pts_factor": pts_c,
            }
        )
        cur_ref = r1
        cur_vid = v1

    # Post-speech hold (closed-mouth smile tail) up to target_dur
    if target_dur - cur_ref > 0.03:
        tail_ref = round(target_dur - cur_ref, 3)
        avail_vid = max(0.05, round(vid_dur - cur_vid, 3))
        if avail_vid >= tail_ref:
            # Enough natural post-speech footage available: play at 1.0x without time-compression
            segments.append(
                {
                    "kind": "tail_hold",
                    "ref_range": [round(cur_ref, 3), round(target_dur, 3)],
                    "vid_range": [round(cur_vid, 3), round(cur_vid + tail_ref, 3)],
                    "pts_factor": 1.0,
                }
            )
        else:
            # Video ends slightly early: gently slow down the remaining smile frames + clone pad safety
            pts_tail = round(tail_ref / avail_vid, 4)
            segments.append(
                {
                    "kind": "tail_hold",
                    "ref_range": [round(cur_ref, 3), round(target_dur, 3)],
                    "vid_range": [round(cur_vid, 3), round(vid_dur, 3)],
                    "pts_factor": pts_tail,
                    "clone_pad_s": 0.25,
                }
            )

    fc_parts: List[str] = []
    labels: List[str] = []
    for i, seg in enumerate(segments):
        vs0, vs1 = seg["vid_range"]
        pf = seg["pts_factor"]
        pts_expr = "PTS-STARTPTS" if abs(pf - 1.0) < 0.015 else f"{pf:.4f}*(PTS-STARTPTS)"
        pad = f",tpad=stop_mode=clone:stop_duration={seg['clone_pad_s']:.2f}" if seg.get("clone_pad_s") else ""
        fc_parts.append(f"[0:v]trim=start={vs0:.3f}:end={vs1:.3f},setpts={pts_expr},fps={fps}{pad}[v{i}]")
        labels.append(f"[v{i}]")

    post_vf = f"fps={fps},setsar=1,format=yuv420p"
    if scale_spec:
        post_vf = f"scale={scale_spec}:flags=lanczos,{post_vf}"
    fc_parts.append(f"{''.join(labels)}concat=n={len(segments)}:v=1:a=0,{post_vf}[vout]")
    return ";".join(fc_parts), segments


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute speech-envelope cross-correlation offset (and piecewise pause warp) for Seedance Method B lip-sync clips"
    )
    parser.add_argument("video", type=Path, help="Generated lip-sync video (.mp4) with temporary Seedance audio")
    parser.add_argument("ref_audio", type=Path, help="Our reference voiceover (.mp3/.wav, either slice or voice-master.wav)")
    parser.add_argument("--ref-start", type=float, default=0.0, help="Start offset (s) in ref_audio if passing full voice-master.wav")
    parser.add_argument("--ref-duration", type=float, default=0.0, help="Duration (s) to slice from ref_audio (0 = full file)")
    parser.add_argument("--target-duration", type=float, default=0.0, help="Target output cut duration in seconds (defaults to ref slice duration)")
    parser.add_argument("--fps", type=int, default=30, help="Target edit frame rate (default: 30)")
    parser.add_argument("--scale", default=None, help="Optional W:H scale (e.g. '1080:1920')")
    parser.add_argument("--clauses", default=None, help="Optional manual clause ranges in ref slice seconds, e.g. '0.05:1.64,1.70:4.28'")
    parser.add_argument("--max-shift", type=float, default=1.2, help="Max +/- lag search range in seconds (default: 1.2)")
    parser.add_argument("--drift-threshold", type=float, default=0.06, help="Inter-clause shift diff (s) triggering piecewise warp (default: 0.06)")
    parser.add_argument("-o", "--render-out", type=Path, default=None, help="Directly render the aligned silent (-an) MP4 to this path")
    parser.add_argument("--json", action="store_true", help="Output alignment report as JSON")
    args = parser.parse_args()

    if not args.video.is_file():
        raise FileNotFoundError(f"Video not found: {args.video}")
    if not args.ref_audio.is_file():
        raise FileNotFoundError(f"Reference audio not found: {args.ref_audio}")

    has_v, has_a, vid_dur = probe_streams(args.video)
    if not has_v:
        raise RuntimeError(f"No video stream in {args.video}")
    if not has_a:
        print(
            f"[lipsync_align] ERROR: '{args.video.name}' has NO audio stream (generated with audio=false / Method A).\n"
            f"Seedance does NOT align mouth movements when audio=false. Regenerate using Method B:\n"
            f"  python3 scripts/updream.py generate --model sed2-5 --mode ref2v --lipsync-audio -a <slice.mp3> ...",
            file=sys.stderr,
        )
        return 2

    _, ref_has_a, ref_total_dur = probe_streams(args.ref_audio)
    if not ref_has_a:
        raise RuntimeError(f"No audio stream in reference file: {args.ref_audio}")

    slice_dur = args.ref_duration if args.ref_duration > 0 else max(0.1, ref_total_dur - args.ref_start)
    target_dur = args.target_duration if args.target_duration > 0 else slice_dur
    target_frames = int(round(target_dur * args.fps))

    with tempfile.TemporaryDirectory(prefix="updream_lipsync_") as td:
        tmp = Path(td)
        vid_env = extract_db_envelope(args.video, tmp / "vid.wav")
        ref_env = extract_db_envelope(args.ref_audio, tmp / "ref.wav", start_s=args.ref_start, duration_s=slice_dur)

    hop_s = 0.01
    global_shift, global_corr = xcorr_segment(
        vid_env, ref_env, 0.0, len(ref_env) * hop_s, hop_s=hop_s, max_shift_s=args.max_shift
    )

    clause_bounds = parse_manual_clauses(args.clauses) if args.clauses else detect_speech_clauses(ref_env, hop_s=hop_s)
    clause_results: List[Dict[str, Any]] = []
    for idx, (c0, c1) in enumerate(clause_bounds, 1):
        sh, co = xcorr_segment(vid_env, ref_env, c0, c1, hop_s=hop_s, max_shift_s=args.max_shift)
        clause_results.append(
            {
                "clause": idx,
                "ref_start_s": c0,
                "ref_end_s": c1,
                "shift_s": sh,
                "video_clause_start_s": round(c0 + sh, 3),
                "corr": co,
            }
        )

    shifts = [c["shift_s"] for c in clause_results]
    max_clause_drift = round(max(shifts) - min(shifts), 3) if len(shifts) >= 2 else 0.0
    need_piecewise = len(clause_results) >= 2 and max_clause_drift > args.drift_threshold

    out_placeholder = str(args.render_out) if args.render_out else "aligned_silent.mp4"
    post_vf = f"fps={args.fps},setsar=1,format=yuv420p"
    if args.scale:
        post_vf = f"scale={args.scale}:flags=lanczos,{post_vf}"

    if not need_piecewise:
        best_shift = clause_results[0]["shift_s"] if len(clause_results) == 1 else global_shift
        start_in_vid = max(0.0, best_shift)
        method = "single_offset"
        piecewise_segments: List[Dict[str, Any]] = []
        filter_complex = None
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{start_in_vid:.3f}",
            "-i",
            str(args.video),
            "-frames:v",
            str(target_frames),
            "-vf",
            post_vf,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "15",
            "-pix_fmt",
            "yuv420p",
            "-an",
            out_placeholder,
        ]
    else:
        method = "piecewise_pause_warp"
        start_in_vid = max(0.0, clause_results[0]["shift_s"])
        filter_complex, piecewise_segments = build_piecewise_filter(
            clause_results,
            vid_dur=vid_dur,
            target_dur=target_dur,
            fps=args.fps,
            scale_spec=args.scale,
        )
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(args.video),
            "-filter_complex",
            filter_complex,
            "-map",
            "[vout]",
            "-frames:v",
            str(target_frames),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "15",
            "-pix_fmt",
            "yuv420p",
            "-an",
            out_placeholder,
        ]

    if args.render_out:
        args.render_out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(ffmpeg_cmd, check=True)

    report = {
        "video": str(args.video.resolve()),
        "video_duration_s": round(vid_dur, 3),
        "ref_audio": str(args.ref_audio.resolve()),
        "ref_slice": {"start_s": args.ref_start, "duration_s": round(slice_dur, 3)},
        "target_duration_s": round(target_dur, 3),
        "target_frames": target_frames,
        "fps": args.fps,
        "global_shift_s": global_shift,
        "global_corr": global_corr,
        "clauses": clause_results,
        "inter_clause_drift_s": max_clause_drift,
        "recommended_method": method,
        "recommended_video_start_s": round(start_in_vid, 3),
        "piecewise_segments": piecewise_segments,
        "filter_complex": filter_complex,
        "ffmpeg_command": ffmpeg_cmd,
        "rendered_output": str(args.render_out.resolve()) if args.render_out else None,
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"Video: {args.video.name} ({vid_dur:.2f}s) | Ref slice: +{args.ref_start:.2f}s ({slice_dur:.2f}s)")
        print(f"Global xcorr: shift={global_shift:+.3f}s, corr={global_corr:.3f}")
        for cl in clause_results:
            print(
                f"  Clause {cl['clause']} [{cl['ref_start_s']:.2f}s..{cl['ref_end_s']:.2f}s]: "
                f"shift={cl['shift_s']:+.3f}s (video @{cl['video_clause_start_s']:.3f}s), corr={cl['corr']:.3f}"
            )
        print(f"Recommended alignment: {method} (inter-clause drift={max_clause_drift:.3f}s, -an strips Seedance audio)")
        if args.render_out:
            print(f"Rendered silent aligned clip -> {args.render_out.resolve()} ({target_frames} frames @ {args.fps}fps)")
        else:
            quoted = " ".join(f"'{x}'" if (" " in x or ";" in x or "[" in x) else x for x in ffmpeg_cmd)
            print(f"Command:\n  {quoted}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
