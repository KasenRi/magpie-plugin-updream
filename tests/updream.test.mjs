import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as pluginModule from "../index.mjs";
import { UPdreamPlugin, _internal } from "../index.mjs";

function makeJwt(payloadObj) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  return `${header}.${payload}.fakesig`;
}

function futureJwt(secondsFromNow = 3600, extra = {}) {
  return makeJwt({
    sub: "user_1001",
    exp: Math.floor(Date.now() / 1000) + secondsFromNow,
    ...extra,
  });
}

async function startFakeUPdreamServer(t) {
  const state = {
    requests: [],
    validAccessToken: futureJwt(3600, { ver: 1 }),
    validRefreshToken: makeJwt({ sub: "user_1001", type: "refresh", exp: Math.floor(Date.now() / 1000) + 86400, ver: 1 }),
    rotatedAccessToken: futureJwt(7200, { ver: 2 }),
    rotatedRefreshToken: makeJwt({ sub: "user_1001", type: "refresh", exp: Math.floor(Date.now() / 1000) + 172800, ver: 2 }),
    refreshCount: 0,
    projects: [],
    nextProjectId: 9001,
    nodes: new Map(),
    nextNodeId: 5001,
    tasks: new Map(),
    nextTaskId: 7001,
    customHandler: null,
  };

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    const url = new URL(req.url, "http://127.0.0.1");

    let parsedBody = null;
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/json") && rawBody.length > 0) {
      try {
        parsedBody = JSON.parse(rawBody.toString("utf8"));
      } catch {
        parsedBody = null;
      }
    }

    const record = {
      method: req.method,
      pathname: url.pathname,
      searchParams: Object.fromEntries(url.searchParams.entries()),
      headers: req.headers,
      rawBody,
      body: parsedBody,
    };
    state.requests.push(record);

    const sendJson = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (state.customHandler) {
      const handled = await state.customHandler(record, sendJson, state);
      if (handled !== false) return;
    }

    // Public image download route for upload_image URL tests
    if (req.method === "GET" && url.pathname === "/public/sample.png") {
      const pngBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(pngBytes.length),
      });
      res.end(pngBytes);
      return;
    }

    // Auth refresh endpoint
    if (req.method === "POST" && url.pathname === "/api/auth/refresh") {
      if (!parsedBody || parsedBody.refresh_token !== state.validRefreshToken) {
        sendJson(401, { detail: `Invalid refresh_token: ${parsedBody?.refresh_token}` });
        return;
      }
      state.refreshCount += 1;
      state.validAccessToken = state.rotatedAccessToken;
      state.validRefreshToken = state.rotatedRefreshToken;
      sendJson(200, {
        access_token: state.validAccessToken,
        refresh_token: state.validRefreshToken,
      });
      return;
    }

    // All other /api/* endpoints require valid Bearer token
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${state.validAccessToken}`) {
      sendJson(401, { detail: "Unauthorized token", header_seen: authHeader });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      sendJson(200, {
        id: 1001,
        nickname: "Kasen_13812345678",
        phone: "13812345678",
        email: "secret@example.com",
        avatar: "https://boss.hdslb.com/updream/avatar/u1001.png",
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/user/account") {
      sendJson(200, {
        data: {
          balance_credits: "1280.50",
          permanent_credits: "1000.00",
          temporary_credits: "280.50",
          frozen_credits: "0.00",
          today_credits: "30.00",
          month_credits: "210.00",
          membership: "pro",
          membership_end_at: "2027-01-01T00:00:00Z",
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/member/status") {
      sendJson(200, {
        tier: "pro",
        memberships: [{ membership_id: "m_1", tier: "pro", status: "ACTIVE" }],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ai/video-models") {
      sendJson(200, {
        user_tier: "pro",
        confirm_model_ids: ["wonder-ultra"],
        models: [
          { id: "sed2-5", name: "Seedance 2.5", available: true, extra_internal: "ignored" },
          { id: "sed2", name: "Seedance 2.0", available: true },
        ],
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/upload/image") {
      if (!contentType.includes("multipart/form-data")) {
        sendJson(400, { detail: "Expected multipart/form-data" });
        return;
      }
      const folder = url.searchParams.get("folder") || "image";
      sendJson(200, {
        url: `https://boss.hdslb.com/updream/${folder}/2026/11/uploaded_frame_m1e0.png@320w_180h_1e_1c.webp`,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/credit/estimate") {
      sendJson(200, {
        estimated_credits: 15,
        list_price_credits: 30,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/projects") {
      sendJson(200, {
        projects: state.projects,
        total: state.projects.length,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      const proj = {
        project_id: state.nextProjectId++,
        name: parsedBody?.name || "未命名项目",
      };
      state.projects.push(proj);
      sendJson(200, proj);
      return;
    }

    const nodeCreateMatch = url.pathname.match(/^\/api\/canvas-nodes\/project\/([^/]+)$/);
    if (req.method === "POST" && nodeCreateMatch) {
      const nodeId = state.nextNodeId++;
      const node = {
        id: nodeId,
        project_id: nodeCreateMatch[1],
        ...parsedBody,
        task_status: "idle",
      };
      state.nodes.set(String(nodeId), node);
      sendJson(200, node);
      return;
    }

    const nodeGetMatch = url.pathname.match(/^\/api\/canvas-nodes\/([^/]+)$/);
    if (req.method === "GET" && nodeGetMatch) {
      const node = state.nodes.get(nodeGetMatch[1]);
      if (!node) {
        sendJson(404, { detail: "Node not found" });
        return;
      }
      sendJson(200, node);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai/generate-video/async") {
      const taskId = `task_${state.nextTaskId++}`;
      state.tasks.set(taskId, {
        task_id: taskId,
        status: "pending",
        progress: 10,
        payload: parsedBody,
        request_id: `req_${taskId}`,
      });
      sendJson(200, {
        task_id: taskId,
        status: "pending",
      });
      return;
    }

    const taskCancelMatch = url.pathname.match(/^\/api\/ai\/task\/([^/]+)\/cancel$/);
    if (req.method === "POST" && taskCancelMatch) {
      const taskId = decodeURIComponent(taskCancelMatch[1]);
      const task = state.tasks.get(taskId);
      if (task) task.status = "cancelled";
      sendJson(200, { status: "cancelled" });
      return;
    }

    const taskGetMatch = url.pathname.match(/^\/api\/ai\/task\/([^/]+)$/);
    if (req.method === "GET" && taskGetMatch) {
      const taskId = decodeURIComponent(taskGetMatch[1]);
      const task = state.tasks.get(taskId);
      if (!task) {
        sendJson(404, { detail: "Task not found" });
        return;
      }
      sendJson(200, task);
      return;
    }

    sendJson(404, { detail: `Unhandled route ${req.method} ${url.pathname}` });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const origin = `http://127.0.0.1:${addr.port}`;
  const baseUrl = `${origin}/api`;

  const tempDir = await mkdtemp(join(tmpdir(), "updream-plugin-test-"));
  const tokenFile = join(tempDir, "magpie", "updream-tokens.json");

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  });

  return { server, origin, baseUrl, tempDir, tokenFile, state };
}

