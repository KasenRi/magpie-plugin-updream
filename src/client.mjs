import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_BASE_URL = "https://www.updream.cn/api";
export const DEFAULT_ORIGIN = "https://www.updream.cn";
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const DEFAULT_TIMEOUT_MS = 42_000;

export function defaultTokenFilePath(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const baseDir = xdg || join(homedir(), ".config");
  return join(baseDir, "magpie", "updream-tokens.json");
}

export function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function decodeJwtExp(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return null;
  }
  return payload.exp;
}

export function isJwtExpiringSoon(token, thresholdSeconds = 60, nowMs = Date.now()) {
  const exp = decodeJwtExp(token);
  if (exp === null) return false;
  return exp * 1000 - nowMs <= thresholdSeconds * 1000;
}

export function redactSecrets(input, extraSecrets = []) {
  if (typeof input !== "string" || !input) return "";
  let out = input;

  for (const secret of extraSecrets) {
    if (typeof secret === "string" && secret.trim().length >= 6) {
      out = out.split(secret.trim()).join("[REDACTED]");
    }
  }

  // Redact Bearer tokens
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
  // Redact JWTs (eyJ...eyJ...)
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[REDACTED_JWT]");
  // Redact JSON or query token values
  out = out.replace(
    /(["']?(?:access_token|refresh_token|accessToken|refreshToken|cookie)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi,
    "$1[REDACTED]$3"
  );

  return out;
}

export function unwrapResponseData(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }
  if (body.data !== undefined && body.data !== null && typeof body.data === "object") {
    const otherKeys = Object.keys(body).filter((k) => k !== "data");
    const envelopeKeys = new Set(["code", "message", "msg", "ok", "success"]);
    if (otherKeys.length === 0 || otherKeys.every((k) => envelopeKeys.has(k))) {
      return body.data;
    }
  }
  return body;
}

export function extractErrorDetail(body, fallbackText = "") {
  if (body && typeof body === "object") {
    const candidates = [body.detail, body.message, body.error, body.error_code, body.data?.detail, body.data?.message, body.data?.error];
    const parts = [];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        if (!parts.includes(c.trim())) parts.push(c.trim());
      } else if (c && typeof c === "object") {
        for (const sub of [c.message, c.detail, c.error, c.code]) {
          if (typeof sub === "string" && sub.trim() && !parts.includes(sub.trim())) {
            parts.push(sub.trim());
          }
        }
      }
    }
    if (parts.length > 0) return parts.join(" | ");
  }
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }
  return fallbackText || "Unknown API error";
}

export class UPdreamApiError extends Error {
  constructor(status, detail, extraSecrets = []) {
    const safeDetail = redactSecrets(String(detail || "Unknown error"), extraSecrets);
    super(`UPdream API error (HTTP ${status}): ${safeDetail}`);
    this.name = "UPdreamApiError";
    this.status = status;
    this.detail = safeDetail;
  }
}

function chooseInitialTokens(configured, persisted, nowMs = Date.now()) {
  const cfgAccess = configured.accessToken || "";
  const cfgRefresh = configured.refreshToken || "";
  const fileAccess = persisted?.access_token || "";
  const fileRefresh = persisted?.refresh_token || "";

  if (!fileAccess && !fileRefresh) {
    return { accessToken: cfgAccess, refreshToken: cfgRefresh, source: "config" };
  }
  if (!cfgAccess && !cfgRefresh) {
    return { accessToken: fileAccess, refreshToken: fileRefresh, source: "file" };
  }

  const cfgExp = decodeJwtExp(cfgAccess);
  const fileExp = decodeJwtExp(fileAccess);
  const nowSec = nowMs / 1000;

  if (fileExp !== null && cfgExp !== null) {
    if (fileExp >= cfgExp) {
      return { accessToken: fileAccess, refreshToken: fileRefresh || cfgRefresh, source: "file" };
    }
    return { accessToken: cfgAccess, refreshToken: cfgRefresh || fileRefresh, source: "config" };
  }

  if (fileExp !== null && cfgExp === null) {
    if (fileExp > nowSec) {
      return { accessToken: fileAccess, refreshToken: fileRefresh || cfgRefresh, source: "file" };
    }
    return { accessToken: cfgAccess || fileAccess, refreshToken: cfgRefresh || fileRefresh, source: "config" };
  }

  if (fileExp === null && cfgExp !== null) {
    if (cfgExp > nowSec) {
      return { accessToken: cfgAccess, refreshToken: cfgRefresh || fileRefresh, source: "config" };
    }
    return { accessToken: fileAccess || cfgAccess, refreshToken: fileRefresh || cfgRefresh, source: "file" };
  }

  // Neither is a JWT with exp (e.g. opaque tokens in tests): prefer persisted file if it has access_token
  if (fileAccess) {
    return { accessToken: fileAccess, refreshToken: fileRefresh || cfgRefresh, source: "file" };
  }
  return { accessToken: cfgAccess, refreshToken: cfgRefresh || fileRefresh, source: "config" };
}

