# UPdream Web API Reverse-Engineering Reference (Video Generation)

This document details the web API of **UPdream** (`https://www.updream.cn`, Bilibili's AI video creation platform), reverse-engineered directly from its production frontend bundles:
- Main bundle: `/workspace/updream/site/index.js`
- Canvas chunk: `/workspace/updream/site/chunks/CanvasPage-_5l7ucsN.js`
- AI Chat chunk: `/workspace/updream/site/chunks/AiChat-k-ytaCxQ.js`

All claims below are backed by verbatim minified JS snippets from those bundles. Anything that cannot be determined purely from client code is explicitly marked **`UNVERIFIED`**.

---

## 1. Base URL, Axios Client & Authentication Interceptor

### 1.1 Base URL & Axios Instance
All API requests use a shared Axios instance `api` configured with `baseURL: "/api"`, which resolves to `https://www.updream.cn/api`:

```js
// index.js @ 1260292
const API_BASE_URL="/api",api=axios.create({baseURL:API_BASE_URL});
```

- **Cookies / `withCredentials`**: `withCredentials` is **not** set on `api`, and no CSRF cookie/header is configured. Authentication is performed via the `Authorization: Bearer <access_token>` header.

### 1.2 Request Interceptor & Headers Added
Every request through `api` runs through the following request interceptor (and `fetch` requests use the equivalent `getRequestHeaders` helper):

```js
// index.js @ 1264178
function getRequestHeaders(d){const _={},p=_getStoredToken();p&&(_.Authorization=`Bearer ${p}`),isDebugWriteEnabled()&&(_[DEBUG_WRITE_HEADER]="1");const m=getBilispyColor();return m&&(_["x1-bilispy-color"]=m),_["Accept-Language"]=getPreferredLocale(),_["X-Workspace"]=getWorkspaceRequestKey(),d&&Object.assign(_,d),_}
api.interceptors.request.use(d=>{markApmRequestStart(d);const _=_getStoredToken();_&&(d.headers.Authorization=`Bearer ${_}`),isDebugWriteEnabled()&&(d.headers[DEBUG_WRITE_HEADER]="1");const p=getBilispyColor();return p&&(d.headers["x1-bilispy-color"]=p),d.headers["Accept-Language"]=getPreferredLocale(),d.headers["Cache-Control"]="no-cache, no-store, must-revalidate",d.headers.Pragma="no-cache",d.headers.Expires="0",d.headers["X-Workspace"]=getWorkspaceRequestKey(),d});
```

Supporting helpers for the headers:

```js
// index.js @ 1260340
const DEBUG_WRITE_STORAGE_KEY="debug-mode-write-enabled",DEBUG_WRITE_HEADER="X-Debug-Write-Enabled",WORKSPACE_STORAGE_KEY="workspace",BUILD_TIME_BILISPY_COLOR="";
function isDebugWriteEnabled(){try{return sessionStorage.getItem(DEBUG_WRITE_STORAGE_KEY)==="1"}catch{return!1}}
function getWorkspaceRequestKey(){try{const d=localStorage.getItem(WORKSPACE_STORAGE_KEY);if(!d)return"personal";const _=JSON.parse(d);return _?.type==="team"&&_?.teamId?`team:${String(_.teamId)}`:"personal"}catch{return"personal"}}
function getBilispyColor(){try{const d=useAuthStore.getState().bilispyColor?.trim();if(d)return d}catch{}return BUILD_TIME_BILISPY_COLOR}
```

```js
// index.js @ 1255377
const LOCALE_STORAGE_KEY="updream_locale";
function getPreferredLocale(){if(typeof window>"u")return"zh";const d=localStorage.getItem(LOCALE_STORAGE_KEY);return d==="en"||d==="zh"?d:navigator.language.toLowerCase().startsWith("zh")?"zh":"en"}
```

#### Summary of Request Headers

| Header | Value | When Included | Purpose |
| :--- | :--- | :--- | :--- |
| `Authorization` | `Bearer <access_token>` | When `_getStoredToken()` is non-empty | JWT access token authentication |
| `Accept-Language` | `"zh"` or `"en"` | Always | Locale preference (`localStorage.getItem("updream_locale")`, default `"zh"`) |
| `X-Workspace` | `"personal"` or `"team:<teamId>"` | Always | Workspace scope (`"personal"` by default, or `"team:<id>"` from `localStorage["workspace"]`) |
| `Cache-Control` | `"no-cache, no-store, must-revalidate"` | Always (on `api` Axios calls) | Prevents HTTP caching |
| `Pragma` | `"no-cache"` | Always (on `api` Axios calls) | Legacy cache control |
| `Expires` | `"0"` | Always (on `api` Axios calls) | Legacy cache expiration |
| `x1-bilispy-color` | `<string>` | Only if `user.bilispy_color` is non-empty | Bilibili internal canary/lane routing header |
| `X-Debug-Write-Enabled` | `"1"` | Only if `sessionStorage["debug-mode-write-enabled"] === "1"` | Admin/sandbox debug write override |
| `Idempotency-Key` | `video:<uuid-v4>` | On `POST /ai/generate-video/async` (and `image:<uuid-v4>` on image gen) | Request deduplication & safe network retry |

### 1.3 Request Signing, Hashing, Device ID, Timestamp, or CSRF
**There is NO request signing, body hashing, HMAC, device ID header, timestamp header, or CSRF token.**

The `markApmRequestStart(d)` call in the request interceptor only attaches a local JS property `d.__apmStartTime = Date.now()` onto the Axios config object to measure client-side HTTP latency for Bilibili's Mirror APM telemetry (`window.__MIRROR_REPORT__`):

```js
// index.js @ 1261166
function markApmRequestStart(d){d&&(d.__apmStartTime=Date.now())}
```

---

## 2. Token Storage, Refresh Flow & Auth Endpoints

### 2.1 Token Storage Keys
Tokens are JWT strings stored in `localStorage` under the keys **`access_token`** and **`refresh_token`** (or in `sessionStorage` under the same keys only when running in an admin sandbox session where `sessionStorage.getItem("sandbox_session")` is truthy):

```js
// index.js @ 1262598
function isSandboxMode(){return!!sessionStorage.getItem("sandbox_session")}
function _getStoredToken(){return sessionStorage.getItem("sandbox_session")?sessionStorage.getItem("access_token"):localStorage.getItem("access_token")}
function _getStoredRefreshToken(){return sessionStorage.getItem("sandbox_session")?sessionStorage.getItem("refresh_token"):localStorage.getItem("refresh_token")}
function _setStoredTokens(d,_){sessionStorage.getItem("sandbox_session")?(sessionStorage.setItem("access_token",d),sessionStorage.setItem("refresh_token",_)):(localStorage.setItem("access_token",d),localStorage.setItem("refresh_token",_))}
function _clearStoredTokens(){sessionStorage.getItem("sandbox_session")?(sessionStorage.removeItem("access_token"),sessionStorage.removeItem("refresh_token"),sessionStorage.removeItem("sandbox_session")):(localStorage.removeItem("access_token"),localStorage.removeItem("refresh_token"))}
```

### 2.2 Token Refresh Endpoint
- **Method & URL**: `POST /api/auth/refresh` (called directly via `axios.post`, bypassing the `api` instance interceptors)
- **Headers**: `{"Accept-Language": "zh" | "en", "Content-Type": "application/json"}`
- **Request Body**:
  ```json
  {
    "refresh_token": "<current_refresh_token>"
  }
  ```
- **Response Body (`200 OK`)**:
  ```json
  {
    "access_token": "<new_access_token_jwt>",
    "refresh_token": "<new_refresh_token_jwt>"
  }
  ```

Evidence:

```js
// index.js @ 1263051
let refreshTokenRequest=null;
function refreshStoredTokens(d){return refreshTokenRequest||(refreshTokenRequest=axios.post(`${API_BASE_URL}/auth/refresh`,{refresh_token:d},{headers:{"Accept-Language":getPreferredLocale()}}).then(_=>(_setStoredTokens(_.data.access_token,_.data.refresh_token),_.data)).catch(_=>{throw handleUnauthorizedSession(_),_}).finally(()=>{refreshTokenRequest=null})),refreshTokenRequest}
```

### 2.3 401 Response Interceptor & Retry Logic
When any request through `api` returns HTTP `401` (except `/auth/login`, `/auth/register-by-phone`, or `/auth/exchange-sandbox-token`), `retryAfterUnauthorized(d, api)` handles token refresh and transparent replay:

```js
// index.js @ 1263452
async function retryAfterUnauthorized(d,_){const p=d.config;if(!p||p._authRetry)return p?._authRetry&&handleUnauthorizedSession(d),Promise.reject(d);if(d.response?.data?.detail==="session_expired")return handleUnauthorizedSession(d),Promise.reject(d);const m=_getStoredToken(),g=readAuthorizationHeader(p.headers);if(m&&g&&g!==`Bearer ${m}`)return p._authRetry=!0,p.headers.Authorization=`Bearer ${m}`,_.request(p);const b=_getStoredRefreshToken();if(!b)return m&&safeRedirectToLogin(),Promise.reject(d);try{const x=await refreshStoredTokens(b);return p._authRetry=!0,p.headers.Authorization=`Bearer ${x.access_token}`,_.request(p)}catch(x){return Promise.reject(x)}}
```

```js
// index.js @ 1264702
api.interceptors.response.use(d=>(reportAxiosResponse(d),d),async d=>{if(shouldRetryNetworkError(d))return retryOnNetworkError(d);reportAxiosError(d);const _=d.config?.url||"";if(_.includes("/auth/login")||_.includes("/auth/register-by-phone")||_.includes("/auth/exchange-sandbox-token"))return Promise.reject(d);if(isProjectNotFoundError(d)){const p=resolveInvalidatedProjectIdFromRequest(d.config)??readActiveCanvasProjectIdFromLocation();p&&notifyProjectInvalidated(p,"not_found")}return d.response?.status===401?retryAfterUnauthorized(d,api):Promise.reject(d)});
```

Step-by-step behavior on HTTP `401`:
1. **Single-retry guard**: If `d.config._authRetry` is already `true`, calls `handleUnauthorizedSession(d)` (clears tokens and redirects to `/`) and rejects.
2. **Concurrent login kick-out check**: If `d.response?.data?.detail === "session_expired"`, the session was invalidated by another login; it immediately calls `handleUnauthorizedSession(d)` (which sets `localStorage.setItem("session_kicked_out", "1")`, clears tokens, and calls `POST /api/auth/logout`) without attempting a refresh.
3. **Already-refreshed token check**: If `_getStoredToken()` in storage is already newer than the `Authorization` header sent on the failed request (`g !== "Bearer " + m`), it sets `p._authRetry = true`, updates `p.headers.Authorization = "Bearer " + m`, and replays `api.request(p)`.
4. **Refresh call**: Reads `b = _getStoredRefreshToken()`. Calls `refreshStoredTokens(b)` (deduplicated across concurrent 401s via the module-level `refreshTokenRequest` promise).
5. **Replay**: Stores both `access_token` and `refresh_token` from the response, marks `p._authRetry = true`, sets `p.headers.Authorization = "Bearer " + x.access_token`, and replays `api.request(p)`.

### 2.4 Current User Endpoint (`GET /api/auth/me`)
```js
// index.js @ 1269747
authApi={login:d=>api.post("/auth/login",d,{params:{client_type:"web"},headers:{"Content-Type":"application/x-www-form-urlencoded"}}),me:()=>api.get("/auth/me"),logout:()=>api.post("/auth/logout"), ...}
```
`GET /api/auth/me` returns the user profile in `response.data`, including `id`, `bilispy_color`, and `site_redirect_enabled`:
```js
// index.js @ 1337683
const b=await authApi.me(),x=isBetaColorDomain()?_().bilispyColor:b.data.bilispy_color??"";if(d({user:b.data,isAuthenticated:!0,isLoading:!1,bilispyColor:x}),...)
```

---

## 3. Video Generation Request Body (`POST /ai/generate-video/async`)

### 3.1 API Wrapper & Store Action
In `index.js`, `aiApi.createVideoTask` posts the payload `d` to `/ai/generate-video/async` with an `Idempotency-Key` header:

```js
// index.js @ 1282897
createVideoTask:(d,_=createIdempotencyKey())=>api.post("/ai/generate-video/async",d,{headers:{"Idempotency-Key":_}}),
```

`canvasStore.generateVideo` (`index.js` @ 1993264) constructs the exact JSON body sent to `aiApi.createVideoTask`:

```js
// index.js @ 1993264
generateVideo:async(p,m,g,b)=>{const x=++_genCounter;setNodeRuntimeGenId(p,x),clearNodePollTimer(p),d(y=>({nodes:y.nodes.map(E=>E.id===p?{...E,task_status:"processing",task_progress:0,task_error:void 0}:E)}));try{await flushNodeEditBeforeGeneration(p,{mode:"video",payload:g,promptText:g.prompt,routeAnalytics:b?.routeAnalytics,timestamp:Date.now()});const y=_().nodes.find(O=>O.id===p),E=y?.node_config?.videoCount||1,S=await aiApi.createVideoTask({prompt:g.prompt,prompt_source:g.prompt_source,model_name:g.model_name,route_analytics:b?.routeAnalytics,project_id:m,generate_type:g.generate_type,image:g.image,size:g.size,resolution:g.resolution,aspect_ratio:g.aspect_ratio,duration:g.duration,supports_audio:g.audio,sound:g.sound,last_image:g.last_image,ref_video:g.ref_video,ref_videos:g.ref_videos,ref_images:g.ref_images,fast_mode:g.fast_mode,keep_original_sound:g.keep_original_sound,negative_prompt:g.negative_prompt,cfg_scale:g.cfg_scale,enhance_prompt:g.enhance_prompt,prompt_extend:g.prompt_extend,shot_type:g.shot_type,audio_urls:g.audio_urls,num_videos:g.videoCount,mode:g.mode,bitrate_mode:g.bitrate_mode,output_format:g.output_format,draft:g.draft,draft_task_id:g.draft_task_id,node_id:p,use_local:g.use_local,config_name:g.config_name,target_fps:g.target_fps}),{task_id:C,status:k}=S.data;
```

### 3.2 How the Canvas UI Builds the Payload
In `CanvasPage-_5l7ucsN.js`, the submission handler `jc` (inside `wW`) resolves reference media, active schema parameters, and model aliases before calling `generateVideo(nodeId, projectId, payload, options)`:

```js
// CanvasPage-_5l7ucsN.js @ 656455
const Qf=Ve==="sed2-5"||Ve==="icloudsky-sed2-5";
switch(Kj){
  case"t2v":Lr="t2v";break;
  case"i2v":Lr=Wo[0]?"i2v":"t2v",Ui=Wo[0];break;
  case"firstlast":Lr=Wo[0]?"firstlast":"t2v",Ui=Wo[0],kc=Wo.length>=2?Wo[1]:void 0;break;
  case"multiframe":Lr=Wo.length>=3?"multiframe":"t2v",Ui=Wo[0],Mc=Wo.length>1?Wo.slice(1):void 0;break;
  case"ref2v":Mc=Wo.length>0?Wo:void 0,Qf?Ec=Ds.length>0?Ds:void 0:Ve==="kling-v4"?{ref_video:Dl,ref_videos:Ec}=GC(Ds):(Dl=Ds[0],Ec=Ds.length>1?Ds:void 0),zd=oa.length>0?oa:void 0,Lr=Mc||Dl||Ec||zd?"ref2v":"t2v";break;
  case"video_edit":Lr="video_edit",Qf?(Mc=Wo.length>0?Wo:void 0,Ec=Ds.length>0?Ds:void 0,zd=oa.length>0?oa:void 0):(Dl=Ds[0],Mc=Wo.length>0?Wo:void 0);break;
  case"clip2v":Lr="clip2v",Qf?(Mc=Wo.length>0?Wo:void 0,Ec=Ds.length>0?Ds:void 0,zd=oa.length>0?oa:void 0):(Dl=Ds[0],kc=Wo[0]);break
}
const us={};
for(const fo of mi){if(!fo.visible)continue;const ba=au(fo,ke);ba!==void 0&&(us[fo.key]=ba)}
us.quality&&us.aspect_ratio&&(us.size=O4(us.quality,us.aspect_ratio),delete us.quality,delete us.aspect_ratio);
```

```js
// CanvasPage-_5l7ucsN.js @ 657920
e4=f(P,g.project_id,{prompt:Pt,prompt_source:zx,model_name:$d?$x?.platform_model_id??"":Ox,generate_type:Lr,image:Ui,last_image:kc,ref_images:Mc,ref_video:Dl,ref_videos:Ec,audio_urls:zd,duration:be??(typeof us.duration=="string"?Number(us.duration):us.duration),aspect_ratio:us.aspect_ratio,resolution:us.resolution,mode:us.mode,bitrate_mode:us.bitrate_mode,output_format:us.output_format,draft:He?!0:void 0,sound:us.sound,audio:us.audio,cfg_scale:us.cfg_scale,negative_prompt:us.negative_prompt,enhance_prompt:us.enhance_prompt,prompt_extend:us.prompt_extend,shot_type:us.shot_type,size:us.size,keep_original_sound:us.keep_original_sound,videoCount:dt,use_local:$d,config_name:$d?$x?.config_name:void 0},{routeAnalytics:...})
```

#### Special Callers of `generateVideo`
1. **Seedance 2.5 Draft (`sed2-5-draft`) vs Final 1080p Promotion (`hm`)**:
   - When the user selects `"sed2-5-draft"` (`Seedance 2.5(样片模式)`) in the UI, `He` (`J === "sed2-5-draft"`) is `true` and `Ox` (`Ve`) resolves to `"sed2-5"`:
     ```js
     // CanvasPage-_5l7ucsN.js @ 626029
     const sa="sed2-5",nc="sed2-5-draft";
     // CanvasPage-_5l7ucsN.js @ 634770
     const He=J===nc,Ve=He?sa:J;
     ```
     Thus the API receives `model_name: "sed2-5"`, `resolution: "480p"`, and `draft: true`.
   - Later, when promoting a completed draft video to a 1080p final video (`hm` in `CanvasPage-_5l7ucsN.js` @ 660220), it calls:
     ```js
     // CanvasPage-_5l7ucsN.js @ 660220
     await f($n.id,g.project_id,{prompt:gt,model_name:"sed2-5",resolution:"1080p",duration:at,draft_task_id:G.draft_task_id})
     ```
2. **Video Super-Resolution (`video-enhance-pro`)**:
   ```js
   // CanvasPage-_5l7ucsN.js @ 1233710
   await c(B.id,s.project_id,{prompt:"",model_name:"video-enhance-pro",generate_type:"enhance",ref_video:u.video_url,resolution:ne,target_fps:f})
   ```
3. **Prompt Prefixing on `sed2-5` `video_edit`**:
   When `generate_type === "video_edit"` and `model === "sed2-5"`, `Ag` automatically prepends `"编辑视频："` if not already present:
   ```js
   // CanvasPage-_5l7ucsN.js @ 499450
   const R0="编辑视频：",E$=new Set(["sed2-5"]);function Ag(e,t,o){if(o!=="video_edit"||!E$.has(t??""))return e;const s=e.trim();return!s||s.startsWith(R0)?e:`${R0}${e}`}
   ```

### 3.3 Complete Field Reference for `POST /ai/generate-video/async`

> **Note on `undefined` fields**: Axios's `JSON.stringify` strips keys whose values are `undefined`. Only defined properties are serialized into the HTTP request payload.

| API Field Name | Type | Required? | UI Source / Mapping | Description |
| :--- | :--- | :--- | :--- | :--- |
| `model_name` | `string` | **Required** | UI `model` (`Ox` / `Ve`) | Model identifier, e.g. `"sed2-5"`, `"wonder-ultra"`, `"sed2"`, `"sed2-fast"`, `"sed2-mini"`, `"wonder-pro"`. Note: UI `"sed2-5-draft"` maps to `model_name: "sed2-5"` with `draft: true`. |
| `prompt` | `string` | **Required** | `g.prompt` | Text prompt. In `ref2v`/`video_edit`/`clip2v`, references media using `[@图片1]`, `[@视频1]`, `[@音频1]` or `[参考图1]`, `[参考视频1]`. Can be `""` when `generate_type === "enhance"`. |
| `generate_type` | `string` | **Required** (except `draft_task_id` promotion) | UI `generateType` (`Lr`) | Generation mode: `"t2v"`, `"i2v"`, `"firstlast"`, `"multiframe"`, `"ref2v"`, `"video_edit"`, `"clip2v"`, `"enhance"`, `"erase"`. (Note: If the user selects `i2v`/`firstlast`/`ref2v` in UI without attaching media, the UI falls back to `"t2v"`). |
| `project_id` | `number \| string` | Sent by UI (`UNVERIFIED` if optional on backend) | `m` (`g.project_id`) | Canvas project ID owning the task. |
| `node_id` | `number \| string` | Sent by UI (`UNVERIFIED` if optional on backend) | `p` (`node.id`) | Canvas node ID associated with the generation task. |
| `duration` | `number` | Model-dependent (sent for all standard models) | `Number(us.duration)` | Video duration in seconds (integer, e.g. `5`). Special value: `-1` for auto duration (`"跟随原视频"`) in `sed2-5` / `wonder-ultra` `video_edit`. |
| `aspect_ratio` | `string` | Model-dependent | `us.aspect_ratio` | Aspect ratio: `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"`, `"3:4"`, `"21:9"`, or `"adaptive"`. Omitted on models that convert `quality` + `aspect_ratio` into `size` (`wan-2.2`, `wan-2.5-preview`, `wan-2.6`). |
| `resolution` | `string` | Model-dependent | `us.resolution` | Output resolution: `"480p"`, `"720p"`, `"1080p"`, `"2k"`, `"4k"` (or `"768p"` on `hailuo-2.3`). |
| `size` | `string` | Only for Wan / Veo | `O4(us.quality, us.aspect_ratio)` or `us.size` | Pixel dimensions string `"W*H"`, e.g. `"1920*1080"`, `"1280*720"`, `"832*480"`. Used by `wan-2.2`, `wan-2.5-preview`, `wan-2.6`, `wan-2.6-ref2v`, `veo-3.1-preview`. |
| `supports_audio` | `boolean` | Only for models with `audio` param | **UI `us.audio` -> API `supports_audio`** | Controls audio generation (`true`/`false`) for **Seedance 2.5**, **Seedance 2.0** (all variants), **Vidu Q2 Pro / Q4**, and **Wan 3.0**. |
| `sound` | `boolean` | Only for models with `sound` param | **UI `us.sound` -> API `sound`** | Controls sound effect/audio generation (`true`/`false`) for **Kling**, **Wan 2.5/2.6/2.7**, and **Veo 3.1**. |
| `output_format` | `string` | Only for `sed2-5` & `wonder-ultra` | `us.output_format` | Container format: `"mp4"` (default) or `"mov"` (`"mov"` only on `sed2-5`). |
| `bitrate_mode` | `string` | Only for Seedance 2.0 variants | `us.bitrate_mode` | Bitrate tier: `"high"` (default, `"高码率"`) or `"standard"` (`"标准码率"`). Used by `sed2`, `sed2-fast`, `sed2-mini`, `wonder-pro`. |
| `mode` | `string` | Only for models with `mode` param | `us.mode` | Quality/speed tier: `"std"` / `"pro"` (Kling), or `"standard"` / `"prime"` (HappyHorse, Hailuo H3, Minimax H3 Max). |
| `image` | `string` | Required for `i2v`, `firstlast`, `multiframe` | `Wo[0]` (`Ui`) | First/starting frame image URL (`https://...`). |
| `last_image` | `string` | Optional for `firstlast` & non-`sed2-5` `clip2v` | `Wo[1]` (`kc`) | Ending frame image URL for `firstlast` (when 2 images provided), or tail frame for `clip2v` on non-`sed2-5` models (`wan-2.7`). |
| `ref_images` | `string[]` | Used in `ref2v`, `video_edit`, `clip2v`, `multiframe` | `Mc` | Array of reference image URLs. In `multiframe`, contains frames `Wo.slice(1)` (frames 2..N). In `ref2v`, `video_edit`, and (`sed2-5`) `clip2v`, contains all uploaded reference images `Wo`. |
| `ref_video` | `string` | Used in non-`sed2-5` `ref2v`, `video_edit`, `clip2v`, `enhance` | `Dl` (`Ds[0]`) | Single reference video URL. Note: **`sed2-5` does NOT use `ref_video`**; `sed2-5` always populates `ref_videos` (array) instead. For `kling-v4` `ref2v`, `Ds[0]` goes to `ref_video` and `Ds.slice(1)` goes to `ref_videos`. |
| `ref_videos` | `string[]` | Used in `sed2-5` `ref2v`/`video_edit`/`clip2v` & multi-video `ref2v` | `Ec` (`Ds`) | Array of reference video URLs. Always used for `sed2-5` (`Qf === true`) whenever 1+ videos are attached; on other models, used when `Ds.length > 1`. |
| `audio_urls` | `string[]` | Optional in `ref2v`, `video_edit`, `clip2v` | `zd` (`oa`) | Array of reference audio URLs. |
| `num_videos` | `number` | Optional (sent by UI as `1`..`4`) | **UI `videoCount` -> API `num_videos`** | Number of videos to generate (`1` by default, up to `4`). |
| `draft` | `boolean` | Optional (`true` for `sed2-5-draft`) | `He ? true : undefined` | When `true` on `model_name: "sed2-5"`, runs in 480p Draft/Sample mode (`样片模式`). |
| `draft_task_id` | `string` | Only when promoting a draft to 1080p | `G.draft_task_id` | Task ID of a completed `sed2-5` draft task to render in `1080p`. |
| `prompt_source` | `string` | Optional | `"user"` \| `"agent"` | Indicates whether prompt was typed by user or generated by AI agent. |
| `keep_original_sound` | `boolean` | Optional (Kling O1 / V3 Omni) | `us.keep_original_sound` | Whether to preserve original video audio in `ref2v` / `video_edit`. |
| `negative_prompt` | `string` | Optional (Kling V2.5, Wan) | `us.negative_prompt` | Negative prompt string. |
| `cfg_scale` | `number` | Optional (Kling V2.5) | `us.cfg_scale` | Classifier-free guidance scale (`0` to `1`, default `0.5`). |
| `enhance_prompt` | `boolean` | Optional (Veo 3.1) | `us.enhance_prompt` | Prompt enhancement switch. |
| `prompt_extend` | `boolean` | Optional (Wan 2.2–2.7) | `us.prompt_extend` | Smart prompt expansion switch. |
| `shot_type` | `string` | Optional (Wan 2.6, Kling V3 Omni) | `us.shot_type` | Narrative mode: `"single"` (`"单镜头"`) or `"multi"` (`"多镜头"`). |
| `fast_mode` | `boolean` | Optional | `g.fast_mode` | Forwarded by `generateVideo` if present. |
| `target_fps` | `number` | Optional (`video-enhance-pro`) | `g.target_fps` | Target frame rate for video super-resolution. |
| `route_analytics` | `object` | Optional | `b?.routeAnalytics` | Client telemetry when auto-model routing is enabled. |
| `use_local` | `boolean` | Optional (default `false`) | `$d` | Internal/local provider toggle. |
| `config_name` | `string` | Optional | `$x?.config_name` | Local provider configuration name when `use_local` is `true`. |

### 3.4 Complete Example Payloads

#### Example 1: Seedance 2.5 (`sed2-5`) Text-to-Video (`t2v`), 480p, 5s, Audio Off
Note how UI `model: "sed2-5"` maps to `model_name: "sed2-5"`, UI `audio: false` maps to `supports_audio: false`, and UI `videoCount: 1` maps to `num_videos: 1`:

```json
{
  "prompt": "A cinematic aerial shot of a neon-lit cyberpunk city in the rain at night, smooth camera movement",
  "prompt_source": "user",
  "model_name": "sed2-5",
  "project_id": 102400,
  "node_id": 508912,
  "generate_type": "t2v",
  "resolution": "480p",
  "aspect_ratio": "16:9",
  "duration": 5,
  "supports_audio": false,
  "output_format": "mp4",
  "num_videos": 1,
  "use_local": false
}
```

#### Example 2A: Seedance 2.5 (`sed2-5`) Image-to-Video (`i2v`)
In `sed2-5`, `i2v` and `firstlast` override `aspect_ratio` to `aspect_ratio_adaptive_only` (`"adaptive"`). The single start frame is sent in `image`:

```json
{
  "prompt": "The character slowly turns toward the camera and smiles, wind blowing through hair",
  "prompt_source": "user",
  "model_name": "sed2-5",
  "project_id": 102400,
  "node_id": 508913,
  "generate_type": "i2v",
  "image": "https://boss.hdslb.com/updream/image/2026/11/example_first_frame_m1e0-u0-3k2a.png",
  "resolution": "720p",
  "aspect_ratio": "adaptive",
  "duration": 5,
  "supports_audio": true,
  "output_format": "mp4",
  "num_videos": 1,
  "use_local": false
}
```

#### Example 2B: Seedance 2.5 (`sed2-5`) First-Last-Frame (`firstlast`)
When two images are provided in `firstlast` mode, `Wo[0]` is placed in `image` and `Wo[1]` is placed in `last_image`:

```json
{
  "prompt": "Smooth morphing transition from daytime cherry blossoms to winter snow at night",
  "prompt_source": "user",
  "model_name": "sed2-5",
  "project_id": 102400,
  "node_id": 508914,
  "generate_type": "firstlast",
  "image": "https://boss.hdslb.com/updream/image/2026/11/start_frame_m1e0-u0-4a1b.png",
  "last_image": "https://boss.hdslb.com/updream/image/2026/11/end_frame_m1e0-u0-4c9d.png",
  "resolution": "720p",
  "aspect_ratio": "adaptive",
  "duration": 5,
  "supports_audio": true,
  "output_format": "mp4",
  "num_videos": 1,
  "use_local": false
}
```

#### Example 2C: Seedance 2.5 (`sed2-5`) Multi-Modal Reference (`ref2v`)
In `ref2v` on `sed2-5`, images go into `ref_images`, videos go into `ref_videos` (array), and audios go into `audio_urls`:

```json
{
  "prompt": "Make [@图片1] perform the camera motion from [@视频1] while speaking with [@音频1]",
  "prompt_source": "user",
  "model_name": "sed2-5",
  "project_id": 102400,
  "node_id": 508915,
  "generate_type": "ref2v",
  "ref_images": [
    "https://boss.hdslb.com/updream/image/2026/11/char_ref_m1e0-u0-2b11.png"
  ],
  "ref_videos": [
    "https://boss.hdslb.com/updream/video/2026/11/motion_ref.mp4"
  ],
  "audio_urls": [
    "https://boss.hdslb.com/updream/video/2026/11/voice_ref.mp3"
  ],
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "duration": 5,
  "supports_audio": true,
  "output_format": "mp4",
  "num_videos": 1,
  "use_local": false
}
```

---

## 4. Full Video Model List & Parameter Schemas (`VIDEO_MODEL_SCHEMA_DEFINITIONS`)

### 4.1 Parameter Preset Table (`PARAM_TEMPLATES`)
In `index.js` (@ 1802006–1811310), `PARAM_TEMPLATES` defines all reusable parameter presets referenced by `VIDEO_MODEL_SCHEMA_DEFINITIONS`:

```js
// index.js @ 1802006 (excerpt of Seedance presets)
const PARAM_TEMPLATES={
  duration_4_to_15_slider:{key:"duration",label:"时长",type:"slider",min:4,max:15,step:1,unit:"s",default:5},
  duration_seedance25:{key:"duration",label:"时长",type:"slider",min:4,max:30,step:1,unit:"s",default:5},
  duration_seedance25_edit:{key:"duration",label:"时长",type:"select",options:[{value:"-1",label:"跟随原视频"}],default:"-1"},
  duration_seedance25_extend:{key:"duration",label:"延长时长",type:"slider",min:4,max:180,step:1,unit:"s",default:5},
  aspect_ratio_seedance:{key:"aspect_ratio",label:"比例",type:"select",options:[{value:"16:9",label:"16:9"},{value:"4:3",label:"4:3"},{value:"1:1",label:"1:1"},{value:"3:4",label:"3:4"},{value:"9:16",label:"9:16"},{value:"21:9",label:"21:9"},{value:"adaptive",label:"自适应"}],default:"16:9"},
  aspect_ratio_seedance_mini:{key:"aspect_ratio",label:"比例",type:"select",options:[{value:"21:9",label:"21:9"},{value:"16:9",label:"16:9"},{value:"4:3",label:"4:3"},{value:"1:1",label:"1:1"},{value:"3:4",label:"3:4"},{value:"9:16",label:"9:16"}],default:"16:9"},
  aspect_ratio_wonder_pro:{key:"aspect_ratio",label:"比例",type:"select",options:[{value:"16:9",label:"16:9"},{value:"4:3",label:"4:3"},{value:"1:1",label:"1:1"},{value:"3:4",label:"3:4"},{value:"9:16",label:"9:16"},{value:"21:9",label:"21:9"}],default:"16:9"},
  aspect_ratio_adaptive_only:{key:"aspect_ratio",label:"比例",type:"select",options:[{value:"adaptive",label:"自适应"}],default:"adaptive"},
  resolution_480_720:{key:"resolution",label:"分辨率",type:"select",options:[{value:"480p",label:"480p"},{value:"720p",label:"720p"}],default:"720p"},
  resolution_480_only:{key:"resolution",label:"分辨率",type:"select",options:[{value:"480p",label:"480p"}],default:"480p"},
  resolution_720_1080:{key:"resolution",label:"分辨率",type:"select",options:[{value:"720p",label:"720p"},{value:"1080p",label:"1080p"}],default:"720p"},
  resolution_sed2:{key:"resolution",label:"分辨率",type:"select",options:[{value:"480p",label:"480p"},{value:"720p",label:"720p"},{value:"1080p",label:"1080p"},{value:"4k",label:"4K"}],default:"720p"},
  resolution_sed2_fast:{key:"resolution",label:"分辨率",type:"select",options:[{value:"480p",label:"480p"},{value:"720p",label:"720p"},{value:"1080p",label:"1080p",tag:"超分"},{value:"2k",label:"2K",tag:"超分"},{value:"4k",label:"4K",tag:"超分"}],default:"720p"},
  resolution_sed2_mini:{key:"resolution",label:"分辨率",type:"select",options:[{value:"480p",label:"480p"},{value:"720p",label:"720p"}],default:"720p"},
  resolution_wonder_pro:{key:"resolution",label:"分辨率",type:"select",options:[{value:"720p",label:"720p"},{value:"1080p",label:"1080p"}],default:"720p"},
  audio_on:{key:"audio",label:"生成音频",type:"switch",default:!0},
  output_format:{key:"output_format",label:"输出格式",type:"select",options:[{value:"mp4",label:"MP4"},{value:"mov",label:"MOV"}],default:"mp4"},
  bitrate_mode_high:{key:"bitrate_mode",label:"码率",type:"select",options:[{value:"standard",label:"标准码率"},{value:"high",label:"高码率"}],default:"high"}
};
```

#### Complete Resolved `PARAM_TEMPLATES` Lookup Table

| Preset Name | UI `key` -> API Field | Type | Allowed Option Values / Range | Default |
| :--- | :--- | :--- | :--- | :--- |
| `duration_seedance25` | `duration` -> `duration` | `slider` | Integer `4` .. `30` (step `1`, unit `s`) | `5` |
| `duration_seedance25_edit` | `duration` -> `duration` | `select` | `"-1"` (sent as `-1`, `"跟随原视频"`) | `"-1"` (`-1`) |
| `duration_seedance25_extend` | `duration` -> `duration` | `slider` | Integer `4` .. `180` (step `1`, unit `s`) | `5` |
| `duration_4_to_15_slider` | `duration` -> `duration` | `slider` | Integer `4` .. `15` (step `1`, unit `s`) | `5` |
| `duration_3_to_15_slider` | `duration` -> `duration` | `slider` | Integer `3` .. `15` (step `1`, unit `s`) | `5` |
| `duration_3_to_10_slider` | `duration` -> `duration` | `slider` | Integer `3` .. `10` (step `1`, unit `s`) | `5` |
| `duration_2_to_15_slider` | `duration` -> `duration` | `slider` | Integer `2` .. `15` (step `1`, unit `s`) | `5` |
| `duration_2_to_10_slider` | `duration` -> `duration` | `slider` | Integer `2` .. `10` (step `1`, unit `s`) | `5` |
| `duration_1_to_8_slider` | `duration` -> `duration` | `slider` | Integer `1` .. `8` (step `1`, unit `s`) | `5` |
| `duration_5_10` | `duration` -> `duration` | `select` | `"5"`, `"10"` | `"5"` (`5`) |
| `duration_5_10_15` | `duration` -> `duration` | `select` | `"5"`, `"10"`, `"15"` | `"5"` (`5`) |
| `duration_5_only` | `duration` -> `duration` | `select` | `"5"` | `"5"` (`5`) |
| `duration_6_10` | `duration` -> `duration` | `select` | `"6"`, `"10"` | `"6"` (`6`) |
| `duration_4_6_8` | `duration` -> `duration` | `select` | `"4"`, `"6"`, `"8"` | `"8"` (`8`) |
| `duration_8_only` | `duration` -> `duration` | `select` | `"8"` | `"8"` (`8`) |
| `duration_3_to_10` | `duration` -> `duration` | `select` | `"3"`, `"4"`, `"5"`, `"6"`, `"7"`, `"8"`, `"9"`, `"10"` | `"5"` (`5`) |
| `duration_o1_ref` | `duration` -> `duration` | `select` | `"3"`, `"4"`, `"5"`, `"6"`, `"7"`, `"8"`, `"9"`, `"10"` | `"5"` (`5`) |
| `aspect_ratio_seedance` | `aspect_ratio` -> `aspect_ratio` | `select` | `"16:9"`, `"4:3"`, `"1:1"`, `"3:4"`, `"9:16"`, `"21:9"`, `"adaptive"` | `"16:9"` |
| `aspect_ratio_seedance_mini` | `aspect_ratio` -> `aspect_ratio` | `select` | `"21:9"`, `"16:9"`, `"4:3"`, `"1:1"`, `"3:4"`, `"9:16"` | `"16:9"` |
| `aspect_ratio_wonder_pro` | `aspect_ratio` -> `aspect_ratio` | `select` | `"16:9"`, `"4:3"`, `"1:1"`, `"3:4"`, `"9:16"`, `"21:9"` | `"16:9"` |
| `aspect_ratio_adaptive_only` | `aspect_ratio` -> `aspect_ratio` | `select` | `"adaptive"` | `"adaptive"` |
| `aspect_ratio_3` | `aspect_ratio` -> `aspect_ratio` | `select` | `"16:9"`, `"9:16"`, `"1:1"` | `"16:9"` |
| `aspect_ratio_2` | `aspect_ratio` -> `aspect_ratio` | `select` | `"16:9"`, `"9:16"` | `"16:9"` |
| `aspect_ratio_wan` | `aspect_ratio` -> `size` (with `quality`) | `select` | `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"`, `"3:4"` | `"16:9"` |
| `aspect_ratio_wan27` | `aspect_ratio` -> `aspect_ratio` | `select` | `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"`, `"3:4"` | `"16:9"` |
| `resolution_480_720` | `resolution` -> `resolution` | `select` | `"480p"`, `"720p"` | `"720p"` |
| `resolution_480_only` | `resolution` -> `resolution` | `select` | `"480p"` | `"480p"` |
| `resolution_720_1080` | `resolution` -> `resolution` | `select` | `"720p"`, `"1080p"` | `"720p"` |
| `resolution_sed2` | `resolution` -> `resolution` | `select` | `"480p"`, `"720p"`, `"1080p"`, `"4k"` | `"720p"` |
| `resolution_sed2_fast` | `resolution` -> `resolution` | `select` | `"480p"`, `"720p"`, `"1080p"` (tag `超分`), `"2k"` (tag `超分`), `"4k"` (tag `超分`) | `"720p"` |
| `resolution_sed2_mini` | `resolution` -> `resolution` | `select` | `"480p"`, `"720p"` | `"720p"` |
| `resolution_wonder_pro` | `resolution` -> `resolution` | `select` | `"720p"`, `"1080p"` | `"720p"` |
| `resolution_540_720_1080` | `resolution` -> `resolution` | `select` | `"540p"`, `"720p"`, `"1080p"` | `"720p"` |
| `resolution_768_1080` | `resolution` -> `resolution` | `select` | `"768p"`, `"1080p"` | `"768p"` |
| `resolution_wan27` | `resolution` -> `resolution` | `select` | `"720p"`, `"1080p"` | `"1080p"` |
| `resolution_wan27_i2v` | `resolution` -> `resolution` | `select` | `"480p"`, `"720p"`, `"1080p"` | `"1080p"` |
| `quality_720_1080` | `quality` -> `size` (with `aspect_ratio`) | `select` | `"720p"`, `"1080p"` | `"1080p"` |
| `quality_480_720_1080` | `quality` -> `size` (with `aspect_ratio`) | `select` | `"480p"`, `"720p"`, `"1080p"` | `"1080p"` |
| `size_veo` | `size` -> `size` | `select` | `"1280*720"`, `"720*1280"`, `"1920*1080"`, `"1080*1920"` | `"1920*1080"` |
| `size_wan_26_ref` | `size` -> `size` | `select` | `"1280*720"`, `"720*1280"`, `"960*960"`, `"1088*832"`, `"832*1088"`, `"1920*1080"`, `"1080*1920"`, `"1440*1440"`, `"1632*1248"`, `"1248*1632"` | `"1920*1080"` |
| `audio_on` | `audio` -> `supports_audio` | `switch` | `true`, `false` | `true` |
| `audio` | `audio` -> `supports_audio` | `switch` | `true`, `false` | `false` |
| `sound` | `sound` -> `sound` | `switch` | `true`, `false` | `false` |
| `sound_on` | `sound` -> `sound` | `switch` | `true`, `false` | `true` |
| `keep_original_sound` | `keep_original_sound` -> `keep_original_sound` | `switch` | `true`, `false` | `true` |
| `output_format` | `output_format` -> `output_format` | `select` | `"mp4"`, `"mov"` | `"mp4"` |
| `bitrate_mode_high` | `bitrate_mode` -> `bitrate_mode` | `select` | `"standard"`, `"high"` | `"high"` |
| `mode_std_pro` | `mode` -> `mode` | `select` | `"std"` (`"标准(720p)"`), `"pro"` (`"高品质(1080p)"`) | `"std"` |
| `mode_pro_default` | `mode` -> `mode` | `select` | `"std"` (`"标准(720p)"`), `"pro"` (`"高品质(1080p)"`) | `"pro"` |
| `mode_happyhorse` | `mode` -> `mode` | `select` | `"standard"`, `"prime"` | `"standard"` |
| `mode_hailuo_h3` | `mode` -> `mode` | `select` | `"standard"`, `"prime"` | `"standard"` |
| `shot_type` | `shot_type` -> `shot_type` | `select` | `"single"`, `"multi"` | `"single"` |
| `cfg_scale` | `cfg_scale` -> `cfg_scale` | `slider` | `0` .. `1` (step `0.1`) | `0.5` |
| `negative_prompt` | `negative_prompt` -> `negative_prompt` | `text` | Free text | `""` |
| `enhance_prompt` | `enhance_prompt` -> `enhance_prompt` | `switch` | `true`, `false` | `true` |
| `prompt_extend` | `prompt_extend` -> `prompt_extend` | `switch` | `true`, `false` | `true` |

---

### 4.2 Seedance 2.0 & 2.5 Variants (Detailed Breakdown)

Here is the verbatim definition of `sed2-5`, `wonder-ultra`, `sed2-5-draft`, `sed2`, `wonder-pro`, `sed2-fast`, `sed2-mini`, and legacy ID aliases from `index.js`:

```js
// index.js @ 1811310
{id:"sed2-5",label:"Seedance 2.5",baseParams:{duration:"duration_seedance25",aspect_ratio:"aspect_ratio_seedance",resolution:"resolution_480_720",audio:"audio_on",output_format:"output_format"},generateTypes:{t2v:{},i2v:{media:{images:{min:1,max:1}},overrides:{aspect_ratio:"aspect_ratio_adaptive_only"}},firstlast:{media:{images:{min:2,max:2}},overrides:{aspect_ratio:"aspect_ratio_adaptive_only"}},ref2v:{media:{images:{min:0,max:30},videos:{min:0,max:10},audios:{min:0,max:10},maxTotal:50}},video_edit:{media:{images:{min:0,max:30},videos:{min:1,max:10},audios:{min:0,max:10},maxTotal:50},overrides:{duration:"duration_seedance25_edit",aspect_ratio:"aspect_ratio_adaptive_only"}},clip2v:{media:{images:{min:0,max:30},videos:{min:1,max:10},audios:{min:0,max:10},maxTotal:50},overrides:{duration:"duration_seedance25_extend",aspect_ratio:"aspect_ratio_adaptive_only"}}}},
```

```js
// index.js @ 1812420
{id:"sed2",label:"Seedance 2.0",baseParams:{duration:"duration_4_to_15_slider",aspect_ratio:"aspect_ratio_seedance",resolution:"resolution_sed2",audio:"audio_on",bitrate_mode:"bitrate_mode_high"},generateTypes:{t2v:{},i2v:{media:{images:{min:1,max:1}}},firstlast:{media:{images:{min:1,max:2}}},ref2v:{media:{images:{min:0,max:9},videos:{min:0,max:3},audios:{min:0,max:3}}},video_edit:{media:{videos:{min:1,max:1}}}}},
{id:"wonder-pro",label:"Wonder Pro",baseParams:{duration:"duration_4_to_15_slider",aspect_ratio:"aspect_ratio_wonder_pro",resolution:"resolution_wonder_pro",audio:"audio_on",bitrate_mode:"bitrate_mode_high"},generateTypes:{t2v:{},i2v:{media:{images:{min:1,max:1}}},firstlast:{media:{images:{min:2,max:2}}},ref2v:{media:{images:{min:0,max:9},videos:{min:0,max:3},audios:{min:0,max:3},maxTotal:15}},video_edit:{media:{videos:{min:1,max:1}}}}},
{id:"sed2-fast",label:"Seedance 2.0 Fast",baseParams:{duration:"duration_4_to_15_slider",aspect_ratio:"aspect_ratio_seedance",resolution:"resolution_sed2_fast",audio:"audio_on",bitrate_mode:"bitrate_mode_high"},generateTypes:{t2v:{},i2v:{media:{images:{min:1,max:1}}},firstlast:{media:{images:{min:1,max:2}}},ref2v:{media:{images:{min:0,max:9},videos:{min:0,max:3},audios:{min:0,max:3}}},video_edit:{media:{videos:{min:1,max:1}}}}},
{id:"sed2-mini",label:"Seedance 2.0 Mini",baseParams:{duration:"duration_4_to_15_slider",aspect_ratio:"aspect_ratio_seedance_mini",resolution:"resolution_sed2_mini",audio:"audio_on",bitrate_mode:"bitrate_mode_high"},generateTypes:{t2v:{},i2v:{media:{images:{min:1,max:1}}},firstlast:{media:{images:{min:1,max:2}}},ref2v:{media:{images:{min:0,max:12},videos:{min:0,max:3},audios:{min:0,max:3}}},video_edit:{media:{videos:{min:1,max:1}}}}},
```

And the dynamic cloning for `wonder-ultra`, `sed2-5-draft`, and `LEGACY_VIDEO_MODEL_IDS`:

```js
// index.js @ 1833075
const sed25Schema=VIDEO_MODEL_SCHEMA_DEFINITIONS.find(d=>d.id==="sed2-5");
if(sed25Schema){
  const d=JSON.parse(JSON.stringify(sed25Schema));
  d.id="wonder-ultra",d.label="Seedance 2.5(导演专属)",d.baseParams={...d.baseParams,resolution:"resolution_720_1080",output_format:{key:"output_format",label:"输出格式",type:"select",options:[{value:"mp4",label:"MP4"}],default:"mp4"}},VIDEO_MODEL_SCHEMA_DEFINITIONS.push(d);
  const _=JSON.parse(JSON.stringify(sed25Schema));
  _.id="sed2-5-draft",_.label="Seedance 2.5(样片模式)",_.baseParams={..._.baseParams,resolution:"resolution_480_only"};
  for(const m of Object.keys(_.generateTypes)){const g=_.generateTypes[m];g.overrides={...g.overrides,resolution:"resolution_480_only"},m==="clip2v"&&(g.overrides.duration={...PARAM_TEMPLATES.duration_seedance25_extend,max:30})}
  const p=VIDEO_MODEL_SCHEMA_DEFINITIONS.findIndex(m=>m.id==="sed2-5");
  VIDEO_MODEL_SCHEMA_DEFINITIONS.splice(p+1,0,_)
}
const LEGACY_VIDEO_MODEL_IDS={"sed2-hsr":"sed2","sed2-5-hsr":"sed2-5"};
function normalizeVideoModelId(d){return d?LEGACY_VIDEO_MODEL_IDS[d]??d:d}
```

#### Seedance 2.0 & 2.5 Variants Comparison Table

| Model ID | Display Label | API `model_name` Sent | Supported `generateTypes` & Media Constraints | `duration` Options (Default) | `aspect_ratio` Options (Default) | `resolution` Options (Default) | `supports_audio` (UI `audio`) | Extra Model-Specific Params |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`sed2-5`** | `Seedance 2.5` | `"sed2-5"` | • `t2v`: none<br>• `i2v`: img `1..1`<br>• `firstlast`: img `2..2`<br>• `ref2v`: img `0..30`, vid `0..10`, aud `0..10`, maxTotal `50`<br>• `video_edit`: img `0..30`, vid `1..10`, aud `0..10`, maxTotal `50`<br>• `clip2v`: img `0..30`, vid `1..10`, aud `0..10`, maxTotal `50` | • Base (`t2v`/`i2v`/`firstlast`/`ref2v`): `4..30`s (`5`)<br>• `video_edit`: `-1` (`-1`, auto)<br>• `clip2v`: `4..180`s (`5`) | • `t2v`/`ref2v`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (`16:9`)<br>• `i2v`/`firstlast`/`video_edit`/`clip2v`: `adaptive` only (`adaptive`) | `480p`, `720p` (`720p`)<br>*(1080p via `draft_task_id` promotion)* | `true` / `false` (`true`) | `output_format`: `"mp4"`, `"mov"` (`"mp4"`) |
| **`sed2-5-draft`** | `Seedance 2.5(样片模式)` | `"sed2-5"` + `draft: true` | Same 6 modes & media limits as `sed2-5` | • Base: `4..30`s (`5`)<br>• `video_edit`: `-1` (`-1`)<br>• `clip2v`: `4..30`s (`5`) | Same as `sed2-5` | `480p` only (`480p`) | `true` / `false` (`true`) | `draft: true`, `output_format`: `"mp4"`, `"mov"` (`"mp4"`) |
| **`wonder-ultra`** | `Seedance 2.5(导演专属)` | `"wonder-ultra"` | Same 6 modes & media limits as `sed2-5` | Same as `sed2-5` (`4..30`s; `-1` for edit; `4..180`s for extend) | Same as `sed2-5` | `720p`, `1080p` (`720p`) | `true` / `false` (`true`) | `output_format`: `"mp4"` only (`"mp4"`) |
| **`sed2`** | `Seedance 2.0` | `"sed2"` | • `t2v`: none<br>• `i2v`: img `1..1`<br>• `firstlast`: img `1..2`<br>• `ref2v`: img `0..9`, vid `0..3`, aud `0..3`<br>• `video_edit`: vid `1..1` | `4..15`s (`5`) | `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (`16:9`) | `480p`, `720p`, `1080p`, `4k` (`720p`) | `true` / `false` (`true`) | `bitrate_mode`: `"standard"`, `"high"` (`"high"`) |
| **`wonder-pro`** | `Seedance 2.0(导演专属)` (schema label `Wonder Pro`) | `"wonder-pro"` | • `t2v`: none<br>• `i2v`: img `1..1`<br>• `firstlast`: img `2..2`<br>• `ref2v`: img `0..9`, vid `0..3`, aud `0..3`, maxTotal `15`<br>• `video_edit`: vid `1..1` | `4..15`s (`5`) | `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9` (`16:9`) *(no `adaptive`)* | `720p`, `1080p` (`720p`) | `true` / `false` (`true`) | `bitrate_mode`: `"standard"`, `"high"` (`"high"`) |
| **`sed2-fast`** | `Seedance 2.0 Fast` | `"sed2-fast"` | Same 5 modes & media limits as `sed2` | `4..15`s (`5`) | `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (`16:9`) | `480p`, `720p`, `1080p` (超分), `2k` (超分), `4k` (超分) (`720p`) | `true` / `false` (`true`) | `bitrate_mode`: `"standard"`, `"high"` (`"high"`) |
| **`sed2-mini`** | `Seedance 2.0 Mini` | `"sed2-mini"` | • `t2v`: none<br>• `i2v`: img `1..1`<br>• `firstlast`: img `1..2`<br>• `ref2v`: img `0..12`, vid `0..3`, aud `0..3`<br>• `video_edit`: vid `1..1` | `4..15`s (`5`) | `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16` (`16:9`) *(no `adaptive`)* | `480p`, `720p` (`720p`) | `true` / `false` (`true`) | `bitrate_mode`: `"standard"`, `"high"` (`"high"`) |
| **`sed2-hsr`** *(legacy)* | Normalized to `sed2` | `"sed2"` | Alias in `LEGACY_VIDEO_MODEL_IDS` -> `"sed2"` | — | — | — | — | Normalized via `normalizeVideoModelId` |
| **`sed2-5-hsr`** *(legacy)* | Normalized to `sed2-5` | `"sed2-5"` | Alias in `LEGACY_VIDEO_MODEL_IDS` -> `"sed2-5"` | — | — | — | — | Normalized via `normalizeVideoModelId` |

---

### 4.3 Full Video Models Table (All 31 Models in `VIDEO_MODEL_SCHEMA_DEFINITIONS`)

Display name overrides from `MODEL_DISPLAY_NAME_BY_ID` (`index.js` @ 1966000) are noted in parentheses under **Label**:

```js
// index.js @ 1966000
const MODEL_DISPLAY_NAME_BY_ID={"wonder-pro":"Seedance 2.0(导演专属)","wonder-ultra":"Seedance 2.5(导演专属)","sed2-5-draft":"Seedance 2.5(样片模式)","happyhorse":"HappyHorse-1.0","happyhorse-1.1":"HappyHorse-1.1","kling-v4":"Kling O3","vidu-q4":"Vidu Q3 Pro","wan-3.0":"Wan 2.7","hailuo-h3":"Hailuo 2.3 Pro","minimax-h3-max":"Hailuo 2.3 Max","paiwo-v6max":"PixVerse V6 Max","gemini-omni-flash":"Veo 3.1 Lite","gemini-omni-1.1-flash":"Veo 3.1 Fast"};
```

| # | Model ID (`id`) | Label (and UI Display Name Override) | `generateTypes` & Media Constraints | Resolved Parameters & Defaults (Including Per-Mode Overrides) |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `sed2-5` | `Seedance 2.5` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `2..2`), `ref2v` (img `0..30`, vid `0..10`, aud `0..10`, max `50`), `video_edit` (img `0..30`, vid `1..10`, aud `0..10`, max `50`), `clip2v` (img `0..30`, vid `1..10`, aud `0..10`, max `50`) | • `duration`: `4..30`s (def `5`); `video_edit` -> `-1` (def `-1`); `clip2v` -> `4..180`s (def `5`)<br>• `aspect_ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (def `16:9`); `i2v`/`firstlast`/`video_edit`/`clip2v` -> `adaptive` (def `adaptive`)<br>• `resolution`: `480p`, `720p` (def `720p`)<br>• `audio` (`supports_audio`): bool (def `true`)<br>• `output_format`: `mp4`, `mov` (def `mp4`) |
| 2 | `sed2-5-draft` | `Seedance 2.5(样片模式)` | Same as `sed2-5` | Same as `sed2-5`, except:<br>• Sends `model_name: "sed2-5"` and `draft: true`<br>• `resolution`: `480p` only (def `480p`) in all modes<br>• `clip2v` `duration`: `4..30`s (def `5`) |
| 3 | `wonder-ultra` | `Seedance 2.5(导演专属)` | Same as `sed2-5` | Same as `sed2-5`, except:<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `output_format`: `mp4` only (def `mp4`) |
| 4 | `sed2` | `Seedance 2.0` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `0..9`, vid `0..3`, aud `0..3`), `video_edit` (vid `1..1`) | • `duration`: `4..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (def `16:9`)<br>• `resolution`: `480p`, `720p`, `1080p`, `4k` (def `720p`)<br>• `audio` (`supports_audio`): bool (def `true`)<br>• `bitrate_mode`: `standard`, `high` (def `high`) |
| 5 | `wonder-pro` | `Wonder Pro` (`Seedance 2.0(导演专属)`) | `t2v`, `i2v` (img `1..1`), `firstlast` (img `2..2`), `ref2v` (img `0..9`, vid `0..3`, aud `0..3`, max `15`), `video_edit` (vid `1..1`) | • `duration`: `4..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `audio` (`supports_audio`): bool (def `true`)<br>• `bitrate_mode`: `standard`, `high` (def `high`) |
| 6 | `sed2-fast` | `Seedance 2.0 Fast` | Same as `sed2` | Same as `sed2`, except:<br>• `resolution`: `480p`, `720p`, `1080p` (超分), `2k` (超分), `4k` (超分) (def `720p`) |
| 7 | `sed2-mini` | `Seedance 2.0 Mini` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `0..12`, vid `0..3`, aud `0..3`), `video_edit` (vid `1..1`) | • `duration`: `4..15`s (def `5`)<br>• `aspect_ratio`: `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16` (def `16:9`)<br>• `resolution`: `480p`, `720p` (def `720p`)<br>• `audio` (`supports_audio`): bool (def `true`)<br>• `bitrate_mode`: `standard`, `high` (def `high`) |
| 8 | `paiwo-v6max` | `拍我 V6 Max` (`PixVerse V6 Max`) | `t2v`, `i2v` (img `1..1`) | • `duration`: `1..8`s (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `sound`: bool (def `true`) |
| 9 | `wan-3.0` | `万相 3.0` (`Wan 2.7`) | `t2v`, `i2v` (img `1..1`), `firstlast` (img `2..2`) | • `duration`: `2..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `audio` (`supports_audio`): bool (def `true`) |
| 10 | `hailuo-h3` | `海螺 H3` (`Hailuo 2.3 Pro`) | `t2v`, `i2v` (img `1..1`) | • `duration`: `4..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `mode`: `standard`, `prime` (def `standard`)<br>• `sound`: bool (def `true`) |
| 11 | `minimax-h3-max` | `Minimax H3 Max` (`Hailuo 2.3 Max`) | `t2v`, `i2v` (img `1..1`) | • `duration`: `4..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `mode`: `standard`, `prime` (def `standard`)<br>• `sound`: bool (def `true`) |
| 12 | `happyhorse-1.1` | `HappyHorse-1.1` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `0..9`, vid `0..3`, aud `0..3`), `video_edit` (img `0..9`, vid `1..3`) | • `duration`: `4..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `mode`: `standard`, `prime` (def `standard`)<br>• `sound`: bool (def `true`) |
| 13 | `happyhorse` | `HappyHorse-1.0` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `0..9`, vid `0..3`, aud `0..3`), `video_edit` (vid `1..1`) | • `duration`: `4..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `mode`: `standard`, `prime` (def `standard`)<br>• `sound`: bool (def `true`) |
| 14 | `kling-v3.0-turbo` | `可灵 V3.0 Turbo` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`) | • `duration`: `5`, `10` (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1` (def `16:9`); hidden on `i2v`/`firstlast` (`visibleWhen: noImages`)<br>• `mode`: `std`, `pro` (def `pro`) |
| 15 | `kling-v3-omni` | `可灵 V3 Omni` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `multiframe` (img `3..4`), `ref2v` (img `0..7`, vid `0..1`, max `7`), `video_edit` (img `0..4`, vid `1..1`, max `5`) | • `duration`: `3..15`s (def `5`); `ref2v` with video & `video_edit` -> `3..10`s (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1` (def `16:9`); hidden on `i2v`/`firstlast`/`multiframe`/`video_edit`<br>• `mode`: `std`, `pro` (def `pro`)<br>• `sound`: bool (def `true`, hidden when video attached)<br>• `keep_original_sound`: bool (def `true`, visible when video attached in `ref2v`/`video_edit`)<br>• `shot_type`: `single`, `multi` (def `single`, on `t2v`/`i2v`/`ref2v` without video) |
| 16 | `kling-v3.0-std` | `可灵 V3.0` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `multiframe` (img `3..4`) | • `duration`: `3..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1` (def `16:9`); hidden when images attached<br>• `mode`: `std`, `pro` (def `pro`)<br>• `sound`: bool (def `false`) |
| 17 | `kling-v4` | `可灵 V4` (`Kling O3`) | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `0..9`, vid `0..3`) | • `duration`: `3..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `sound`: bool (def `true`) |
| 18 | `kling-v2-5-turbo` | `可灵 V2.5 Turbo` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`) | • `duration`: `5`, `10` (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1` (def `16:9`); hidden when images attached<br>• `mode`: `std`, `pro` (def `std`; forced to `pro` on `firstlast` when 2 images attached)<br>• `cfg_scale`: `0..1` (def `0.5`)<br>• `negative_prompt`: string (def `""`) |
| 19 | `kling-o1` | `可灵 O1` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `0..7`, vid `0..1`, max `7`), `video_edit` (img `0..4`, vid `1..1`, max `5`) | • `duration`: `5`, `10` (def `5`); `ref2v` -> `3..10`s select (def `5`); `video_edit` -> disabled (`null`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1` (def `16:9`); hidden on `i2v`/`firstlast`/`video_edit` or `ref2v` with video<br>• `mode`: `std`, `pro` (def `std`)<br>• `keep_original_sound`: bool (def `true`, visible when video attached in `ref2v`/`video_edit`) |
| 20 | `gemini-omni-flash` | `Gemini Omni Flash` (`Veo 3.1 Lite`) | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`) | • `duration`: `4`, `6`, `8` (def `8`)<br>• `aspect_ratio`: `16:9`, `9:16` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`) |
| 21 | `gemini-omni-1.1-flash` | `Gemini Omni 1.1 Flash` (`Veo 3.1 Fast`) | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `1..3`) | • `duration`: `4`, `6`, `8` (def `8`; forced to `8` on `firstlast`/`ref2v` or `1080p`/`4k`)<br>• `aspect_ratio`: `16:9`, `9:16` (def `16:9`)<br>• `resolution`: `720p`, `1080p`, `4k` (def `720p`) |
| 22 | `vidu-q2-pro` | `Vidu Q2 Pro` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `multiframe` (img `3..7`), `ref2v` (img `1..7`) | • `duration`: `2..10`s (def `5`); `firstlast` -> `2..8`s (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1`, `4:3`, `3:4` (def `16:9`); hidden on `i2v`/`firstlast`/`multiframe`<br>• `resolution`: `540p`, `720p`, `1080p` (def `720p`); `ref2v` -> `720p`, `1080p` (def `720p`)<br>• `audio` (`supports_audio`): bool (def `true`) |
| 23 | `vidu-q4` | `Vidu Q4` (`Vidu Q3 Pro`) | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `1..4`) | • `duration`: `2..15`s (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1`, `4:3`, `3:4` (def `16:9`)<br>• `resolution`: `720p`, `1080p` (def `720p`)<br>• `audio` (`supports_audio`): bool (def `true`) |
| 24 | `hailuo-2.3` | `海螺 2.3` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`) | • `duration`: `6`, `10` (def `6`; `1080p` forces `6`)<br>• `resolution`: `768p`, `1080p` (def `768p`) |
| 25 | `veo-3.1-preview` | `Veo 3.1` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `1..3`) | • `duration`: `4`, `6`, `8` (def `8`); `firstlast`/`ref2v` -> `8` only (def `8`)<br>• `size`: `1280*720`, `720*1280`, `1920*1080`, `1080*1920` (def `1920*1080`)<br>• `sound`: bool (def `true`)<br>• `enhance_prompt`: bool (def `true`, `t2v`/`i2v` only) |
| 26 | `wan-2.7` | `万相 2.7` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`), `ref2v` (img `0..9`, vid `0..3`, aud `0..1`, max `12`), `video_edit` (img `0..4`, vid `1..1`, max `5`), `clip2v` (img `0..1`, vid `1..1`, max `2`) | • `duration`: `2..15`s (def `5`); `ref2v`/`video_edit` -> `2..10`s (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1`, `4:3`, `3:4` (def `16:9`); hidden on `i2v`/`firstlast`/`clip2v`<br>• `resolution`: `720p`, `1080p` (def `1080p`); `i2v`/`firstlast`/`clip2v` -> `480p`, `720p`, `1080p` (def `1080p`)<br>• `prompt_extend`: bool (def `true`, `t2v`/`i2v`/`firstlast` only)<br>• `sound`: bool (def `true`, `t2v`/`i2v` only)<br>• `negative_prompt`: string (def `""`) |
| 27 | `wan-2.6-ref2v` | `万相 2.6 参考生视频` | `ref2v` (img `0..5`, vid `0..3`, max `5`) | • `duration`: `5`, `10` (def `5`)<br>• `size`: `1280*720`, `720*1280`, `960*960`, `1088*832`, `832*1088`, `1920*1080`, `1080*1920`, `1440*1440`, `1632*1248`, `1248*1632` (def `1920*1080`)<br>• `shot_type`: `single`, `multi` (def `single`)<br>• `sound`: bool (def `true`)<br>• `prompt_extend`: bool (def `true`)<br>• `negative_prompt`: string (def `""`) |
| 28 | `wan-2.6` | `万相 2.6` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`) | • `duration`: `5`, `10`, `15` (def `5`); `firstlast` -> `5` only (def `5`)<br>• `quality` (`720p`, `1080p`, def `1080p`) + `aspect_ratio` (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, def `16:9`) -> converted to `size` (`1920*1080` etc.); on `i2v`/`firstlast`, `resolution` (`720p`, `1080p`)<br>• `shot_type`: `single`, `multi` (def `single`, `t2v`/`i2v`)<br>• `sound`: bool (def `true`, `t2v`/`i2v`)<br>• `prompt_extend`: bool (def `true`)<br>• `negative_prompt`: string (def `""`) |
| 29 | `wan-2.5-preview` | `万相 2.5 Preview` | `t2v`, `i2v` (img `1..1`) | • `duration`: `5`, `10` (def `5`)<br>• `quality` (`480p`, `720p`, `1080p`, def `1080p`) + `aspect_ratio` (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, def `16:9`) -> converted to `size`; on `i2v`, `resolution` (`480p`, `720p`, `1080p`)<br>• `sound`: bool (def `true`)<br>• `prompt_extend`: bool (def `true`)<br>• `negative_prompt`: string (def `""`) |
| 30 | `wan-2.2` | `万相 2.2` | `t2v`, `i2v` (img `1..1`), `firstlast` (img `1..2`) | • `duration`: `5` only (def `5`)<br>• `quality` (`480p`, `720p`, `1080p`, def `1080p`) + `aspect_ratio` -> converted to `size`; on `i2v`, `resolution` (`480p`, `720p`, `1080p`); on `firstlast`, `resolution` (`720p` only)<br>• `prompt_extend`: bool (def `true`)<br>• `negative_prompt`: string (def `""`) |
| 31 | `test` | `测试模型 (Mock)` | `t2v`, `i2v` (img `1..1`) | • `duration`: `5` only (def `5`)<br>• `aspect_ratio`: `16:9`, `9:16`, `1:1` (def `16:9`) |

