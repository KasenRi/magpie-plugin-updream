// Static video model schemas and parameter validation for UPdream (www.updream.cn).
// Derived from live GET /ai/video-models, VIDEO_MODEL_SCHEMA_DEFINITIONS, PARAM_TEMPLATES,
// and CanvasPage payload builders in UPdream's web bundle.

export const SEEDANCE_MODEL_IDS = [
  "sed2-5",
  "sed2-5-draft",
  "wonder-ultra",
  "sed2",
  "wonder-pro",
  "sed2-fast",
  "sed2-mini",
];

export const LEGACY_VIDEO_MODEL_IDS = {
  "sed2-hsr": "sed2",
  "sed2-5-hsr": "sed2-5",
  "doubao-seedance-2-5": "sed2-5",
  seedance25: "sed2-5",
  "doubao-seedance-2-0-mini": "sed2-mini",
  "seedance-2.0-mini": "sed2-mini",
  "seedance-2-0-mini": "sed2-mini",
  "yike-wonder-pro": "wonder-pro",
  "wan3.0": "wan-3.0",
  "minimax-h3": "hailuo-h3",
  minimaxh3: "hailuo-h3",
};

export const POST_PROCESS_VIDEO_MODEL_IDS = [
  "video-enhance-standard",
  "video-enhance-pro",
  "subtitle-erase-pro",
];

export function normalizeVideoModelId(modelId) {
  if (typeof modelId !== "string") return modelId;
  const trimmed = modelId.trim();
  return LEGACY_VIDEO_MODEL_IDS[trimmed] ?? trimmed;
}