export function combineAbortSignal(signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  return signal;
}

export class UPdreamClient {
  constructor(options = {}, env = process.env) {
    this.options = options || {};
    this.env = env || process.env;

    const rawBaseUrl =
      this.options.baseUrl ??
      this.env.UPDREAM_BASE_URL ??
      DEFAULT_BASE_URL;
    this.baseUrl = String(rawBaseUrl).trim().replace(/\/+$/, "");

    this.cookie = String(this.options.cookie ?? this.env.UPDREAM_COOKIE ?? "").trim();
    this.workspace = String(this.options.workspace ?? this.env.UPDREAM_WORKSPACE ?? "personal").trim() || "personal";
    this.tokenFile = String(this.options.tokenFile ?? this.env.UPDREAM_TOKEN_FILE ?? defaultTokenFilePath(this.env)).trim();

    const cfgAccess = String(this.options.accessToken ?? this.env.UPDREAM_ACCESS_TOKEN ?? "").trim();
    const cfgRefresh = String(this.options.refreshToken ?? this.env.UPDREAM_REFRESH_TOKEN ?? "").trim();
    const cfgProjectId = this.options.projectId ?? this.env.UPDREAM_PROJECT_ID ?? undefined;

    const persisted = this._readTokenFile();
    const chosen = chooseInitialTokens(
      { accessToken: cfgAccess, refreshToken: cfgRefresh },
      persisted
    );

    this.accessToken = chosen.accessToken;
    this.refreshToken = chosen.refreshToken;
    this.configuredProjectId = cfgProjectId !== undefined && cfgProjectId !== "" ? cfgProjectId : undefined;
    this.persistedProjectId = persisted?.project_id !== undefined && persisted?.project_id !== "" ? persisted.project_id : undefined;

    this._knownSecrets = new Set();
    this._recordSecret(cfgAccess);
    this._recordSecret(cfgRefresh);
    this._recordSecret(this.accessToken);
    this._recordSecret(this.refreshToken);
    this._recordSecret(this.cookie);

    this._refreshPromise = null;
  }

  _recordSecret(val) {
    if (typeof val === "string" && val.trim().length >= 6) {
      this._knownSecrets.add(val.trim());
    }
  }

  redact(text) {
    return redactSecrets(text, Array.from(this._knownSecrets));
  }