#### Additional Model Listing Endpoints
- `GET /api/ai/video-models` (`aiApi.getVideoModelConfigs`):
  Returns `{ models: [...], confirm_model_ids: string[], video_route_recommend_enabled: boolean, video_route_recommend_gate_reason: string, user_tier: string }`.
  ```js
  // index.js @ 1970158
  fetchVideoModelConfigs:()=>{... return workspaceModelConfigCache.load("video",p,m,g=>{const b=g.data.confirm_model_ids,x=g.data.models.map(withMappedModelLabel).map(normalizeVideoModelDisplayCapabilities);d({videoModelConfigs:applyExclusiveModelUnlock(x,unlockedModelKeys(_())),videoConfirmModelIds:b??[],videoConfirmModelIdsLoaded:!0,videoRouteRecommendEnabled:g.data.video_route_recommend_enabled===!0,videoRouteRecommendGateReason:g.data.video_route_recommend_gate_reason??"unknown",userTier:g.data.user_tier??"origin"})...})}
  ```
- `GET /api/ai/supported-models` (`aiApi.getSupportedModels`):
  Returns `{ image_models: [...], video_models: [...] }`:
  ```js
  // index.js @ 4020160
  aiApi.getSupportedModels().then(st=>{Qs(st.data.image_models),ko(st.data.video_models)})
  ```

