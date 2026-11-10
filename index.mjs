// Magpie / OpenCode tools plugin for UPdream (www.updream.cn) video generation.
// Exposes tools as updream_<tool> via Magpie's MCP server (/mcp/magpie/tools).
import {
  DEFAULT_BASE_URL,
  UPdreamApiError,
  UPdreamClient,
  decodeJwtExp,
  decodeJwtPayload,
  defaultTokenFilePath,
  isJwtExpiringSoon,
  redactSecrets,
  unwrapResponseData,
} from "./src/client.mjs";
import {
  ALL_VIDEO_MODELS,
  LEGACY_VIDEO_MODEL_IDS,
  NON_SEEDANCE_MODELS,
  SEEDANCE_MODEL_IDS,
  SEEDANCE_MODELS,
  inferGenerateType,
  normalizeImageReferenceUrl,
  normalizeVideoModelId,
  resolveAndValidateVideoParams,
} from "./src/models.mjs";
import {
  MAX_UPLOAD_BYTES,
  createTools,
  extractTaskError,
  getTaskHelper,
  redactPiiText,
  sanitizeAccountUser,
  uploadImageHelper,
  waitTaskHelper,
} from "./src/tools.mjs";

export const UPdreamPlugin = async (_input, options = {}) => {
  const client = new UPdreamClient(options);
  return {
    tool: createTools(client),
  };
};

export const _internal = {
  DEFAULT_BASE_URL,
  MAX_UPLOAD_BYTES,
  UPdreamApiError,
  UPdreamClient,
  decodeJwtExp,
  decodeJwtPayload,
  defaultTokenFilePath,
  isJwtExpiringSoon,
  redactSecrets,
  unwrapResponseData,
  ALL_VIDEO_MODELS,
  LEGACY_VIDEO_MODEL_IDS,
  NON_SEEDANCE_MODELS,
  SEEDANCE_MODEL_IDS,
  SEEDANCE_MODELS,
  inferGenerateType,
  normalizeImageReferenceUrl,
  normalizeVideoModelId,
  resolveAndValidateVideoParams,
  createTools,
  extractTaskError,
  getTaskHelper,
  redactPiiText,
  sanitizeAccountUser,
  uploadImageHelper,
  waitTaskHelper,
};
