import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { combineAbortSignal } from "./client.mjs";
import {
  ALL_VIDEO_MODELS,
  NON_SEEDANCE_MODELS,
  REF_VIDEO_SECONDS_MODELS,
  SEEDANCE_MODEL_IDS,
  SEEDANCE_MODELS,
  SUPPORTED_VIDEO_MODEL_IDS,
  normalizeImageReferenceUrl,
  resolveAndValidateVideoParams,
} from "./models.mjs";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

function omitUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function redactPiiText(value) {
  if (typeof value !== "string" || !value) return value;
  let out = value;
  // Redact email addresses
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
  // Redact mainland China mobile numbers (11 digits starting with 1[3-9]) and international +86 numbers
  out = out.replace(/(?:\+?86[-\s]?)?1[3-9]\d{9}\b/g, "[REDACTED_PHONE]");
  return out;
}

export function sanitizeAccountUser(me) {
  if (!me || typeof me !== "object") {
    return { id: null, name: null };
  }
  const rawName = me.nickname ?? me.username ?? me.name ?? null;
  const user = {
    id: me.id ?? me.user_id ?? me.uid ?? null,
    name: typeof rawName === "string" ? redactPiiText(rawName) : null,
  };
  if (me.avatar || me.avatar_url) {
    user.avatar = me.avatar ?? me.avatar_url;
  }
  if (me.phone !== undefined || me.mobile !== undefined || me.tel !== undefined) {
    user.phone = "[REDACTED]";
  }
  if (me.email !== undefined) {
    user.email = "[REDACTED]";
  }
  return user;
}

function detectImageMimeAndExt(buffer, filenameHint = "", contentTypeHeader = "") {
  if (buffer && buffer.length >= 12) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { mime: "image/png", ext: ".png" };
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mime: "image/jpeg", ext: ".jpg" };
    }
    // WEBP: RIFF....WEBP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { mime: "image/webp", ext: ".webp" };
    }
    // GIF: GIF87a / GIF89a
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
      return { mime: "image/gif", ext: ".gif" };
    }
  }

  const headerType = String(contentTypeHeader || "").split(";")[0].trim().toLowerCase();
  if (headerType.startsWith("image/")) {
    const sub = headerType.slice("image/".length);
    const ext = sub === "jpeg" ? ".jpg" : `.${sub.replace(/[^a-z0-9]/g, "") || "png"}`;
    return { mime: headerType, ext };
  }

  const ext = extname(filenameHint || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return { mime: "image/jpeg", ext: ".jpg" };
  if (ext === ".webp") return { mime: "image/webp", ext: ".webp" };
  if (ext === ".gif") return { mime: "image/gif", ext: ".gif" };
  return { mime: "image/png", ext: ".png" };
}