test("index.mjs exports only the plugin function and _internal object, and all tools match Magpie's schema rules", async (t) => {
  const f = await startFakeUPdreamServer(t);

  // Every exported function in index.mjs is invoked by Magpie as a plugin;
  // verify only UPdreamPlugin is exported as a function and _internal is an object.
  const exportedFunctions = Object.entries(pluginModule).filter(([, v]) => typeof v === "function");
  assert.equal(exportedFunctions.length, 1, "index.mjs must export exactly one plugin function");
  assert.equal(exportedFunctions[0][0], "UPdreamPlugin");
  assert.equal(typeof _internal, "object");
  assert.notEqual(_internal, null);

  const hooks = await UPdreamPlugin(
    { directory: f.tempDir },
    {
      baseUrl: f.baseUrl,
      accessToken: f.state.validAccessToken,
      refreshToken: f.state.validRefreshToken,
      tokenFile: f.tokenFile,
    }
  );

  assert.ok(hooks && typeof hooks.tool === "object");
  const toolNames = Object.keys(hooks.tool);
  assert.deepEqual(toolNames, [
    "account",
    "list_video_models",
    "upload_image",
    "estimate_credits",
    "create_video",
    "get_task",
    "wait_task",
    "cancel_task",
  ]);

  const nameRegex = /^[A-Za-z0-9_-]{1,48}$/;
  for (const [name, def] of Object.entries(hooks.tool)) {
    assert.match(name, nameRegex, `Tool name ${name} must match ^[A-Za-z0-9_-]{1,48}$`);
    assert.equal(typeof def.description, "string", `${name} must have a string description`);
    assert.ok(def.description.length > 20, `${name} description should be informative`);
    assert.ok(def.args && typeof def.args === "object", `${name} must have an args schema object`);
    assert.equal(def.args.type, "object", `${name} args.type must be 'object'`);
    assert.equal(typeof def.args.properties, "object", `${name} args.properties must be an object`);
    assert.equal(typeof def.execute, "function", `${name} must have an execute function`);
  }
});

test("missing credentials return a clear configuration error while static list_video_models works offline", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const savedAccess = process.env.UPDREAM_ACCESS_TOKEN;
  const savedRefresh = process.env.UPDREAM_REFRESH_TOKEN;
  const savedTokenFile = process.env.UPDREAM_TOKEN_FILE;
  delete process.env.UPDREAM_ACCESS_TOKEN;
  delete process.env.UPDREAM_REFRESH_TOKEN;
  delete process.env.UPDREAM_TOKEN_FILE;
  t.after(() => {
    if (savedAccess !== undefined) process.env.UPDREAM_ACCESS_TOKEN = savedAccess;
    if (savedRefresh !== undefined) process.env.UPDREAM_REFRESH_TOKEN = savedRefresh;
    if (savedTokenFile !== undefined) process.env.UPDREAM_TOKEN_FILE = savedTokenFile;
  });

  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      tokenFile: join(f.tempDir, "nonexistent-tokens.json"),
    }
  );

  // Static list_video_models works without credentials
  const seedanceOnly = await hooks.tool.list_video_models.execute({});
  assert.equal(seedanceOnly.models.length, 7);
  const allModels = await hooks.tool.list_video_models.execute({ all_models: true });
  assert.equal(allModels.models.length, 31);

  // API tools reject with clear instructions explaining how to configure
  await assert.rejects(
    () => hooks.tool.account.execute({}),
    /UPdream credentials are not configured.*UPDREAM_ACCESS_TOKEN/i
  );
});

test("auth headers, workspace header, cookie header, response unwrapping, and account PII redaction", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: f.state.validAccessToken,
      refreshToken: f.state.validRefreshToken,
      cookie: "buvid3=fake_cookie_val",
      workspace: "team:888",
      tokenFile: f.tokenFile,
    }
  );

  const res = await hooks.tool.account.execute({}, { abort: AbortSignal.timeout(5000) });

  assert.equal(res.user.id, 1001);
  assert.equal(res.user.phone, "[REDACTED]");
  assert.equal(res.user.email, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(res), /13812345678/);
  assert.doesNotMatch(JSON.stringify(res), /secret@example\.com/);
  assert.equal(res.credits.balance_credits, "1280.50");
  assert.equal(res.membership.tier, "pro");

  const meReq = f.state.requests.find((r) => r.pathname === "/api/auth/me");
  assert.ok(meReq);
  assert.equal(meReq.headers.authorization, `Bearer ${f.state.validAccessToken}`);
  assert.equal(meReq.headers["accept-language"], "zh-CN");
  assert.equal(meReq.headers["x-workspace"], "team:888");
  assert.equal(meReq.headers["cache-control"], "no-cache");
  assert.equal(meReq.headers.origin, "https://www.updream.cn");
  assert.equal(meReq.headers.referer, "https://www.updream.cn/");
  assert.equal(meReq.headers.cookie, "buvid3=fake_cookie_val");
});

test("401 -> refresh -> retry with rotated token, persisted with mode 0600, and preferred over older configured token", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const staleToken = futureJwt(1800, { ver: 0, note: "stale_but_not_expired_jwt" });

  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: staleToken, // Server does not accept staleToken -> returns 401
      refreshToken: f.state.validRefreshToken,
      tokenFile: f.tokenFile,
    }
  );

  const account = await hooks.tool.account.execute({});
  assert.equal(account.user.id, 1001);
  assert.equal(f.state.refreshCount, 1, "Should have refreshed exactly once");

  // Verify tokenFile was written with mode 0600 and contains rotated tokens
  const fileStat = await stat(f.tokenFile);
  assert.equal(fileStat.mode & 0o777, 0o600, "Token file must have 0600 permissions");
  const saved = JSON.parse(await readFile(f.tokenFile, "utf8"));
  assert.equal(saved.access_token, f.state.rotatedAccessToken);
  assert.equal(saved.refresh_token, f.state.rotatedRefreshToken);

  // Create a second plugin instance passing the old staleToken in options;
  // it must prefer the newer persisted token from tokenFile without needing another refresh!
  const hooks2 = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: staleToken,
      refreshToken: "old_spent_refresh_token",
      tokenFile: f.tokenFile,
    }
  );
  await hooks2.tool.account.execute({});
  assert.equal(f.state.refreshCount, 1, "Second instance should use persisted rotated token without re-refreshing");
});

