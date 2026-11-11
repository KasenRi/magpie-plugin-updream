#!/usr/bin/env python3
"""Generic UPdream multi-model & multi-account video generation CLI via Magpie MCP JSON-RPC.

Environment variables (all overridable via CLI flags):
  - UPDREAM_ENV            Path to .env file (chmod 600) containing MAGPIE_API_KEY and optional MAGPIE_URL
                           (default: ./.env in current working directory)
  - UPDREAM_ACCOUNT        Optional UPdream account selector (slot id 'updream#...', label, alias, last-4, or 'options')
  - UPDREAM_LEDGER         Path to credits_ledger.csv (default: ./credits_ledger.csv)
  - UPDREAM_OUTPUT         Default output directory or .mp4 path (default: ./clips_raw)
  - UPDREAM_PURPOSE_PREFIX Optional prefix for per-film budget accounting (auto-derived from --purpose if unset)
  - UPDREAM_BUDGET_LIMIT   Default credit cap per film/prefix (default: 3000)

Subcommands:
  - account   Query UPdream account and remaining credit balance, or --all-accounts (0 credits)
  - models    List UPdream video models and parameter schemas (0 credits)
  - upload    Upload local image or audio (.png/.jpg/.mp3/.wav) to UPdream storage and return https URL (0 credits)
  - estimate  Estimate credits and check ledger budget projection without creating a task (0 credits)
  - generate  Estimate -> check budget & rework cap -> create_video -> wait_task -> download MP4 -> log ledger
              (pass --dry-run to validate & estimate without calling create_video)
  - wait      Resume polling and downloading an existing task_id and append to ledger
  - get       Single non-blocking get_task status check (0 credits)
  - cancel    Cancel a pending/processing task_id
  - ledger    Summarize local credits_ledger.csv totals, prefix usage, and rework counts (offline, 0 credits)
"""
import argparse
import csv
import datetime as dt
import fcntl
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_MAGPIE_URL = "http://127.0.0.1:3425/mcp/magpie/tools/updream"
LEDGER_HEADERS = ["timestamp", "purpose", "model", "duration", "mode", "task_id", "credits", "output_file"]

ALLOWED_SEEDANCE_MODELS = (
    "sed2-5",
    "sed2-5-draft",
    "wonder-ultra",
    "sed2",
    "wonder-pro",
    "sed2-fast",
    "sed2-mini",
)
SEEDANCE_25_MODELS = ("sed2-5", "sed2-5-draft", "wonder-ultra")
SEEDANCE_20_MODELS = ("sed2", "wonder-pro", "sed2-fast", "sed2-mini")

LEGACY_MODEL_ALIASES: Dict[str, str] = {
    "sed2-hsr": "sed2",
    "sed2-5-hsr": "sed2-5",
    "doubao-seedance-2-5": "sed2-5",
    "seedance25": "sed2-5",
    "doubao-seedance-2-0-mini": "sed2-mini",
    "seedance-2.0-mini": "sed2-mini",
    "seedance-2-0-mini": "sed2-mini",
    "yike-wonder-pro": "wonder-pro",
    "wan3.0": "wan-3.0",
    "minimax-h3": "hailuo-h3",
    "minimaxh3": "hailuo-h3",
}
POST_PROCESS_MODELS = ("video-enhance-standard", "video-enhance-pro", "subtitle-erase-pro")

# Per-model static spec matching magpie-plugin-updream src/models.mjs
MODEL_SPECS: Dict[str, Dict[str, Any]] = {
    # Seedance 2.5 family (CLI default duration=4s for cut-friendly workflow)
    "sed2-5": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"),
        "dur_range": (4, 30),
        "default_dur": 4,
        "mode_dur": {"video_edit": (-1, -1), "clip2v": (4, 180)},
        "default_res": "720p",
        "forced_adaptive": ("i2v", "firstlast", "video_edit", "clip2v"),
        "audio": True,
    },
    "sed2-5-draft": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"),
        "dur_range": (4, 30),
        "default_dur": 4,
        "mode_dur": {"video_edit": (-1, -1), "clip2v": (4, 30)},
        "default_res": "480p",
        "resolutions": ("480p",),
        "forced_adaptive": ("i2v", "firstlast", "video_edit", "clip2v"),
        "audio": True,
    },
    "wonder-ultra": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"),
        "dur_range": (4, 30),
        "default_dur": 4,
        "mode_dur": {"video_edit": (-1, -1), "clip2v": (4, 180)},
        "default_res": "720p",
        "forced_adaptive": ("i2v", "firstlast", "video_edit", "clip2v"),
        "audio": True,
    },
    # Seedance 2.0 family
    "sed2": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit"),
        "dur_range": (4, 15),
        "default_dur": 4,
        "default_res": "720p",
        "audio": True,
    },
    "wonder-pro": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit"),
        "dur_range": (4, 15),
        "default_dur": 4,
        "default_res": "720p",
        "disallow_adaptive": True,
        "audio": True,
    },
    "sed2-fast": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit"),
        "dur_range": (4, 15),
        "default_dur": 4,
        "default_res": "720p",
        "audio": True,
    },
    "sed2-mini": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit"),
        "dur_range": (4, 15),
        "default_dur": 4,
        "default_res": "720p",
        "disallow_adaptive": True,
        "audio": True,
    },
    # Non-Seedance adapted models (23 models)
    "kling-v4": {
        "modes": ("t2v", "i2v", "firstlast", "multiframe", "ref2v", "video_edit"),
        "dur_range": (3, 30),
        "default_dur": 5,
        "default_res": "1080p",
        "audio": False,
    },
    "kling-v3-omni": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v"),
        "dur_range": (3, 15),
        "default_dur": 5,
        "quality_modes": ("std", "pro", "4k"),
        "default_qm": "pro",
        "audio": True,
    },
    "kling-v3.0-std": {
        "modes": ("t2v", "i2v", "firstlast"),
        "dur_range": (3, 15),
        "default_dur": 5,
        "quality_modes": ("std", "pro", "4k"),
        "default_qm": "pro",
        "audio": True,
    },
    "kling-v3.0-turbo": {
        "modes": ("t2v", "i2v"),
        "dur_range": (3, 15),
        "default_dur": 5,
        "default_res": "1080P",
        "audio": False,
    },
    "kling-o1": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v"),
        "dur_range": (5, 10),
        "default_dur": 5,
        "quality_modes": ("std", "pro"),
        "default_qm": "pro",
        "audio": False,
    },
    "kling-v2-5-turbo": {
        "modes": ("t2v", "i2v"),
        "dur_values": (5, 10),
        "default_dur": 5,
        "quality_modes": ("std", "pro"),
        "default_qm": "pro",
        "audio": False,
    },
    "wan-3.0": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit"),
        "dur_range": (2, 30),
        "default_dur": 5,
        "default_res": "1080P",
        "quality_modes": ("standard", "prime"),
        "default_qm": "standard",
        "audio": True,
    },
    "wan-2.7": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit"),
        "dur_values": (5, 10, 15),
        "default_dur": 5,
        "default_res": "1080p",
        "audio": False,
    },
    "wan-2.6": {
        "modes": ("t2v", "i2v"),
        "dur_values": (5, 10, 15),
        "default_dur": 5,
        "default_res": "1080p",
        "audio": True,
    },
    "wan-2.6-ref2v": {
        "modes": ("ref2v",),
        "dur_values": (5, 10),
        "default_dur": 5,
        "default_res": "1080p",
        "audio": True,
    },
    "wan-2.5-preview": {
        "modes": ("t2v", "i2v"),
        "dur_values": (5, 10),
        "default_dur": 5,
        "default_res": "1080p",
        "audio": True,
    },
    "wan-2.2": {
        "modes": ("t2v", "i2v"),
        "dur_values": (5,),
        "default_dur": 5,
        "default_res": "1080p",
        "audio": False,
    },
    "vidu-q4": {
        "modes": ("i2v", "ref2v"),
        "dur_range": (3, 16),
        "default_dur": 5,
        "default_res": "720p",
        "audio": True,
    },
    "vidu-q2-pro": {
        "modes": ("i2v", "firstlast", "multiframe", "ref2v"),
        "dur_range": (1, 10),
        "default_dur": 5,
        "default_res": "720p",
        "audio": True,
    },
    "paiwo-v6max": {
        "modes": ("t2v", "i2v"),
        "dur_range": (1, 15),
        "default_dur": 5,
        "default_res": "720p",
        "audio": True,
    },
    "hailuo-h3": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v"),
        "dur_range": (5, 15),
        "default_dur": 5,
        "default_res": "2K",
        "audio": False,
    },
    "minimax-h3-max": {
        "modes": ("t2v", "i2v"),
        "dur_range": (5, 15),
        "default_dur": 5,
        "default_res": "768P",
        "audio": False,
    },
    "hailuo-2.3": {
        "modes": ("t2v", "i2v"),
        "dur_values": (6, 10),
        "default_dur": 6,
        "default_res": "768P",
        "default_ar": "16:9",
        "audio": False,
    },
    "happyhorse-1.1": {
        "modes": ("t2v", "i2v", "ref2v", "video_edit"),
        "dur_range": (3, 15),
        "default_dur": 5,
        "default_res": "1080P",
        "audio": False,
    },
    "happyhorse": {
        "modes": ("t2v", "i2v", "ref2v", "video_edit"),
        "dur_range": (3, 15),
        "default_dur": 5,
        "default_res": "1080P",
        "audio": False,
    },
    "gemini-omni-1.1-flash": {
        "modes": ("t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"),
        "dur_range": (3, 10),
        "default_dur": 5,
        "default_res": "720p",
        "audio": False,
    },
    "gemini-omni-flash": {
        "modes": ("t2v", "i2v", "ref2v", "video_edit"),
        "dur_values": (10,),
        "default_dur": 10,
        "default_res": "720p",
        "audio": False,
    },
    "veo-3.1-preview": {
        "modes": ("t2v", "i2v"),
        "dur_values": (4, 6, 8),
        "default_dur": 8,
        "default_res": "720p",
        "audio": True,
    },
}

