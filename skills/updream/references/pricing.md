# UPdream 全模型选型、积分单价、多账号路由与台账规范

## 目录（Table of Contents）
- [1. 模型选型建议（Seedance 主力 + 非 Seedance 场景补充）](#1-模型选型建议seedance-主力--非-seedance-场景补充)
- [2. Seedance 家族模型规格与实测积分表](#2-seedance-家族模型规格与实测积分表)
- [3. 非 Seedance 已适配模型能力、限制与预估积分表（23 款）](#3-非-seedance-已适配模型能力限制与预估积分表23-款)
- [4. 多账号配置与 `account` 参数路由规则](#4-多账号配置与-account-参数路由规则)
- [5. 画幅强制规则、模型特殊约束与审核拦截回退](#5-画幅强制规则模型特殊约束与审核拦截回退)
- [6. 预算门禁、CSV 台账与返工上限](#6-预算门禁csv-台账与返工上限)

---

## 1. 模型选型建议（Seedance 主力 + 非 Seedance 场景补充）

UPdream Magpie 插件（v0.2.0+）与 `scripts/updream.py` 已完整适配平台 **30 款生成式视频模型**（7 款 Seedance + 23 款非 Seedance）。按项目类型选型：

- **写实带货、生活方式实拍、手部交互（默认主力）**：首选 **`sed2`**（`ref2v` / `i2v`，人脸过审稳、光学质感自然、性价比高）。
- **正脸对镜口播对口型（Method B）、旗舰近景 `i2v`**：首选 **`sed2-5`**（光学景深与皮肤次表面散射最佳；遇商业肖像“版权限制”误判按第 5 节回退 `sed2`）。
- **超长单镜（3–30 s）、智能多帧关键帧串联（`multiframe` 3–10 图）、多参考视频+图片**：选 **`kling-v4`**（720p/1080p）或 **`wan-3.0`**（支持 `2–30 s`、`standard` / `prime` 双档画质）。
- **参考视频动作迁移 / 运镜参考（`ref2v` 传 1 条视频 + 最多 4 张角色/产品图）**：选 **`kling-v3-omni`**（`--quality-mode std|pro|4k`，带参考视频时服务端自动禁原生音效，可配 `--keep-original-sound`）。
- **二次元/插画风、最高 20 图角色/道具参考或 2K/4K 图生视频**：选 **`vidu-q4`**（`i2v`/`ref2v`，支持 `540p`–`4k`）或 **`vidu-q2-pro`**（支持 `multiframe` 与最多 20 图 `ref2v`）。
- **高性价比物理动态、2K 画面或 1–3 s 超短空镜**：
  - 2K 大动态 / 多图参考：**`hailuo-h3`**（`768P` 50 积分/s、`2K` 85 积分/s）；超低成本固定 6s/10s 空镜：**`hailuo-2.3`**（`768P` 仅 15 积分/s，仅 `16:9`）。
  - `1–3 s` 超短过场单镜（免裁切）：**`paiwo-v6max`**（支持 `1–15 s` 任意秒数）或 **`wan-3.0`**（`2–30 s`）。
- **视频续写（`clip2v`）与视频局部编辑（`video_edit`）**：选 **`sed2-5`**、**`gemini-omni-1.1-flash`**（支持传入参考视频 + 可选目标尾帧 `--last-frame`）、**`kling-v4`**、**`wan-3.0`** 或 **`happyhorse-1.1`**。

---

## 2. Seedance 家族模型规格与实测积分表

### 2.1 Seedance 家族 7 款模型规格

| 模型 ID | 对应版本与定位 | 支持模式 | 支持时长 | 常用分辨率 | 典型用途 |
|---|---|---|---|---|---|
| `sed2` | **Seedance 2.0 标准版（主力）** | `t2v, i2v, firstlast, ref2v, video_edit` | `4–15 s` | `480p` / `720p` / `1080p` / `4k` | **主力生产模型**：产品特写、手部交互、人物中远景/侧背影；人脸过审极稳、性价比最高 |
| `sed2-5` | **Seedance 2.5 旗舰版** | `t2v, i2v, firstlast, ref2v, video_edit, clip2v` | `4–30 s`（`video_edit` `-1`；`clip2v` `4–180 s`） | `480p` / `720p` | **重点镜头模型**：正脸对镜说话对口型（Method B）、黄金近景首帧 `i2v` |
| `sed2-mini` | Seedance 2.0 Mini | `t2v, i2v, firstlast, ref2v, video_edit` | `4–15 s` | `480p` / `720p` | 极低成本分镜预演、构图与动作抽卡探路（不允许 `adaptive` 画幅） |
| `sed2-fast` | Seedance 2.0 Fast | `t2v, i2v, firstlast, ref2v, video_edit` | `4–15 s` | `480p` / `720p` / `1080p` / `2k` / `4k` | 高质量首帧确定后的低成本 `i2v` 备选 |
| `sed2-5-draft` | Seedance 2.5 样片模式 | `t2v, i2v, firstlast, ref2v, video_edit, clip2v` | `4–30 s` | 仅 `480p` | 2.5 模型 480p 样片快速预览（自动传 `model_name="sed2-5", draft=true`） |
| `wonder-pro` | Seedance 2.0 导演专属 | `t2v, i2v, firstlast, ref2v, video_edit` | `4–15 s` | `720p` / `1080p` | 2.0 高规格备选（不允许 `adaptive` 画幅；视账号等级开放） |
| `wonder-ultra` | Seedance 2.5 导演专属 | `t2v, i2v, firstlast, ref2v, video_edit, clip2v` | `4–30 s` | `720p` / `1080p` | 2.5 1080p 高规格备选（视账号等级开放） |

### 2.2 Seedance 实测积分扣费表（2026-11 实测基准）

**铁律：任何正式生成前必须先调用 `estimate_credits`（或使用默认开启预估的 `scripts/updream.py generate`）。**

| 模型 | 模式 | 分辨率 | 每秒单价 | 4 s 实扣 | 5 s 实扣 | 说明 |
|---|---|---|---:|---:|---:|---|
| **`sed2`** | `ref2v` / `i2v` / `t2v` | `720p` | 110 | **440** | **550** | `ref2v` 与 `i2v` 价格完全相同；主力镜头首选 |
| **`sed2`** | `ref2v` / `i2v` | `480p` | 50 | **200** | **250** | 低成本测试 |
| **`sed2-5`** | `ref2v` | `720p` | 195 | **780** | **975** | 对口型（`audio: true` + 参考音频）与关闭音频同价 |
| **`sed2-5`** | `i2v` | `720p` | 150（实扣） | **600** | **750** | **注意估价偏差**：`estimate_credits` 接口当前按 `780/4s`、`975/5s` 报价，且 `wait_task` 不返回 `cost_credits`，但账户实际扣费为 `600/4s`、`750/5s` |
| **`sed2-5`** | `ref2v` / `i2v` | `480p` | 85 | **340** | **425** | 2.5 方案预测试（`sed2-5-draft` 同价） |
| `sed2-fast` | `ref2v` / `i2v` | `720p` / `480p` | 45 / 20 | 180 / 80 | 225 / 100 | 低成本备选（`max` 会员折扣价；原价 450/5s） |
| `sed2-mini` | `ref2v` | `720p` / `480p` | 30 / 15 | 120 / 60 | 150 / 75 | 极低价构图探路 |
| `wonder-pro` | `ref2v` / `i2v` | `720p` | 100 | 400 | 500 | 2.0 导演版 |
| `wonder-ultra` | `ref2v` / `i2v` | `720p` | 175 | 700 | 875 | 2.5 导演版 |

### 时长与裁切策略
- 成片里单镜通常只用 **1.6–2.8 秒**，但 Seedance 最短生成时长为 **`4 秒`**。
- 使用 Seedance 时，常规单镜一律生成 **`4 秒`**，在剪辑阶段避开首尾偶发微抖、截取中间最稳的约 2 秒；只有口播单镜超过 3.8 秒（如 4.5–5.0 秒结尾长句）或刻意两镜合一时才生成 `5 秒`。
- 若使用 `paiwo-v6max`（`1–15 s`）、`wan-3.0`（`2–30 s`）、`kling-v4` / `vidu-q4`（`3 s` 起）等支持更短秒数的非 Seedance 模型，仍建议留出至少 `0.5–1 s` 首尾余量便于剪辑对齐。

---

## 3. 非 Seedance 已适配模型能力、限制与预估积分表（23 款）

以下数据来自线上 `GET /ai/video-models` 与 `GET /credit/estimate` 免费实测（`max` 会员档位基准；实际单价可能随会员等级与是否附带参考视频/音效浮动，**提交前一律以 `estimate` 返回值为准**）。

> **验证级别说明**：非 Seedance 模型均已完成代码 schema 校验、网页端请求体对齐与服务端 `estimate_credits` 预估确认（未经真实扣费提交生成）；其中 `wan-2.6-ref2v` 服务端预估返回 `0`，属「仅代码层面适配」。内部测试模型 `test` 及画质增强/去字幕工具 `video-enhance-standard`、`video-enhance-pro`、`subtitle-erase-pro` 非生成式接口，插件显式拦截。

| 模型 ID | 线上列表 | 支持模式 | 时长(s) | 分辨率 / `quality_mode` | 原生音频 | 5s 代表预估积分（单价/s） | 关键特性与限制 |
|---|---:|---|---|---|---:|---:|---|
| `kling-v4` | ✅ | `t2v, i2v, firstlast, multiframe, ref2v, video_edit` | `3–30` | `720p, 1080p` | 无 | `1080p`: **675** (135/s) | 支持 `multiframe`（3–10 帧）；`ref2v` 至少含 1 图或 1 视频 |
| `kling-v3-omni` | ✅ | `t2v, i2v, firstlast, ref2v` | `3–15` | `quality_mode`: `std, pro, 4k` | `sound` | `std`: **200** (40/s)<br>`pro`: **250** (50/s)<br>`4k`+音: **1175** | `ref2v` 含视频时限 ≤4 图且禁 `sound`；支持 `negative_prompt`、`keep_original_sound` |
| `kling-v3.0-std` | ✅ | `t2v, i2v, firstlast` | `3–15` | `quality_mode`: `std, pro, 4k` | `sound` | `pro`: **250** (50/s) | 支持 `negative_prompt`、`cfg_scale` (`0–1`) |
| `kling-v3.0-turbo` | ✅ | `t2v, i2v` | `3–15` | `720P, 1080P` | 无 | `1080P`: **400** (80/s) | `i2v` 画幅跟随首帧 |
| `kling-o1` | ✅ | `t2v, i2v, firstlast, ref2v` | `5–10` | `quality_mode`: `std, pro` | 无 | `pro`: **250** (50/s) | `ref2v` 最多 7 图（带 1 视频时最多 4 图） |
| `kling-v2-5-turbo` | ✅ | `t2v, i2v` | `5, 10` | `quality_mode`: `std, pro` | 无 | `pro`: **225** (45/s) | 仅支持 5s / 10s；支持 `negative_prompt` |
| `wan-3.0` | ✅ | `t2v, i2v, firstlast, ref2v, video_edit` | `2–30` | `480P, 720P, 1080P` + `standard\|prime` | `sound` | `1080P/standard`: **400** (80/s)<br>`1080P/prime`: **800** (160/s) | 支持 `prompt_extend`；`video_edit` 自动跟随源视频时长 |
| `vidu-q4` | ✅ | `i2v, ref2v`（无 `t2v`） | `3–16` | `540p, 720p, 1080p, 2k, 4k` | `supports_audio` | `1080p`: **250** (50/s，原价 500) | 不支持纯文生视频；`ref2v` 最多 15 图 + 3 音频 |
| `vidu-q2-pro` | ✅ | `i2v, firstlast, multiframe, ref2v`（无 `t2v`） | `1–10` | `540p, 720p, 1080p` | `supports_audio` | `720p`: **200** / `1080p`: **250** | 支持 `multiframe`（3–10 图）与最多 20 图 `ref2v` |
| `paiwo-v6max` | ✅ | `t2v, i2v` | `1–15` | `360p, 540p, 720p, 1080p` | `supports_audio` | `1080p`: **300** (60/s) | PixVerse V6 Max，支持 1s 起任意整数秒与 `2:3`/`3:2` 画幅 |
| `hailuo-h3` | ✅ | `t2v, i2v, firstlast, ref2v` | `5–15` | `768P, 2K` | 无 | `768P`: **250** (50/s)<br>`2K`: **425** (85/s) | 别名 `minimax-h3`；`ref2v` 至少含 1 图或 1 视频 |
| `minimax-h3-max` | ✅ | `t2v, i2v` | `5–15` | `480P, 768P` | 无 | `768P`: **325** (65/s) | MiniMax H3 Max |
| `hailuo-2.3` | ✅ | `t2v, i2v` | `6, 10` | `768P, 1080P`（10s 仅 `768P`） | 无 | 6s `768P`: **90** (15/s)<br>6s `1080P`: **150** (25/s) | 仅固定 `16:9`（请求体不发 `aspect_ratio`）；10s 禁选 `1080P` |
| `happyhorse-1.1` | ✅ | `t2v, i2v, ref2v, video_edit` | `3–15` | `720P, 1080P` | 无 | `1080P`: **325** (65/s) | `ref2v` 支持 1–9 张图；`video_edit` 支持 1 视频 + 0–5 图 |
| `happyhorse` | ✅ | `t2v, i2v, ref2v, video_edit` | `3–15` | `720P, 1080P` | 无 | `1080P`: **875** (175/s) | 优先用性价比更高的 `happyhorse-1.1` |
| `gemini-omni-1.1-flash` | ✅ | `t2v, i2v, firstlast, ref2v, video_edit, clip2v` | `3–10` | `360p, 720p, 1080p, 4k` | 无 | `1080p`: **575** (115/s) | 画幅仅 `16:9` / `9:16`；`clip2v` 支持 `--ref-video` + 可选 `--last-frame` |
| `gemini-omni-flash` | ✅ | `t2v, i2v, ref2v, video_edit` | 固定 `10` | 固定 `720p` | 无 | 10s `720p`: **1500** (150/s) | 仅支持 10s、`720p`、`16:9`/`9:16` |
| `wan-2.7` | 候选 | `t2v, i2v, firstlast, ref2v, video_edit` | `5, 10, 15` | `720p, 1080p` | 无 | `1080p`: **450** (90/s) | 位于 `/ai/supported-models`；支持 `negative_prompt`、`keep_original_sound` |
| `wan-2.6` | 候选 | `t2v, i2v` | `5, 10, 15` | `720p, 1080p`（`t2v` 转像素 `size`） | `sound` | `1080p`: **225** (45/s) | 支持 `shot_type` (`single`/`multi`)、`negative_prompt` |
| `wan-2.5-preview` | 候选 | `t2v, i2v` | `5, 10` | `480p`(仅`i2v`), `720p, 1080p` | `sound` | `1080p`: **225** (45/s) | `t2v` 自动映射像素 `size` |
| `wan-2.2` | 候选 | `t2v, i2v` | 固定 `5` | `480p`(仅`i2v`), `720p`(仅`t2v`), `1080p` | 无 | `1080p`: **150** (30/s) | 固定 5s，低价备选 |
| `veo-3.1-preview` | 候选 | `t2v, i2v` | `4, 6, 8` | `720p, 1080p` | `sound` | 8s `1080p`: **1640** (205/s) | 画幅仅 `16:9` / `9:16`；支持 `enhance_prompt`、`negative_prompt` |
| `wan-2.6-ref2v` | 仅静态 | `ref2v` | `5, 10` | `720p, 1080p`（像素 `size`） | `sound` | 预估返回 `0`（仅代码适配） | 前端静态保留 schema，当前未在画布开放，不建议生产使用 |

---

## 4. 多账号配置与 `account` 参数路由规则

1. **在 Magpie「模型 → 供应商」页面管理多账号**：
   - 找到 **`UPdream`**（声明 0 个聊天模型，仅用于集中管理视频插件账号），点击登录并填写浏览器 `localStorage` 中的 `updream_access_token`、`updream_refresh_token` 及可选备注名（如 `主账号`、`二号机`）。
   - 支持添加多个账号、调整置顶默认顺序、单独启用/停用槽位；Magpie 后台与工具调用时均会自动用 `refresh_token` 续期并写回对应槽位，互不覆盖。
2. **凭据优先级（禁止轮询换号）**：
   - 显式传入 `account`（CLI `--account` / `UPDREAM_ACCOUNT` / MCP `account` 参数） > `create_video` 已绑定的 `task_id → 槽位` > 页面上**置顶且启用**的账号 > `plugins.json` 的 `options`（如 `tokenFile`） > `UPDREAM_*` 环境变量。
   - 页面尚未添加任何账号时，自动无缝回退到 `plugins.json` 现有配置。
3. **`account` 参数匹配方式与常用命令**：
   - 可传槽位键（`updream#a1b2c3`）、账号备注名（`二号机`）、页面别名、Token 末 4 位，或传 `"options"` 强制走 `plugins.json` 凭据。
   - 查看全部账号余额：`python3 $SKILL_DIR/scripts/updream.py account --all-accounts`（MCP：`updream_account({"all_accounts": true})`）。
   - 指定账号预估/生成：加 `--account 二号机`（或设环境变量 `UPDREAM_ACCOUNT=二号机`）。
   - **跨账号注意事项**：`upload_image` 返回的素材与画布项目归属对应账号，`upload`、`create_video`、`wait_task` 应保持同一账号（`create_video` 成功后插件已在内存记住 `task_id → slot`，且 `get_task`/`wait_task`/`cancel_task` 遇 404 会自动遍历其余启用账号兜底）。

---

## 5. 画幅强制规则、模型特殊约束与审核拦截回退

1. **`sed2-5` 的 `i2v` / `firstlast` 强制 `adaptive` 画幅**：
   - 调用 `sed2-5`（含 `sed2-5-draft`、`wonder-ultra`）跑 `i2v`/`firstlast` 时，接口强制 `aspect_ratio="adaptive"`，输出画幅严格跟随 `first_frame` 图片长宽比。传入 `first_frame` 前必须先把图片裁成目标比例（如竖屏 9:16 的 `768×1376` 或 `1080×1920`）。
   - 多数非 Seedance 模型（如 `kling-*`、`wan-3.0`、`vidu-*`、`paiwo-v6max`、`hailuo-h3`）在 `i2v` 模式下同样自动省略 `aspect_ratio` 并继承首帧长宽比（仅 `gemini-omni-1.1-flash` 的 `i2v` 例外保留 `16:9`/`9:16`）。
2. **Kling / Wan 的 `quality_mode` 档位参数**：
   - `kling-v3-omni`、`kling-v3.0-std`、`kling-o1`、`kling-v2-5-turbo` 不传 `quality` 分辨率字段，而是通过 `--quality-mode std|pro|4k`（对应 720P / 1080P / 4K）控制规格；若传了 `--resolution 720p|1080p|4k`，插件会自动映射为对应档位。
   - `wan-3.0` 同时支持 `--resolution 480P|720P|1080P` 与 `--quality-mode standard|prime`（`prime` 单价约为 `standard` 的 2 倍）。
3. **失败与被拒不扣分**：
   - 审核拦截、画布节点异常（`Task failed on canvas node`）或超时取消均扣 **0 积分**，`scripts/updream.py` 会记一行 `[FAILED]`（`credits=0`）方便留痕排查。
4. **`sed2-5` 漂亮人脸“版权限制”误判回退规则**：
   - `sed2-5`（及偶发 `sed2-fast`）在生成漂亮精致女性面孔或提示词含 `"高端生活方式品牌广告实拍 / 品牌广告里的女模特"` 时，偶发报错：`生成视频涉及版权限制，请更换参考素材或提示词后重试`
   - **标准处置**：
     1. 删去 `"品牌广告 / 女模特 / 明星"` 等商业肖像敏感词，改为 `"高品质居家生活摄影实拍，气质温柔出众"`，**最多重试 1 次**；
     2. 若第 2 次仍被拦截，**不要继续死磕 `sed2-5`**，立即将该镜头降级改用 **`sed2`**（实测 `sed2` 零误判且单价低 44%）。

---

## 6. 预算门禁、CSV 台账与返工上限

1. **台账格式（`credits_ledger.csv`）**：
   - 列头固定为：`timestamp,purpose,model,duration,mode,task_id,credits,output_file`
   - 每部影片设定明确的积分上限（如 `--budget-limit 10000`），并统一命名 `purpose` 前缀（如 `f02_seg01_s01_v1`，前缀 `f02_`）。
   - 每次提交前必须校验：`本片前缀已用积分 + 本次预估积分 <= 本片预算上限`。测试参数组装与预算门禁时可用 `generate --dry-run`（只做本地校验与免费预估，不调 `create_video`）。
2. **返工次数硬上限（最多返工 3 次 = 同一画面最多共 4 次生成）**：
   - 每次返工必须在台账 `purpose` 中写明失败原因与修改方案（CLI 用 `--rework-reason "v1左下角多出一盆花，改为干净窗台仅唯一一盆"`）。
   - 如果连续 1–2 次返工仍出现同类结构性崩坏（如 `ref2v` 人货比例失真、复杂换鞋/手部动作变形、植物缓慢开花），不要原模式硬抽卡——立即切换生成策略（例如先用生图/修图定好精确比例与姿态的首帧图，改走 `i2v`）。
3. **瞬断恢复（零重复扣费）**：
   - 并发轮询 `wait_task` 偶遇 `ECONNRESET` 时，服务端任务仍在正常渲染。先看日志里的 `task_id`，用 `updream.py wait --task-id <id> --node-id <nid> [--account <acc>] ...` 原地恢复下载与记账，切勿盲目重新 `generate` 造成双倍扣费。