test("proactive refresh when access JWT expires within 60 seconds, and graceful fallback when tokenFile is unwritable", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const expiringSoonToken = futureJwt(25, { ver: 1 }); // Expires in 25s (< 60s threshold)
  f.state.validAccessToken = expiringSoonToken;

  // Point tokenFile to an unwritable path (a file blocking directory creation)
  const blockerFile = join(f.tempDir, "not-a-dir");
  await writeFile(blockerFile, "file");
  const unwritableTokenFile = join(blockerFile, "subdir", "tokens.json");

  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: expiringSoonToken,
      refreshToken: f.state.validRefreshToken,
      tokenFile: unwritableTokenFile,
    }
  );

  const res = await hooks.tool.cancel_task.execute({ task_id: "task_999" });
  assert.equal(res.cancelled, true);
  assert.equal(f.state.refreshCount, 1, "Should proactively refresh before the request");
  assert.equal(f.state.requests[0].pathname, "/api/auth/refresh", "First HTTP request must be /api/auth/refresh");
  assert.equal(f.state.requests[1].pathname, "/api/ai/task/task_999/cancel");
  assert.equal(f.state.requests[1].headers.authorization, `Bearer ${f.state.rotatedAccessToken}`);
});

test("parameter validation, schema defaults, sed2-5-draft, i2v adaptive ratio, and audio->supports_audio", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: f.state.validAccessToken,
      refreshToken: f.state.validRefreshToken,
      projectId: 12345,
      tokenFile: f.tokenFile,
    }
  );

  // 1. Bad aspect_ratio for sed2-mini ('adaptive' is not allowed on sed2-mini)
  const reqCountBefore = f.state.requests.length;
  await assert.rejects(
    () =>
      hooks.tool.create_video.execute({
        prompt: "A mini test",
        model: "sed2-mini",
        aspect_ratio: "adaptive",
      }),
    /Invalid 'aspect_ratio' \("adaptive"\) for model "sed2-mini"\. Allowed values: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16/
  );
  assert.equal(f.state.requests.length, reqCountBefore, "Validation failure must not send any HTTP request");

  // 2. Bad resolution for sed2-5 ('1080p' is only on wonder-ultra / sed2 / etc., not sed2-5)
  await assert.rejects(
    () =>
      hooks.tool.create_video.execute({
        prompt: "Resolution check",
        model: "sed2-5",
        resolution: "1080p",
      }),
    /Invalid 'resolution' \("1080p"\) for model "sed2-5"\. Allowed values: 480p, 720p/
  );

  // 3. Bad bitrate_mode on Seedance 2.5
  await assert.rejects(
    () =>
      hooks.tool.create_video.execute({
        prompt: "Bitrate check",
        model: "sed2-5",
        bitrate_mode: "high",
      }),
    /bitrate_mode.*not supported by model "sed2-5"/
  );

  // 4. sed2-5-draft => model_name: "sed2-5", draft: true, resolution: "480p"
  const draftRes = await hooks.tool.create_video.execute({
    prompt: "Draft mode cyberpunk street",
    model: "sed2-5-draft",
  });
  assert.equal(draftRes.model, "sed2-5-draft");
  assert.equal(draftRes.params_sent.model_name, "sed2-5");
  assert.equal(draftRes.params_sent.draft, true);
  assert.equal(draftRes.params_sent.prompt_source, "original");
  assert.equal(draftRes.params_sent.resolution, "480p");
  assert.equal(draftRes.params_sent.aspect_ratio, "16:9");
  assert.equal(draftRes.params_sent.duration, 5);
  assert.equal(draftRes.params_sent.supports_audio, true);
  assert.equal(draftRes.params_sent.output_format, "mp4");
  assert.equal(draftRes.params_sent.use_local, false);

  const lastGenReq = f.state.requests.findLast((r) => r.pathname === "/api/ai/generate-video/async");
  assert.match(lastGenReq.headers["idempotency-key"], /^video:[0-9a-f-]{36}$/i);

  // 5. i2v sets aspect_ratio: "adaptive" and audio: false -> supports_audio: false
  const i2vRes = await hooks.tool.create_video.execute({
    prompt: "Animate this frame",
    model: "sed2-5",
    first_frame: "https://boss.hdslb.com/updream/image/first.png@640w.webp",
    audio: false,
  });
  assert.equal(i2vRes.params_sent.generate_type, "i2v");
  assert.equal(i2vRes.params_sent.aspect_ratio, "adaptive");
  assert.equal(i2vRes.params_sent.supports_audio, false);
  assert.equal(i2vRes.params_sent.image, "https://boss.hdslb.com/updream/image/first.png");

  // 6. estimate_credits sends web-compatible query params
  const est = await hooks.tool.estimate_credits.execute({
    model: "sed2",
    duration: 10,
    resolution: "1080p",
    audio: false,
    reference_images: ["https://boss.hdslb.com/updream/image/r1.png"],
    reference_videos: ["https://boss.hdslb.com/updream/video/v1.mp4"],
    ref_video_seconds: 6,
    num_videos: 2,
  });
  assert.equal(est.estimated_credits, 15);
  assert.equal(est.total_estimated_credits, 30);
  assert.deepEqual(est.params_sent, {
    model_name: "sed2",
    service_type: "VIDEO",
    quantity: 10,
    quality: "1080p",
    num_ref_images: 1,
    has_sound: 0,
    has_ref_video: 1,
    ref_video_seconds: 6,
    generate_type: "ref2v",
  });
});