export async function uploadImageHelper(client, args = {}, signal) {
  const hasUrl = typeof args.url === "string" && args.url.trim().length > 0;
  const hasPath = typeof args.path === "string" && args.path.trim().length > 0;
  const hasBase64 = typeof args.base64 === "string" && args.base64.trim().length > 0;

  const sourcesCount = [hasUrl, hasPath, hasBase64].filter(Boolean).length;
  if (sourcesCount === 0) {
    throw new Error("upload_image requires one of 'url', 'path', or 'base64'.");
  }
  if (sourcesCount > 1) {
    throw new Error("upload_image accepts only one source at a time: provide either 'url', 'path', or 'base64'.");
  }

  let buffer;
  let filenameHint = typeof args.filename === "string" ? args.filename.trim() : "";
  let contentTypeHint = "";

  if (hasUrl) {
    const targetUrl = args.url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      throw new Error(`Invalid image 'url' ("${targetUrl}"): must start with http:// or https://.`);
    }
    const res = await fetch(targetUrl, {
      method: "GET",
      signal: combineAbortSignal(signal, 25_000),
    });
    if (!res.ok) {
      throw new Error(`Failed to download image from URL (HTTP ${res.status} ${res.statusText}).`);
    }
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      throw new Error(`Image size (${contentLength} bytes) exceeds the 20 MB maximum limit.`);
    }
    contentTypeHint = res.headers.get("content-type") || "";
    const ab = await res.arrayBuffer();
    buffer = Buffer.from(ab);
    if (!filenameHint) {
      try {
        const u = new URL(targetUrl);
        filenameHint = basename(u.pathname) || "upload.png";
      } catch {
        filenameHint = "upload.png";
      }
    }
  } else if (hasPath) {
    const filePath = args.path.trim();
    const info = await stat(filePath);
    if (info.size > MAX_UPLOAD_BYTES) {
      throw new Error(`Local image file "${basename(filePath)}" (${info.size} bytes) exceeds the 20 MB maximum limit.`);
    }
    buffer = await readFile(filePath);
    if (!filenameHint) {
      filenameHint = basename(filePath) || "upload.png";
    }
  } else if (hasBase64) {
    let rawB64 = args.base64.trim();
    const dataUriMatch = rawB64.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i);
    if (dataUriMatch) {
      contentTypeHint = dataUriMatch[1] || "image/png";
      rawB64 = dataUriMatch[2].trim();
    }
    buffer = Buffer.from(rawB64, "base64");
  }

  if (!buffer || buffer.length === 0) {
    throw new Error("Image data is empty (0 bytes).");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Image size (${buffer.length} bytes) exceeds the 20 MB maximum limit.`);
  }

  const { mime, ext } = detectImageMimeAndExt(buffer, filenameHint, contentTypeHint);
  let finalFilename = filenameHint || `image${ext}`;
  if (!extname(finalFilename)) {
    finalFilename += ext;
  }

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), finalFilename);

  const query = {};
  if (typeof args.folder === "string" && args.folder.trim()) {
    query.folder = args.folder.trim();
  }

  const uploadRes = await client.request("/upload/image", {
    method: "POST",
    query: Object.keys(query).length > 0 ? query : undefined,
    formData: form,
    signal,
  });

  const rawUploadedUrl = uploadRes?.url ?? uploadRes?.file_url;
  if (!rawUploadedUrl || typeof rawUploadedUrl !== "string") {
    throw new Error("UPdream /upload/image did not return a valid 'url'.");
  }

  return {
    url: normalizeImageReferenceUrl(rawUploadedUrl),
    filename: finalFilename,
    mime_type: mime,
    size: buffer.length,
  };
}

async function resolveImageInputUrl(client, value, signal) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeImageReferenceUrl(trimmed);
  }
  if (/^data:image\//i.test(trimmed)) {
    const uploaded = await uploadImageHelper(client, { base64: trimmed }, signal);
    return uploaded.url;
  }
  const uploaded = await uploadImageHelper(client, { path: trimmed }, signal);
  return uploaded.url;
}

export function extractTaskError(taskData) {
  if (!taskData || typeof taskData !== "object") return null;
  const err = taskData.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object") {
    for (const k of ["message", "detail", "code"]) {
      if (typeof err[k] === "string" && err[k].trim()) return err[k].trim();
    }
  }
  if (typeof taskData.message === "string" && taskData.message.trim() && taskData.status === "failed") {
    return taskData.message.trim();
  }
  if (typeof taskData.error_code === "string" && taskData.error_code.trim()) {
    return taskData.error_code.trim();
  }
  return null;
}

export async function getTaskHelper(client, { task_id, node_id }, signal) {
  if (task_id === undefined || task_id === null || String(task_id).trim() === "") {
    throw new Error("Invalid 'task_id': a non-empty task_id is required.");
  }
  const taskIdStr = String(task_id).trim();
  const taskData = await client.get(`/ai/task/${encodeURIComponent(taskIdStr)}`, { signal });

  let status = taskData?.status ?? "unknown";
  let progress = typeof taskData?.progress === "number" ? taskData.progress : 0;
  let error = extractTaskError(taskData);

  const rawVideos = Array.isArray(taskData?.result?.videos)
    ? taskData.result.videos
    : Array.isArray(taskData?.videos)
    ? taskData.videos
    : [];

  let videos = rawVideos
    .filter((v) => v && (v.video_url || v.url))
    .map((v) => ({
      video_url: v.video_url ?? v.url,
      cover_url: v.cover_url ?? v.cover ?? null,
    }));

  // Cross-check canvas node status for pending/processing tasks when node_id is provided
  const hasNodeId = node_id !== undefined && node_id !== null && String(node_id).trim() !== "";
  if (hasNodeId && (status === "pending" || status === "processing")) {
    try {
      const nodeData = await client.get(`/canvas-nodes/${encodeURIComponent(String(node_id).trim())}`, { signal });
      if (nodeData?.task_status === "waiting_asset_review") {
        status = "waiting_asset_review";
        progress = 0;
      } else if (nodeData?.task_status === "failed") {
        status = "failed";
        error = nodeData.task_error || error || "Task failed on canvas node";
        progress = 0;
      } else if (nodeData?.task_status === "completed") {
        status = "completed";
        progress = 100;
        if (videos.length === 0 && nodeData.video_url) {
          videos = [
            {
              video_url: nodeData.video_url,
              cover_url: nodeData.cover_url ?? null,
            },
          ];
        }
      }
    } catch {
      // Ignore node lookup errors during polling, matching web client behavior
    }
  }

  if (status === "completed") {
    progress = 100;
  } else if (status === "pending" || status === "processing") {
    progress = Math.min(99, Math.max(0, Math.round(Number(progress) || 0)));
  } else if (status === "failed" || status === "waiting_asset_review") {
    progress = 0;
  }

  return {
    task_id: taskIdStr,
    ...(hasNodeId ? { node_id } : {}),
    status,
    progress,
    videos,
    error: error ? client.redact(error) : null,
    request_id: taskData?.request_id ?? null,
  };
}

function abortableSleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitTaskHelper(
  client,
  { task_id, node_id, timeout_seconds = 40, interval_seconds = 5 },
  signal,
) {
  const timeoutSec = Math.min(45, Math.max(0, Number(timeout_seconds ?? 40)));
  const intervalSec = Math.min(30, Math.max(0.02, Number(interval_seconds ?? 5)));
  const startMs = Date.now();
  const deadlineMs = startMs + timeoutSec * 1000;

  let lastResult = await getTaskHelper(client, { task_id, node_id }, signal);
  if (lastResult.status === "completed" || lastResult.status === "failed") {
    return {
      ...lastResult,
      timed_out: false,
      elapsed_seconds: Number(((Date.now() - startMs) / 1000).toFixed(2)),
    };
  }

  while (Date.now() < deadlineMs) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) break;
    const sleepMs = Math.min(intervalSec * 1000, remainingMs);
    try {
      await abortableSleep(sleepMs, signal);
    } catch (err) {
      if (signal?.aborted) {
        return {
          ...lastResult,
          timed_out: true,
          aborted: true,
          elapsed_seconds: Number(((Date.now() - startMs) / 1000).toFixed(2)),
          message:
            `Task ${lastResult.task_id} is still '${lastResult.status}' (aborted after ${((Date.now() - startMs) / 1000).toFixed(1)}s). ` +
            `Call wait_task again with task_id="${lastResult.task_id}"${node_id != null ? ` and node_id="${node_id}"` : ""} to continue polling.`,
        };
      }
      throw err;
    }

    if (Date.now() >= deadlineMs && sleepMs < intervalSec * 1000) {
      // Final check right at deadline
      lastResult = await getTaskHelper(client, { task_id, node_id }, signal);
      break;
    }

    lastResult = await getTaskHelper(client, { task_id, node_id }, signal);
    if (lastResult.status === "completed" || lastResult.status === "failed") {
      return {
        ...lastResult,
        timed_out: false,
        elapsed_seconds: Number(((Date.now() - startMs) / 1000).toFixed(2)),
      };
    }
  }

  if (lastResult.status === "completed" || lastResult.status === "failed") {
    return {
      ...lastResult,
      timed_out: false,
      elapsed_seconds: Number(((Date.now() - startMs) / 1000).toFixed(2)),
    };
  }

  return {
    ...lastResult,
    timed_out: true,
    elapsed_seconds: Number(((Date.now() - startMs) / 1000).toFixed(2)),
    message:
      `Task ${lastResult.task_id} is still '${lastResult.status}' (progress: ${lastResult.progress}%). ` +
      `Call wait_task again with task_id="${lastResult.task_id}"${node_id != null ? ` and node_id="${node_id}"` : ""} to continue waiting.`,
  };
}

function isTaskNotFoundError(err) {
  if (!err) return false;
  if (err.status === 404) return true;
  const msg = String(err.detail ?? err.message ?? "");
  return /not\s*found|不存在|task.*not.*exist/i.test(msg);
}

async function queryAccountSummary(client, signal) {
  const me = await client.get("/auth/me", { signal });
  const [accountRes, memberRes] = await Promise.all([
    client.get("/user/account", { signal }),
    client.get("/member/status", { signal }).catch(() => null),
  ]);

  return {
    user: sanitizeAccountUser(me),
    credits: {
      balance_credits: accountRes?.balance_credits ?? null,
      permanent_credits: accountRes?.permanent_credits ?? null,
      temporary_credits: accountRes?.temporary_credits ?? null,
      frozen_credits: accountRes?.frozen_credits ?? null,
      today_credits: accountRes?.today_credits ?? null,
      month_credits: accountRes?.month_credits ?? null,
    },
    membership: {
      tier: accountRes?.membership ?? memberRes?.tier ?? null,
      membership_end_at: accountRes?.membership_end_at ?? null,
      ...(memberRes?.memberships !== undefined ? { memberships: memberRes.memberships } : {}),
      ...(memberRes?.frozen_memberships !== undefined ? { frozen_memberships: memberRes.frozen_memberships } : {}),
    },
  };
}

const ACCOUNT_ARG_SCHEMA = {
  account: {
    type: "string",
    description:
      "可选：指定使用哪个已登录 UPdream 账号（可匹配槽位键如 'updream#xxxxxx'、账号备注名、自定义别名、Token 末 4 位，或填 'options' 使用旧版 plugins.json 配置；不填默认使用「模型 → 供应商」页面置顶且启用的账号）。",
  },
};

const GENERATION_PARAM_PROPERTIES = {
  model: {
    type: "string",
    enum: SUPPORTED_VIDEO_MODEL_IDS,
    description:
      "UPdream video model ID (default 'sed2-5'). Supports Seedance family ('sed2-5', 'sed2-5-draft', 'wonder-ultra', 'sed2', 'wonder-pro', 'sed2-fast', 'sed2-mini') " +
      "and non-Seedance models ('kling-v4', 'kling-v3-omni', 'kling-v3.0-std', 'kling-v3.0-turbo', 'kling-o1', 'kling-v2-5-turbo', 'wan-3.0', 'wan-2.7', 'wan-2.6', 'wan-2.6-ref2v', 'wan-2.5-preview', 'wan-2.2', 'vidu-q4', 'vidu-q2-pro', 'paiwo-v6max', 'hailuo-h3', 'minimax-h3-max', 'hailuo-2.3', 'happyhorse-1.1', 'happyhorse', 'gemini-omni-1.1-flash', 'gemini-omni-flash', 'veo-3.1-preview').",
  },
  mode: {
    type: "string",
    enum: ["t2v", "i2v", "firstlast", "multiframe", "ref2v", "video_edit", "clip2v"],
    description:
      "Generation mode (生成模式): 't2v' (文生视频), 'i2v' (图生视频, requires first_frame), " +
      "'firstlast' (首尾帧生视频, requires first_frame + optional/required last_frame), 'multiframe' (智能多帧, 3-10 images), " +
      "'ref2v' (多模态参考生视频), 'video_edit' (视频编辑), 'clip2v' (视频续写). Auto-detected from attached frames/references when omitted.",
  },
  generate_type: {
    type: "string",
    enum: ["t2v", "i2v", "firstlast", "multiframe", "ref2v", "video_edit", "clip2v"],
    description: "Alias for 'mode' (生成类型).",
  },
  duration: {
    type: "integer",
    description:
      "Video duration in seconds (时长/秒). Seedance 2.5 supports 4-30s (-1 for video_edit, 4-180s for clip2v); Seedance 2.0 supports 4-15s; Kling 4.0 supports 3-30s; Wan 3.0 supports 2-30s; check list_video_models for per-model ranges.",
  },
  aspect_ratio: {
    type: "string",
    enum: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9", "adaptive"],
    description:
      "Aspect ratio (画面比例, default '16:9' or model default). Forced to 'adaptive' for Seedance 2.5 i2v/firstlast, and omitted automatically on models whose i2v/video_edit follows input media.",
  },
  resolution: {
    type: "string",
    description:
      "Output resolution (分辨率, e.g. '360p', '480p', '540p', '720p', '768p', '1080p', '2k', '4k'; case-insensitive for non-Seedance models).",
  },
  quality_mode: {
    type: "string",
    enum: ["std", "pro", "4k", "standard", "prime"],
    description:
      "Model quality/tier mode (画质/规格档位 -> API 'mode'): 'std' (720P) / 'pro' (1080P) / '4k' (4K) for Kling v3.0 Omni, Kling v3.0 Standard, Kling-o1, Kling 2.5 Turbo; 'standard' / 'prime' for Wan 3.0.",
  },
  audio: {
    type: "boolean",
    description:
      "Whether to generate synchronized native audio/sound effects (生成原生音效/语音; maps to supports_audio or sound per model, omitted on models without native audio).",
  },
  output_format: {
    type: "string",
    enum: ["mp4", "mov"],
    description: "Output video format (输出格式, default 'mp4'; 'mov' is supported on 'sed2-5' and 'sed2-5-draft').",
  },
  bitrate_mode: {
    type: "string",
    enum: ["standard", "high"],
    description: "Bitrate mode (码率模式: 'high' 高码率 or 'standard' 标准码率, default 'high'). Seedance 2.0 family only.",
  },
  first_frame: {
    type: "string",
    description: "First frame image URL (https://...) or local file path for 'i2v', 'firstlast', or 'multiframe' modes (首帧图片).",
  },
  last_frame: {
    type: "string",
    description: "Last frame image URL (https://...) or local file path for 'firstlast' (or non-Seedance 'clip2v') mode (尾帧图片).",
  },
  reference_images: {
    type: "array",
    items: { type: "string" },
    description:
      "Reference image URLs (https://...) or local file paths for 'ref2v', 'multiframe' (3-10 keyframes), or 'video_edit' modes (参考图片列表; reference in prompt as [@图片1], [@图片2], ...).",
  },
  reference_videos: {
    type: "array",
    items: { type: "string" },
    description:
      "Reference video URLs (https://...) for 'ref2v'/'video_edit'/'clip2v' modes (参考视频列表; reference in prompt as [@视频1]).",
  },
  reference_audios: {
    type: "array",
    items: { type: "string" },
    description:
      "Reference audio URLs (https://...) for 'ref2v' mode (参考音频列表; reference in prompt as [@音频1]).",
  },
  num_videos: {
    type: "integer",
    minimum: 1,
    maximum: 4,
    description: "Number of videos to generate in one task (生成条数 1-4, default 1).",
  },
  negative_prompt: {
    type: "string",
    description: "Optional negative prompt (反向提示词; supported on Kling v3.0 Omni/Std, Kling 2.5 Turbo, Veo 3.1, Wan 2.x; not supported on Seedance).",
  },
  cfg_scale: {
    type: "number",
    minimum: 0,
    maximum: 1,
    description: "Optional prompt adherence scale 0..1 (提示词相关性; supported on 'kling-v3.0-std').",
  },
  prompt_extend: {
    type: "boolean",
    description: "Optional prompt smart rewrite switch (智能扩写; supported on 'wan-3.0', default true).",
  },
  enhance_prompt: {
    type: "boolean",
    description: "Optional prompt enhancement switch (提示词增强; supported on 'veo-3.1-preview', default true).",
  },
  shot_type: {
    type: "string",
    enum: ["single", "multi"],
    description: "Optional shot type ('single' 单镜头 or 'multi' 多镜头叙事; supported on 'wan-2.6' and 'wan-2.6-ref2v').",
  },
  keep_original_sound: {
    type: "boolean",
    description: "Optional switch to keep reference video's original sound (保留原声; supported on 'kling-v3-omni' and 'wan-2.7').",
  },
};

export function createTools(clientOrPool) {
  const isPool = Boolean(clientOrPool && typeof clientOrPool.resolve === "function");

  function resolveAccount({ account, taskId, directory } = {}) {
    if (!isPool) {
      return { slot: null, label: null, client: clientOrPool };
    }
    return clientOrPool.resolve({ account, taskId, directory });
  }

  async function runTaskActionWithFallback(args, ctx, actionFn) {
    const primary = resolveAccount({
      account: args?.account,
      taskId: args?.task_id,
      directory: ctx?.directory,
    });

    try {
      const res = await actionFn(primary.client);
      return { res, used: primary };
    } catch (err) {
      const canFallback =
        isPool &&
        !(typeof args?.account === "string" && args.account.trim()) &&
        args?.task_id &&
        !clientOrPool.hasBoundTask(args.task_id) &&
        isTaskNotFoundError(err);

      if (!canFallback) {
        throw err;
      }

      const candidates = clientOrPool.listFallbackEnabledAccounts({
        excludeSlot: primary.slot,
        directory: ctx?.directory,
      });

      for (const cand of candidates) {
        try {
          const res = await actionFn(cand.client);
          clientOrPool.rememberTask(String(args.task_id).trim(), cand.slot);
          return { res, used: cand };
        } catch (candErr) {
          if (isTaskNotFoundError(candErr)) {
            continue;
          }
          throw candErr;
        }
      }
      throw err;
    }
  }

  return {
    account: {
      description:
        "Query your UPdream account profile (GET /auth/me), credit balances (GET /user/account), and membership status (GET /member/status). " +
        "Supports multi-account selection via 'account' and listing all configured accounts via 'all_accounts: true'. " +
        "Phone numbers and email addresses are automatically redacted. (查询 UPdream 账号信息、积分余额与会员状态，支持多账号)",
      args: {
        type: "object",
        properties: {
          ...ACCOUNT_ARG_SCHEMA,
          all_accounts: {
            type: "boolean",
            description: "设为 true 时列出所有已配置 UPdream 账号的启用状态、默认标记及积分余额摘要。",
          },
        },
        additionalProperties: false,
      },
      async execute(args = {}, ctx) {
        const signal = ctx?.abort;
        const { slot, label, client } = resolveAccount({
          account: args?.account,
          directory: ctx?.directory,
        });

        const summary = await queryAccountSummary(client, signal);
        const out = {
          ...(isPool
            ? {
                account: label,
                selected: { slot, label },
                selected_account: { slot, label },
              }
            : {}),
          ...summary,
        };

        if (args?.all_accounts && isPool) {
          const { providerOff, all } = clientOrPool.listAccounts(ctx?.directory);
          const entries = [];
          for (const item of all) {
            const itemLabel = item.alias || item.user;
            const slotClient = clientOrPool._getOrCreateSlotClient(item);
            try {
              const info = await queryAccountSummary(slotClient, signal);
              entries.push({
                slot: item.slot,
                label: itemLabel,
                user: item.user,
                ...(item.alias ? { alias: item.alias } : {}),
                enabled: item.enabled,
                first: item.first,
                selected: item.slot === slot,
                ...info,
              });
            } catch (err) {
              entries.push({
                slot: item.slot,
                label: itemLabel,
                user: item.user,
                ...(item.alias ? { alias: item.alias } : {}),
                enabled: item.enabled,
                first: item.first,
                selected: item.slot === slot,
                error: slotClient.redact ? slotClient.redact(err?.message || String(err)) : String(err?.message || err),
              });
            }
          }

          if (entries.length === 0) {
            entries.push({
              slot: "options",
              label: "options",
              enabled: true,
              first: true,
              selected: slot === "options",
              ...summary,
            });
          }

          out.provider_off = providerOff;
          out.accounts = entries;
        }

        return out;
      },
    },

    list_video_models: {
      description:
        "List UPdream video generation models (Seedance 2.5/2.0 plus Kling, Wan, Vidu, Hailuo, PixVerse, HappyHorse, Omni, Veo) " +
        "with their supported modes, durations, aspect ratios, resolutions, quality_mode, audio, and reference media limits. " +
        "Set all_models=true to return all 31 models in 'models', or live=true to query GET /ai/video-models. (列出支持的视频生成模型及参数规格)",
      args: {
        type: "object",
        properties: {
          ...ACCOUNT_ARG_SCHEMA,
          all_models: {
            type: "boolean",
            description: "Include all 31 platform video models in 'models' in addition to Seedance (default false).",
          },
          live: {
            type: "boolean",
            description: "Fetch live model availability and user tier from GET /ai/video-models (default false).",
          },
        },
        additionalProperties: false,
      },
      async execute(args = {}, ctx) {
        const { label, client } = resolveAccount({
          account: args?.account,
          directory: ctx?.directory,
        });

        const seedanceList = SEEDANCE_MODEL_IDS.map((id) => SEEDANCE_MODELS[id]);
        const models = args?.all_models ? ALL_VIDEO_MODELS : seedanceList;

        const out = {
          ...(isPool ? { account: label } : {}),
          default_model: "sed2-5",
          seedance_model_ids: SEEDANCE_MODEL_IDS,
          supported_model_ids: SUPPORTED_VIDEO_MODEL_IDS,
          models,
          ...(!args?.all_models
            ? { non_seedance_models: NON_SEEDANCE_MODELS.filter((m) => m.supported !== false) }
            : {}),
        };

        if (args?.live) {
          const liveData = await client.get("/ai/video-models", { signal: ctx?.abort });
          const rawModels = Array.isArray(liveData?.models)
            ? liveData.models
            : Array.isArray(liveData)
            ? liveData
            : [];
          out.live = {
            user_tier: liveData?.user_tier ?? null,
            confirm_model_ids: liveData?.confirm_model_ids ?? [],
            models: rawModels.map((m) =>
              omitUndefined({
                id: m.value ?? m.id ?? m.model_id ?? m.model_name,
                name: m.label ?? m.name ?? m.display_name,
                available: m.available ?? m.enabled ?? (m.status !== undefined ? m.status === "active" : true),
                min_tier: m.min_tier ?? m.tier,
                operations: Array.isArray(m.operations) && m.operations.length ? m.operations : undefined,
                generate_types: m.generate_types,
                durations: Array.isArray(m.durations) ? m.durations : undefined,
                resolutions: m.resolutions,
                modes: Array.isArray(m.modes) && m.modes.length ? m.modes : undefined,
                aspect_ratios: m.aspect_ratios,
                supports_audio: m.supports_audio,
                supports_sound: m.supports_sound,
                output_formats: Array.isArray(m.output_formats) && m.output_formats.length ? m.output_formats : undefined,
                bitrate_modes: Array.isArray(m.bitrate_modes) && m.bitrate_modes.length ? m.bitrate_modes : undefined,
              }),
            ),
          };
        }

        return out;
      },
    },

    upload_image: {
      description:
        "Upload an image (from an HTTP/HTTPS URL, local file path, or base64 string) to UPdream's Bilibili BOSS storage (POST /upload/image) " +
        "and return the hosted https:// URL for use in create_video (first_frame, last_frame, reference_images). Max 20 MB. (上传参考图或首尾帧图片到 UPdream，最大 20MB)",
      args: {
        type: "object",
        properties: {
          ...ACCOUNT_ARG_SCHEMA,
          url: {
            type: "string",
            description: "HTTP(S) URL of an image to download and re-upload to UPdream.",
          },
          path: {
            type: "string",
            description: "Local file path to an image (PNG, JPEG, WebP, GIF).",
          },
          base64: {
            type: "string",
            description: "Base64-encoded image string or data:image/...;base64,... URI.",
          },
          filename: {
            type: "string",
            description: "Optional filename (e.g. 'frame.png').",
          },
          folder: {
            type: "string",
            description: "Optional storage folder parameter.",
          },
        },
        additionalProperties: false,
      },
      async execute(args = {}, ctx) {
        const { label, client } = resolveAccount({
          account: args?.account,
          directory: ctx?.directory,
        });
        const uploaded = await uploadImageHelper(client, args, ctx?.abort);
        return {
          ...(isPool ? { account: label } : {}),
          ...uploaded,
        };
      },
    },

    estimate_credits: {
      description:
        "Estimate the credit cost (GET /credit/estimate) of a video generation request before creating the task. " +
        "Takes the same model and generation parameters as create_video. (预估视频生成所需积分)",
      args: {
        type: "object",
        properties: {
          ...ACCOUNT_ARG_SCHEMA,
          prompt: {
            type: "string",
            description: "Optional prompt string.",
          },
          ...GENERATION_PARAM_PROPERTIES,
          ref_video_seconds: {
            type: "integer",
            minimum: 0,
            description: "Total duration in seconds of attached reference videos (参考视频总秒数, default 0).",
          },
        },
        additionalProperties: false,
      },
      async execute(args = {}, ctx) {
        const resolved = resolveAndValidateVideoParams(args, { requirePrompt: false });
        const { label, client } = resolveAccount({
          account: args?.account,
          directory: ctx?.directory,
        });

        const numRefImages =
          (resolved.first_frame ? 1 : 0) +
          (resolved.last_frame ? 1 : 0) +
          (resolved.reference_images ? resolved.reference_images.length : 0);
        const rawHasRefVideo = Boolean(resolved.reference_videos && resolved.reference_videos.length > 0);
        const refVideoSeconds = Math.trunc(Math.max(0, Number(args.ref_video_seconds ?? 0) || 0));

        const hasRefVideoFlag = resolved.is_seedance
          ? rawHasRefVideo
            ? 1
            : 0
          : rawHasRefVideo && (!REF_VIDEO_SECONDS_MODELS.has(resolved.model_name) || resolved.model_name === "kling-v4")
          ? 1
          : 0;

        const quantity =
          resolved.duration === -1
            ? 30
            : resolved.duration === undefined
            ? refVideoSeconds > 0
              ? refVideoSeconds
              : 5
            : resolved.duration;

        const queryParams = {
          model_name: resolved.model_name,
          service_type: "VIDEO",
          quantity,
          quality: resolved.estimate_quality || resolved.resolution || "720p",
          num_ref_images: numRefImages,
          has_sound: resolved.has_sound ? 1 : 0,
          has_ref_video: hasRefVideoFlag,
          ref_video_seconds: refVideoSeconds,
          ...(resolved.quality_mode ? { mode: resolved.quality_mode } : {}),
          generate_type: resolved.generate_type,
        };

        const res = await client.get("/credit/estimate", {
          query: queryParams,
          signal: ctx?.abort,
        });

        const estimatedCredits = res?.estimated_credits ?? null;
        const listPriceCredits = res?.list_price_credits ?? null;

        return {
          ...(isPool ? { account: label } : {}),
          model: resolved.model,
          model_name: resolved.model_name,
          generate_type: resolved.generate_type,
          estimated_credits: estimatedCredits,
          list_price_credits: listPriceCredits,
          num_videos: resolved.num_videos,
          total_estimated_credits:
            typeof estimatedCredits === "number" ? estimatedCredits * resolved.num_videos : estimatedCredits,
          params_sent: queryParams,
        };
      },
    },

    create_video: {
      description:
        "Create an async video generation task on UPdream (POST /ai/generate-video/async) across Seedance 2.5/2.0, Kling, Wan, Vidu, Hailuo, PixVerse, HappyHorse, Omni, and Veo models. " +
        "Supports t2v, i2v, firstlast, multiframe, ref2v, video_edit, and clip2v per model capabilities. " +
        "Local file paths in first_frame/last_frame/reference_images are automatically uploaded using the selected account. " +
        "Automatically ensures a project ('magpie-updream') and creates a video canvas node. " +
        "Note: Generating videos consumes UPdream credits. (创建 UPdream 视频生成任务，支持多模型与多账号；消耗账号积分)",
      args: {
        type: "object",
        properties: {
          ...ACCOUNT_ARG_SCHEMA,
          prompt: {
            type: "string",
            description:
              "Video generation prompt (视频描述提示词, required). In ref2v mode, reference attached items with [@图片1], [@视频1], [@音频1].",
          },
          ...GENERATION_PARAM_PROPERTIES,
          project_id: {
            type: "string",
            description: "Optional UPdream canvas project ID (项目 ID). If omitted, reuses configured/persisted project or 'magpie-updream'.",
          },
          wait_seconds: {
            type: "number",
            minimum: 0,
            maximum: 40,
            description:
              "Seconds to wait and poll for task completion before returning (0-40, default 0 = return immediately after task creation).",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      async execute(args = {}, ctx) {
        const signal = ctx?.abort;

        // Validate wait_seconds first
        let waitSeconds = 0;
        if (args.wait_seconds !== undefined && args.wait_seconds !== null) {
          const parsedWait = Number(args.wait_seconds);
          if (!Number.isFinite(parsedWait) || parsedWait < 0 || parsedWait > 40) {
            throw new Error("Invalid 'wait_seconds': must be a number between 0 and 40.");
          }
          waitSeconds = parsedWait;
        }

        // 1. Validate all generation parameters against static model schema
        const resolved = resolveAndValidateVideoParams(args, { requirePrompt: true });

        // Resolve target account after local parameter validation succeeds
        const { slot, label, client } = resolveAccount({
          account: args?.account,
          directory: ctx?.directory,
        });

        // 2. Upload local file paths if any frame/reference image is not http(s)
        const imageUrl = resolved.first_frame
          ? await resolveImageInputUrl(client, resolved.first_frame, signal)
          : undefined;
        let lastImageUrl = resolved.last_frame
          ? await resolveImageInputUrl(client, resolved.last_frame, signal)
          : undefined;

        let refImageUrls;
        if (resolved.reference_images && resolved.reference_images.length > 0) {
          refImageUrls = [];
          for (const item of resolved.reference_images) {
            refImageUrls.push(await resolveImageInputUrl(client, item, signal));
          }
        }

        // 3. Ensure canvas project and create video canvas node
        const projectId = await client.ensureProject(args.project_id, signal);
        const nodeId = await client.createVideoCanvasNode(
          projectId,
          { aspectRatio: resolved.canvas_aspect_ratio, name: "magpie video" },
          signal,
        );

        // 4. Build payload matching UPdream web app per model family
        let payload;
        if (resolved.is_seedance) {
          payload = omitUndefined({
            model_name: resolved.model_name,
            prompt: resolved.prompt,
            prompt_source: "original",
            project_id: projectId,
            node_id: nodeId,
            generate_type: resolved.generate_type,
            image: imageUrl,
            last_image: lastImageUrl,
            ref_images: refImageUrls,
            ref_videos: resolved.reference_videos,
            audio_urls: resolved.reference_audios,
            resolution: resolved.resolution,
            aspect_ratio: resolved.aspect_ratio,
            duration: resolved.duration,
            supports_audio: resolved.supports_audio,
            output_format: resolved.output_format,
            bitrate_mode: resolved.bitrate_mode,
            num_videos: resolved.num_videos,
            draft: resolved.draft,
            use_local: false,
          });
        } else {
          const rawRefVideos = resolved.reference_videos || [];
          const refVideoSingle = rawRefVideos.length > 0 ? rawRefVideos[0] : undefined;
          const refVideosMulti = rawRefVideos.length > 1 ? rawRefVideos : undefined;

          if (resolved.generate_type === "clip2v" && !lastImageUrl && refImageUrls?.length) {
            lastImageUrl = refImageUrls[0];
            refImageUrls = undefined;
          }

          payload = omitUndefined({
            model_name: resolved.model_name,
            prompt: resolved.prompt,
            prompt_source: "original",
            project_id: projectId,
            node_id: nodeId,
            generate_type: resolved.generate_type,
            image: imageUrl,
            size: resolved.size,
            resolution: resolved.resolution,
            aspect_ratio: resolved.aspect_ratio,
            duration: resolved.duration,
            supports_audio: resolved.supports_audio,
            sound: resolved.sound,
            last_image: lastImageUrl,
            ref_video: refVideoSingle,
            ref_videos: refVideosMulti,
            ref_images: refImageUrls,
            keep_original_sound: resolved.keep_original_sound,
            negative_prompt: resolved.negative_prompt,
            cfg_scale: resolved.cfg_scale,
            enhance_prompt: resolved.enhance_prompt,
            prompt_extend: resolved.prompt_extend,
            shot_type: resolved.shot_type,
            audio_urls: resolved.reference_audios,
            num_videos: resolved.num_videos,
            mode: resolved.quality_mode,
            bitrate_mode: resolved.bitrate_mode,
            output_format: resolved.output_format,
            draft: resolved.draft,
            use_local: false,
          });
        }

        const idempotencyKey = `video:${randomUUID()}`;
        const createRes = await client.post("/ai/generate-video/async", payload, {
          headers: { "Idempotency-Key": idempotencyKey },
          signal,
        });

        const taskId = createRes?.task_id;
        if (!taskId) {
          throw new Error("UPdream /ai/generate-video/async did not return a task_id.");
        }

        if (isPool) {
          clientOrPool.rememberTask(String(taskId), slot);
        }

        const baseOut = {
          ...(isPool ? { account: label } : {}),
          task_id: String(taskId),
          status: createRes?.status ?? "pending",
          project_id: projectId,
          node_id: nodeId,
          model: resolved.model,
          params_sent: payload,
        };

        if (waitSeconds > 0) {
          const polled = await waitTaskHelper(
            client,
            {
              task_id: String(taskId),
              node_id: nodeId,
              timeout_seconds: waitSeconds,
              interval_seconds: Math.min(5, Math.max(0.05, waitSeconds / 2)),
            },
            signal,
          );
          return {
            ...baseOut,
            status: polled.status,
            progress: polled.progress,
            videos: polled.videos,
            error: polled.error,
            request_id: polled.request_id,
            timed_out: polled.timed_out,
            ...(polled.message ? { message: polled.message } : {}),
          };
        }

        return baseOut;
      },
    },

    get_task: {
      description:
        "Get the current status, progress, and output video URLs of an UPdream video generation task (GET /ai/task/{task_id}). " +
        "Automatically routes back to the account slot that created the task, or falls back across enabled accounts on 404. " +
        "(查询视频生成任务状态、进度及结果视频 URL，自动回绑提交账号)",
      args: {
        type: "object",
        properties: {
          ...ACCOUNT_ARG_SCHEMA,
          task_id: {
            type: "string",
            description: "Task ID returned by create_video (任务 ID, required).",
          },
          node_id: {
            type: "string",
            description: "Optional canvas node ID returned by create_video (画布节点 ID, recommended for Seedance models).",
          },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      async execute(args = {}, ctx) {
        const { res, used } = await runTaskActionWithFallback(args, ctx, (client) =>
          getTaskHelper(client, args, ctx?.abort),
        );
        return {
          ...(isPool ? { account: used.label } : {}),
          ...res,
        };
      },
    },

    wait_task: {
      description:
        "Poll get_task until the video generation task finishes ('completed' or 'failed') or timeout_seconds (default 40s, max 45s) elapses. " +
        "If the task is still running when wait_task returns (timed_out: true), call wait_task again with the same task_id and node_id. " +
        "(轮询等待视频生成任务完成，单次最长 45 秒；自动回绑提交账号)",
      args: {
        type: "object",
        properties: {
          ...ACCOUNT_ARG_SCHEMA,
          task_id: {
            type: "string",
            description: "Task ID returned by create_video (任务 ID, required).",
          },
          node_id: {
            type: "string",
            description: "Optional canvas node ID returned by create_video (画布节点 ID).",
          },
          timeout_seconds: {
            type: "number",
            minimum: 0.05,
            maximum: 45,
            description: "Maximum seconds to wait in this call (单次等待超时秒数, default 40, max 45).",
          },
          interval_seconds: {
            type: "number",
            minimum: 0.02,
            maximum: 30,
            description: "Polling interval in seconds (轮询间隔秒数, default 5).",
          },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      async execute(args = {}, ctx) {
        const { res, used } = await runTaskActionWithFallback(args, ctx, (client) =>
          waitTaskHelper(client, args, ctx?.abort),
        );
        return {
          ...(isPool ? { account: used.label } : {}),
          ...res,
        };
      },
    },

    cancel_task: {
      description:
        "Cancel a pending or processing UPdream video generation task (POST /ai/task/{task_id}/cancel). (取消正在排队的视频生成任务)",
      args: {
        type: "object",
        properties: {
          ...ACCOUNT_ARG_SCHEMA,
          task_id: {
            type: "string",
            description: "Task ID to cancel (要取消的任务 ID, required).",
          },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      async execute(args = {}, ctx) {
        if (!args?.task_id || String(args.task_id).trim() === "") {
          throw new Error("Invalid 'task_id': a non-empty task_id is required.");
        }
        const taskId = String(args.task_id).trim();
        const { res, used } = await runTaskActionWithFallback(args, ctx, (client) =>
          client.post(`/ai/task/${encodeURIComponent(taskId)}/cancel`, undefined, {
            signal: ctx?.abort,
          }),
        );
        return {
          ...(isPool ? { account: used.label } : {}),
          task_id: taskId,
          cancelled: true,
          ...(res && typeof res === "object" ? res : {}),
        };
      },
    },
  };
}