ALLOWED_MODELS = tuple(MODEL_SPECS.keys())
SUBCOMMANDS = ("account", "models", "upload", "estimate", "generate", "wait", "get", "cancel", "ledger")


def default_account() -> Optional[str]:
    val = os.environ.get("UPDREAM_ACCOUNT", "").strip()
    return val or None


def normalize_model_id(raw_model: str) -> str:
    trimmed = raw_model.strip()
    return LEGACY_MODEL_ALIASES.get(trimmed, trimmed)


def default_env_path() -> Path:
    val = os.environ.get("UPDREAM_ENV", "").strip()
    return Path(val) if val else (Path.cwd() / ".env")


def default_ledger_path() -> Path:
    val = os.environ.get("UPDREAM_LEDGER", "").strip()
    return Path(val) if val else (Path.cwd() / "credits_ledger.csv")


def default_output_path() -> Path:
    val = os.environ.get("UPDREAM_OUTPUT", "").strip()
    return Path(val) if val else (Path.cwd() / "clips_raw")


def default_budget_limit() -> float:
    val = os.environ.get("UPDREAM_BUDGET_LIMIT", "").strip()
    if val:
        try:
            return float(val)
        except ValueError:
            pass
    return 3000.0


def load_env(env_path: Path) -> Dict[str, str]:
    env: Dict[str, str] = {}
    if env_path.is_file():
        st_mode = env_path.stat().st_mode & 0o777
        if st_mode & 0o077:
            print(
                f"[updream] Security warning: {env_path} has mode {oct(st_mode)}; recommend `chmod 600 {env_path}`.",
                file=sys.stderr,
            )
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'\"")
    for k in ("MAGPIE_URL", "MAGPIE_API_KEY"):
        if k in os.environ and os.environ[k]:
            env[k] = os.environ[k]
    return env


def _redact_secret(text: str, secret: Optional[str]) -> str:
    if secret and len(secret) >= 4 and secret in text:
        return text.replace(secret, "***REDACTED***")
    return text


def parse_rpc_or_sse(raw_text: str) -> Dict[str, Any]:
    """Parse either plain JSON-RPC response or SSE stream containing JSON-RPC data lines."""
    stripped = raw_text.strip()
    if stripped.startswith("{"):
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass

    last_msg: Optional[Dict[str, Any]] = None
    for line in stripped.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            data_str = line[len("data:") :].strip()
            if data_str.startswith("{"):
                try:
                    obj = json.loads(data_str)
                    if isinstance(obj, dict):
                        last_msg = obj
                except json.JSONDecodeError:
                    continue
    if last_msg is not None:
        return last_msg
    raise RuntimeError(f"Unable to parse Magpie MCP response: {stripped[:500]}")


def _call_updream_tool_once(
    tool_name: str,
    arguments: Dict[str, Any],
    env_path: Path,
    timeout: int = 90,
) -> Dict[str, Any]:
    env = load_env(env_path)
    magpie_url = env.get("MAGPIE_URL", DEFAULT_MAGPIE_URL)
    api_key = env.get("MAGPIE_API_KEY")
    parsed = urllib.parse.urlparse(magpie_url)
    # magpie answers loopback calls without a key; anything else needs one
    if not api_key and parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError(
            f"Missing MAGPIE_API_KEY (checked env file '{env_path}' and environment variable MAGPIE_API_KEY). "
            f"Pass --env /path/to/.env or set UPDREAM_ENV."
        )
    rpc_payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000) % 1000000,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        },
    }
    body_bytes = json.dumps(rpc_payload, ensure_ascii=False).encode("utf-8")

    conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(parsed.netloc, timeout=timeout)
    try:
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        conn.request(
            "POST",
            path,
            body=body_bytes,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                **({"Authorization": f"Bearer {api_key}"} if api_key else {}),
            },
        )
        resp = conn.getresponse()
        raw_bytes = resp.read()
        status = resp.status
    finally:
        conn.close()

    raw_text = _redact_secret(raw_bytes.decode("utf-8", errors="replace"), api_key)
    if status >= 400:
        raise RuntimeError(f"Magpie HTTP {status} calling {tool_name}: {raw_text[:500]}")

    rpc_obj = parse_rpc_or_sse(raw_text)
    if "error" in rpc_obj and rpc_obj["error"]:
        err_str = _redact_secret(json.dumps(rpc_obj["error"], ensure_ascii=False), api_key)
        raise RuntimeError(f"JSON-RPC error calling {tool_name}: {err_str}")

    result = rpc_obj.get("result") or {}
    is_error = bool(result.get("isError"))
    if "structuredContent" in result and isinstance(result["structuredContent"], dict):
        data = result["structuredContent"]
        if is_error:
            raise RuntimeError(f"Tool {tool_name} error: {_redact_secret(json.dumps(data, ensure_ascii=False), api_key)}")
        return data

    content_list = result.get("content") or []
    texts: List[str] = []
    for item in content_list:
        if isinstance(item, dict) and item.get("type") == "text" and "text" in item:
            texts.append(item["text"])
    joined = _redact_secret("\n".join(texts).strip(), api_key)
    if is_error:
        raise RuntimeError(f"Tool {tool_name} returned error: {joined}")
    if joined.startswith("{") or joined.startswith("["):
        try:
            parsed_json = json.loads(joined)
            if isinstance(parsed_json, dict):
                return parsed_json
            return {"data": parsed_json}
        except json.JSONDecodeError:
            pass
    return {"raw_text": joined, "result": result}