test("project and video canvas node auto-creation, reuse, and local image auto-upload", async (t) => {
  const f = await startFakeUPdreamServer(t);

  // Create a local dummy PNG file
  const localImgPath = join(f.tempDir, "local_frame.png");
  await writeFile(
    localImgPath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])
  );

  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: f.state.validAccessToken,
      refreshToken: f.state.validRefreshToken,
      tokenFile: f.tokenFile,
    }
  );

  // First create_video call: should list projects (0), create "magpie-updream" (9001),
  // upload local first_frame via /upload/image, create video node (5001), and create video task.
  const first = await hooks.tool.create_video.execute({
    prompt: "Camera pans across landscape",
    first_frame: localImgPath,
  });

  assert.equal(first.project_id, 9001);
  assert.equal(first.node_id, 5001);
  assert.equal(first.params_sent.image, "https://boss.hdslb.com/updream/image/2026/11/uploaded_frame_m1e0.png");

  const projectCreateCallsAfterFirst = f.state.requests.filter(
    (r) => r.method === "POST" && r.pathname === "/api/projects"
  ).length;
  assert.equal(projectCreateCallsAfterFirst, 1);

  // Second create_video call: should reuse project 9001 without listing or creating projects again
  const second = await hooks.tool.create_video.execute({
    prompt: "Second shot",
  });
  assert.equal(second.project_id, 9001);
  assert.equal(second.node_id, 5002);

  const projectCreateCallsAfterSecond = f.state.requests.filter(
    (r) => r.method === "POST" && r.pathname === "/api/projects"
  ).length;
  assert.equal(projectCreateCallsAfterSecond, 1, "Must reuse persisted project_id");

  // Also test upload_image tool directly with URL and >20MB rejection
  const uploadedFromUrl = await hooks.tool.upload_image.execute({
    url: `${f.origin}/public/sample.png`,
    folder: "custom_folder",
  });
  assert.equal(
    uploadedFromUrl.url,
    "https://boss.hdslb.com/updream/custom_folder/2026/11/uploaded_frame_m1e0.png"
  );
});

test("get_task normalization, Seedance canvas-node cross-check, and wait_task completion & timeout", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: f.state.validAccessToken,
      refreshToken: f.state.validRefreshToken,
      projectId: 9001,
      tokenFile: f.tokenFile,
    }
  );

  const created = await hooks.tool.create_video.execute({
    prompt: "Test task polling",
  });
  const { task_id: taskId, node_id: nodeId } = created;

  // 1. While task is pending, if canvas node says waiting_asset_review, get_task surfaces waiting_asset_review
  f.state.nodes.get(String(nodeId)).task_status = "waiting_asset_review";
  const reviewStatus = await hooks.tool.get_task.execute({ task_id: taskId, node_id: String(nodeId) });
  assert.equal(reviewStatus.status, "waiting_asset_review");
  assert.equal(reviewStatus.progress, 0);

  // 2. Set node back to processing and test wait_task timeout
  f.state.nodes.get(String(nodeId)).task_status = "processing";
  f.state.tasks.get(taskId).status = "processing";
  f.state.tasks.get(taskId).progress = 42;

  const timedOut = await hooks.tool.wait_task.execute({
    task_id: taskId,
    node_id: String(nodeId),
    timeout_seconds: 0.12,
    interval_seconds: 0.04,
  });
  assert.equal(timedOut.timed_out, true);
  assert.equal(timedOut.status, "processing");
  assert.equal(timedOut.progress, 42);
  assert.match(timedOut.message, /Call wait_task again/i);

  // 3. Complete task after 60ms and verify wait_task resolves with normalized videos
  setTimeout(() => {
    const task = f.state.tasks.get(taskId);
    task.status = "completed";
    task.progress = 100;
    task.result = {
      videos: [
        {
          video_url: "https://boss.hdslb.com/updream/video/out1.mp4",
          cover_url: "https://boss.hdslb.com/updream/image/cov1.jpg",
        },
      ],
    };
  }, 60);

  const completed = await hooks.tool.wait_task.execute({
    task_id: taskId,
    node_id: String(nodeId),
    timeout_seconds: 2,
    interval_seconds: 0.04,
  });
  assert.equal(completed.timed_out, false);
  assert.equal(completed.status, "completed");
  assert.equal(completed.progress, 100);
  assert.deepEqual(completed.videos, [
    {
      video_url: "https://boss.hdslb.com/updream/video/out1.mp4",
      cover_url: "https://boss.hdslb.com/updream/image/cov1.jpg",
    },
  ]);
});

test("no token leakage in error messages even when backend echoes tokens back", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const secretAccess = f.state.validAccessToken;
  const secretRefresh = f.state.validRefreshToken;
  const secretCookie = "SESSDATA=super_secret_cookie_value_12345";

  f.state.customHandler = async (req, sendJson) => {
    if (req.pathname === "/api/ai/task/bad_task/cancel") {
      sendJson(500, {
        detail: `Upstream failure with Bearer ${secretAccess} and refresh=${secretRefresh} and cookie=${secretCookie}`,
      });
      return true;
    }
    return false;
  };

  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: secretAccess,
      refreshToken: secretRefresh,
      cookie: secretCookie,
      tokenFile: f.tokenFile,
    }
  );

  let caughtError = null;
  try {
    await hooks.tool.cancel_task.execute({ task_id: "bad_task" });
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError, "Expected cancel_task to throw on HTTP 500");
  assert.match(caughtError.message, /HTTP 500/);
  assert.ok(!caughtError.message.includes(secretAccess), "Access token must be redacted from error message");
  assert.ok(!caughtError.message.includes(secretRefresh), "Refresh token must be redacted from error message");
  assert.ok(!caughtError.message.includes(secretCookie), "Cookie must be redacted from error message");
  assert.match(caughtError.message, /\[REDACTED\]/);
});

test("single-flight refresh deduplicates concurrent 401 responses", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const staleToken = futureJwt(1800, { ver: 0 });

  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: staleToken,
      refreshToken: f.state.validRefreshToken,
      tokenFile: f.tokenFile,
    }
  );

  // Fire 4 concurrent requests that all hit 401 initially
  const results = await Promise.all([
    hooks.tool.list_video_models.execute({ live: true }),
    hooks.tool.cancel_task.execute({ task_id: "t1" }),
    hooks.tool.cancel_task.execute({ task_id: "t2" }),
    hooks.tool.cancel_task.execute({ task_id: "t3" }),
  ]);

  assert.equal(f.state.refreshCount, 1, "Concurrent 401s must share a single refresh request");
  assert.equal(results[0].live.user_tier, "pro");
  assert.deepEqual(results[0].live.models, [
    { id: "sed2-5", name: "Seedance 2.5", available: true },
    { id: "sed2", name: "Seedance 2.0", available: true },
  ]);
});