---

## 5. Task Status (`GET /ai/task/{id}`) & Polling Flow

### 5.1 Endpoints
```js
// index.js @ 1283050
getTaskStatus:(d,_)=>api.get(`/ai/task/${d}`,_?.includePairMainResult?{params:{include_pair_main_result:!0}}:void 0),
cancelTask:d=>api.post(`/ai/task/${d}/cancel`),
```

### 5.2 Creation & Status Response Shapes
1. **Creation Response (`POST /api/ai/generate-video/async`)**:
   ```json
   {
     "task_id": "string",
     "status": "pending"
   }
   ```
2. **Task Status Response (`GET /api/ai/task/{id}`)**:
   ```json
   {
     "status": "pending | processing | completed | failed",
     "progress": 45,
     "result": {
       "videos": [
         {
           "video_url": "https://boss.hdslb.com/updream/video/.../output.mp4",
           "cover_url": "https://boss.hdslb.com/updream/image/.../cover.jpg"
         }
       ],
       "pair_status": "dual_ready | single",
       "pair_id": "optional_ab_test_pair_id"
     },
     "error": "Optional error string or { message, code, detail }",
     "error_code": "OPTIONAL_ERROR_CODE",
     "message": "Optional fallback error message",
     "request_id": "optional_request_id"
   }
   ```