  _readTokenFile() {
    if (!this.tokenFile) return null;
    try {
      if (!existsSync(this.tokenFile)) return null;
      const raw = readFileSync(this.tokenFile, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  persistState(patch = {}) {
    if (patch.access_token !== undefined) {
      this.accessToken = String(patch.access_token || "").trim();
      this._recordSecret(this.accessToken);
    }
    if (patch.refresh_token !== undefined) {
      this.refreshToken = String(patch.refresh_token || "").trim();
      this._recordSecret(this.refreshToken);
    }
    if (patch.project_id !== undefined && patch.project_id !== null && patch.project_id !== "") {
      this.persistedProjectId = patch.project_id;
    }

    if (!this.tokenFile) return false;
    try {
      const dir = dirname(this.tokenFile);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const payload = {
        access_token: this.accessToken || undefined,
        refresh_token: this.refreshToken || undefined,
        project_id: this.persistedProjectId ?? this.configuredProjectId ?? undefined,
        updated_at: new Date().toISOString(),
      };
      writeFileSync(this.tokenFile, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
      chmodSync(this.tokenFile, 0o600);
      return true;
    } catch {
      // Must still work without any file write permission (fall back to memory)
      return false;
    }
  }

  hasCredentials() {
    return Boolean(this.accessToken || this.refreshToken);
  }

  ensureCredentials() {
    if (!this.hasCredentials()) {
      throw new Error(
        "UPdream credentials are not configured. Set 'options.accessToken' and 'options.refreshToken' in Magpie's plugins.json " +
          "(or set UPDREAM_ACCESS_TOKEN and UPDREAM_REFRESH_TOKEN environment variables). " +
          "To obtain them: sign in at https://www.updream.cn, open Browser DevTools -> Application -> Local Storage -> https://www.updream.cn, " +
          "and copy the 'access_token' and 'refresh_token' values."
      );
    }
  }

  buildHeaders({ json = true, extraHeaders = {}, accessToken = this.accessToken } = {}) {
    const headers = {
      "Accept-Language": "zh-CN",
      "X-Workspace": this.workspace,
      "Cache-Control": "no-cache",
      "User-Agent": DEFAULT_USER_AGENT,
      Origin: DEFAULT_ORIGIN,
      Referer: `${DEFAULT_ORIGIN}/`,
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    if (this.cookie) {
      headers.Cookie = this.cookie;
    }
    if (json) {
      headers["Content-Type"] = "application/json";
    }
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (v !== undefined && v !== null) {
        headers[k] = String(v);
      }
    }
    return headers;
  }

  async refresh(signal) {
    if (this._refreshPromise) {
      return this._refreshPromise;
    }
    if (!this.refreshToken) {
      throw new Error(
        "Cannot refresh UPdream session: no refreshToken configured. Set options.refreshToken or UPDREAM_REFRESH_TOKEN."
      );
    }

    const doRefresh = async () => {
      const url = `${this.baseUrl}/auth/refresh`;
      const headers = this.buildHeaders({ json: true, accessToken: "" });
      delete headers.Authorization;

      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ refresh_token: this.refreshToken }),
          signal: combineAbortSignal(signal, 20_000),
        });
      } catch (err) {
        throw new Error(`UPdream token refresh network error: ${this.redact(err?.message || String(err))}`);
      }

      const rawText = await res.text();
      let parsed = null;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        const detail = extractErrorDetail(parsed, rawText || res.statusText);
        throw new UPdreamApiError(res.status, `Token refresh failed: ${detail}`, Array.from(this._knownSecrets));
      }

      const data = unwrapResponseData(parsed);
      const newAccess = data?.access_token;
      const newRefresh = data?.refresh_token ?? this.refreshToken;
      if (!newAccess || typeof newAccess !== "string") {
        throw new Error("UPdream token refresh returned an invalid response (missing access_token).");
      }

      this.persistState({
        access_token: newAccess,
        refresh_token: newRefresh,
      });