test("reuses existing magpie-updream project from GET /projects, supports firstlast/ref2v/wait_seconds, and checks upload_image base64 + 20MB limit", async (t) => {
  const f = await startFakeUPdreamServer(t);
  f.state.projects.push({ project_id: 4444, name: "other-project" });
  f.state.projects.push({ project_id: 7777, name: "magpie-updream" });

  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: f.state.validAccessToken,
      refreshToken: f.state.validRefreshToken,
      tokenFile: f.tokenFile,
    }
  );

  // Base64 upload
  const b64Png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb]).toString("base64");
  const upB64 = await hooks.tool.upload_image.execute({
    base64: `data:image/png;base64,${b64Png}`,
    filename: "inline.png",
  });
  assert.equal(upB64.mime_type, "image/png");
  assert.equal(upB64.filename, "inline.png");

  // > 20 MB rejection
  const tooBigB64 = Buffer.alloc(_internal.MAX_UPLOAD_BYTES + 16, 0x41).toString("base64");
  await assert.rejects(
    () => hooks.tool.upload_image.execute({ base64: tooBigB64 }),
    /exceeds the 20 MB maximum limit/
  );

  // Auto-complete created tasks immediately so wait_seconds returns completed video
  f.state.customHandler = async (req, sendJson, state) => {
    if (req.method === "POST" && req.pathname === "/api/ai/generate-video/async") {
      const taskId = `task_${state.nextTaskId++}`;
      state.tasks.set(taskId, {
        task_id: taskId,
        status: "completed",
        progress: 100,
        result: {
          videos: [
            {
              video_url: "https://boss.hdslb.com/updream/video/final.mp4",
              cover_url: "https://boss.hdslb.com/updream/image/final.jpg",
            },
          ],
        },
        request_id: "req_fast_1",
      });
      sendJson(200, { task_id: taskId, status: "pending" });
      return true;
    }
    return false;
  };

  // firstlast mode with wait_seconds
  const fl = await hooks.tool.create_video.execute({
    prompt: "Day to night transition",
    model: "wonder-ultra",
    first_frame: "https://boss.hdslb.com/updream/image/start.png",
    last_frame: "https://boss.hdslb.com/updream/image/end.png",
    resolution: "1080p",
    wait_seconds: 1,
  });

  assert.equal(fl.project_id, 7777, "Should find and reuse existing 'magpie-updream' project");
  assert.equal(
    f.state.requests.filter((r) => r.method === "POST" && r.pathname === "/api/projects").length,
    0,
    "Should not POST /projects when 'magpie-updream' already exists"
  );
  assert.equal(fl.params_sent.generate_type, "firstlast");
  assert.equal(fl.params_sent.aspect_ratio, "adaptive");
  assert.equal(fl.params_sent.image, "https://boss.hdslb.com/updream/image/start.png");
  assert.equal(fl.params_sent.last_image, "https://boss.hdslb.com/updream/image/end.png");
  assert.equal(fl.status, "completed");
  assert.equal(fl.videos[0].video_url, "https://boss.hdslb.com/updream/video/final.mp4");

  // ref2v mode with reference_images, reference_videos, reference_audios
  const ref2v = await hooks.tool.create_video.execute({
    prompt: "Make [@图片1] dance like [@视频1] with [@音频1]",
    model: "sed2-5",
    reference_images: ["https://boss.hdslb.com/updream/image/char.png"],
    reference_videos: ["https://boss.hdslb.com/updream/video/dance.mp4"],
    reference_audios: ["https://boss.hdslb.com/updream/audio/song.mp3"],
  });
  assert.equal(ref2v.params_sent.generate_type, "ref2v");
  assert.deepEqual(ref2v.params_sent.ref_images, ["https://boss.hdslb.com/updream/image/char.png"]);
  assert.deepEqual(ref2v.params_sent.ref_videos, ["https://boss.hdslb.com/updream/video/dance.mp4"]);
  assert.deepEqual(ref2v.params_sent.audio_urls, ["https://boss.hdslb.com/updream/audio/song.mp3"]);
});


test("config and auth hooks register UPdream provider with 0 models, oauth authorize, and background refresh", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const isolatedTokenFile = join(f.tempDir, "should-never-exist.json");
  const hooks = await UPdreamPlugin(
    { directory: f.tempDir },
    {
      baseUrl: f.baseUrl,
      tokenFile: isolatedTokenFile,
    },
  );

  // 1. config hook registers provider.updream with 0 models
  const cfg = {};
  await hooks.config(cfg);
  assert.equal(cfg.provider.updream.name, "UPdream");
  assert.equal(cfg.provider.updream.models, undefined, "Must not declare any chat/video models");

  // 2. auth hook structure & authorize()
  assert.equal(hooks.auth.provider, "updream");
  assert.equal(hooks.auth.methods.length, 1);
  const method = hooks.auth.methods[0];
  assert.equal(method.type, "api");
  assert.equal(method.keyless, true);
  assert.equal(method.prompts.length, 3);

  const jwt1 = makeJwt({ sub: "987654", exp: Math.floor(Date.now() / 1000) + 1800 });
  const authResAuto = await method.authorize({
    access_token: `Bearer ${jwt1}`,
    refresh_token: "  refresh_tok_1  ",
    label: "",
  });
  assert.equal(authResAuto.type, "success");
  assert.equal(authResAuto.access, jwt1);
  assert.equal(authResAuto.refresh, "refresh_tok_1");
  assert.equal(authResAuto.accountId, "uid-987654");
  assert.ok(authResAuto.expires > Date.now());

  const authResNamed = await method.authorize({
    access_token: jwt1,
    refresh_token: "refresh_tok_1",
    label: "主号",
  });
  assert.equal(authResNamed.accountId, "主号");

  // 3. auth.refresh() rotates JWT via UPdream API without writing tokenFile
  const refreshed = await hooks.auth.refresh({
    type: "oauth",
    access: f.state.validAccessToken,
    refresh: f.state.validRefreshToken,
  });
  assert.equal(refreshed.access, f.state.rotatedAccessToken);
  assert.equal(refreshed.refresh, f.state.rotatedRefreshToken);
  await assert.rejects(() => stat(isolatedTokenFile), "UI refresh must never write to tokenFile");

  // 4. Backward compatibility: createTools(singleClient) direct invocation still works
  const singleClient = new _internal.UPdreamClient({
    baseUrl: f.baseUrl,
    accessToken: f.state.rotatedAccessToken,
    refreshToken: f.state.rotatedRefreshToken,
    tokenFile: "",
  });
  const legacyTools = _internal.createTools(singleClient);
  const accRes = await legacyTools.account.execute({});
  assert.equal(accRes.selected, undefined, "createTools(singleClient) keeps raw legacy return shape");
  assert.equal(accRes.credits.balance_credits, "1280.50");
});