### 5.3 Frontend Polling & Success/Failure Decision Logic
The frontend polls `aiApi.getTaskStatus(taskId)` every **5,000 ms (5 seconds)** inside `_pollVideoTask` (`index.js` @ 1990066):

```js
// index.js @ 1990066
_pollVideoTask:(p,m,g,b)=>{const x=getNodeRuntimeGenId(p),y=typeof b=="number"?{videoCount:b}:b??{},E=y.videoCount??1,S=y.model_name==="sed2"||y.model_name==="sed2-fast"||y.model_name==="sed2-mini"||y.model_name==="sed2-5",C=d=>{clearNodePollTimer(p);const k=setTimeout(()=>{clearNodePollTimer(p),O()},d);_nodePollTimers.set(p,k)},O=async()=>{if(getNodeRuntimeGenId(p)!==x)return;try{const k=await aiApi.getTaskStatus(g);if(getNodeRuntimeGenId(p)!==x)return;let{status:w,result:A,error:N,progress:R}=k.data;if(S&&(w==="pending"||w==="processing"))try{const B=(await canvasNodesApi.get(p)).data;if(getNodeRuntimeGenId(p)!==x)return;B.task_status==="waiting_asset_review"?w="waiting_asset_review":B.task_status==="failed"?(w="failed",N=B.task_error||N):B.task_status==="completed"&&(w="completed")}catch{}if(w==="waiting_asset_review"){d(B=>({nodes:B.nodes.map($=>$.id===p?{...$,task_status:"waiting_asset_review",task_progress:0,task_error:void 0}:B)}));return}if(w==="completed"&&A?.pair_status==="dual_ready"&&A?.pair_id){... return}if(w==="completed"&&A?.videos?.length){clearNodePollTimer(p),useAuthStore.getState().refreshAccount();try{const B=(await canvasNodesApi.get(p)).data;...}catch{const B=A.videos[0];d($=>({nodes:$.nodes.map(q=>q.id===p?{...q,video_url:B.video_url,cover_url:B.cover_url,task_status:"completed",task_progress:100}:q)}))}return}if(w==="failed"){clearNodePollTimer(p),useAuthStore.getState().refreshAccount();const B=formatGenerationError(k.data,"视频生成失败",g);d($=>({nodes:$.nodes.map(q=>q.id===p?{...q,task_status:"failed",task_error:B,task_progress:0}:q)}));return}syncNodeTaskProgress(d,p,m,R),C(5e3)}catch{if(getNodeRuntimeGenId(p)!==x)return;C(5e3)}};C(5e3)}
```