const IMAGE_RESIZE_SUFFIX_IN_PATH_RE = /(\.(?:jpe?g|png|webp|gif|bmp|svg|avif))@[^/?#]+$/i;

export function normalizeImageReferenceUrl(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^([^?#]+)(.*)$/);
  if (!match) return trimmed;
  const [, pathPart, suffix] = match;
  const cleanedPath = pathPart.replace(IMAGE_RESIZE_SUFFIX_IN_PATH_RE, "$1");
  return `${cleanedPath}${suffix}`;
}

export const ASPECT_RATIO_SEEDANCE = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"];
export const ASPECT_RATIO_SEEDANCE_MINI = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export const ASPECT_RATIO_WONDER_PRO = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
export const ASPECT_RATIO_ADAPTIVE_ONLY = ["adaptive"];
export const ASPECT_RATIO_STANDARD = ["16:9", "9:16", "1:1"];
export const ASPECT_RATIO_FIVE = ["16:9", "9:16", "1:1", "4:3", "3:4"];
export const ASPECT_RATIO_H3 = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export const ASPECT_RATIO_EXTENDED = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export const ASPECT_RATIO_PIXVERSE = ["16:9", "9:16", "4:3", "3:4", "1:1", "2:3", "3:2", "21:9"];
export const ASPECT_RATIO_VEO = ["16:9", "9:16"];

export const WAN_SIZE_MAP = {
  "1080p": {
    "16:9": "1920*1080",
    "9:16": "1080*1920",
    "1:1": "1440*1440",
    "4:3": "1632*1248",
    "3:4": "1248*1632",
  },
  "720p": {
    "16:9": "1280*720",
    "9:16": "720*1280",
    "1:1": "960*960",
    "4:3": "1088*832",
    "3:4": "832*1088",
  },
};

export function getWanSize(quality, aspectRatio) {
  const q = String(quality || "1080p").toLowerCase();
  return WAN_SIZE_MAP[q]?.[aspectRatio] ?? "1920*1080";
}

// Models whose reference video billing uses ref_video_seconds in /credit/estimate (matches web pp() helper)
export const REF_VIDEO_SECONDS_MODELS = new Set([
  "kling-v4",
  "sed2-5",
  "wonder-ultra",
  "hailuo-h3",
  "wan-3.0",
]);

const SED25_MEDIA_LIMITS = {
  t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
  i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
  firstlast: { images: { min: 2, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
  ref2v: { images: { min: 0, max: 30 }, videos: { min: 0, max: 10 }, audios: { min: 0, max: 10 }, minTotal: 1, maxTotal: 50 },
  video_edit: { images: { min: 0, max: 30 }, videos: { min: 1, max: 10 }, audios: { min: 0, max: 10 }, minTotal: 1, maxTotal: 50 },
  clip2v: { images: { min: 0, max: 30 }, videos: { min: 1, max: 10 }, audios: { min: 0, max: 10 }, minTotal: 1, maxTotal: 50 },
};

const SED2_MEDIA_LIMITS = {
  t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
  i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
  firstlast: { images: { min: 1, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
  ref2v: { images: { min: 0, max: 9 }, videos: { min: 0, max: 3 }, audios: { min: 0, max: 3 }, minTotal: 1, maxTotal: 15 },
  video_edit: { images: { min: 0, max: 0 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 1 },
};

const BASIC_T2V_I2V_LIMITS = {
  t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
  i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
};

export const SEEDANCE_MODELS = {
  "sed2-5": {
    id: "sed2-5",
    label: "Seedance 2.5",
    display_name: "Seedance 2.5",
    api_model_name: "sed2-5",
    family: "seedance-2.5",
    supported: true,
    live_available: true,
    draft: false,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"],
    durations: {
      default: 5,
      min: 4,
      max: 30,
      step: 1,
      mode_overrides: {
        video_edit: { values: [-1], default: -1, description: "Auto duration matching source video (-1 / 跟随原视频)" },
        clip2v: { min: 4, max: 180, step: 1, default: 5 },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_SEEDANCE,
      default: "16:9",
      forced_adaptive_modes: ["i2v", "firstlast", "video_edit", "clip2v"],
    },
    resolutions: {
      options: ["480p", "720p"],
      default: "720p",
    },
    audio: {
      supported: true,
      default: true,
      api_field: "supports_audio",
    },
    output_format: {
      options: ["mp4", "mov"],
      default: "mp4",
    },
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: SED25_MEDIA_LIMITS,
  },

  "sed2-5-draft": {
    id: "sed2-5-draft",
    label: "Seedance 2.5(样片模式)",
    display_name: "Seedance 2.5(样片模式)",
    api_model_name: "sed2-5",
    family: "seedance-2.5",
    supported: true,
    live_available: true,
    draft: true,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"],
    durations: {
      default: 5,
      min: 4,
      max: 30,
      step: 1,
      mode_overrides: {
        video_edit: { values: [-1], default: -1, description: "Auto duration matching source video (-1 / 跟随原视频)" },
        clip2v: { min: 4, max: 30, step: 1, default: 5 },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_SEEDANCE,
      default: "16:9",
      forced_adaptive_modes: ["i2v", "firstlast", "video_edit", "clip2v"],
    },
    resolutions: {
      options: ["480p"],
      default: "480p",
    },
    audio: {
      supported: true,
      default: true,
      api_field: "supports_audio",
    },
    output_format: {
      options: ["mp4", "mov"],
      default: "mp4",
    },
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: SED25_MEDIA_LIMITS,
  },

  "wonder-ultra": {
    id: "wonder-ultra",
    label: "Seedance 2.5(导演专属)",
    display_name: "Seedance 2.5(导演专属)",
    api_model_name: "wonder-ultra",
    family: "seedance-2.5",
    supported: true,
    live_available: false,
    draft: false,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"],
    durations: {
      default: 5,
      min: 4,
      max: 30,
      step: 1,
      mode_overrides: {
        video_edit: { values: [-1], default: -1, description: "Auto duration matching source video (-1 / 跟随原视频)" },
        clip2v: { min: 4, max: 180, step: 1, default: 5 },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_SEEDANCE,
      default: "16:9",
      forced_adaptive_modes: ["i2v", "firstlast", "video_edit", "clip2v"],
    },
    resolutions: {
      options: ["720p", "1080p"],
      default: "720p",
    },
    audio: {
      supported: true,
      default: true,
      api_field: "supports_audio",
    },
    output_format: {
      options: ["mp4"],
      default: "mp4",
    },
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: SED25_MEDIA_LIMITS,
  },

  sed2: {
    id: "sed2",
    label: "Seedance 2.0",
    display_name: "Seedance 2.0",
    api_model_name: "sed2",
    family: "seedance-2.0",
    supported: true,
    live_available: true,
    draft: false,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"],
    durations: {
      default: 5,
      min: 4,
      max: 15,
      step: 1,
      mode_overrides: {},
    },
    aspect_ratios: {
      options: ASPECT_RATIO_SEEDANCE,
      default: "16:9",
      forced_adaptive_modes: [],
    },
    resolutions: {
      options: ["480p", "720p", "1080p", "4k"],
      default: "720p",
    },
    audio: {
      supported: true,
      default: true,
      api_field: "supports_audio",
    },
    output_format: null,
    bitrate_mode: {
      options: ["standard", "high"],
      default: "high",
    },
    supports_negative_prompt: false,
    media_limits: SED2_MEDIA_LIMITS,
  },

  "wonder-pro": {
    id: "wonder-pro",
    label: "Wonder Pro",
    display_name: "Seedance 2.0(导演专属)",
    api_model_name: "wonder-pro",
    family: "seedance-2.0",
    supported: true,
    live_available: false,
    draft: false,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"],
    durations: {
      default: 5,
      min: 4,
      max: 15,
      step: 1,
      mode_overrides: {},
    },
    aspect_ratios: {
      options: ASPECT_RATIO_WONDER_PRO,
      default: "16:9",
      forced_adaptive_modes: [],
    },
    resolutions: {
      options: ["720p", "1080p"],
      default: "720p",
    },
    audio: {
      supported: true,
      default: true,
      api_field: "supports_audio",
    },
    output_format: null,
    bitrate_mode: {
      options: ["standard", "high"],
      default: "high",
    },
    supports_negative_prompt: false,
    media_limits: {
      ...SED2_MEDIA_LIMITS,
      firstlast: { images: { min: 2, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
    },
  },

  "sed2-fast": {
    id: "sed2-fast",
    label: "Seedance 2.0 Fast",
    display_name: "Seedance 2.0 Fast",
    api_model_name: "sed2-fast",
    family: "seedance-2.0",
    supported: true,
    live_available: true,
    draft: false,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"],
    durations: {
      default: 5,
      min: 4,
      max: 15,
      step: 1,
      mode_overrides: {},
    },
    aspect_ratios: {
      options: ASPECT_RATIO_SEEDANCE,
      default: "16:9",
      forced_adaptive_modes: [],
    },
    resolutions: {
      options: ["480p", "720p", "1080p", "2k", "4k"],
      default: "720p",
    },
    audio: {
      supported: true,
      default: true,
      api_field: "supports_audio",
    },
    output_format: null,
    bitrate_mode: {
      options: ["standard", "high"],
      default: "high",
    },
    supports_negative_prompt: false,
    media_limits: SED2_MEDIA_LIMITS,
  },

  "sed2-mini": {
    id: "sed2-mini",
    label: "Seedance 2.0 Mini",
    display_name: "Seedance 2.0 Mini",
    api_model_name: "sed2-mini",
    family: "seedance-2.0",
    supported: true,
    live_available: true,
    draft: false,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"],
    durations: {
      default: 5,
      min: 4,
      max: 15,
      step: 1,
      mode_overrides: {},
    },
    aspect_ratios: {
      options: ASPECT_RATIO_SEEDANCE_MINI,
      default: "16:9",
      forced_adaptive_modes: [],
    },
    resolutions: {
      options: ["480p", "720p"],
      default: "720p",
    },
    audio: {
      supported: true,
      default: true,
      api_field: "supports_audio",
    },
    output_format: null,
    bitrate_mode: {
      options: ["standard", "high"],
      default: "high",
    },
    supports_negative_prompt: false,
    media_limits: {
      ...SED2_MEDIA_LIMITS,
      ref2v: { images: { min: 0, max: 12 }, videos: { min: 0, max: 3 }, audios: { min: 0, max: 3 }, minTotal: 1, maxTotal: 18 },
    },
  },
};

// All 24 non-Seedance models from live /ai/video-models + VIDEO_MODEL_SCHEMA_DEFINITIONS.
export const NON_SEEDANCE_MODELS = [
  {
    id: "paiwo-v6max",
    label: "PixVerse V6 Max",
    display_name: "PixVerse V6 Max",
    api_model_name: "paiwo-v6max",
    family: "pixverse",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v"],
    durations: { min: 1, max: 15, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_PIXVERSE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: { options: ["360p", "540p", "720p", "1080p"], default: "720p" },
    audio: { supported: true, default: true, api_field: "supports_audio" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "wan-3.0",
    label: "Wan 3.0",
    display_name: "Wan 3.0",
    api_model_name: "wan-3.0",
    family: "wan",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"],
    durations: {
      min: 2,
      max: 30,
      step: 1,
      default: 5,
      mode_overrides: {
        video_edit: { min: 2, max: 30, step: 1, default: undefined, omitted: true },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_H3,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "firstlast", "video_edit"],
      mode_options: {
        t2v: { options: ASPECT_RATIO_EXTENDED, default: "16:9" },
      },
    },
    resolutions: { options: ["480P", "720P", "1080P"], default: "1080P" },
    quality_mode: { options: ["standard", "prime"], default: "standard" },
    audio: { supported: true, default: true, api_field: "sound" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    supports_prompt_extend: true,
    default_prompt_extend: true,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 2, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
      ref2v: { images: { min: 0, max: 10 }, videos: { min: 0, max: 5 }, audios: { min: 0, max: 5 }, minTotal: 1 },
      video_edit: { images: { min: 0, max: 10 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1 },
    },
  },
  {
    id: "hailuo-h3",
    label: "Hailuo H3",
    display_name: "Hailuo H3",
    api_model_name: "hailuo-h3",
    family: "hailuo",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "firstlast", "ref2v"],
    durations: { min: 5, max: 15, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_H3,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "firstlast"],
      mode_options: {
        t2v: { options: ASPECT_RATIO_EXTENDED, default: "16:9" },
      },
    },
    resolutions: { options: ["768P", "2K"], default: "2K" },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 2, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
      ref2v: {
        images: { min: 0, max: 9 },
        videos: { min: 0, max: 3 },
        audios: { min: 0, max: 3 },
        minTotal: 1,
        combinedMin: { mediaTypes: ["images", "videos"], min: 1 },
      },
    },
  },
  {
    id: "minimax-h3-max",
    label: "MiniMax H3 Max",
    display_name: "MiniMax H3 Max",
    api_model_name: "minimax-h3-max",
    family: "hailuo",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v"],
    durations: { min: 5, max: 15, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_EXTENDED,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: { options: ["480P", "768P"], default: "768P" },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "happyhorse-1.1",
    label: "Happyhorse 1.1",
    display_name: "Happyhorse 1.1",
    api_model_name: "happyhorse-1.1",
    family: "happyhorse",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "ref2v", "video_edit"],
    durations: {
      min: 3,
      max: 15,
      step: 1,
      default: 5,
      mode_overrides: {
        video_edit: { min: 3, max: 15, step: 1, default: undefined, omitted: true },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_FIVE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "video_edit"],
    },
    resolutions: { options: ["720P", "1080P"], default: "1080P" },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      ref2v: { images: { min: 1, max: 9 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 9 },
      video_edit: { images: { min: 0, max: 5 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 6 },
    },
  },
  {
    id: "happyhorse",
    label: "Happyhorse",
    display_name: "Happyhorse",
    api_model_name: "happyhorse",
    family: "happyhorse",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "ref2v", "video_edit"],
    durations: {
      min: 3,
      max: 15,
      step: 1,
      default: 5,
      mode_overrides: {
        video_edit: { min: 3, max: 15, step: 1, default: undefined, omitted: true },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_FIVE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "video_edit"],
    },
    resolutions: { options: ["720P", "1080P"], default: "1080P" },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      ref2v: { images: { min: 1, max: 9 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 9 },
      video_edit: { images: { min: 0, max: 5 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 6 },
    },
  },
  {
    id: "kling-v3.0-turbo",
    label: "Kling 3.0 Turbo",
    display_name: "Kling 3.0 Turbo",
    api_model_name: "kling-v3.0-turbo",
    family: "kling",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v"],
    durations: { min: 3, max: 15, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_STANDARD,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: { options: ["720P", "1080P"], default: "1080P" },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "kling-v3-omni",
    label: "Kling v3.0 Omni",
    display_name: "Kling v3.0 Omni",
    api_model_name: "kling-v3-omni",
    family: "kling",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "firstlast", "ref2v"],
    durations: { min: 3, max: 15, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_STANDARD,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "firstlast"],
    },
    resolutions: null,
    quality_mode: { options: ["std", "pro", "4k"], default: "pro", resolution_map: { "720p": "std", "1080p": "pro", "4k": "4k" } },
    audio: { supported: true, default: true, api_field: "sound", disable_when_ref_video: true },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    supports_keep_original_sound: true,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 1, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
      ref2v: {
        images: { min: 0, max: 7 },
        videos: { min: 0, max: 1 },
        audios: { min: 0, max: 0 },
        minTotal: 1,
        conditionalMax: { when: "has_video", images: 4 },
      },
    },
  },
  {
    id: "kling-v3.0-std",
    label: "Kling v3.0 Standard",
    display_name: "Kling v3.0 Standard",
    api_model_name: "kling-v3.0-std",
    family: "kling",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "firstlast"],
    durations: { min: 3, max: 15, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_STANDARD,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "firstlast"],
    },
    resolutions: null,
    quality_mode: { options: ["std", "pro", "4k"], default: "pro", resolution_map: { "720p": "std", "1080p": "pro", "4k": "4k" } },
    audio: { supported: true, default: true, api_field: "sound" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    supports_cfg_scale: true,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 1, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
    },
  },
  {
    id: "kling-v4",
    label: "Kling 4.0",
    display_name: "Kling 4.0",
    api_model_name: "kling-v4",
    family: "kling",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "firstlast", "multiframe", "ref2v", "video_edit"],
    durations: { min: 3, max: 30, step: 1, default: 10, mode_overrides: {} },
    aspect_ratios: {
      options: ["21:9", "16:9", "9:16", "1:1", "adaptive"],
      default: "adaptive",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "firstlast", "multiframe", "video_edit"],
      mode_options: {
        t2v: { options: ["21:9", "16:9", "9:16", "1:1"], default: "16:9" },
      },
    },
    resolutions: { options: ["720p", "1080p"], default: "1080p" },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 1, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
      multiframe: { images: { min: 3, max: 10 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 10 },
      ref2v: {
        images: { min: 0, max: 10 },
        videos: { min: 0, max: 5 },
        audios: { min: 0, max: 3 },
        minTotal: 1,
        maxTotal: 15,
        combinedMin: { mediaTypes: ["images", "videos"], min: 1 },
      },
      video_edit: { images: { min: 0, max: 0 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 1 },
    },
  },
  {
    id: "kling-v2-5-turbo",
    label: "Kling 2.5 Turbo",
    display_name: "Kling 2.5 Turbo",
    api_model_name: "kling-v2-5-turbo",
    family: "kling",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v"],
    durations: { values: [5, 10], default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_STANDARD,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: null,
    quality_mode: { options: ["std", "pro"], default: "pro", resolution_map: { "720p": "std", "1080p": "pro" } },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "kling-o1",
    label: "Kling-o1",
    display_name: "Kling-o1",
    api_model_name: "kling-o1",
    family: "kling",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "firstlast", "ref2v"],
    durations: { min: 5, max: 10, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_STANDARD,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "firstlast"],
    },
    resolutions: null,
    quality_mode: { options: ["std", "pro"], default: "pro", resolution_map: { "720p": "std", "1080p": "pro" } },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 1, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
      ref2v: {
        images: { min: 0, max: 7 },
        videos: { min: 0, max: 1 },
        audios: { min: 0, max: 0 },
        minTotal: 1,
        conditionalMax: { when: "has_video", images: 4 },
      },
    },
  },
  {
    id: "gemini-omni-flash",
    label: "Omni Flash",
    display_name: "Omni Flash",
    api_model_name: "gemini-omni-flash",
    family: "omni",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "ref2v", "video_edit"],
    durations: {
      values: [10],
      default: 10,
      mode_overrides: {
        video_edit: { values: [10], default: undefined, omitted: true },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_VEO,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "video_edit"],
    },
    resolutions: { options: ["720p"], default: "720p", omitted_modes: ["video_edit"] },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      ref2v: { images: { min: 1, max: 4 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 4 },
      video_edit: { images: { min: 0, max: 0 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 1 },
    },
  },
  {
    id: "gemini-omni-1.1-flash",
    label: "Omni 1.1 Flash",
    display_name: "Omni 1.1 Flash",
    api_model_name: "gemini-omni-1.1-flash",
    family: "omni",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"],
    durations: {
      min: 3,
      max: 10,
      step: 1,
      default: 10,
      mode_overrides: {
        video_edit: { min: 3, max: 10, step: 1, default: undefined, omitted: true },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_VEO,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["video_edit", "clip2v"],
    },
    resolutions: {
      options: ["360p", "720p", "1080p", "4k"],
      default: "720p",
      omitted_modes: ["video_edit", "clip2v"],
    },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 2, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
      ref2v: {
        images: { min: 0, max: 10 },
        videos: { min: 0, max: 3 },
        audios: { min: 0, max: 0 },
        minTotal: 1,
        combinedMin: { mediaTypes: ["images", "videos"], min: 1 },
      },
      video_edit: { images: { min: 0, max: 0 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 1 },
      clip2v: { images: { min: 0, max: 1 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 2 },
    },
  },
  {
    id: "vidu-q2-pro",
    label: "VIDU Q2 Pro",
    display_name: "VIDU Q2 Pro",
    api_model_name: "vidu-q2-pro",
    family: "vidu",
    supported: true,
    live_available: true,
    modes: ["i2v", "firstlast", "multiframe", "ref2v"],
    durations: { min: 1, max: 10, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_FIVE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "firstlast", "multiframe"],
    },
    resolutions: { options: ["540p", "720p", "1080p"], default: "720p" },
    audio: { supported: true, default: true, api_field: "supports_audio" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 2, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
      multiframe: { images: { min: 3, max: 10 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 10 },
      ref2v: { images: { min: 1, max: 20 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 20 },
    },
  },
  {
    id: "vidu-q4",
    label: "VIDU Q4 Preview",
    display_name: "VIDU Q4 Preview",
    api_model_name: "vidu-q4",
    family: "vidu",
    supported: true,
    live_available: true,
    modes: ["i2v", "ref2v"],
    durations: { min: 3, max: 16, step: 1, default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_FIVE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: { options: ["540p", "720p", "1080p", "2k", "4k"], default: "720p" },
    audio: { supported: true, default: true, api_field: "supports_audio" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: {
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      ref2v: {
        images: { min: 0, max: 15 },
        videos: { min: 0, max: 0 },
        audios: { min: 0, max: 3 },
        minTotal: 1,
        combinedMin: { mediaTypes: ["images", "audios"], min: 1 },
      },
    },
  },
  {
    id: "hailuo-2.3",
    label: "Hailuo 2.3",
    display_name: "Hailuo 2.3",
    api_model_name: "hailuo-2.3",
    family: "hailuo",
    supported: true,
    live_available: true,
    modes: ["t2v", "i2v"],
    durations: { values: [6, 10], default: 6, mode_overrides: {} },
    aspect_ratios: {
      options: ["16:9"],
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["t2v", "i2v"],
    },
    resolutions: {
      options: ["768P", "1080P"],
      default: "768P",
      duration_constraints: { 10: ["768P"] },
    },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "veo-3.1-preview",
    label: "Veo 3.1",
    display_name: "Veo 3.1",
    api_model_name: "veo-3.1-preview",
    family: "veo",
    supported: true,
    live_available: false,
    modes: ["t2v", "i2v"],
    durations: { values: [4, 6, 8], default: 8, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_VEO,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: { options: ["720p", "1080p"], default: "720p" },
    audio: { supported: true, default: true, api_field: "sound" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    supports_enhance_prompt: true,
    default_enhance_prompt: true,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "wan-2.7",
    label: "Wan 2.7",
    display_name: "Wan 2.7",
    api_model_name: "wan-2.7",
    family: "wan",
    supported: true,
    live_available: false,
    modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"],
    durations: {
      values: [5, 10, 15],
      default: 5,
      mode_overrides: {
        video_edit: { values: [5, 10, 15], default: undefined, omitted: true },
      },
    },
    aspect_ratios: {
      options: ASPECT_RATIO_FIVE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v", "firstlast", "video_edit"],
    },
    resolutions: { options: ["720p", "1080p"], default: "1080p", omitted_modes: ["video_edit"] },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    supports_keep_original_sound: true,
    media_limits: {
      t2v: { images: { min: 0, max: 0 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 0 },
      i2v: { images: { min: 1, max: 1 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 1 },
      firstlast: { images: { min: 1, max: 2 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, maxTotal: 2 },
      ref2v: { images: { min: 0, max: 5 }, videos: { min: 0, max: 5 }, audios: { min: 0, max: 0 }, minTotal: 1 },
      video_edit: { images: { min: 0, max: 4 }, videos: { min: 1, max: 1 }, audios: { min: 0, max: 0 }, minTotal: 1, maxTotal: 5 },
    },
  },
  {
    id: "wan-2.6-ref2v",
    label: "Wan 2.6 参考生视频",
    display_name: "Wan 2.6 参考生视频",
    api_model_name: "wan-2.6-ref2v",
    family: "wan",
    supported: true,
    live_available: false,
    modes: ["ref2v"],
    durations: { values: [5, 10], default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_STANDARD,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: [],
    },
    resolutions: { options: ["720p", "1080p"], default: "1080p", size_modes: ["ref2v"] },
    audio: { supported: true, default: true, api_field: "sound" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    supports_shot_type: true,
    media_limits: {
      ref2v: { images: { min: 1, max: 3 }, videos: { min: 0, max: 1 }, audios: { min: 0, max: 1 }, minTotal: 1 },
    },
  },
  {
    id: "wan-2.6",
    label: "Wan 2.6",
    display_name: "Wan 2.6",
    api_model_name: "wan-2.6",
    family: "wan",
    supported: true,
    live_available: false,
    modes: ["t2v", "i2v"],
    durations: { values: [5, 10, 15], default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_FIVE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: { options: ["720p", "1080p"], default: "1080p", size_modes: ["t2v"] },
    audio: { supported: true, default: true, api_field: "sound" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    supports_shot_type: true,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "wan-2.5-preview",
    label: "Wan 2.5 Preview",
    display_name: "Wan 2.5 Preview",
    api_model_name: "wan-2.5-preview",
    family: "wan",
    supported: true,
    live_available: false,
    modes: ["t2v", "i2v"],
    durations: { values: [5, 10], default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_FIVE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: {
      options: ["480p", "720p", "1080p"],
      default: "1080p",
      size_modes: ["t2v"],
      mode_options: { t2v: ["720p", "1080p"], i2v: ["480p", "720p", "1080p"] },
    },
    audio: { supported: true, default: true, api_field: "sound" },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "wan-2.2",
    label: "Wan 2.2",
    display_name: "Wan 2.2",
    api_model_name: "wan-2.2",
    family: "wan",
    supported: true,
    live_available: false,
    modes: ["t2v", "i2v"],
    durations: { values: [5], default: 5, mode_overrides: {} },
    aspect_ratios: {
      options: ASPECT_RATIO_FIVE,
      default: "16:9",
      forced_adaptive_modes: [],
      omitted_modes: ["i2v"],
    },
    resolutions: {
      options: ["480p", "720p", "1080p"],
      default: "1080p",
      size_modes: ["t2v"],
      mode_options: { t2v: ["720p", "1080p"], i2v: ["480p", "1080p"] },
    },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: true,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
  {
    id: "test",
    label: "测试模型 (Mock)",
    display_name: "测试模型 (Mock)",
    api_model_name: "test",
    family: "mock",
    supported: false,
    live_available: false,
    unsupported_reason: "Internal UPdream mock/test model excluded from production canvas video generation.",
    modes: ["t2v", "i2v"],
    durations: { values: [5, 10], default: 5, mode_overrides: {} },
    aspect_ratios: { options: ASPECT_RATIO_STANDARD, default: "16:9", forced_adaptive_modes: [] },
    resolutions: { options: ["720p"], default: "720p" },
    audio: { supported: false, default: false, api_field: null },
    output_format: null,
    bitrate_mode: null,
    supports_negative_prompt: false,
    media_limits: BASIC_T2V_I2V_LIMITS,
  },
];

export const ALL_VIDEO_MODELS = [
  ...SEEDANCE_MODEL_IDS.map((id) => SEEDANCE_MODELS[id]),
  ...NON_SEEDANCE_MODELS,
];

export const VIDEO_MODELS_BY_ID = Object.fromEntries(
  ALL_VIDEO_MODELS.map((m) => [m.id, m]),
);

export const NON_SEEDANCE_MODEL_IDS = NON_SEEDANCE_MODELS.filter((m) => m.supported !== false).map(
  (m) => m.id,
);

export const SUPPORTED_VIDEO_MODEL_IDS = [
  ...SEEDANCE_MODEL_IDS,
  ...NON_SEEDANCE_MODEL_IDS,
];

function cleanStringArray(arr, fieldName) {
  if (arr === undefined || arr === null) return [];
  if (!Array.isArray(arr)) {
    throw new Error(`Invalid '${fieldName}': expected an array of strings.`);
  }
  return arr.map((item, idx) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Invalid '${fieldName}[${idx}]': expected a non-empty string URL or path.`);
    }
    return item.trim();
  });
}

export function inferGenerateType({
  mode,
  generate_type,
  first_frame,
  last_frame,
  reference_images,
  reference_videos,
  reference_audios,
}) {
  const explicit = mode ?? generate_type;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
    return String(explicit).trim();
  }
  const hasRefImages = Array.isArray(reference_images) && reference_images.length > 0;
  const hasRefVideos = Array.isArray(reference_videos) && reference_videos.length > 0;
  const hasRefAudios = Array.isArray(reference_audios) && reference_audios.length > 0;
  if (hasRefImages || hasRefVideos || hasRefAudios) return "ref2v";
  const hasFirst = typeof first_frame === "string" && first_frame.trim().length > 0;
  const hasLast = typeof last_frame === "string" && last_frame.trim().length > 0;
  if (hasFirst && hasLast) return "firstlast";
  if (hasFirst) return "i2v";
  if (hasLast) {
    throw new Error(
      "Invalid frame parameters: 'last_frame' cannot be provided without 'first_frame'. Provide both 'first_frame' and 'last_frame' for 'firstlast' mode.",
    );
  }
  return "t2v";
}

function matchResolutionOption(rawRes, options) {
  if (options.includes(rawRes)) return rawRes;
  const lower = rawRes.toLowerCase();
  return options.find((opt) => opt.toLowerCase() === lower) ?? null;
}

export function resolveAndValidateVideoParams(args = {}, { requirePrompt = true } = {}) {
  if (!args || typeof args !== "object") {
    throw new Error("Arguments must be an object.");
  }

  // 1. Validate prompt
  let prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (requirePrompt && !prompt) {
    throw new Error("Invalid 'prompt': a non-empty string prompt is required.");
  }

  // 2. Validate model
  const rawModel =
    args.model === undefined || args.model === null || args.model === ""
      ? "sed2-5"
      : String(args.model).trim();
  const modelId = normalizeVideoModelId(rawModel);

  if (POST_PROCESS_VIDEO_MODEL_IDS.includes(modelId)) {
    throw new Error(
      `Model "${rawModel}" is a video post-processing utility (enhancement / subtitle erase), not a generative video model supported by create_video.`,
    );
  }

  const schema = VIDEO_MODELS_BY_ID[modelId];
  if (!schema || schema.supported === false) {
    const reason = schema?.unsupported_reason ? ` (${schema.unsupported_reason})` : "";
    throw new Error(
      `Invalid 'model' "${rawModel}"${reason}. Allowed models: ${SUPPORTED_VIDEO_MODEL_IDS.join(", ")}.`,
    );
  }

  const isSeedance = Boolean(SEEDANCE_MODELS[modelId]);

  // 3. Validate media inputs & infer/validate mode (generate_type)
  let firstFrame =
    typeof args.first_frame === "string" && args.first_frame.trim() ? args.first_frame.trim() : undefined;
  let lastFrame =
    typeof args.last_frame === "string" && args.last_frame.trim() ? args.last_frame.trim() : undefined;
  let refImages = cleanStringArray(args.reference_images, "reference_images");
  const refVideos = cleanStringArray(args.reference_videos, "reference_videos");
  const refAudios = cleanStringArray(args.reference_audios, "reference_audios");

  const generateType = inferGenerateType({
    mode: args.mode,
    generate_type: args.generate_type,
    first_frame: firstFrame,
    last_frame: lastFrame,
    reference_images: refImages,
    reference_videos: refVideos,
    reference_audios: refAudios,
  });

  if (!schema.modes.includes(generateType)) {
    throw new Error(
      `Invalid 'mode' ("${generateType}") for model "${modelId}". Allowed modes for ${modelId}: ${schema.modes.join(", ")}.`,
    );
  }

  // Validate media limits per mode
  const limits = schema.media_limits[generateType];
  if (generateType === "t2v") {
    if (firstFrame || lastFrame || refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0) {
      throw new Error(
        "Mode 't2v' does not accept media attachments. Omit frames/references or use mode 'i2v', 'firstlast', or 'ref2v'.",
      );
    }
  } else if (generateType === "i2v") {
    if (!firstFrame) {
      throw new Error(`Mode 'i2v' on model "${modelId}" requires 'first_frame' (1 image).`);
    }
    if (lastFrame) {
      throw new Error(
        "Mode 'i2v' does not accept 'last_frame'. Use mode 'firstlast' when providing both 'first_frame' and 'last_frame'.",
      );
    }
    if (refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0) {
      throw new Error(
        "Mode 'i2v' does not accept 'reference_images', 'reference_videos', or 'reference_audios'. Use 'first_frame' only, or switch to 'ref2v'.",
      );
    }
  } else if (generateType === "firstlast") {
    if (!firstFrame) {
      throw new Error(`Mode 'firstlast' on model "${modelId}" requires 'first_frame'.`);
    }
    const frameCount = (firstFrame ? 1 : 0) + (lastFrame ? 1 : 0);
    if (frameCount < limits.images.min || frameCount > limits.images.max) {
      throw new Error(
        `Mode 'firstlast' on model "${modelId}" requires ${limits.images.min === limits.images.max ? limits.images.min : `${limits.images.min}..${limits.images.max}`} frame images ('first_frame'${limits.images.min >= 2 ? " and 'last_frame'" : " and optional 'last_frame'"}), got ${frameCount}.`,
      );
    }
    if (refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0) {
      throw new Error(
        "Mode 'firstlast' uses 'first_frame' and 'last_frame', not 'reference_images'/'reference_videos'/'reference_audios'.",
      );
    }
  } else if (generateType === "multiframe") {
    if (lastFrame || refVideos.length > 0 || refAudios.length > 0) {
      throw new Error(
        "Mode 'multiframe' accepts only keyframe images (via 'reference_images' or 'first_frame' + 'reference_images'), not 'last_frame', 'reference_videos', or 'reference_audios'.",
      );
    }
    const allFrames = [...(firstFrame ? [firstFrame] : []), ...refImages];
    if (allFrames.length < limits.images.min || allFrames.length > limits.images.max) {
      throw new Error(
        `Mode 'multiframe' on model "${modelId}" requires ${limits.images.min}..${limits.images.max} images, got ${allFrames.length}.`,
      );
    }
    // Web client sends first frame in 'image' and remaining frames in 'ref_images'
    firstFrame = allFrames[0];
    refImages = allFrames.slice(1);
  } else if (generateType === "ref2v" || generateType === "video_edit" || generateType === "clip2v") {
    if (firstFrame || lastFrame) {
      // Allow optional target end frame via last_frame on non-Seedance clip2v (matches CanvasPage kc = Wo[0])
      if (!(!isSeedance && generateType === "clip2v" && !firstFrame && lastFrame && limits.images.max >= 1)) {
        throw new Error(`Mode '${generateType}' uses 'reference_images' instead of 'first_frame'/'last_frame'.`);
      }
    }
    const effectiveImgCount = refImages.length + (!isSeedance && generateType === "clip2v" && lastFrame ? 1 : 0);
    if (effectiveImgCount < limits.images.min || effectiveImgCount > limits.images.max) {
      throw new Error(
        `Invalid 'reference_images' count (${effectiveImgCount}) for ${modelId} in '${generateType}' mode. Allowed: ${limits.images.min}..${limits.images.max}.`,
      );
    }
    if (refVideos.length < limits.videos.min || refVideos.length > limits.videos.max) {
      throw new Error(
        `Invalid 'reference_videos' count (${refVideos.length}) for ${modelId} in '${generateType}' mode. Allowed: ${limits.videos.min}..${limits.videos.max}.`,
      );
    }
    if (refAudios.length < limits.audios.min || refAudios.length > limits.audios.max) {
      throw new Error(
        `Invalid 'reference_audios' count (${refAudios.length}) for ${modelId} in '${generateType}' mode. Allowed: ${limits.audios.min}..${limits.audios.max}.`,
      );
    }
    if (limits.combinedMin) {
      const countsByType = {
        images: effectiveImgCount,
        videos: refVideos.length,
        audios: refAudios.length,
      };
      const combinedSum = limits.combinedMin.mediaTypes.reduce((acc, k) => acc + (countsByType[k] || 0), 0);
      if (combinedSum < limits.combinedMin.min) {
        throw new Error(
          `Mode '${generateType}' on model "${modelId}" requires at least ${limits.combinedMin.min} item across [${limits.combinedMin.mediaTypes.join(", ")}].`,
        );
      }
    }
    if (limits.conditionalMax && limits.conditionalMax.when === "has_video" && refVideos.length > 0) {
      if (limits.conditionalMax.images !== undefined && effectiveImgCount > limits.conditionalMax.images) {
        throw new Error(
          `Invalid 'reference_images' count (${effectiveImgCount}) for ${modelId} when 'reference_videos' is attached: maximum ${limits.conditionalMax.images} images allowed alongside a reference video.`,
        );
      }
    }
    const totalMedia = effectiveImgCount + refVideos.length + refAudios.length;
    if (limits.minTotal && totalMedia < limits.minTotal) {
      throw new Error(
        `Mode '${generateType}' on model "${modelId}" requires at least ${limits.minTotal} reference media item (in 'reference_images', 'reference_videos', or 'reference_audios').`,
      );
    }
    if (limits.maxTotal && totalMedia > limits.maxTotal) {
      throw new Error(
        `Total reference media count (${totalMedia}) exceeds maximum allowed (${limits.maxTotal}) for ${modelId} in '${generateType}' mode.`,
      );
    }
  }

  // 4. Validate duration
  const durationSpec = schema.durations.mode_overrides?.[generateType] ?? schema.durations;
  let duration;
  if (args.duration === undefined || args.duration === null) {
    duration = durationSpec.omitted ? undefined : durationSpec.default;
  } else {
    const parsed = Number(args.duration);
    if (!Number.isInteger(parsed)) {
      throw new Error(`Invalid 'duration' (${args.duration}): must be an integer number of seconds.`);
    }
    if (Array.isArray(durationSpec.values)) {
      if (!durationSpec.values.includes(parsed)) {
        throw new Error(
          `Invalid 'duration' (${parsed}) for model "${modelId}" in mode "${generateType}". Allowed values: ${durationSpec.values.join(", ")}.`,
        );
      }
    } else if (parsed < durationSpec.min || parsed > durationSpec.max) {
      throw new Error(
        `Invalid 'duration' (${parsed}) for model "${modelId}" in mode "${generateType}". Allowed range: ${durationSpec.min}..${durationSpec.max} seconds${durationSpec.default !== undefined ? ` (default ${durationSpec.default})` : ""}.`,
      );
    }
    duration = durationSpec.omitted ? undefined : parsed;
  }

  // 5. Validate aspect_ratio
  const arSpec = schema.aspect_ratios;
  const forcedAdaptive = Boolean(arSpec.forced_adaptive_modes?.includes(generateType));
  const omittedAspectRatio = Boolean(arSpec.omitted_modes?.includes(generateType));
  const modeArSpec = arSpec.mode_options?.[generateType];
  const allowedRatios = modeArSpec?.options ?? arSpec.options;
  const defaultRatio = modeArSpec?.default ?? arSpec.default;

  let aspectRatio;
  let logicalAspectRatio = defaultRatio || "16:9";
  if (args.aspect_ratio === undefined || args.aspect_ratio === null || args.aspect_ratio === "") {
    if (forcedAdaptive) {
      aspectRatio = "adaptive";
      logicalAspectRatio = "adaptive";
    } else if (omittedAspectRatio) {
      aspectRatio = undefined;
    } else {
      aspectRatio = defaultRatio;
    }
  } else {
    const rawAr = String(args.aspect_ratio).trim();
    if (!arSpec.options.includes(rawAr) || (!omittedAspectRatio && !forcedAdaptive && !allowedRatios.includes(rawAr))) {
      throw new Error(
        `Invalid 'aspect_ratio' ("${rawAr}") for model "${modelId}"${modeArSpec ? ` in mode "${generateType}"` : ""}. Allowed values: ${(omittedAspectRatio ? arSpec.options : allowedRatios).join(", ")}.`,
      );
    }
    logicalAspectRatio = rawAr;
    if (forcedAdaptive) {
      aspectRatio = "adaptive";
    } else if (omittedAspectRatio) {
      aspectRatio = undefined;
    } else {
      aspectRatio = rawAr;
    }
  }

  // 6. Validate quality_mode (payload.mode) and resolution / size
  let qualityMode;
  if (schema.quality_mode) {
    if (args.quality_mode !== undefined && args.quality_mode !== null && args.quality_mode !== "") {
      const rawQm = String(args.quality_mode).trim().toLowerCase();
      const matchedQm = schema.quality_mode.options.find((o) => o.toLowerCase() === rawQm);
      if (!matchedQm) {
        throw new Error(
          `Invalid 'quality_mode' ("${args.quality_mode}") for model "${modelId}". Allowed values: ${schema.quality_mode.options.join(", ")}.`,
        );
      }
      qualityMode = matchedQm;
    } else {
      qualityMode = schema.quality_mode.default;
    }
  } else if (args.quality_mode !== undefined && args.quality_mode !== null && args.quality_mode !== "") {
    throw new Error(
      `Parameter 'quality_mode' is not supported by model "${modelId}" (only supported on wan-3.0, kling-v3-omni, kling-v3.0-std, kling-o1, kling-v2-5-turbo).`,
    );
  }

  let resolution;
  let size;
  let estimateQuality;

  if (schema.resolutions) {
    const resSpec = schema.resolutions;
    const resOmitted = Boolean(resSpec.omitted_modes?.includes(generateType));
    const allowedResOptions = resSpec.mode_options?.[generateType] ?? resSpec.options;

    let chosenRes;
    if (args.resolution === undefined || args.resolution === null || args.resolution === "") {
      chosenRes = allowedResOptions.includes(resSpec.default) ? resSpec.default : allowedResOptions[0];
    } else {
      const rawRes = String(args.resolution).trim();
      const matched = isSeedance
        ? allowedResOptions.includes(rawRes)
          ? rawRes
          : null
        : matchResolutionOption(rawRes, allowedResOptions);
      if (!matched) {
        throw new Error(
          `Invalid 'resolution' ("${rawRes}") for model "${modelId}"${resSpec.mode_options?.[generateType] ? ` in mode "${generateType}"` : ""}. Allowed values: ${allowedResOptions.join(", ")} (default "${resSpec.default}").`,
        );
      }
      chosenRes = matched;
    }

    if (resSpec.duration_constraints && duration !== undefined && resSpec.duration_constraints[duration]) {
      const allowedForDuration = resSpec.duration_constraints[duration];
      if (!allowedForDuration.includes(chosenRes)) {
        throw new Error(
          `Invalid 'resolution' ("${chosenRes}") for model "${modelId}" when duration=${duration}s. Allowed values at ${duration}s: ${allowedForDuration.join(", ")}.`,
        );
      }
    }

    estimateQuality = chosenRes;
    if (resOmitted) {
      resolution = undefined;
    } else if (resSpec.size_modes?.includes(generateType)) {
      size = getWanSize(chosenRes, aspectRatio || logicalAspectRatio);
      resolution = undefined;
      aspectRatio = undefined;
    } else {
      resolution = chosenRes;
    }
  } else {
    // Models without 'resolution' (Kling quality_mode models: std=720p, pro=1080p, 4k=4k)
    if (args.resolution !== undefined && args.resolution !== null && args.resolution !== "") {
      const rawRes = String(args.resolution).trim().toLowerCase();
      const mappedQm = schema.quality_mode?.resolution_map?.[rawRes];
      if (!mappedQm) {
        throw new Error(
          `Invalid 'resolution' ("${args.resolution}") for model "${modelId}". Use 'quality_mode' (${schema.quality_mode?.options.join(", ")}) or matching resolution (${Object.keys(schema.quality_mode?.resolution_map ?? {}).join(", ")}).`,
        );
      }
      if (args.quality_mode === undefined || args.quality_mode === null || args.quality_mode === "") {
        qualityMode = mappedQm;
      }
    }
    estimateQuality = qualityMode === "pro" ? "1080p" : qualityMode === "4k" ? "4k" : "720p";
  }

  // 7. Validate audio -> supports_audio or sound
  let supportsAudio;
  let sound;
  let hasSoundFlag = false;
  if (schema.audio?.supported) {
    let audioVal = schema.audio.default;
    if (schema.audio.disable_when_ref_video && refVideos.length > 0 && (args.audio === undefined || args.audio === null)) {
      audioVal = false;
    }
    if (args.audio !== undefined && args.audio !== null) {
      if (typeof args.audio !== "boolean") {
        throw new Error(`Invalid 'audio' (${args.audio}): must be a boolean (true or false).`);
      }
      if (args.audio === true && schema.audio.disable_when_ref_video && refVideos.length > 0) {
        throw new Error(
          `Parameter 'audio: true' cannot be enabled on model "${modelId}" when 'reference_videos' is attached (use 'keep_original_sound' instead).`,
        );
      }
      audioVal = args.audio;
    }
    hasSoundFlag = Boolean(audioVal);
    if (schema.audio.api_field === "sound") {
      sound = audioVal;
    } else {
      supportsAudio = audioVal;
    }
  } else if (args.audio !== undefined && args.audio !== null) {
    if (typeof args.audio !== "boolean") {
      throw new Error(`Invalid 'audio' (${args.audio}): must be a boolean (true or false).`);
    }
    if (args.audio === true) {
      throw new Error(
        `Parameter 'audio: true' is not supported by model "${modelId}" (this model does not generate native audio).`,
      );
    }
  }

  // 8. Validate output_format
  let outputFormat;
  if (schema.output_format) {
    if (args.output_format === undefined || args.output_format === null || args.output_format === "") {
      outputFormat = schema.output_format.default;
    } else {
      const rawFmt = String(args.output_format).trim().toLowerCase();
      if (!schema.output_format.options.includes(rawFmt)) {
        throw new Error(
          `Invalid 'output_format' ("${args.output_format}") for model "${modelId}". Allowed values: ${schema.output_format.options.join(", ")}.`,
        );
      }
      outputFormat = rawFmt;
    }
  } else if (args.output_format !== undefined && args.output_format !== null && args.output_format !== "") {
    const rawFmt = String(args.output_format).trim().toLowerCase();
    if (rawFmt !== "mp4") {
      throw new Error(
        `Invalid 'output_format' ("${args.output_format}") for model "${modelId}". Only Seedance 2.5 ("sed2-5", "sed2-5-draft") supports "mov"; ${modelId} only outputs mp4.`,
      );
    }
  }

  // 9. Validate bitrate_mode (Seedance 2.0 family only)
  let bitrateMode;
  if (schema.bitrate_mode) {
    if (args.bitrate_mode === undefined || args.bitrate_mode === null || args.bitrate_mode === "") {
      bitrateMode = schema.bitrate_mode.default;
    } else {
      const rawBm = String(args.bitrate_mode).trim();
      if (!schema.bitrate_mode.options.includes(rawBm)) {
        throw new Error(
          `Invalid 'bitrate_mode' ("${rawBm}") for model "${modelId}". Allowed values: ${schema.bitrate_mode.options.join(", ")}.`,
        );
      }
      bitrateMode = rawBm;
    }
  } else if (args.bitrate_mode !== undefined && args.bitrate_mode !== null && args.bitrate_mode !== "") {
    throw new Error(
      `Parameter 'bitrate_mode' is not supported by model "${modelId}" (only supported on Seedance 2.0 family: sed2, wonder-pro, sed2-fast, sed2-mini).`,
    );
  }

  // 10. Validate num_videos (1-4, default 1)
  let numVideos = 1;
  if (args.num_videos !== undefined && args.num_videos !== null) {
    const parsedNum = Number(args.num_videos);
    if (!Number.isInteger(parsedNum) || parsedNum < 1 || parsedNum > 4) {
      throw new Error(`Invalid 'num_videos' (${args.num_videos}): must be an integer between 1 and 4.`);
    }
    numVideos = parsedNum;
  }

  // 11. Validate negative_prompt
  let negativePrompt;
  if (args.negative_prompt !== undefined && args.negative_prompt !== null && String(args.negative_prompt).trim() !== "") {
    if (!schema.supports_negative_prompt) {
      throw new Error(
        `Parameter 'negative_prompt' is not supported by model "${modelId}".${isSeedance ? " Seedance models do not accept negative prompts." : ""}`,
      );
    }
    negativePrompt = String(args.negative_prompt).trim();
  }

  // 12. Validate model-specific optional params (cfg_scale, prompt_extend, enhance_prompt, shot_type, keep_original_sound)
  let cfgScale;
  if (args.cfg_scale !== undefined && args.cfg_scale !== null) {
    if (!schema.supports_cfg_scale) {
      throw new Error(`Parameter 'cfg_scale' is not supported by model "${modelId}".`);
    }
    const parsedCfg = Number(args.cfg_scale);
    if (!Number.isFinite(parsedCfg) || parsedCfg < 0 || parsedCfg > 1) {
      throw new Error(`Invalid 'cfg_scale' (${args.cfg_scale}): must be a number between 0 and 1.`);
    }
    cfgScale = parsedCfg;
  }

  let promptExtend;
  if (schema.supports_prompt_extend) {
    if (args.prompt_extend === undefined || args.prompt_extend === null) {
      promptExtend = schema.default_prompt_extend ?? true;
    } else if (typeof args.prompt_extend !== "boolean") {
      throw new Error(`Invalid 'prompt_extend' (${args.prompt_extend}): must be a boolean.`);
    } else {
      promptExtend = args.prompt_extend;
    }
  } else if (args.prompt_extend !== undefined && args.prompt_extend !== null) {
    throw new Error(`Parameter 'prompt_extend' is not supported by model "${modelId}".`);
  }

  let enhancePrompt;
  if (schema.supports_enhance_prompt) {
    if (args.enhance_prompt === undefined || args.enhance_prompt === null) {
      enhancePrompt = schema.default_enhance_prompt ?? true;
    } else if (typeof args.enhance_prompt !== "boolean") {
      throw new Error(`Invalid 'enhance_prompt' (${args.enhance_prompt}): must be a boolean.`);
    } else {
      enhancePrompt = args.enhance_prompt;
    }
  } else if (args.enhance_prompt !== undefined && args.enhance_prompt !== null) {
    throw new Error(`Parameter 'enhance_prompt' is not supported by model "${modelId}".`);
  }

  let shotType;
  if (args.shot_type !== undefined && args.shot_type !== null && args.shot_type !== "") {
    if (!schema.supports_shot_type) {
      throw new Error(`Parameter 'shot_type' is not supported by model "${modelId}".`);
    }
    const rawShot = String(args.shot_type).trim();
    if (rawShot !== "single" && rawShot !== "multi") {
      throw new Error(`Invalid 'shot_type' ("${rawShot}"): allowed values are "single", "multi".`);
    }
    shotType = rawShot;
  }

  let keepOriginalSound;
  if (args.keep_original_sound !== undefined && args.keep_original_sound !== null) {
    if (!schema.supports_keep_original_sound) {
      throw new Error(`Parameter 'keep_original_sound' is not supported by model "${modelId}".`);
    }
    if (typeof args.keep_original_sound !== "boolean") {
      throw new Error(`Invalid 'keep_original_sound' (${args.keep_original_sound}): must be a boolean.`);
    }
    keepOriginalSound = args.keep_original_sound;
  }

  // 13. Prompt prefixing for sed2-5 video_edit (matches web app Ag() helper)
  if (generateType === "video_edit" && schema.api_model_name === "sed2-5" && prompt && !prompt.startsWith("编辑视频：")) {
    prompt = `编辑视频：${prompt}`;
  }

  return {
    model: modelId,
    model_name: schema.api_model_name,
    is_seedance: isSeedance,
    draft: schema.draft ? true : undefined,
    prompt,
    generate_type: generateType,
    duration,
    aspect_ratio: aspectRatio,
    canvas_aspect_ratio: aspectRatio || logicalAspectRatio || "16:9",
    resolution,
    size,
    quality_mode: qualityMode,
    estimate_quality: estimateQuality,
    supports_audio: supportsAudio,
    sound,
    has_sound: hasSoundFlag,
    output_format: outputFormat,
    bitrate_mode: bitrateMode,
    num_videos: numVideos,
    negative_prompt: negativePrompt,
    cfg_scale: cfgScale,
    prompt_extend: promptExtend,
    enhance_prompt: enhancePrompt,
    shot_type: shotType,
    keep_original_sound: keepOriginalSound,
    first_frame: firstFrame,
    last_frame: lastFrame,
    reference_images: refImages.length > 0 ? refImages : undefined,
    reference_videos: refVideos.length > 0 ? refVideos : undefined,
    reference_audios: refAudios.length > 0 ? refAudios : undefined,
  };
}