test("MagpieAccountPool multi-account priority, slot refresh writeback, task-slot binding, and 404 fallback", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const dataDir = await mkdtemp(join(tmpdir(), "magpie-pool-test-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const tokMain = futureJwt(3600, { sub: "u_main", tag: "1111" });
  const tokSub = futureJwt(3600, { sub: "u_sub", tag: "2222" });
  const tokSubExpired = futureJwt(15, { sub: "u_sub_exp", tag: "3333" }); // expires in 15s -> triggers proactive refresh
  const tokSubRotated = futureJwt(7200, { sub: "u_sub_rot", tag: "4444" });
  const tokOptions = futureJwt(3600, { sub: "u_opt", tag: "9999" });

  const tasksByToken = new Map();
  let nextMultiTaskId = 8001;

  f.state.customHandler = async (record, sendJson) => {
    if (record.method === "POST" && record.pathname === "/api/auth/refresh") {
      if (record.body?.refresh_token === "ref_sub_exp") {
        sendJson(200, { access_token: tokSubRotated, refresh_token: "ref_sub_rotated" });
        return true;
      }
    }
    const auth = (record.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const who =
      auth === tokMain
        ? { id: 1, name: "MainUser", bal: "5000.00", key: "main" }
        : auth === tokSub || auth === tokSubRotated
        ? { id: 2, name: "SubUser", bal: "1200.00", key: "sub" }
        : auth === tokOptions
        ? { id: 9, name: "OptUser", bal: "300.00", key: "opt" }
        : null;
    if (!who) {
      sendJson(401, { detail: "Unknown bearer token" });
      return true;
    }

    if (record.method === "GET" && record.pathname === "/api/auth/me") {
      sendJson(200, { id: who.id, nickname: who.name });
      return true;
    }
    if (record.method === "GET" && record.pathname === "/api/user/account") {
      sendJson(200, { balance_credits: who.bal, membership: "max" });
      return true;
    }
    if (record.method === "GET" && record.pathname === "/api/member/status") {
      sendJson(200, { tier: "max" });
      return true;
    }
    if (record.method === "GET" && record.pathname === "/api/projects") {
      sendJson(200, { projects: [{ project_id: `proj_${who.key}`, name: "magpie-updream" }] });
      return true;
    }
    if (record.method === "POST" && record.pathname.startsWith("/api/canvas-nodes/project/")) {
      sendJson(200, { id: `node_${who.key}_1` });
      return true;
    }
    if (record.method === "POST" && record.pathname === "/api/ai/generate-video/async") {
      const tid = `t_${who.key}_${nextMultiTaskId++}`;
      tasksByToken.set(tid, who.key);
      sendJson(200, { task_id: tid, status: "pending" });
      return true;
    }
    const taskMatch = record.pathname.match(/^\/api\/ai\/task\/([^/]+)$/);
    if (record.method === "GET" && taskMatch) {
      const tid = decodeURIComponent(taskMatch[1]);
      const owner = tasksByToken.get(tid);
      if (owner !== who.key) {
        sendJson(404, { detail: "Task not found" });
        return true;
      }
      sendJson(200, {
        task_id: tid,
        status: "completed",
        progress: 100,
        videos: [{ video_url: `https://boss.hdslb.com/updream/video/${tid}.mp4` }],
      });
      return true;
    }
    return false;
  };

  const authWrites = [];
  const optionsTokenFile = join(dataDir, "legacy-options-token.json");
  const hooks = await UPdreamPlugin(
    {
      directory: dataDir,
      client: {
        auth: {
          async set(req) {
            authWrites.push(req);
            const cur = JSON.parse(await readFile(join(dataDir, "plugin-auth.json"), "utf8"));
            cur[req.path.id] = req.body;
            await writeFile(join(dataDir, "plugin-auth.json"), JSON.stringify(cur, null, 2));
          },
        },
      },
    },
    {
      baseUrl: f.baseUrl,
      accessToken: tokOptions,
      refreshToken: "ref_options",
      tokenFile: optionsTokenFile,
    },
  );

  // A. When UI has 0 accounts, seamlessly falls back to options
  const fallbackRes = await hooks.tool.account.execute({});
  assert.equal(fallbackRes.account, "options");
  assert.deepEqual(fallbackRes.selected, { slot: "options", label: "options" });
  assert.equal(fallbackRes.credits.balance_credits, "300.00");

  // B. Populate two UI accounts in plugin-auth.json + logins.json + providers.json
  await writeFile(
    join(dataDir, "plugin-auth.json"),
    JSON.stringify(
      {
        updream: {
          type: "oauth",
          access: tokMain,
          refresh: "ref_main",
          expires: Date.now() + 3600_000,
          accountId: "主号",
        },
        "updream#sub2": {
          type: "oauth",
          access: tokSubExpired,
          refresh: "ref_sub_exp",
          expires: Date.now() + 15_000,
          accountId: "uid-2002",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(dataDir, "logins.json"),
    JSON.stringify([
      { agent: "plugin:updream", home: "updream", first: true, on: true },
      { agent: "plugin:updream", home: "updream#sub2", first: false, on: true },
    ]),
  );
  await writeFile(
    join(dataDir, "providers.json"),
    JSON.stringify({
      providers: [
        {
          id: "updream",
          off: false,
          accountNames: { "uid-2002": "二号机" },
        },
      ],
    }),
  );

  // Default uses top enabled account ('主号')
  const mainAcc = await hooks.tool.account.execute({});
  assert.deepEqual(mainAcc.selected, { slot: "updream", label: "主号" });
  assert.equal(mainAcc.credits.balance_credits, "5000.00");

  // Explicit account selection by custom alias ('二号机') triggers proactive refresh -> client.auth.set writeback (not optionsTokenFile!)
  const subAcc = await hooks.tool.account.execute({ account: "二号机" });
  assert.deepEqual(subAcc.selected, { slot: "updream#sub2", label: "二号机" });
  assert.equal(subAcc.credits.balance_credits, "1200.00");
  assert.ok(authWrites.some((w) => w.path.id === "updream#sub2" && w.body.access === tokSubRotated));
  await assert.rejects(() => stat(optionsTokenFile), "UI slot refresh must never touch options tokenFile");

  // all_accounts: true lists both accounts with balances
  const allAcc = await hooks.tool.account.execute({ all_accounts: true });
  assert.equal(allAcc.accounts.length, 2);
  assert.deepEqual(
    allAcc.accounts.map((a) => ({ label: a.label, bal: a.credits.balance_credits, first: a.first })),
    [
      { label: "主号", bal: "5000.00", first: true },
      { label: "二号机", bal: "1200.00", first: false },
    ],
  );

  // C. Submit task on '二号机', then switch default to '主号' -> get_task without account still routes to '二号机'
  const createdSub = await hooks.tool.create_video.execute({
    account: "二号机",
    prompt: "Sub account shot",
    model: "sed2",
    audio: false,
  });
  assert.equal(createdSub.account, "二号机");

  // Switch top default in logins.json to '二号机' and verify account.selected changes
  await writeFile(
    join(dataDir, "logins.json"),
    JSON.stringify([
      { agent: "plugin:updream", home: "updream#sub2", first: true, on: true },
      { agent: "plugin:updream", home: "updream", first: false, on: true },
    ]),
  );
  const switchedAcc = await hooks.tool.account.execute({});
  assert.deepEqual(switchedAcc.selected, { slot: "updream#sub2", label: "二号机" });

  // Switch back to '主号' as default; polling createdSub.task_id without account must still hit '二号机' via task binding!
  await writeFile(
    join(dataDir, "logins.json"),
    JSON.stringify([
      { agent: "plugin:updream", home: "updream", first: true, on: true },
      { agent: "plugin:updream", home: "updream#sub2", first: false, on: true },
    ]),
  );
  const polledBound = await hooks.tool.get_task.execute({ task_id: createdSub.task_id });
  assert.equal(polledBound.account, "二号机");
  assert.equal(polledBound.status, "completed");

  // D. Unbound historical task owned by '二号机' falls back across enabled slots when '主号' returns 404
  tasksByToken.set("t_historic_sub_99", "sub");
  const fallbackTask = await hooks.tool.get_task.execute({ task_id: "t_historic_sub_99" });
  assert.equal(fallbackTask.account, "二号机");
  assert.equal(fallbackTask.status, "completed");

  // E. Explicit account: "options" selects legacy options even when UI accounts exist
  const explicitOpt = await hooks.tool.account.execute({ account: "options" });
  assert.equal(explicitOpt.account, "options");
  assert.equal(explicitOpt.credits.balance_credits, "300.00");
});

test("non-Seedance models validation, payload snapshots, quality_mode, WAN_SIZE_MAP, multiframe, and boundary rejections", async (t) => {
  const f = await startFakeUPdreamServer(t);
  const hooks = await UPdreamPlugin(
    {},
    {
      baseUrl: f.baseUrl,
      accessToken: f.state.validAccessToken,
      refreshToken: f.state.validRefreshToken,
      projectId: 777,
      tokenFile: "",
    },
  );

  // 1. kling-v4: t2v, multiframe (3 keyframes -> image + ref_images), and ref2v combinedMin check
  const klingT2v = await hooks.tool.create_video.execute({
    prompt: "Cyberpunk train station",
    model: "kling-v4",
  });
  assert.equal(klingT2v.params_sent.model_name, "kling-v4");
  assert.equal(klingT2v.params_sent.generate_type, "t2v");
  assert.equal(klingT2v.params_sent.duration, 10);
  assert.equal(klingT2v.params_sent.resolution, "1080p");
  assert.equal(klingT2v.params_sent.aspect_ratio, "16:9");
  assert.equal(klingT2v.params_sent.supports_audio, undefined);
  assert.equal(klingT2v.params_sent.sound, undefined);

  const klingMf = await hooks.tool.create_video.execute({
    prompt: "Smooth transition across three keyframes",
    model: "kling-v4",
    mode: "multiframe",
    reference_images: [
      "https://boss.hdslb.com/updream/image/k1.png",
      "https://boss.hdslb.com/updream/image/k2.png",
      "https://boss.hdslb.com/updream/image/k3.png",
    ],
  });
  assert.equal(klingMf.params_sent.generate_type, "multiframe");
  assert.equal(klingMf.params_sent.image, "https://boss.hdslb.com/updream/image/k1.png");
  assert.deepEqual(klingMf.params_sent.ref_images, [
    "https://boss.hdslb.com/updream/image/k2.png",
    "https://boss.hdslb.com/updream/image/k3.png",
  ]);
  assert.equal(klingMf.params_sent.aspect_ratio, undefined);

  // kling-v4 ref2v requires at least 1 image or video (audio-only rejected)
  await assert.rejects(
    () =>
      hooks.tool.create_video.execute({
        prompt: "Audio only should fail on kling-v4",
        model: "kling-v4",
        mode: "ref2v",
        reference_audios: ["https://boss.hdslb.com/updream/audio/a1.mp3"],
      }),
    /requires at least 1 item across \[images, videos\]/,
  );

  // kling-v4 does not support native audio: true
  await assert.rejects(
    () =>
      hooks.tool.create_video.execute({
        prompt: "Native audio check",
        model: "kling-v4",
        audio: true,
      }),
    /audio: true.*not supported by model "kling-v4"/,
  );

  // 2. wan-3.0: uppercase resolution normalization, quality_mode='prime', sound=true, prompt_extend=false
  const wan3 = await hooks.tool.create_video.execute({
    prompt: "Ocean waves crashing at dusk",
    model: "wan-3.0",
    duration: 8,
    resolution: "1080p",
    quality_mode: "prime",
    audio: true,
    prompt_extend: false,
  });
  assert.equal(wan3.params_sent.model_name, "wan-3.0");
  assert.equal(wan3.params_sent.resolution, "1080P");
  assert.equal(wan3.params_sent.mode, "prime");
  assert.equal(wan3.params_sent.sound, true);
  assert.equal(wan3.params_sent.supports_audio, undefined);
  assert.equal(wan3.params_sent.prompt_extend, false);

  const wan3Est = await hooks.tool.estimate_credits.execute({
    model: "wan-3.0",
    duration: 5,
    resolution: "720p",
    quality_mode: "prime",
    audio: false,
  });
  assert.equal(wan3Est.params_sent.quality, "720P");
  assert.equal(wan3Est.params_sent.mode, "prime");
  assert.equal(wan3Est.params_sent.has_sound, 0);

  // 3. kling-v3-omni & kling-v3.0-std: quality_mode, ref_video single field, conditionalMax images<=4 with video, cfg_scale
  const omniRef = await hooks.tool.create_video.execute({
    prompt: "Character [@图片1] follows camera motion of [@视频1]",
    model: "kling-v3-omni",
    mode: "ref2v",
    quality_mode: "4k",
    reference_images: ["https://boss.hdslb.com/updream/image/c1.png"],
    reference_videos: ["https://boss.hdslb.com/updream/video/cam.mp4"],
    keep_original_sound: true,
    negative_prompt: "low quality, watermark",
  });
  assert.equal(omniRef.params_sent.mode, "4k");
  assert.equal(omniRef.params_sent.resolution, undefined);
  assert.equal(omniRef.params_sent.ref_video, "https://boss.hdslb.com/updream/video/cam.mp4");
  assert.equal(omniRef.params_sent.ref_videos, undefined);
  assert.equal(omniRef.params_sent.sound, false, "kling-v3-omni auto-disables sound when ref_video is attached");
  assert.equal(omniRef.params_sent.keep_original_sound, true);
  assert.equal(omniRef.params_sent.negative_prompt, "low quality, watermark");

  await assert.rejects(
    () =>
      hooks.tool.create_video.execute({
        prompt: "Too many images with video",
        model: "kling-v3-omni",
        mode: "ref2v",
        reference_images: ["1", "2", "3", "4", "5"].map((n) => `https://boss.hdslb.com/updream/image/${n}.png`),
        reference_videos: ["https://boss.hdslb.com/updream/video/cam.mp4"],
      }),
    /maximum 4 images allowed alongside a reference video/,
  );

  const klingStd = await hooks.tool.create_video.execute({
    prompt: "Close-up tea pouring",
    model: "kling-v3.0-std",
    resolution: "720p", // maps to quality_mode: "std"
    cfg_scale: 0.7,
    audio: false,
  });
  assert.equal(klingStd.params_sent.mode, "std");
  assert.equal(klingStd.params_sent.cfg_scale, 0.7);
  assert.equal(klingStd.params_sent.sound, false);

  // 4. wan-2.6: WAN_SIZE_MAP converts quality+aspect_ratio -> size on t2v, uses resolution on i2v
  const wan26T2v = await hooks.tool.create_video.execute({
    prompt: "Vertical street food stall",
    model: "wan-2.6",
    duration: 10,
    resolution: "1080p",
    aspect_ratio: "9:16",
    shot_type: "multi",
    audio: false,
  });
  assert.equal(wan26T2v.params_sent.size, "1080*1920");
  assert.equal(wan26T2v.params_sent.resolution, undefined);
  assert.equal(wan26T2v.params_sent.aspect_ratio, undefined);
  assert.equal(wan26T2v.params_sent.shot_type, "multi");

  const wan26I2v = await hooks.tool.create_video.execute({
    prompt: "Subtle steam rising",
    model: "wan-2.6",
    first_frame: "https://boss.hdslb.com/updream/image/dish.png",
    resolution: "720p",
    audio: false,
  });
  assert.equal(wan26I2v.params_sent.generate_type, "i2v");
  assert.equal(wan26I2v.params_sent.size, undefined);
  assert.equal(wan26I2v.params_sent.resolution, "720p");
  assert.equal(wan26I2v.params_sent.aspect_ratio, undefined);

  // 5. vidu-q4 (no t2v), hailuo-2.3 (duration=10 only allows 768P), gemini-omni-1.1-flash (i2v keeps aspect_ratio + clip2v), veo-3.1-preview
  await assert.rejects(
    () => hooks.tool.create_video.execute({ prompt: "No t2v on vidu-q4", model: "vidu-q4" }),
    /Invalid 'mode' \("t2v"\) for model "vidu-q4"\. Allowed modes for vidu-q4: i2v, ref2v/,
  );

  const viduI2v = await hooks.tool.create_video.execute({
    prompt: "Gentle breeze in hair",
    model: "vidu-q4",
    first_frame: "https://boss.hdslb.com/updream/image/portrait.png",
    duration: 5,
    resolution: "2k",
    audio: false,
  });
  assert.equal(viduI2v.params_sent.resolution, "2k");
  assert.equal(viduI2v.params_sent.supports_audio, false);

  await assert.rejects(
    () =>
      hooks.tool.create_video.execute({
        prompt: "Hailuo 2.3 10s 1080P invalid combo",
        model: "hailuo-2.3",
        duration: 10,
        resolution: "1080p",
      }),
    /Invalid 'resolution' \("1080P"\) for model "hailuo-2.3" when duration=10s\. Allowed values at 10s: 768P/,
  );

  const hailuoOk = await hooks.tool.create_video.execute({
    prompt: "Hailuo 2.3 10s 768P valid",
    model: "hailuo-2.3",
    duration: 10,
    resolution: "768p",
  });
  assert.equal(hailuoOk.params_sent.resolution, "768P");
  assert.equal(hailuoOk.params_sent.aspect_ratio, undefined);

  const omniClip = await hooks.tool.create_video.execute({
    prompt: "Extend scene toward sunset",
    model: "gemini-omni-1.1-flash",
    mode: "clip2v",
    reference_videos: ["https://boss.hdslb.com/updream/video/src.mp4"],
    last_frame: "https://boss.hdslb.com/updream/image/target_end.png",
    duration: 6,
  });
  assert.equal(omniClip.params_sent.ref_video, "https://boss.hdslb.com/updream/video/src.mp4");
  assert.equal(omniClip.params_sent.last_image, "https://boss.hdslb.com/updream/image/target_end.png");

  const veo = await hooks.tool.create_video.execute({
    prompt: "Aerial fjord sunrise",
    model: "veo-3.1-preview",
    duration: 8,
    resolution: "1080p",
    enhance_prompt: true,
    audio: true,
  });
  assert.equal(veo.params_sent.sound, true);
  assert.equal(veo.params_sent.enhance_prompt, true);

  // 6. Reject mock/post-processing models clearly
  await assert.rejects(
    () => hooks.tool.create_video.execute({ prompt: "Mock", model: "test" }),
    /Invalid 'model' "test"/,
  );
  await assert.rejects(
    () => hooks.tool.create_video.execute({ prompt: "Enhance", model: "video-enhance-pro" }),
    /post-processing utility/,
  );
});