Error extraction helper (`formatGenerationError` in `index.js` @ 1859500):

```js
// index.js @ 1859500
function extractRawError(d){if(!d)return"";const _=d.error;if(typeof _=="string")return _;if(_&&typeof _=="object"){const p=_;if(typeof p.message=="string")return p.message;if(typeof p.detail=="string")return p.detail;if(typeof p.code=="string")return p.code}return typeof d.message=="string"?d.message:typeof d.error_code=="string"?d.error_code:""}
```

#### Key Polling Takeaways
1. **Interval**: 5 seconds (`5e3` ms). Network errors during polling are swallowed and retried after 5 seconds.
2. **Progress Clamping**: While `status` is `"pending"` or `"processing"`, `syncNodeTaskProgress` clamps `progress` to `Math.min(99, Math.max(0, R))`.
3. **Seedance Node-Status Cross-Check**: When `model_name` is `"sed2"`, `"sed2-fast"`, `"sed2-mini"`, or `"sed2-5"` (`S === true`) and `/ai/task/{id}` reports `"pending"` or `"processing"`, the client also calls `GET /api/canvas-nodes/{nodeId}`:
   - If `node.task_status === "waiting_asset_review"`, polling pauses in `"waiting_asset_review"` state (waiting for Seedance character/image asset audit).
   - If `node.task_status === "failed"` or `"completed"`, it overrides `status`.