def call_updream_tool(
    tool_name: str,
    arguments: Dict[str, Any],
    env_path: Path,
    timeout: int = 90,
) -> Dict[str, Any]:
    last_exc: Optional[Exception] = None
    for attempt in range(1, 6):
        try:
            return _call_updream_tool_once(tool_name, arguments, env_path=env_path, timeout=timeout)
        except Exception as exc:
            last_exc = exc
            msg = str(exc)
            if any(
                k in msg
                for k in ("ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "socket", "fetch", "502", "503", "504", "timed out")
            ):
                print(
                    f"[updream] Transient error in {tool_name} (attempt {attempt}/5): {msg[:180]}... retrying in {2 * attempt}s",
                    file=sys.stderr,
                )
                time.sleep(2 * attempt)
                continue
            raise
    raise last_exc  # type: ignore[misc]


def strip_purpose_tags(purpose: str) -> str:
    """Remove trailing bracket annotations like `[rework: ...]` or `[FAILED]`."""
    return purpose.split("[", 1)[0].strip()


def resolve_purpose_prefix(purpose: str, explicit_prefix: Optional[str] = None) -> str:
    """Resolve prefix used to tally film-level credits in credits_ledger.csv.

    Priority:
      1. CLI `--purpose-prefix` (pass `"*"` or `"ALL"` to sum the entire ledger without prefix filtering)
      2. Environment variable `UPDREAM_PURPOSE_PREFIX`
      3. Auto-derived from `--purpose` up to the first `_` or `-` (e.g. `f013_seg01_v1` -> `f013_`)
    """
    if explicit_prefix is not None:
        p = explicit_prefix.strip()
        return "" if p in ("*", "ALL", "all") else p
    env_p = os.environ.get("UPDREAM_PURPOSE_PREFIX", "").strip()
    if env_p:
        return "" if env_p in ("*", "ALL", "all") else env_p
    clean = strip_purpose_tags(purpose)
    if "_" in clean:
        return clean.split("_", 1)[0] + "_"
    if "-" in clean:
        return clean.split("-", 1)[0] + "-"
    return clean


def derive_shot_stem(purpose: str, explicit_shot_key: Optional[str] = None) -> str:
    """Derive canonical shot stem to count attempts/reworks for the same shot.

    E.g. `f013_seg08_s08_crown_walkby_v2 [rework: ...]` -> `f013_seg08_s08_crown_walkby`
    """
    if explicit_shot_key:
        return explicit_shot_key.strip()
    clean = strip_purpose_tags(purpose)
    return re.sub(r"_(?:v\d+|rework\d*|retry\d*)$", "", clean, flags=re.IGNORECASE)


def read_ledger_rows(ledger_path: Path) -> List[Dict[str, str]]:
    if not ledger_path.is_file():
        return []
    with ledger_path.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def read_ledger_total(ledger_path: Path, purpose_prefix: Optional[str] = None) -> float:
    total = 0.0
    for row in read_ledger_rows(ledger_path):
        if purpose_prefix:
            purp = (row.get("purpose") or "").strip()
            if not purp.startswith(purpose_prefix):
                continue
        val = (row.get("credits") or "").strip()
        if val:
            try:
                total += float(val)
            except ValueError:
                pass
    return total


def count_shot_attempts(ledger_path: Path, shot_stem: str) -> int:
    """Count completed (non-[FAILED]) ledger entries sharing the same shot stem."""
    if not shot_stem:
        return 0
    count = 0
    for row in read_ledger_rows(ledger_path):
        raw_purp = (row.get("purpose") or "").strip()
        if "[FAILED]" in raw_purp:
            continue
        if derive_shot_stem(raw_purp) == shot_stem:
            count += 1
    return count


def append_ledger_row(
    purpose: str,
    model: str,
    duration: int,
    mode: str,
    task_id: str,
    credits: Any,
    output_file: str,
    ledger_path: Path,
) -> None:
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    now_str = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    with ledger_path.open("a+", encoding="utf-8", newline="") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            f.seek(0, os.SEEK_END)
            write_header = f.tell() == 0
            writer = csv.writer(f)
            if write_header:
                writer.writerow(LEDGER_HEADERS)
            writer.writerow([now_str, purpose, model, duration, mode, task_id, credits, output_file])
            f.flush()
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def format_ledger_purpose(purpose: str, rework_reason: Optional[str]) -> str:
    base = purpose.strip()
    if rework_reason and "[rework:" not in base:
        return f"{base} [rework: {rework_reason.strip()}]"
    return base


def extract_estimated_credits(est_resp: Dict[str, Any]) -> float:
    for key in ("total_estimated_credits", "credits", "cost_credits", "estimated_credits", "total_credits", "credit", "cost"):
        if key in est_resp and est_resp[key] is not None:
            try:
                return float(est_resp[key])
            except (TypeError, ValueError):
                pass
    for subkey in ("data", "estimate", "result"):
        sub = est_resp.get(subkey)
        if isinstance(sub, dict):
            for key in ("total_estimated_credits", "credits", "cost_credits", "estimated_credits", "total_credits", "credit", "cost"):
                if key in sub and sub[key] is not None:
                    try:
                        return float(sub[key])
                    except (TypeError, ValueError):
                        pass
    return 0.0


def extract_video_url_and_credits(task_resp: Dict[str, Any]) -> Tuple[Optional[str], Optional[float], str]:
    status = str(task_resp.get("status") or task_resp.get("state") or "")
    video_url: Optional[str] = None
    for k in ("video_url", "url", "output_url"):
        if isinstance(task_resp.get(k), str) and task_resp[k].startswith("http"):
            video_url = task_resp[k]
            break
    if not video_url:
        urls = (
            task_resp.get("videos")
            or task_resp.get("video_urls")
            or task_resp.get("urls")
            or task_resp.get("outputs")
        )
        if isinstance(urls, list) and urls:
            first = urls[0]
            if isinstance(first, str) and first.startswith("http"):
                video_url = first
            elif isinstance(first, dict):
                video_url = first.get("video_url") or first.get("url")
    if not video_url and isinstance(task_resp.get("task"), dict):
        sub_url, _, sub_status = extract_video_url_and_credits(task_resp["task"])
        video_url = video_url or sub_url
        status = status or sub_status

    cost_credits: Optional[float] = None
    for ck in ("cost_credits", "credits", "credit_cost", "used_credits"):
        if task_resp.get(ck) is not None:
            try:
                cost_credits = float(task_resp[ck])
                break
            except (TypeError, ValueError):
                pass
    if cost_credits is None and isinstance(task_resp.get("task"), dict):
        for ck in ("cost_credits", "credits", "credit_cost", "used_credits"):
            if task_resp["task"].get(ck) is not None:
                try:
                    cost_credits = float(task_resp["task"][ck])
                    break
                except (TypeError, ValueError):
                    pass
    return video_url, cost_credits, status


def download_file(url: str, dest_path: Path) -> int:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 5):
        cmd = [
            "curl",
            "-L",
            "--retry",
            "5",
            "--retry-delay",
            "2",
            "--retry-all-errors",
            "-C",
            "-",
            "-sS",
            "-o",
            str(dest_path),
            url,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode == 0 and dest_path.is_file() and dest_path.stat().st_size > 0:
            return dest_path.stat().st_size
        time.sleep(1.5 * attempt)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    dest_path.write_bytes(data)
    return len(data)


def upload_local_asset(
    file_path: str,
    env_path: Path,
    filename: Optional[str] = None,
    folder: Optional[str] = None,
    account: Optional[str] = None,
) -> Dict[str, Any]:
    p = Path(file_path).resolve()
    if not p.is_file():
        raise FileNotFoundError(f"Asset file not found: {p}")
    up_args: Dict[str, Any] = {"path": str(p)}
    if filename:
        up_args["filename"] = filename
    if folder:
        up_args["folder"] = folder
    if account:
        up_args["account"] = account
    return call_updream_tool("upload_image", up_args, env_path=env_path)


def extract_uploaded_url(up_resp: Dict[str, Any]) -> str:
    for k in ("url", "image_url", "file_url", "https_url"):
        val = up_resp.get(k)
        if isinstance(val, str) and val.startswith("http"):
            return val
    for subk in ("data", "result"):
        sub = up_resp.get(subk)
        if isinstance(sub, dict):
            for k in ("url", "image_url", "file_url", "https_url"):
                val = sub.get(k)
                if isinstance(val, str) and val.startswith("http"):
                    return val
    raise RuntimeError(f"Could not extract URL from upload_image response: {json.dumps(up_resp, ensure_ascii=False)}")


def infer_cli_mode(args: argparse.Namespace, spec: Dict[str, Any]) -> str:
    if args.mode:
        return args.mode
    if args.first_frame and args.last_frame:
        return "firstlast"
    if args.first_frame:
        return "i2v"
    if getattr(args, "reference_images", None) or getattr(args, "reference_videos", None) or getattr(args, "reference_audios", None):
        return "ref2v"
    if "t2v" in spec["modes"]:
        return "t2v"
    return spec["modes"][0]


def resolve_cli_duration(args: argparse.Namespace, mode: str, spec: Dict[str, Any]) -> int:
    if args.duration is not None:
        return int(args.duration)
    mode_dur = spec.get("mode_dur", {}).get(mode)
    if mode_dur and mode_dur[0] == mode_dur[1]:
        return int(mode_dur[0])
    return int(spec["default_dur"])


def validate_generation_policy(
    args: argparse.Namespace,
    model_id: str,
    mode: str,
    duration: int,
    spec: Dict[str, Any],
) -> None:
    if mode not in spec["modes"]:
        raise RuntimeError(
            f"Invalid mode '{mode}' for model '{model_id}'. Allowed modes for {model_id}: {spec['modes']}."
        )

    mode_dur = spec.get("mode_dur", {}).get(mode)
    if mode_dur:
        lo, hi = mode_dur
        if duration < lo or duration > hi:
            raise RuntimeError(f"Invalid duration {duration}s for {model_id} mode '{mode}' (allowed: {lo}..{hi}s).")
    elif "dur_values" in spec:
        if duration not in spec["dur_values"]:
            raise RuntimeError(
                f"Invalid duration {duration}s for model '{model_id}' (allowed values: {spec['dur_values']})."
            )
    else:
        lo, hi = spec["dur_range"]
        if duration < lo or duration > hi:
            hint = " For ~2s edit cuts on Seedance, generate -d 4 and trim in editing." if model_id in ALLOWED_SEEDANCE_MODELS else ""
            raise RuntimeError(f"Invalid duration {duration}s for model '{model_id}' (allowed: {lo}-{hi}s).{hint}")

    if model_id == "hailuo-2.3" and duration == 10 and args.resolution and args.resolution.lower() != "768p":
        raise RuntimeError("Model 'hailuo-2.3' at 10s supports resolution '768P' only.")

    if "resolutions" in spec and args.resolution and args.resolution.lower() not in [r.lower() for r in spec["resolutions"]]:
        raise RuntimeError(f"Invalid resolution '{args.resolution}' for '{model_id}' (allowed: {spec['resolutions']}).")

    if getattr(args, "quality_mode", None):
        allowed_qm = spec.get("quality_modes")
        if not allowed_qm or args.quality_mode not in allowed_qm:
            raise RuntimeError(
                f"Invalid --quality-mode '{args.quality_mode}' for '{model_id}' (allowed: {allowed_qm or 'none'})."
            )

    aspect_ratio = args.aspect_ratio or spec.get("default_ar", "9:16")
    if aspect_ratio == "adaptive" and spec.get("disallow_adaptive"):
        raise RuntimeError(f"Model '{model_id}' does not allow aspect_ratio='adaptive'; specify e.g. '9:16' or '16:9'.")

    lipsync_flag = bool(getattr(args, "lipsync_audio", False))
    allow_native_flag = bool(getattr(args, "allow_native_audio", False))
    use_audio = bool(args.audio) or lipsync_flag or allow_native_flag
    if lipsync_flag:
        if not getattr(args, "reference_audios", None):
            raise RuntimeError("Method B lip-sync (--lipsync-audio) requires -a / --ref-audio <clip.mp3>.")
        if not spec.get("audio"):
            raise RuntimeError(f"Model '{model_id}' does not support audio generation for --lipsync-audio.")
    elif args.audio and not allow_native_flag:
        raise RuntimeError(
            "Policy violation: native audio must remain disabled by default (audio=False), except when BOTH "
            "--lipsync-audio and --ref-audio <clip.mp3> are passed for Seedance Method B lip-sync (strip track with -an "
            "in final assembly), or when --allow-native-audio is explicitly passed on an audio-capable model."
        )
    if use_audio and not spec.get("audio"):
        raise RuntimeError(f"Model '{model_id}' does not support native audio generation.")

    if mode == "t2v":
        if (
            args.first_frame
            or args.last_frame
            or getattr(args, "reference_images", None)
            or getattr(args, "reference_videos", None)
            or getattr(args, "reference_audios", None)
        ):
            raise RuntimeError("Mode 't2v' does not accept frame or reference media attachments.")
    elif mode in ("i2v", "firstlast"):
        if not args.first_frame:
            raise RuntimeError(f"Mode '{mode}' requires --first-frame <image_path_or_url>.")
        if mode == "firstlast" and not args.last_frame:
            raise RuntimeError("Mode 'firstlast' requires --last-frame <image_path_or_url>.")
    elif mode == "multiframe":
        total_imgs = (1 if args.first_frame else 0) + len(getattr(args, "reference_images", None) or [])
        if total_imgs < 3 or total_imgs > 10:
            raise RuntimeError(f"Mode 'multiframe' on '{model_id}' requires 3-10 keyframe images (-r), got {total_imgs}.")
    elif mode == "ref2v":
        total_refs = (
            len(getattr(args, "reference_images", None) or [])
            + len(getattr(args, "reference_videos", None) or [])
            + len(getattr(args, "reference_audios", None) or [])
        )
        if total_refs < 1:
            raise RuntimeError("Mode 'ref2v' requires at least one reference item (-r / -v / -a).")
    elif mode in ("video_edit", "clip2v"):
        if not getattr(args, "reference_videos", None):
            raise RuntimeError(f"Mode '{mode}' requires at least one reference video (-v / --ref-video).")


def build_generation_args(args: argparse.Namespace, *, allow_upload: bool = True) -> Dict[str, Any]:
    raw_model = (args.model or "sed2").strip()
    model_id = normalize_model_id(raw_model)
    if model_id == "test":
        raise RuntimeError("Model 'test' is an internal UPdream mock model and is not supported.")
    if model_id in POST_PROCESS_MODELS:
        raise RuntimeError(
            f"Model '{raw_model}' is a video post-processing utility (enhance/subtitle-erase), not supported by create_video."
        )
    if model_id not in MODEL_SPECS:
        raise RuntimeError(f"Unsupported UPdream model '{raw_model}'. Allowed models: {ALLOWED_MODELS}")

    spec = MODEL_SPECS[model_id]
    mode = infer_cli_mode(args, spec)
    duration = resolve_cli_duration(args, mode, spec)
    validate_generation_policy(args, model_id, mode, duration, spec)

    use_audio = bool(args.audio) or bool(getattr(args, "lipsync_audio", False)) or bool(getattr(args, "allow_native_audio", False))
    aspect_ratio = args.aspect_ratio or spec.get("default_ar", "9:16")
    forced_adaptive = spec.get("forced_adaptive") or ()
    if mode in forced_adaptive and aspect_ratio != "adaptive":
        print(
            f"[updream] Note: {model_id} {mode} forces aspect_ratio='adaptive' (inherits input media aspect ratio).",
            file=sys.stderr,
        )
        aspect_ratio = "adaptive"

    gen_args: Dict[str, Any] = {
        "prompt": args.prompt,
        "model": model_id,
        "mode": mode,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "num_videos": args.num_videos,
    }
    if spec.get("audio"):
        gen_args["audio"] = use_audio
    if getattr(args, "account", None):
        gen_args["account"] = args.account

    if args.resolution:
        gen_args["resolution"] = args.resolution
    elif spec.get("default_res"):
        gen_args["resolution"] = spec["default_res"]

    if getattr(args, "quality_mode", None):
        gen_args["quality_mode"] = args.quality_mode
    elif spec.get("quality_modes") and not args.resolution and spec.get("default_qm"):
        gen_args["quality_mode"] = spec["default_qm"]

    if model_id in SEEDANCE_20_MODELS:
        gen_args["bitrate_mode"] = args.bitrate_mode
    if getattr(args, "output_format", None):
        gen_args["output_format"] = args.output_format
    if getattr(args, "negative_prompt", None):
        gen_args["negative_prompt"] = args.negative_prompt
    if getattr(args, "cfg_scale", None) is not None:
        gen_args["cfg_scale"] = args.cfg_scale
    if getattr(args, "prompt_extend", None) is not None:
        gen_args["prompt_extend"] = args.prompt_extend
    if getattr(args, "enhance_prompt", None) is not None:
        gen_args["enhance_prompt"] = args.enhance_prompt
    if getattr(args, "shot_type", None):
        gen_args["shot_type"] = args.shot_type
    if getattr(args, "keep_original_sound", None) is not None:
        gen_args["keep_original_sound"] = args.keep_original_sound

    if args.first_frame:
        if not args.first_frame.startswith("http"):
            fp = Path(args.first_frame).resolve()
            if not fp.is_file():
                raise FileNotFoundError(f"First frame image not found: {fp}")
            gen_args["first_frame"] = str(fp)
        else:
            gen_args["first_frame"] = args.first_frame
    if args.last_frame:
        if not args.last_frame.startswith("http"):
            lp = Path(args.last_frame).resolve()
            if not lp.is_file():
                raise FileNotFoundError(f"Last frame image not found: {lp}")
            gen_args["last_frame"] = str(lp)
        else:
            gen_args["last_frame"] = args.last_frame
    if args.reference_images:
        resolved_imgs: List[str] = []
        for p in args.reference_images:
            if p.startswith("http"):
                resolved_imgs.append(p)
            else:
                ip = Path(p).resolve()
                if not ip.is_file():
                    raise FileNotFoundError(f"Reference image not found: {ip}")
                resolved_imgs.append(str(ip))
        gen_args["reference_images"] = resolved_imgs
    if getattr(args, "reference_videos", None):
        resolved_vids: List[str] = []
        for p in args.reference_videos:
            if p.startswith("http"):
                resolved_vids.append(p)
            else:
                vp = Path(p).resolve()
                if not vp.is_file():
                    raise FileNotFoundError(f"Reference video not found: {vp}")
                if allow_upload:
                    up_resp = upload_local_asset(str(vp), env_path=args.env, account=getattr(args, "account", None))
                    resolved_vids.append(extract_uploaded_url(up_resp))
                else:
                    resolved_vids.append(str(vp))
        gen_args["reference_videos"] = resolved_vids
    if getattr(args, "reference_audios", None):
        resolved_auds: List[str] = []
        for p in args.reference_audios:
            if p.startswith("http"):
                resolved_auds.append(p)
            else:
                ap = Path(p).resolve()
                if not ap.is_file():
                    raise FileNotFoundError(f"Reference audio not found: {ap}")
                if allow_upload:
                    up_resp = upload_local_asset(str(ap), env_path=args.env, account=getattr(args, "account", None))
                    resolved_auds.append(extract_uploaded_url(up_resp))
                else:
                    resolved_auds.append(str(ap))
        gen_args["reference_audios"] = resolved_auds
    return gen_args


def build_estimate_args(gen_args: Dict[str, Any], args: argparse.Namespace) -> Dict[str, Any]:
    est_args = dict(gen_args)
    if getattr(args, "ref_video_seconds", None) is not None and args.ref_video_seconds > 0:
        est_args["ref_video_seconds"] = int(args.ref_video_seconds)
    return est_args


def cmd_upload(args: argparse.Namespace) -> int:
    if args.path.startswith("http://") or args.path.startswith("https://"):
        up_args: Dict[str, Any] = {"url": args.path}
        if args.filename:
            up_args["filename"] = args.filename
        if args.folder:
            up_args["folder"] = args.folder
        if args.account:
            up_args["account"] = args.account
        res = call_updream_tool("upload_image", up_args, env_path=args.env)
    else:
        res = upload_local_asset(
            args.path,
            env_path=args.env,
            filename=args.filename,
            folder=args.folder,
            account=args.account,
        )
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


def cmd_account(args: argparse.Namespace) -> int:
    acc_args: Dict[str, Any] = {}
    if args.account:
        acc_args["account"] = args.account
    if getattr(args, "all_accounts", False):
        acc_args["all_accounts"] = True
    res = call_updream_tool("account", acc_args, env_path=args.env)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


def cmd_models(args: argparse.Namespace) -> int:
    mdl_args: Dict[str, Any] = {
        "include_all_models": bool(args.all_models),
        "include_live": not bool(args.no_live),
    }
    if args.account:
        mdl_args["account"] = args.account
    res = call_updream_tool("list_video_models", mdl_args, env_path=args.env)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


def cmd_get(args: argparse.Namespace) -> int:
    get_args: Dict[str, Any] = {"task_id": args.task_id}
    if args.node_id:
        get_args["node_id"] = args.node_id
    if args.account:
        get_args["account"] = args.account
    res = call_updream_tool("get_task", get_args, env_path=args.env)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


def cmd_cancel(args: argparse.Namespace) -> int:
    can_args: Dict[str, Any] = {"task_id": args.task_id}
    if args.account:
        can_args["account"] = args.account
    res = call_updream_tool("cancel_task", can_args, env_path=args.env)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


def cmd_ledger(args: argparse.Namespace) -> int:
    rows = read_ledger_rows(args.ledger)
    prefix = ""
    if args.purpose_prefix is not None:
        prefix = "" if args.purpose_prefix in ("*", "ALL", "all") else args.purpose_prefix.strip()
    elif os.environ.get("UPDREAM_PURPOSE_PREFIX"):
        env_p = os.environ["UPDREAM_PURPOSE_PREFIX"].strip()
        prefix = "" if env_p in ("*", "ALL", "all") else env_p

    global_total = 0.0
    prefix_total = 0.0
    by_model: Dict[str, float] = {}
    completed_count = 0
    failed_count = 0
    rework_rows: List[str] = []

    for r in rows:
        purp = (r.get("purpose") or "").strip()
        val_s = (r.get("credits") or "0").strip()
        try:
            cred = float(val_s) if val_s else 0.0
        except ValueError:
            cred = 0.0
        global_total += cred
        if prefix and not purp.startswith(prefix):
            continue
        prefix_total += cred
        if "[FAILED]" in purp:
            failed_count += 1
        else:
            completed_count += 1
        mdl = (r.get("model") or "unknown").strip()
        by_model[mdl] = by_model.get(mdl, 0.0) + cred
        if "[rework:" in purp.lower():
            rework_rows.append(purp)

    summary = {
        "ledger_path": str(args.ledger.resolve()),
        "exists": args.ledger.is_file(),
        "purpose_prefix": prefix or "*",
        "prefix_used_credits": prefix_total,
        "global_used_credits": global_total,
        "budget_limit": args.budget_limit,
        "budget_remaining": (args.budget_limit - prefix_total) if args.budget_limit > 0 else None,
        "completed_tasks": completed_count,
        "failed_tasks": failed_count,
        "credits_by_model": by_model,
        "rework_entries": rework_rows,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def cmd_estimate(args: argparse.Namespace) -> int:
    gen_args = build_generation_args(args, allow_upload=False)
    est_args = build_estimate_args(gen_args, args)
    res = call_updream_tool("estimate_credits", est_args, env_path=args.env)
    prefix = resolve_purpose_prefix(args.purpose, args.purpose_prefix)
    global_used = read_ledger_total(args.ledger)
    task_used = read_ledger_total(args.ledger, purpose_prefix=prefix) if prefix else global_used
    est = extract_estimated_credits(res)
    shot_stem = derive_shot_stem(args.purpose, args.shot_key)
    prior_attempts = count_shot_attempts(args.ledger, shot_stem)
    within_budget = True if args.budget_limit <= 0 else (task_used + est) <= args.budget_limit

    out = {
        "estimate_response": res,
        "estimated_credits": est,
        "account": res.get("account") or args.account,
        "purpose": args.purpose,
        "purpose_prefix": prefix or "*",
        "shot_stem": shot_stem,
        "prior_shot_attempts": prior_attempts,
        "ledger_path": str(args.ledger),
        "ledger_used_credits": global_used,
        "prefix_used_credits": task_used,
        "projected_prefix_credits": task_used + est,
        "projected_total_credits": global_used + est,
        "budget_limit": args.budget_limit,
        "within_budget": within_budget,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def poll_and_download(
    task_id: str,
    node_id: Optional[str],
    output_target: Path,
    file_purpose: str,
    ledger_purpose: str,
    model: str,
    duration: int,
    mode: str,
    fallback_credits: float,
    max_wait: int,
    ledger_path: Path,
    env_path: Path,
    account: Optional[str] = None,
) -> Dict[str, Any]:
    start_ts = time.time()
    last_resp: Dict[str, Any] = {}
    while True:
        elapsed = time.time() - start_ts
        if elapsed > max_wait:
            raise RuntimeError(
                f"Task {task_id} timed out after {int(elapsed)}s. Last response: {json.dumps(last_resp, ensure_ascii=False)}"
            )

        wait_args: Dict[str, Any] = {
            "task_id": task_id,
            "timeout_seconds": 45,
            "interval_seconds": 5,
        }
        if node_id:
            wait_args["node_id"] = node_id
        if account:
            wait_args["account"] = account

        print(f"[updream] Waiting on task_id={task_id} (elapsed={int(elapsed)}s)...", file=sys.stderr)
        try:
            last_resp = call_updream_tool("wait_task", wait_args, env_path=env_path, timeout=65)
        except Exception as exc:
            print(f"[updream] Transient error in wait_task ({exc}), retrying in 5s...", file=sys.stderr)
            time.sleep(5)
            continue

        video_url, cost_credits, status = extract_video_url_and_credits(last_resp)
        timed_out = bool(last_resp.get("timed_out"))

        if status.lower() in ("failed", "error", "cancelled", "canceled", "rejected"):
            append_ledger_row(
                purpose=f"{ledger_purpose} [FAILED]",
                model=model,
                duration=duration,
                mode=mode,
                task_id=task_id,
                credits=cost_credits or 0,
                output_file="",
                ledger_path=ledger_path,
            )
            raise RuntimeError(f"Task {task_id} failed: {json.dumps(last_resp, ensure_ascii=False)}")

        if video_url:
            if output_target.suffix.lower() in (".mp4", ".mov"):
                mp4_path = output_target
            else:
                ext = ".mov" if video_url.split("?", 1)[0].lower().endswith(".mov") else ".mp4"
                clean_stem = strip_purpose_tags(file_purpose)
                safe_purpose = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in clean_stem).strip("_") or "clip"
                mp4_path = output_target / f"{safe_purpose}{ext}"
                if mp4_path.exists():
                    mp4_path = output_target / f"{safe_purpose}_{task_id[:8]}{ext}"

            size_bytes = download_file(video_url, mp4_path)
            final_credits: Any = cost_credits if (cost_credits is not None and cost_credits > 0) else fallback_credits
            if isinstance(final_credits, float) and final_credits == int(final_credits):
                final_credits = int(final_credits)

            append_ledger_row(
                purpose=ledger_purpose,
                model=model,
                duration=duration,
                mode=mode,
                task_id=task_id,
                credits=final_credits,
                output_file=str(mp4_path.resolve()),
                ledger_path=ledger_path,
            )
            return {
                "status": "completed",
                "account": last_resp.get("account") or account,
                "purpose": ledger_purpose,
                "task_id": task_id,
                "node_id": node_id,
                "model": model,
                "mode": mode,
                "duration": duration,
                "cost_credits": final_credits,
                "video_url": video_url,
                "output_file": str(mp4_path.resolve()),
                "file_size_bytes": size_bytes,
                "ledger_total_credits": read_ledger_total(ledger_path),
                "wait_response": last_resp,
            }

        if not timed_out and status.lower() == "completed":
            get_args: Dict[str, Any] = {"task_id": task_id}
            if node_id:
                get_args["node_id"] = node_id
            if account:
                get_args["account"] = account
            last_resp = call_updream_tool("get_task", get_args, env_path=env_path)
            video_url, cost_credits, status = extract_video_url_and_credits(last_resp)
            if video_url:
                continue
            raise RuntimeError(
                f"Task {task_id} marked completed but no video_url found: {json.dumps(last_resp, ensure_ascii=False)}"
            )


def cmd_generate(args: argparse.Namespace) -> int:
    pre_args = build_generation_args(args, allow_upload=False)
    resolved_model = str(pre_args["model"])
    resolved_mode = str(pre_args["mode"])
    resolved_duration = int(pre_args["duration"])

    prefix = resolve_purpose_prefix(args.purpose, args.purpose_prefix)
    shot_stem = derive_shot_stem(args.purpose, args.shot_key)
    prior_attempts = count_shot_attempts(args.ledger, shot_stem)
    if args.max_attempts > 0 and prior_attempts >= args.max_attempts and not args.allow_extra_rework:
        raise RuntimeError(
            f"Rework limit reached for shot '{shot_stem}': {prior_attempts} completed attempt(s) already in "
            f"{args.ledger} (max_attempts={args.max_attempts}, i.e. 1 initial + {args.max_attempts - 1} reworks). "
            f"Change strategy (e.g. switch to i2v first-frame or sed2) or pass --allow-extra-rework if authorized."
        )

    ledger_purpose = format_ledger_purpose(args.purpose, args.rework_reason)
    if (prior_attempts >= 1 or re.search(r"_v[2-9]\b", strip_purpose_tags(args.purpose))) and "[rework:" not in ledger_purpose:
        print(
            f"[updream] Note: '{args.purpose}' looks like rework #{prior_attempts} for '{shot_stem}'; "
            f"pass --rework-reason '...' to record the reason in credits_ledger.csv.",
            file=sys.stderr,
        )

    global_used = read_ledger_total(args.ledger)
    prefix_used = read_ledger_total(args.ledger, purpose_prefix=prefix) if prefix else global_used
    estimated_credits = 0.0
    est_resp: Optional[Dict[str, Any]] = None

    if not args.no_estimate:
        est_args = build_estimate_args(pre_args, args)
        est_resp = call_updream_tool("estimate_credits", est_args, env_path=args.env)
        estimated_credits = extract_estimated_credits(est_resp)
        print(
            f"[updream] Credit check (prefix='{prefix or '*'}'): global_used={global_used:g}, "
            f"prefix_used={prefix_used:g}, estimated={estimated_credits:g}, "
            f"projected={prefix_used + estimated_credits:g} / budget_limit={args.budget_limit:g}",
            file=sys.stderr,
        )
        if args.budget_limit > 0 and (prefix_used + estimated_credits) > args.budget_limit:
            raise RuntimeError(
                f"Budget limit exceeded for prefix '{prefix or '*'}'! "
                f"Used ({prefix_used:g}) + Estimated ({estimated_credits:g}) = "
                f"{prefix_used + estimated_credits:g} > Budget Limit ({args.budget_limit:g}). Refusing to submit."
            )

    if getattr(args, "dry_run", False):
        within_budget = True if args.budget_limit <= 0 else (prefix_used + estimated_credits) <= args.budget_limit
        dry_out = {
            "status": "dry_run",
            "account": (est_resp or {}).get("account") or args.account,
            "purpose": ledger_purpose,
            "purpose_prefix": prefix or "*",
            "shot_stem": shot_stem,
            "prior_shot_attempts": prior_attempts,
            "create_video_args": pre_args,
            "estimate_executed": not bool(args.no_estimate),
            "estimate_response": est_resp,
            "estimated_credits": estimated_credits if not args.no_estimate else None,
            "prefix_used_credits": prefix_used,
            "projected_prefix_credits": prefix_used + estimated_credits,
            "budget_limit": args.budget_limit,
            "within_budget": within_budget,
        }
        print(json.dumps(dry_out, ensure_ascii=False, indent=2))
        return 0

    gen_args = build_generation_args(args, allow_upload=True)
    create_resp = call_updream_tool("create_video", gen_args, env_path=args.env)
    task_id = str(create_resp.get("task_id") or (create_resp.get("data") or {}).get("task_id") or "")
    node_id = str(create_resp.get("node_id") or (create_resp.get("data") or {}).get("node_id") or "") or None
    resolved_account = create_resp.get("account") or args.account
    if not task_id:
        raise RuntimeError(f"create_video did not return a task_id: {json.dumps(create_resp, ensure_ascii=False)}")

    print(f"[updream] Created task_id={task_id}, node_id={node_id}, account={resolved_account}", file=sys.stderr)
    result = poll_and_download(
        task_id=task_id,
        node_id=node_id,
        output_target=args.output,
        file_purpose=args.purpose,
        ledger_purpose=ledger_purpose,
        model=resolved_model,
        duration=resolved_duration,
        mode=resolved_mode,
        fallback_credits=estimated_credits,
        max_wait=args.max_wait,
        ledger_path=args.ledger,
        env_path=args.env,
        account=resolved_account,
    )
    result["estimated_credits"] = estimated_credits
    result["purpose_prefix"] = prefix or "*"
    result["create_response"] = create_resp
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_wait(args: argparse.Namespace) -> int:
    ledger_purpose = format_ledger_purpose(args.purpose, args.rework_reason)
    result = poll_and_download(
        task_id=args.task_id,
        node_id=args.node_id,
        output_target=args.output,
        file_purpose=args.purpose,
        ledger_purpose=ledger_purpose,
        model=args.model,
        duration=args.duration,
        mode=args.mode,
        fallback_credits=args.fallback_credits,
        max_wait=args.max_wait,
        ledger_path=args.ledger,
        env_path=args.env,
        account=args.account,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def add_common_env_flag(p: argparse.ArgumentParser, *, include_account: bool = True) -> None:
    p.add_argument(
        "--env",
        type=Path,
        default=default_env_path(),
        help="Path to .env file with MAGPIE_API_KEY / MAGPIE_URL (or set UPDREAM_ENV; default: ./.env)",
    )
    if include_account:
        p.add_argument(
            "--account",
            default=default_account(),
            help="Optional UPdream account selector: slot key ('updream#...'), label/remark, alias, token last-4, or 'options' (or set UPDREAM_ACCOUNT)",
        )


def add_gen_flags(p: argparse.ArgumentParser, *, is_generate: bool = False) -> None:
    add_common_env_flag(p)
    p.add_argument(
        "-p",
        "--prompt",
        required=True,
        help="Video generation prompt (in ref2v, reference assets with [@图片1], [@图片2], [@视频1], [@音频1])",
    )
    p.add_argument(
        "--purpose",
        default="pilot_shot",
        help="Shot ID recorded in credits_ledger.csv, prefixed with film ID (e.g. f02_seg01_s01_v1)",
    )
    p.add_argument(
        "--purpose-prefix",
        default=None,
        help="Prefix for summing film budget in ledger (or set UPDREAM_PURPOSE_PREFIX; auto-derived from --purpose if omitted; '*' = whole ledger)",
    )
    p.add_argument(
        "--rework-reason",
        default=None,
        help="Reason for rework appended as '[rework: ...]' in credits_ledger.csv",
    )
    p.add_argument(
        "--shot-key",
        default=None,
        help="Canonical shot stem for enforcing the max 4 attempts (initial + 3 reworks) rule",
    )
    p.add_argument(
        "--max-attempts",
        type=int,
        default=4,
        help="Max completed attempts per shot stem before refusing submission (default: 4 = 1 initial + 3 reworks)",
    )
    p.add_argument(
        "--allow-extra-rework",
        action="store_true",
        default=False,
        help="Override --max-attempts cap when explicitly authorized",
    )
    p.add_argument(
        "--mode",
        default=None,
        choices=["t2v", "i2v", "firstlast", "multiframe", "ref2v", "video_edit", "clip2v"],
        help="Generation mode (auto-inferred from attached frames/references when omitted)",
    )
    p.add_argument(
        "--model",
        default="sed2",
        help="UPdream model ID: sed2, sed2-5, kling-v4, kling-v3-omni, wan-3.0, vidu-q4, hailuo-h3, paiwo-v6max, etc. (default: sed2)",
    )
    p.add_argument(
        "-d",
        "--duration",
        type=int,
        default=None,
        help="Duration in seconds (default: 4 for Seedance, or model schema default for non-Seedance)",
    )
    p.add_argument(
        "--aspect-ratio",
        default=None,
        help="Aspect ratio (default: 9:16, or 16:9 for hailuo-2.3; auto-set to adaptive for sed2-5 i2v/firstlast)",
    )
    p.add_argument(
        "--resolution",
        default=None,
        help="Resolution: 360p, 480p, 540p, 720p, 768P, 1080p, 2k, 4k (default: 720p on Seedance or model default)",
    )
    p.add_argument(
        "--quality-mode",
        default=None,
        choices=["std", "pro", "4k", "standard", "prime"],
        help="Quality/tier mode: std|pro|4k for Kling v3/o1/2.5, standard|prime for Wan 3.0",
    )
    p.add_argument(
        "--audio",
        action="store_true",
        default=False,
        help="Blocked by policy unless --lipsync-audio + --ref-audio or --allow-native-audio is passed",
    )
    p.add_argument(
        "--lipsync-audio",
        action="store_true",
        default=False,
        help="Enable Seedance Method B lip-sync audio generation alongside --ref-audio (strip track with -an in edit)",
    )
    p.add_argument(
        "--allow-native-audio",
        action="store_true",
        default=False,
        help="Explicitly allow native sound effects on audio-capable models when non-silent raw output is intended",
    )
    p.add_argument(
        "--bitrate-mode",
        default="high",
        choices=["standard", "high"],
        help="Bitrate mode for Seedance 2.0 family (default: high)",
    )
    p.add_argument(
        "--output-format",
        default=None,
        choices=["mp4", "mov"],
        help="Output format on Seedance 2.5 (mp4 or mov)",
    )
    p.add_argument("--negative-prompt", default=None, help="Negative prompt on models supporting it (Kling v3, Wan 2.x, Veo)")
    p.add_argument("--cfg-scale", type=float, default=None, help="CFG scale (0-1) for kling-v3.0-std")
    p.add_argument(
        "--prompt-extend",
        dest="prompt_extend",
        action="store_true",
        default=None,
        help="Enable prompt expansion on wan-3.0",
    )
    p.add_argument(
        "--no-prompt-extend",
        dest="prompt_extend",
        action="store_false",
        help="Disable prompt expansion on wan-3.0",
    )
    p.add_argument(
        "--enhance-prompt",
        dest="enhance_prompt",
        action="store_true",
        default=None,
        help="Enable prompt enhancement on veo-3.1-preview",
    )
    p.add_argument(
        "--no-enhance-prompt",
        dest="enhance_prompt",
        action="store_false",
        help="Disable prompt enhancement on veo-3.1-preview",
    )
    p.add_argument("--shot-type", default=None, choices=["single", "multi"], help="Shot type for wan-2.6 / wan-2.6-ref2v")
    p.add_argument(
        "--keep-original-sound",
        dest="keep_original_sound",
        action="store_true",
        default=None,
        help="Keep original sound of reference video on kling-v3-omni / wan-2.7",
    )
    p.add_argument(
        "--no-keep-original-sound",
        dest="keep_original_sound",
        action="store_false",
        help="Mute original sound of reference video on kling-v3-omni / wan-2.7",
    )
    p.add_argument("--num-videos", type=int, default=1, help="Number of videos (1-4, default: 1)")
    p.add_argument("--first-frame", help="First frame image path or URL (required for i2v / firstlast)")
    p.add_argument("--last-frame", help="Last frame image path or URL (required for firstlast, optional end frame for clip2v)")
    p.add_argument(
        "-r",
        "--ref-image",
        action="append",
        dest="reference_images",
        help="Reference image path/URL for ref2v / multiframe / video_edit (repeatable: 1st=[@图片1], 2nd=[@图片2], ...)",
    )
    p.add_argument(
        "-v",
        "--ref-video",
        action="append",
        dest="reference_videos",
        help="Reference video path/URL for ref2v / video_edit / clip2v (repeatable: 1st=[@视频1], ...)",
    )
    p.add_argument(
        "--ref-video-seconds",
        type=int,
        default=0,
        help="Total duration in seconds of attached reference videos for accurate credit estimation",
    )
    p.add_argument(
        "-a",
        "--ref-audio",
        action="append",
        dest="reference_audios",
        help="Reference audio (.mp3/.wav) path/URL for ref2v (repeatable: 1st=[@音频1], ...)",
    )
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=default_output_path(),
        help="Output .mp4/.mov file path or directory (or set UPDREAM_OUTPUT; default: ./clips_raw)",
    )
    p.add_argument(
        "--budget-limit",
        type=float,
        default=default_budget_limit(),
        help="Cumulative credit budget cap for the film prefix (or set UPDREAM_BUDGET_LIMIT; default: 3000; 0 = unlimited)",
    )
    p.add_argument("--no-estimate", action="store_true", help="Skip estimate_credits pre-check in generate")
    if is_generate:
        p.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Validate parameters and run free estimate/budget checks without calling create_video (0 credits)",
        )
    p.add_argument("--max-wait", type=int, default=900, help="Max total polling seconds (default: 900)")
    p.add_argument(
        "--ledger",
        type=Path,
        default=default_ledger_path(),
        help="Path to credits_ledger.csv (or set UPDREAM_LEDGER; default: ./credits_ledger.csv)",
    )


def _normalize_argv(argv: List[str]) -> List[str]:
    """Allow `--env <path>` and `--account <val>` before the subcommand as well as after it."""
    if not argv:
        return argv
    rest = list(argv)
    leading_flags: List[str] = []
    while rest:
        if len(rest) >= 2 and rest[0] in ("--env", "--account"):
            leading_flags.extend(rest[:2])
            rest = rest[2:]
        elif rest[0].startswith("--env=") or rest[0].startswith("--account="):
            leading_flags.append(rest[0])
            rest = rest[1:]
        else:
            break

    if not rest:
        return leading_flags + rest

    if rest[0] in SUBCOMMANDS or rest[0] in ("-h", "--help"):
        if rest[0] in SUBCOMMANDS and leading_flags:
            return [rest[0]] + leading_flags + rest[1:]
        return leading_flags + rest

    # Backward compatibility: if no subcommand token appears anywhere, treat `updream.py -p "..."` as `generate`
    if not any(tok in SUBCOMMANDS for tok in rest):
        return ["generate"] + leading_flags + rest
    return leading_flags + rest


def main() -> int:
    parser = argparse.ArgumentParser(
        description="UPdream multi-model & multi-account video generation CLI with budget guardrails and CSV ledger"
    )
    add_common_env_flag(parser)
    subparsers = parser.add_subparsers(dest="subcommand")

    p_acc = subparsers.add_parser("account", help="Query UPdream account and credit balance (0 credits)")
    add_common_env_flag(p_acc)
    p_acc.add_argument(
        "--all-accounts",
        action="store_true",
        default=False,
        help="List all signed-in UPdream accounts on Magpie Provider page and their balances",
    )
    p_acc.set_defaults(func=cmd_account)

    p_mdl = subparsers.add_parser("models", help="List UPdream video models and parameter schemas (0 credits)")
    add_common_env_flag(p_mdl)
    p_mdl.add_argument(
        "--all-models",
        action="store_true",
        default=False,
        help="Include internal unsupported models (e.g. mock 'test') in output",
    )
    p_mdl.add_argument(
        "--no-live",
        action="store_true",
        default=False,
        help="Return static model schemas without querying live /ai/video-models",
    )
    p_mdl.set_defaults(func=cmd_models)

    p_up = subparsers.add_parser(
        "upload", help="Upload a local image or audio (.mp3/.wav) file to UPdream storage and return https URL"
    )
    add_common_env_flag(p_up)
    p_up.add_argument("path", help="Local file path (.png, .jpg, .mp3, .wav) or HTTP(S) URL")
    p_up.add_argument("--filename", help="Optional override filename")
    p_up.add_argument("--folder", help="Optional storage folder")
    p_up.set_defaults(func=cmd_upload)

    p_est = subparsers.add_parser("estimate", help="Estimate credit cost and check film budget (0 credits)")
    add_gen_flags(p_est, is_generate=False)
    p_est.set_defaults(func=cmd_estimate)

    p_gen = subparsers.add_parser(
        "generate", help="Estimate, check budget, create video task, poll, download MP4, and append to ledger"
    )
    add_gen_flags(p_gen, is_generate=True)
    p_gen.set_defaults(func=cmd_generate)

    p_wait = subparsers.add_parser("wait", help="Poll an existing task_id, download MP4, and append to ledger")
    add_common_env_flag(p_wait)
    p_wait.add_argument("--task-id", required=True, help="Existing task_id")
    p_wait.add_argument("--node-id", help="Optional canvas node_id")
    p_wait.add_argument("--purpose", default="pilot_shot", help="Purpose recorded in ledger")
    p_wait.add_argument("--rework-reason", default=None, help="Optional rework reason appended to ledger purpose")
    p_wait.add_argument("--model", default="sed2", help="Model ID recorded in ledger")
    p_wait.add_argument("-d", "--duration", type=int, default=4, help="Duration recorded in ledger")
    p_wait.add_argument("--mode", default="ref2v", help="Mode recorded in ledger")
    p_wait.add_argument("--fallback-credits", type=float, default=0.0, help="Credits logged if wait_task omits cost_credits")
    p_wait.add_argument("-o", "--output", type=Path, default=default_output_path(), help="Output .mp4 path or directory")
    p_wait.add_argument("--max-wait", type=int, default=900, help="Max polling seconds (default: 900)")
    p_wait.add_argument("--ledger", type=Path, default=default_ledger_path(), help="Path to credits_ledger.csv")
    p_wait.set_defaults(func=cmd_wait)

    p_get = subparsers.add_parser("get", help="Single non-blocking get_task check (0 credits)")
    add_common_env_flag(p_get)
    p_get.add_argument("--task-id", required=True, help="Existing task_id")
    p_get.add_argument("--node-id", help="Optional canvas node_id")
    p_get.set_defaults(func=cmd_get)

    p_can = subparsers.add_parser("cancel", help="Cancel a pending or processing task_id")
    add_common_env_flag(p_can)
    p_can.add_argument("--task-id", required=True, help="Existing task_id")
    p_can.set_defaults(func=cmd_cancel)

    p_led = subparsers.add_parser("ledger", help="Summarize credits_ledger.csv usage, models, and reworks (offline)")
    p_led.add_argument("--ledger", type=Path, default=default_ledger_path(), help="Path to credits_ledger.csv")
    p_led.add_argument("--purpose-prefix", default=None, help="Filter summary by purpose prefix ('*' for all)")
    p_led.add_argument("--budget-limit", type=float, default=default_budget_limit(), help="Budget cap for remaining calculation")
    p_led.set_defaults(func=cmd_ledger)

    norm_argv = _normalize_argv(sys.argv[1:])
    args = parser.parse_args(norm_argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 1
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