      return {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
      };
    };

    this._refreshPromise = doRefresh().finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  }

  async request(path, { method = "GET", query, body, formData, headers = {}, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.ensureCredentials();

    // Proactive refresh if access token is missing or expires within 60 seconds
    if ((!this.accessToken || isJwtExpiringSoon(this.accessToken, 60)) && this.refreshToken) {
      await this.refresh(signal);
    }

    return this._executeRequest(path, { method, query, body, formData, headers, signal, timeoutMs, isRetry: false });
  }

  async _executeRequest(
    path,
    { method = "GET", query, body, formData, headers = {}, signal, timeoutMs = DEFAULT_TIMEOUT_MS, isRetry = false }
  ) {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const urlObj = new URL(`${this.baseUrl}${cleanPath}`);
    if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          urlObj.searchParams.set(k, String(v));
        }
      }
    }

    const isForm = Boolean(formData);
    const reqHeaders = this.buildHeaders({
      json: !isForm && body !== undefined,
      extraHeaders: headers,
      accessToken: this.accessToken,
    });

    const fetchInit = {
      method,
      headers: reqHeaders,
      signal: combineAbortSignal(signal, timeoutMs),
    };

    if (isForm) {
      fetchInit.body = formData;
    } else if (body !== undefined) {
      fetchInit.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(urlObj.toString(), fetchInit);
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) {
        throw err;
      }
      throw new Error(`UPdream request failed (${method} ${cleanPath}): ${this.redact(err?.message || String(err))}`);
    }

    const rawText = await res.text();
    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }

    // Reactive 401 refresh once and retry once
    if (res.status === 401 && !isRetry && this.refreshToken) {
      const detail = parsed?.detail ?? parsed?.data?.detail;
      if (detail !== "session_expired") {
        await this.refresh(signal);
        return this._executeRequest(path, {
          method,
          query,
          body,
          formData,
          headers,
          signal,
          timeoutMs,
          isRetry: true,
        });
      }
    }

    if (!res.ok) {
      const detail = extractErrorDetail(parsed, rawText || res.statusText);
      throw new UPdreamApiError(res.status, detail, Array.from(this._knownSecrets));
    }

    if (parsed !== null) {
      return unwrapResponseData(parsed);
    }
    return rawText;
  }

  get(path, options = {}) {
    return this.request(path, { ...options, method: "GET" });
  }

  post(path, body, options = {}) {
    return this.request(path, { ...options, method: "POST", body });
  }

  async ensureProject(explicitProjectId, signal) {
    if (explicitProjectId !== undefined && explicitProjectId !== null && String(explicitProjectId).trim() !== "") {
      return explicitProjectId;
    }
    if (this.configuredProjectId !== undefined && this.configuredProjectId !== null && String(this.configuredProjectId).trim() !== "") {
      return this.configuredProjectId;
    }
    if (this.persistedProjectId !== undefined && this.persistedProjectId !== null && String(this.persistedProjectId).trim() !== "") {
      return this.persistedProjectId;
    }

    // Search existing projects for "magpie-updream"
    const listRes = await this.get("/projects", { signal });
    const projects = Array.isArray(listRes)
      ? listRes
      : Array.isArray(listRes?.projects)
      ? listRes.projects
      : Array.isArray(listRes?.items)
      ? listRes.items
      : [];

    const existing = projects.find((p) => p && p.name === "magpie-updream");
    const existingId = existing?.project_id ?? existing?.id;
    if (existingId !== undefined && existingId !== null) {
      this.persistState({ project_id: existingId });
      return existingId;
    }

    // Create a new project named "magpie-updream"
    const created = await this.post("/projects", { name: "magpie-updream" }, { signal });
    const createdId = created?.project_id ?? created?.id;
    if (createdId === undefined || createdId === null) {
      throw new Error("Failed to create UPdream project 'magpie-updream': response did not include project_id or id.");
    }
    this.persistState({ project_id: createdId });
    return createdId;
  }

  async createVideoCanvasNode(projectId, { aspectRatio = "16:9", name = "magpie video" } = {}, signal) {
    const body = {
      x: 100,
      y: 100,
      width: 320,
      height: 240,
      node_type: "video",
      source_type: "shot",
      name,
      node_config: {
        metadata: {
          cover_url: "",
          width: -1,
          height: -1,
          ratio: aspectRatio === "adaptive" ? "16:9" : aspectRatio,
        },
      },
    };
    const res = await this.post(`/canvas-nodes/project/${encodeURIComponent(String(projectId))}`, body, { signal });
    const nodeId = res?.id ?? res?.node_id;
    if (nodeId === undefined || nodeId === null) {
      throw new Error("Failed to create UPdream video canvas node: response did not include node id.");
    }
    return nodeId;
  }
}