4. **Success Condition**: `status === "completed"` and `result.videos` is a non-empty array. The primary video URL is `result.videos[0].video_url` and thumbnail is `result.videos[0].cover_url` (for `num_videos > 1`, all generated videos are also persisted in the canvas node's `generation_history` via `GET /api/canvas-nodes/{nodeId}`).
5. **Failure Condition**: `status === "failed"`. Error details are read from `data.error` (string or `{message, detail, code}`), `data.message`, or `data.error_code`.

---

## 6. Reference Media Upload Flow (Images, Videos, Audios)

The generation payload (`image`, `last_image`, `ref_images`, `ref_video`, `ref_videos`, `audio_urls`) **always expects remote `https://...` URLs** (hosted on Bilibili's BOSS/BFS storage), never base64 data URIs or raw blobs.

### 6.1 Image Upload (`POST /api/upload/image`)
```js
// index.js @ 1285549
const MAX_UPLOAD_INPUT_SIZE_MB=100,COMPRESS_THRESHOLD_MB=16,DIRECT_UPLOAD_IMAGE_TYPES=new Set(["image/png","image/jpeg","image/jpg","image/webp"]),uploadApi={uploadImage:async d=>{if(!d.type.startsWith("image/"))throw new Error("File must be an image");if(d.size>MAX_UPLOAD_INPUT_SIZE_MB*1024*1024)throw new Error(`Image size must be less than ${MAX_UPLOAD_INPUT_SIZE_MB}MB`);const _=d.size>COMPRESS_THRESHOLD_MB*1024*1024,p=!DIRECT_UPLOAD_IMAGE_TYPES.has(d.type.toLowerCase());let m=d;if(_||p){const b=_?"image/jpeg":d.type==="image/jpeg"||d.type==="image/jpg"?"image/jpeg":"image/png";m=await imageCompression(d,{maxSizeMB:COMPRESS_THRESHOLD_MB,maxWidthOrHeight:4096,useWebWorker:!0,fileType:b})}const g=new FormData;return g.append("file",m),api.post("/upload/image",g)}};
```

- **Endpoint**: `POST /api/upload/image`
- **Content-Type**: `multipart/form-data` with field name **`file`**
- **Client-Side Constraints**: Must be `image/*`, max 100 MB (files > 16 MB or not PNG/JPEG/WebP are compressed client-side to <= 16 MB and max dimension 4096px).
- **Response Shape (`response.data`)**:
  ```json
  {
    "url": "https://boss.hdslb.com/updream/image/..._m1e0-u0-3a2f.png"
  }
  ```
- **URL Normalization (`normalizeImageReferenceUrl`)**:
  Before passing an image URL in `image`, `last_image`, or `ref_images`, the client strips any Bilibili BFS `@...` image-resize suffix while keeping query strings:
  ```js
  // index.js @ 1859990
  const IMAGE_RESIZE_SUFFIX_IN_PATH_RE=/(\.(?:jpe?g|png|webp|gif|bmp|svg|avif))@[^/?#]+$/i;
  function normalizeImageReferenceUrl(d){const _=d.trim();if(!_)return _;const p=_.match(/^([^?#]+)(.*)$/);if(!p)return _;const[,m,g]=p,b=m.replace(IMAGE_RESIZE_SUFFIX_IN_PATH_RE,"$1");return`${b}${g}`}
  ```

### 6.2 Seedance 2.0 Reference Image Asset Review (`POST /api/assets/review-url`)
For **Seedance 2.0** models (`sed2`, `sed2-fast`, `sed2-mini` — note that **`sed2-5` is explicitly excluded** via `rt && !Qf`), reference images must pass Ark asset review (`ark_asset_status === "Active"`):

```js
// CanvasPage-_5l7ucsN.js @ 611867
hW=e=>e==="sed2"||e==="sed2-fast"||e==="sed2-mini"||e==="sed2-5"
// CanvasPage-_5l7ucsN.js @ 656920
if(rt&&!Qf&&an.length>0){
  ...
  const ba=(await userAssetsApi.reviewByUrl({bfs_url:ro(fo),name:`画布图片_${Date.now()}`,category_id:0,asset_type:"Image",timeout:300})).data;
  if(ba.ark_asset_status==="Failed")throw new Error("REAL_PERSON_DETECTED");
}
```
```js
// index.js @ 1283650
userAssetsApi={
  list:d=>api.get("/assets",{params:d!=null?{category_id:d}:{}}),
  getStatus:d=>api.get(`/assets/${d}/status`),
  reviewByUrl:d=>api.post("/assets/review-url",d),
  ...
}
```

### 6.3 Reference Video & Audio Upload (`GET /api/upload/file-presign` + `PUT`)
Reference videos and audio files use a presigned PUT flow to Bilibili BOSS object storage:

```js
// index.js @ 1286320
async function getFileUploadUrl(d,_="video",p){return(await api.get("/upload/file-presign",{params:{filename:d,folder:_,width:p?.width,height:p?.height,size:p?.size,duration:p?.duration,prefix:p?.prefix}})).data}
async function precheckVideoFirstFrame(d){const _=await extractVideoFirstFrame(d);if(!_)return;const p=new FormData;p.append("file",_,"frame.jpg"),await api.post("/upload/face-precheck",p)}
async function uploadFileToBoss(d,_){const p=d.type.startsWith("video/"),[m]=await Promise.all([p?extractVideoMetadata(d):Promise.resolve({}),p?precheckVideoFirstFrame(d):Promise.resolve()]),g=await getFileUploadUrl(d.name,"video",{...m,size:d.size,prefix:"video"});return await new Promise((x,y)=>{const E=new XMLHttpRequest;E.open("PUT",g.upload_url,!0),E.setRequestHeader("Content-Type",d.type||"application/octet-stream"),... E.send(d)}),g.file_url}
```

1. **Step 1 — Presign (`GET /api/upload/file-presign`)**:
   - Query params: `filename`, `folder="video"`, `width`, `height`, `size`, `duration`, `prefix="video"`
   - Response (`response.data`):
     ```json
     {
       "upload_url": "https://...",
       "file_url": "https://...",
       "file_id": "...",
       "key": "...",
       "thumb_upload_url": "https://...",
       "thumb_file_url": "https://...",
       "thumb_key": "..."
     }
     ```
2. **Step 2 — Video First-Frame Face Audit (`POST /api/upload/face-precheck`, video only)**:
   - Sends extracted first frame JPEG in `multipart/form-data` field `file`. Rejects with HTTP 400 (`detail.code === "FACE_AUDIT_REJECTED"`) if a real human face is rejected.
3. **Step 3 — Upload Binary (`PUT <upload_url>`)**:
   - Raw file binary sent with `Content-Type: <file.type>`.
4. **Step 4 — Use `file_url`**:
   - The returned `g.file_url` is passed in `ref_videos` / `ref_video` / `audio_urls`.

---

## 7. Credit Estimate & Account Balance Endpoints

### 7.1 Credit Estimate (`GET /api/credit/estimate`)
```js
// index.js @ 1297240
const creditApi={estimate:d=>api.get("/credit/estimate",{params:d})};
```

How the Canvas UI calls `creditApi.estimate`:
```js
// CanvasPage-_5l7ucsN.js @ 129182
const w=await creditApi.estimate({
  model_name:e.modelName,
  service_type:"VIDEO",
  quantity:e.quantity,
  quality:e.quality||"720p",
  num_ref_images:e.numRefImages??0,
  has_sound:e.hasSound?1:0,
  has_ref_video:e.hasRefVideo?1:0,
  ref_video_seconds:Math.trunc(Math.max(0,e.refVideoSeconds??0)),
  mode:e.mode,
  generate_type:e.generateType
});
p(w.data.estimated_credits);
const A=w.data.list_price_credits;
```

- **Query Parameters**:
  - `model_name`: `string` (e.g. `"sed2-5"`, `"sed2"`, `"wonder-ultra"`)
  - `service_type`: `"VIDEO"` (or `"IMAGE"`)
  - `quantity`: `number` — video duration in seconds (Note: for `sed2-5` / `wonder-ultra` when `duration === -1` in `video_edit`, the UI passes `30` as the fallback estimate quantity)
  - `quality`: `string` — resolution string, e.g. `"480p"`, `"720p"`, `"1080p"`, `"2k"`, `"4k"`
  - `num_ref_images`: `number` — count of reference images (`0` if none)
  - `has_sound`: `0 | 1` — `1` if `audio` or `sound` is enabled, else `0`
  - `has_ref_video`: `0 | 1` — `1` if reference video(s) are attached, else `0`
  - `ref_video_seconds`: `number` — integer total duration (in seconds) of reference video(s)
  - `mode`: `string` (optional) — e.g. `"std"`, `"pro"`, `"standard"`, `"prime"`
  - `generate_type`: `string` (optional) — e.g. `"t2v"`, `"i2v"`, `"firstlast"`, `"ref2v"`, `"video_edit"`, `"clip2v"`
- **Response Shape (`response.data`)**:
  ```json
  {
    "estimated_credits": 15,
    "list_price_credits": 30
  }
  ```

### 7.2 User Account Balance (`GET /api/user/account`)
```js
// index.js @ 1297290
userApi={account:()=>api.get("/user/account"), ...}
// index.js @ 1337985
const m=await userApi.account();
d({account:m.data.data,balanceCredits:m.data.data?.balance_credits??null,accountMembership:m.data.data?.membership??null});
```
And in the billing UI (`index.js` @ 3490500):
```js
// index.js @ 3490555
const ke=parseFloat(Q?.balance_credits||"0"),Be=parseFloat(Q?.permanent_credits||"0"),Ge=parseFloat(Q?.temporary_credits||"0"),Xe=parseFloat(Q?.frozen_credits||"0"),tt=parseFloat(Q?.today_credits||"0"),rt=parseFloat(Q?.month_credits||"0");
```

- **Response Shape (`response.data`)**:
  ```json
  {
    "data": {
      "balance_credits": "1250.00",
      "permanent_credits": "1000.00",
      "temporary_credits": "250.00",
      "frozen_credits": "0.00",
      "today_credits": "45.00",
      "month_credits": "320.00",
      "membership": "origin | pro | max | ultra",
      "membership_end_at": "2026-12-31T23:59:59Z"
    }
  }
  ```

### 7.3 Model-Specific Credit Balance (`GET /api/model-credit/balance`)
```js
// index.js @ 1298120
modelCreditApi={getBalance:d=>api.get("/model-credit/balance",{params:d?.teamId!=null?{team_id:d.teamId}:{}}), ...}
```
```js
// index.js @ 3185450
const at=await modelCreditApi.getBalance(it!=null?{teamId:it}:void 0);
st(at.data?.data??null)
```
- **Query Params**: Optional `team_id` when in a team workspace.
- **Response Shape (`response.data`)**:
  ```json
  {
    "data": {
      "scope": "personal | team",
      "exclusive_model_keys": ["wonder-ultra", "wonder-pro"],
      "member_available_credits": "1250.00",
      "general": {
        "model_key": "general",
        "model_display_name": "通用积分",
        "available_credits": "1250.00",
        "member_available_credits": "1250.00",
        "lots": [
          {
            "credit_kind": "long | short",
            "remaining_credits": "1000.00",
            "expires_at": null
          }
        ]
      },
      "models": [
        {
          "model_key": "sed2-5",
          "model_display_name": "Seedance 2.5",
          "available_credits": "500.00",
          "member_available_credits": "500.00",
          "lots": []
        }
      ]
    }
  }
  ```

---

## 8. Additional Requirements: `Idempotency-Key`, `project_id`, and Canvas Node Lifecycle

### 8.1 `Idempotency-Key` Format (`createIdempotencyKey`)
Every call to `POST /api/ai/generate-video/async` includes an `Idempotency-Key` header generated by `createIdempotencyKey("video")`:

```js
// index.js @ 1268000
function createIdempotencyKey(d="video"){return typeof crypto<"u"&&typeof crypto.randomUUID=="function"?`${d}:${crypto.randomUUID()}`:`${d}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`}
```

- **Format**: `"video:<uuid-v4>"` (e.g., `"video:9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"`), with a base-36 timestamp+random fallback if `crypto.randomUUID` is unavailable.
- **Automatic Network Retry**: The Axios response interceptor checks `hasIdempotencyKey(d.config)` and automatically retries `POST /ai/generate-video/async` up to 3 times (`MAX_NETWORK_RETRIES = 3`, `NETWORK_RETRY_DELAY_MS = 3000`) on network timeouts or `ECONNABORTED` errors because the `Idempotency-Key` prevents duplicate billing/tasks on the backend:
  ```js
  // index.js @ 1260450
  const MAX_NETWORK_RETRIES=3,NETWORK_RETRY_DELAY_MS=3e3;
  function hasIdempotencyKey(d){const _=d?.headers;if(!_)return!1;if(typeof _.get=="function")return Boolean(_.get("Idempotency-Key")||_.get("idempotency-key"));const p=_;return Boolean(p["Idempotency-Key"]||p["idempotency-key"])}
  ```

### 8.2 `project_id` and `node_id` Lifecycle (Must a Canvas Node Exist First?)
In the UPdream web frontend, **a project (`project_id`) and a canvas node (`node_id`) always exist before `POST /ai/generate-video/async` is called**:

1. **Projects API (`projectsApi`)**:
   ```js
   // index.js @ 1271120
   projectsApi={
     list:d=>api.get("/projects",{params:d}),
     create:d=>api.post("/projects",d), // { name: "未命名项目", description?: "" }
     get:d=>api.get(`/projects/${d}`),
     ...
   }
   ```
2. **Canvas Nodes API (`canvasNodesApi`)**:
   ```js
   // index.js @ 1272250
   canvasNodesApi={
     listByProject:d=>api.get(`/canvas-nodes/project/${d}`),
     get:d=>api.get(`/canvas-nodes/${d}`),
     create:(d,_)=>api.post(`/canvas-nodes/project/${d}`,_),
     update:(d,_,p)=>api.put(`/canvas-nodes/${d}`,_,{params:p}),
     ...
   }
   ```
   When creating a video node on the canvas (`addNode` in `index.js` @ 1979500):
   ```js
   // index.js @ 1979550
   const C=await canvasNodesApi.create(p,{
     x:m.x,
     y:m.y,
     width:m.width??320,
     height:m.height??240,
     node_type:"video",
     source_type:"shot",
     name:m.name??"Video Shot",
     node_config:m.node_config
   });
   ```
   The created node ID (`C.data.id`) and project ID (`p`) are then passed as `node_id` and `project_id` to `POST /api/ai/generate-video/async`.
3. **Pre-Generation Node Flush**:
   Immediately before calling `aiApi.createVideoTask`, `generateVideo` calls `flushNodeEditBeforeGeneration(nodeId, ...)` which `PUT`s the latest `node_config` (including `lastGenPayload`) to `PUT /api/canvas-nodes/{nodeId}`.
4. **Backend Coupling to `node_id` / `project_id`**:
   - During task execution, the backend updates the canvas node record directly (`task_status`, `video_url`, `cover_url`, `generation_history`), which `_pollVideoTask` reads via `GET /api/canvas-nodes/{nodeId}`.
   - **`UNVERIFIED`**: Whether the backend's `POST /api/ai/generate-video/async` endpoint strictly requires `project_id` and `node_id` (or allows them to be omitted/null for standalone API usage) cannot be verified from frontend bundles alone. To guarantee compatibility with the web backend (and to support Seedance `waiting_asset_review` status checks), a client can create or reuse a project (`POST /api/projects`) and a video canvas node (`POST /api/canvas-nodes/project/{project_id}`) once and pass their `project_id` and `node_id`.
