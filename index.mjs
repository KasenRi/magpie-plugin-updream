// Magpie / OpenCode tools & provider auth plugin for UPdream (www.updream.cn) video generation.
// Exposes tools as updream_<tool> via Magpie's MCP server (/mcp/magpie/tools) and registers
// UPdream multi-account sign-in on Magpie's Models -> Providers page (0 models declared).
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
import { MagpieAccountPool } from "./src/magpie-auth.mjs";
import {
  ALL_VIDEO_MODELS,
  LEGACY_VIDEO_MODEL_IDS,
  NON_SEEDANCE_MODEL_IDS,
  NON_SEEDANCE_MODELS,
  POST_PROCESS_VIDEO_MODEL_IDS,
  SEEDANCE_MODEL_IDS,
  SEEDANCE_MODELS,
  SUPPORTED_VIDEO_MODEL_IDS,
  VIDEO_MODELS_BY_ID,
  WAN_SIZE_MAP,
  getWanSize,
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

function deriveUpdreamAccountId(accessToken, customLabel) {
  if (typeof customLabel === "string" && customLabel.trim()) {
    return customLabel.trim();
  }
  const payload = decodeJwtPayload(accessToken);
  const sub = payload?.sub ?? payload?.user_id ?? payload?.uid;
  return sub ? `uid-${sub}` : "";
}

function createUpdreamSlotClient(baseOptions, entry, persistToMagpieAuth) {
  let currentSaved = { ...(entry.saved || {}) };
  const client = new UPdreamClient({
    ...baseOptions,
    // UI slots never read or write ~/.config/magpie/updream-tokens.json
    tokenFile: "",
    accessToken: currentSaved.access || currentSaved.key || "",
    refreshToken: currentSaved.refresh || "",
    cookie: currentSaved.cookie ?? baseOptions.cookie ?? "",
    projectId: currentSaved.project_id ?? baseOptions.projectId ?? "",
  });

  // When tool execution triggers proactive/401 token refresh or creates project_id, persist back to the slot
  const origPersist = client.persistState.bind(client);
  client.persistState = (patch = {}) => {
    origPersist(patch);
    const expSec = decodeJwtExp(client.accessToken);
    currentSaved = {
      ...currentSaved,
      type: "oauth",
      access: client.accessToken,
      refresh: client.refreshToken,
      expires: expSec ? expSec * 1000 : Date.now() + 3600_000,
      ...(client.persistedProjectId !== undefined && client.persistedProjectId !== ""
        ? { project_id: client.persistedProjectId }
        : {}),
    };
    Promise.resolve(persistToMagpieAuth(currentSaved)).catch(() => {});
    return true;
  };
  return client;
}

export const UPdreamPlugin = async (_input, options = {}) => {
  let fallbackClient = null;
  const pool = new MagpieAccountPool({
    providerId: "updream",
    dataDir: _input?.directory || "",
    clientAuth: _input?.client?.auth,
    buildClient: (entry, persist) => createUpdreamSlotClient(options, entry, persist),
    buildFallbackClient: () => (fallbackClient ??= new UPdreamClient(options)),
  });

  return {
    async config(cfg) {
      cfg.provider ??= {};
      cfg.provider.updream = {
        ...(cfg.provider.updream ?? {}),
        name: "UPdream",
        // Intentionally declare 0 models so UPdream never participates in chat or /v1/videos routing
      };
    },

    auth: {
      provider: "updream",
      methods: [
        {
          type: "api",
          label: "粘贴 LocalStorage Token（access_token + refresh_token）",
          labels: {
            zh: "粘贴 Token（access_token + refresh_token）",
            en: "Paste Tokens (access_token + refresh_token)",
          },
          keyless: true,
          prompts: [
            {
              type: "password",
              key: "access_token",
              message: "粘贴 UPdream 网页端 LocalStorage 中的 access_token",
              messages: {
                zh: "粘贴 UPdream 网页端 LocalStorage 中的 access_token",
                en: "Paste access_token from UPdream LocalStorage",
              },
              placeholder: "eyJhbGciOi...",
              validate: (v) => (v && v.trim().length >= 10 ? undefined : "access_token 不能为空"),
            },
            {
              type: "password",
              key: "refresh_token",
              message: "粘贴 UPdream 网页端 LocalStorage 中的 refresh_token（用于自动续期）",
              messages: {
                zh: "粘贴 UPdream 网页端 LocalStorage 中的 refresh_token（用于自动续期）",
                en: "Paste refresh_token from UPdream LocalStorage (for auto-renewal)",
              },
              placeholder: "粘贴 refresh_token",
              validate: (v) => (v && v.trim().length >= 6 ? undefined : "refresh_token 不能为空"),
            },
            {
              type: "text",
              key: "label",
              message: "账号备注名称（可选，留空自动从 JWT 提取用户 ID）",
              messages: {
                zh: "账号备注名称（可选，留空自动从 JWT 提取用户 ID）",
                en: "Account label (optional, auto-extracted from JWT if omitted)",
              },
              placeholder: "例如：UPdream 主号 / 二号机",
            },
          ],
          async authorize(inputs) {
            const access = String(inputs?.access_token ?? "")
              .trim()
              .replace(/^Bearer\s+/i, "");
            const refresh = String(inputs?.refresh_token ?? "").trim();
            const expSec = decodeJwtExp(access);
            const accountId = deriveUpdreamAccountId(access, inputs?.label);
            return {
              type: "success",
              access,
              refresh,
              expires: expSec ? expSec * 1000 : Date.now() + 3600_000,
              ...(accountId ? { accountId } : {}),
            };
          },
        },
      ],

      // Used by Magpie's KeepPluginsSignedIn background worker for locked JWT auto-renewal
      async refresh(saved) {
        if (!saved?.refresh) return undefined;
        const tempClient = new UPdreamClient({
          ...options,
          tokenFile: "",
          accessToken: saved.access || "",
          refreshToken: saved.refresh,
          cookie: saved.cookie ?? options.cookie ?? "",
          projectId: saved.project_id ?? options.projectId ?? "",
        });
        const next = await tempClient.refresh();
        const expSec = decodeJwtExp(next.access_token);
        return {
          access: next.access_token,
          refresh: next.refresh_token,
          expires: expSec ? expSec * 1000 : Date.now() + 3600_000,
        };
      },
    },

    tool: createTools(pool),
  };
};

export const _internal = {
  DEFAULT_BASE_URL,
  MAX_UPLOAD_BYTES,
  MagpieAccountPool,
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
  NON_SEEDANCE_MODEL_IDS,
  NON_SEEDANCE_MODELS,
  POST_PROCESS_VIDEO_MODEL_IDS,
  SEEDANCE_MODEL_IDS,
  SEEDANCE_MODELS,
  SUPPORTED_VIDEO_MODEL_IDS,
  VIDEO_MODELS_BY_ID,
  WAN_SIZE_MAP,
  getWanSize,
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
