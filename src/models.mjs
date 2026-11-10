// Static video model schemas and parameter validation for UPdream (www.updream.cn).
// Derived from VIDEO_MODEL_SCHEMA_DEFINITIONS and PARAM_TEMPLATES in UPdream's web bundle.

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
};

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

export const SEEDANCE_MODELS = {
  "sed2-5": {
    id: "sed2-5",
    label: "Seedance 2.5",
    display_name: "Seedance 2.5",
    api_model_name: "sed2-5",
    family: "seedance-2.5",
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

// All 24 non-Seedance models from VIDEO_MODEL_SCHEMA_DEFINITIONS (docs/API.md section 4.3)
export const NON_SEEDANCE_MODELS = [
  { id: "paiwo-v6max", label: "拍我 V6 Max", display_name: "PixVerse V6 Max", family: "pixverse", modes: ["t2v", "i2v"], durations: { min: 1, max: 8, default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"] },
  { id: "wan-3.0", label: "万相 3.0", display_name: "Wan 2.7", family: "wan", modes: ["t2v", "i2v", "firstlast"], durations: { min: 2, max: 15, default: 5 }, aspect_ratios: ASPECT_RATIO_SEEDANCE, resolutions: ["720p", "1080p"] },
  { id: "hailuo-h3", label: "海螺 H3", display_name: "Hailuo 2.3 Pro", family: "hailuo", modes: ["t2v", "i2v"], durations: { min: 4, max: 15, default: 5 }, aspect_ratios: ASPECT_RATIO_SEEDANCE, resolutions: ["720p", "1080p"] },
  { id: "minimax-h3-max", label: "Minimax H3 Max", display_name: "Hailuo 2.3 Max", family: "hailuo", modes: ["t2v", "i2v"], durations: { min: 4, max: 15, default: 5 }, aspect_ratios: ASPECT_RATIO_SEEDANCE, resolutions: ["720p", "1080p"] },
  { id: "happyhorse-1.1", label: "HappyHorse-1.1", display_name: "HappyHorse-1.1", family: "happyhorse", modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"], durations: { min: 4, max: 15, default: 5 }, aspect_ratios: ASPECT_RATIO_SEEDANCE, resolutions: ["720p", "1080p"] },
  { id: "happyhorse", label: "HappyHorse-1.0", display_name: "HappyHorse-1.0", family: "happyhorse", modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"], durations: { min: 4, max: 15, default: 5 }, aspect_ratios: ASPECT_RATIO_SEEDANCE, resolutions: ["720p", "1080p"] },
  { id: "kling-v3.0-turbo", label: "可灵 V3.0 Turbo", display_name: "可灵 V3.0 Turbo", family: "kling", modes: ["t2v", "i2v", "firstlast"], durations: { values: [5, 10], default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"] },
  { id: "kling-v3-omni", label: "可灵 V3 Omni", display_name: "可灵 V3 Omni", family: "kling", modes: ["t2v", "i2v", "firstlast", "multiframe", "ref2v", "video_edit"], durations: { min: 3, max: 15, default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"] },
  { id: "kling-v3.0-std", label: "可灵 V3.0", display_name: "可灵 V3.0", family: "kling", modes: ["t2v", "i2v", "firstlast", "multiframe"], durations: { min: 3, max: 15, default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"] },
  { id: "kling-v4", label: "可灵 V4", display_name: "Kling O3", family: "kling", modes: ["t2v", "i2v", "firstlast", "ref2v"], durations: { min: 3, max: 15, default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"] },
  { id: "kling-v2-5-turbo", label: "可灵 V2.5 Turbo", display_name: "可灵 V2.5 Turbo", family: "kling", modes: ["t2v", "i2v", "firstlast"], durations: { values: [5, 10], default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"], supports_negative_prompt: true },
  { id: "kling-o1", label: "可灵 O1", display_name: "可灵 O1", family: "kling", modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit"], durations: { values: [5, 10], default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"] },
  { id: "gemini-omni-flash", label: "Gemini Omni Flash", display_name: "Veo 3.1 Lite", family: "veo", modes: ["t2v", "i2v", "firstlast"], durations: { values: [4, 6, 8], default: 8 }, aspect_ratios: ["16:9", "9:16"], resolutions: ["720p", "1080p"] },
  { id: "gemini-omni-1.1-flash", label: "Gemini Omni 1.1 Flash", display_name: "Veo 3.1 Fast", family: "veo", modes: ["t2v", "i2v", "firstlast", "ref2v"], durations: { values: [4, 6, 8], default: 8 }, aspect_ratios: ["16:9", "9:16"], resolutions: ["720p", "1080p", "4k"] },
  { id: "vidu-q2-pro", label: "Vidu Q2 Pro", display_name: "Vidu Q2 Pro", family: "vidu", modes: ["t2v", "i2v", "firstlast", "multiframe", "ref2v"], durations: { min: 2, max: 10, default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["540p", "720p", "1080p"] },
  { id: "vidu-q4", label: "Vidu Q4", display_name: "Vidu Q3 Pro", family: "vidu", modes: ["t2v", "i2v", "firstlast", "ref2v"], durations: { min: 2, max: 15, default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["720p", "1080p"] },
  { id: "hailuo-2.3", label: "海螺 2.3", display_name: "海螺 2.3", family: "hailuo", modes: ["t2v", "i2v", "firstlast"], durations: { values: [6, 10], default: 6 }, aspect_ratios: ["16:9"], resolutions: ["768p", "1080p"] },
  { id: "veo-3.1-preview", label: "Veo 3.1", display_name: "Veo 3.1", family: "veo", modes: ["t2v", "i2v", "firstlast", "ref2v"], durations: { values: [4, 6, 8], default: 8 }, aspect_ratios: ["16:9", "9:16"], resolutions: ["720p", "1080p"] },
  { id: "wan-2.7", label: "万相 2.7", display_name: "万相 2.7", family: "wan", modes: ["t2v", "i2v", "firstlast", "ref2v", "video_edit", "clip2v"], durations: { min: 2, max: 15, default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["480p", "720p", "1080p"], supports_negative_prompt: true },
  { id: "wan-2.6-ref2v", label: "万相 2.6 参考生视频", display_name: "万相 2.6 参考生视频", family: "wan", modes: ["ref2v"], durations: { values: [5, 10], default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["720p", "1080p"], supports_negative_prompt: true },
  { id: "wan-2.6", label: "万相 2.6", display_name: "万相 2.6", family: "wan", modes: ["t2v", "i2v", "firstlast"], durations: { values: [5, 10, 15], default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["720p", "1080p"], supports_negative_prompt: true },
  { id: "wan-2.5-preview", label: "万相 2.5 Preview", display_name: "万相 2.5 Preview", family: "wan", modes: ["t2v", "i2v"], durations: { values: [5, 10], default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["480p", "720p", "1080p"], supports_negative_prompt: true },
  { id: "wan-2.2", label: "万相 2.2", display_name: "万相 2.2", family: "wan", modes: ["t2v", "i2v", "firstlast"], durations: { values: [5], default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], resolutions: ["480p", "720p", "1080p"], supports_negative_prompt: true },
  { id: "test", label: "测试模型 (Mock)", display_name: "测试模型 (Mock)", family: "mock", modes: ["t2v", "i2v"], durations: { values: [5], default: 5 }, aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["720p"] },
];

export const ALL_VIDEO_MODELS = [
  ...SEEDANCE_MODEL_IDS.map((id) => SEEDANCE_MODELS[id]),
  ...NON_SEEDANCE_MODELS,
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

export function inferGenerateType({ mode, generate_type, first_frame, last_frame, reference_images, reference_videos, reference_audios }) {
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
    throw new Error("Invalid frame parameters: 'last_frame' cannot be provided without 'first_frame'. Provide both 'first_frame' and 'last_frame' for 'firstlast' mode.");
  }
  return "t2v";
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
  const rawModel = args.model === undefined || args.model === null || args.model === "" ? "sed2-5" : String(args.model).trim();
  const modelId = normalizeVideoModelId(rawModel);
  const schema = SEEDANCE_MODELS[modelId];
  if (!schema) {
    throw new Error(
      `Invalid 'model' "${rawModel}". Allowed Seedance models: ${SEEDANCE_MODEL_IDS.join(", ")}.`
    );
  }

  // 3. Validate media inputs & infer/validate mode (generate_type)
  const firstFrame = typeof args.first_frame === "string" && args.first_frame.trim() ? args.first_frame.trim() : undefined;
  const lastFrame = typeof args.last_frame === "string" && args.last_frame.trim() ? args.last_frame.trim() : undefined;
  const refImages = cleanStringArray(args.reference_images, "reference_images");
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
      `Invalid 'mode' ("${generateType}") for model "${modelId}". Allowed modes for ${modelId}: ${schema.modes.join(", ")}.`
    );
  }

  // Validate media limits per mode
  const limits = schema.media_limits[generateType];
  if (generateType === "t2v") {
    if (firstFrame || lastFrame || refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0) {
      throw new Error(
        `Mode 't2v' does not accept media attachments. Omit frames/references or use mode 'i2v', 'firstlast', or 'ref2v'.`
      );
    }
  } else if (generateType === "i2v") {
    if (!firstFrame) {
      throw new Error(`Mode 'i2v' on model "${modelId}" requires 'first_frame' (1 image).`);
    }
    if (lastFrame) {
      throw new Error(`Mode 'i2v' does not accept 'last_frame'. Use mode 'firstlast' when providing both 'first_frame' and 'last_frame'.`);
    }
    if (refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0) {
      throw new Error(`Mode 'i2v' does not accept 'reference_images', 'reference_videos', or 'reference_audios'. Use 'first_frame' only, or switch to 'ref2v'.`);
    }
  } else if (generateType === "firstlast") {
    if (!firstFrame) {
      throw new Error(`Mode 'firstlast' on model "${modelId}" requires 'first_frame'.`);
    }
    const frameCount = (firstFrame ? 1 : 0) + (lastFrame ? 1 : 0);
    if (frameCount < limits.images.min || frameCount > limits.images.max) {
      throw new Error(
        `Mode 'firstlast' on model "${modelId}" requires ${limits.images.min === limits.images.max ? limits.images.min : `${limits.images.min}..${limits.images.max}`} frame images ('first_frame'${limits.images.min >= 2 ? " and 'last_frame'" : " and optional 'last_frame'"}), got ${frameCount}.`
      );
    }
    if (refImages.length > 0 || refVideos.length > 0 || refAudios.length > 0) {
      throw new Error(`Mode 'firstlast' uses 'first_frame' and 'last_frame', not 'reference_images'/'reference_videos'/'reference_audios'.`);
    }
  } else if (generateType === "ref2v" || generateType === "video_edit" || generateType === "clip2v") {
    if (firstFrame || lastFrame) {
      throw new Error(`Mode '${generateType}' uses 'reference_images' instead of 'first_frame'/'last_frame'.`);
    }
    if (refImages.length < limits.images.min || refImages.length > limits.images.max) {
      throw new Error(
        `Invalid 'reference_images' count (${refImages.length}) for ${modelId} in '${generateType}' mode. Allowed: ${limits.images.min}..${limits.images.max}.`
      );
    }
    if (refVideos.length < limits.videos.min || refVideos.length > limits.videos.max) {
      throw new Error(
        `Invalid 'reference_videos' count (${refVideos.length}) for ${modelId} in '${generateType}' mode. Allowed: ${limits.videos.min}..${limits.videos.max}.`
      );
    }
    if (refAudios.length < limits.audios.min || refAudios.length > limits.audios.max) {
      throw new Error(
        `Invalid 'reference_audios' count (${refAudios.length}) for ${modelId} in '${generateType}' mode. Allowed: ${limits.audios.min}..${limits.audios.max}.`
      );
    }
    const totalMedia = refImages.length + refVideos.length + refAudios.length;
    if (limits.minTotal && totalMedia < limits.minTotal) {
      throw new Error(
        `Mode '${generateType}' on model "${modelId}" requires at least ${limits.minTotal} reference media item (in 'reference_images', 'reference_videos', or 'reference_audios').`
      );
    }
    if (limits.maxTotal && totalMedia > limits.maxTotal) {
      throw new Error(
        `Total reference media count (${totalMedia}) exceeds maximum allowed (${limits.maxTotal}) for ${modelId} in '${generateType}' mode.`
      );
    }
  }

  // 4. Validate duration
  const durationSpec = schema.durations.mode_overrides?.[generateType] ?? schema.durations;
  let duration;
  if (args.duration === undefined || args.duration === null) {
    duration = durationSpec.default;
  } else {
    const parsed = Number(args.duration);
    if (!Number.isInteger(parsed)) {
      throw new Error(`Invalid 'duration' (${args.duration}): must be an integer number of seconds.`);
    }
    if (Array.isArray(durationSpec.values)) {
      if (!durationSpec.values.includes(parsed)) {
        throw new Error(
          `Invalid 'duration' (${parsed}) for model "${modelId}" in mode "${generateType}". Allowed values: ${durationSpec.values.join(", ")}.`
        );
      }
    } else if (parsed < durationSpec.min || parsed > durationSpec.max) {
      throw new Error(
        `Invalid 'duration' (${parsed}) for model "${modelId}" in mode "${generateType}". Allowed range: ${durationSpec.min}..${durationSpec.max} seconds (default ${durationSpec.default}).`
      );
    }
    duration = parsed;
  }

  // 5. Validate aspect_ratio (note forced "adaptive" for sed2-5 family i2v/firstlast/video_edit/clip2v)
  const forcedAdaptive = schema.aspect_ratios.forced_adaptive_modes.includes(generateType);
  let aspectRatio;
  if (args.aspect_ratio === undefined || args.aspect_ratio === null || args.aspect_ratio === "") {
    aspectRatio = forcedAdaptive ? "adaptive" : schema.aspect_ratios.default;
  } else {
    const rawAr = String(args.aspect_ratio).trim();
    if (!schema.aspect_ratios.options.includes(rawAr)) {
      throw new Error(
        `Invalid 'aspect_ratio' ("${rawAr}") for model "${modelId}". Allowed values: ${schema.aspect_ratios.options.join(", ")}.`
      );
    }
    aspectRatio = forcedAdaptive ? "adaptive" : rawAr;
  }

  // 6. Validate resolution
  let resolution;
  if (args.resolution === undefined || args.resolution === null || args.resolution === "") {
    resolution = schema.resolutions.default;
  } else {
    const rawRes = String(args.resolution).trim();
    if (!schema.resolutions.options.includes(rawRes)) {
      throw new Error(
        `Invalid 'resolution' ("${rawRes}") for model "${modelId}". Allowed values: ${schema.resolutions.options.join(", ")} (default "${schema.resolutions.default}").`
      );
    }
    resolution = rawRes;
  }

  // 7. Validate audio -> supports_audio
  let supportsAudio = schema.audio.default;
  if (args.audio !== undefined && args.audio !== null) {
    if (typeof args.audio !== "boolean") {
      throw new Error(`Invalid 'audio' (${args.audio}): must be a boolean (true or false).`);
    }
    supportsAudio = args.audio;
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
          `Invalid 'output_format' ("${args.output_format}") for model "${modelId}". Allowed values: ${schema.output_format.options.join(", ")}.`
        );
      }
      outputFormat = rawFmt;
    }
  } else if (args.output_format !== undefined && args.output_format !== null && args.output_format !== "") {
    const rawFmt = String(args.output_format).trim().toLowerCase();
    if (rawFmt !== "mp4") {
      throw new Error(
        `Invalid 'output_format' ("${args.output_format}") for model "${modelId}". Only Seedance 2.5 ("sed2-5", "sed2-5-draft") supports "mov"; ${modelId} only outputs mp4.`
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
          `Invalid 'bitrate_mode' ("${rawBm}") for model "${modelId}". Allowed values: ${schema.bitrate_mode.options.join(", ")}.`
        );
      }
      bitrateMode = rawBm;
    }
  } else if (args.bitrate_mode !== undefined && args.bitrate_mode !== null && args.bitrate_mode !== "") {
    throw new Error(
      `Parameter 'bitrate_mode' is not supported by model "${modelId}" (only supported on Seedance 2.0 family: sed2, wonder-pro, sed2-fast, sed2-mini).`
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

  // 11. Validate negative_prompt (only if model supports)
  let negativePrompt;
  if (args.negative_prompt !== undefined && args.negative_prompt !== null && String(args.negative_prompt).trim() !== "") {
    if (!schema.supports_negative_prompt) {
      throw new Error(
        `Parameter 'negative_prompt' is not supported by model "${modelId}". Seedance models do not accept negative prompts.`
      );
    }
    negativePrompt = String(args.negative_prompt).trim();
  }

  // 12. Prompt prefixing for sed2-5 video_edit (matches web app Ag() helper)
  if (generateType === "video_edit" && schema.api_model_name === "sed2-5" && prompt && !prompt.startsWith("编辑视频：")) {
    prompt = `编辑视频：${prompt}`;
  }

  return {
    model: modelId,
    model_name: schema.api_model_name,
    draft: schema.draft ? true : undefined,
    prompt,
    generate_type: generateType,
    duration,
    aspect_ratio: aspectRatio,
    resolution,
    supports_audio: supportsAudio,
    output_format: outputFormat,
    bitrate_mode: bitrateMode,
    num_videos: numVideos,
    negative_prompt: negativePrompt,
    first_frame: firstFrame,
    last_frame: lastFrame,
    reference_images: refImages.length > 0 ? refImages : undefined,
    reference_videos: refVideos.length > 0 ? refVideos : undefined,
    reference_audios: refAudios.length > 0 ? refAudios : undefined,
  };
}
