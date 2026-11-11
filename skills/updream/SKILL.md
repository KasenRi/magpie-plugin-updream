---
name: updream
description: "通过 UPdream 调用全平台视频模型（字节 Seedance sed2 / sed2-5 主力，以及 Kling 4.0 / v3 Omni、Wan 3.0、VIDU Q4 / Q2 Pro、Hailuo H3 / 2.3、PixVerse V6 Max、HappyHorse、Omni Flash、Veo 3.1 等 30 款模型）规划并生成视频镜头：支持 Magpie 多账号切换（--account）、文生/首帧/首尾帧/智能多帧/多模态参考/视频编辑/视频续写、积分预估与预算门禁、多镜头并行生成、对口型包络对齐、全尺寸首末帧与运动量质检、返工与 CSV 记账。当用户输入 /updream，或提到 UPdream、Seedance、sed2、sed2-5、Kling/可灵、Wan/万相、VIDU、Hailuo/海螺、PixVerse/拍我、多图/多视频参考生视频（ref2v）、首帧图生视频（i2v）、智能多帧（multiframe）、口播对口型视频生成、切换 UPdream 账号或核算视频生成积分时，务必调用本技能。"
argument-hint: <work-dir> [plan|account|models|estimate|generate|qa|lipsync|ledger]
---

# /updream — UPdream 多模型与多账号视频镜头生成工作流

本技能用于任意影片（带货种草、生活方式、剧情短片、动漫创意等）调用 UPdream 平台已适配的 **30 款视频模型**（默认主力 **Seedance `sed2` / `sed2-5`**，并覆盖 Kling、Wan、VIDU、Hailuo、PixVerse、HappyHorse、Omni、Veo 等），支持 Magpie 多账号选择，统一执行 **规划镜头 → 预估积分 → 并行生成 → 抽帧质检 → 按规返工 → 台账记账** 闭环。

设技能目录 `SKILL_DIR=${UPDREAM_SKILL_DIR:-.claude/skills/updream}`（即本 `SKILL.md` 所在目录），工作目录 `WORK=$1`（含分镜、素材与台账）。

---

## 按需阅读的参考手册（Progressive Disclosure）

动手选模型、写提示词、排预算、切账号、做对口型或看质检图前，按阶段读取对应文档：
- **全模型选型表（30 款）、单价、时长画幅/档位限制、多账号 `account` 规则、版权拦截回退与台账规范**：读 [`references/pricing.md`](references/pricing.md)
- **写实人像（P4 规范）、手机固定机位、产品主次、人货真实比例、禁生长/开花提示词规范**：读 [`references/prompting.md`](references/prompting.md)
- **对镜口播对口型（Method B）与句间停顿分段变速对齐**：读 [`references/lipsync.md`](references/lipsync.md)
- **三帧条 + 1:1 首末帧差分 + `tblend` 运动量质检与旧素材复用**：读 [`references/qa.md`](references/qa.md)

---

## 两种调用通道与多账号支持

1. **CLI 脚本（推荐用于批量并行、子进程与自动记账）**：`python3 $SKILL_DIR/scripts/updream.py`
   - 通过 `--env /path/to/.env`（或 `UPDREAM_ENV`）读取 `MAGPIE_API_KEY` / `MAGPIE_URL`，通过 `--ledger`（或 `UPDREAM_LEDGER`）指定 `credits_ledger.csv`。
   - **多账号切换**：所有联网子命令支持 `--account <槽位键|备注名|别名|末4位|options>`（或环境变量 `UPDREAM_ACCOUNT`）；不传默认使用 Magpie「模型 → 供应商 → UPdream」页面置顶且启用的账号；`account --all-accounts` 可一次查看全部已登录账号余额。
   - 内置全模型参数校验、`generate --dry-run` 免费预演、预算门禁（按 `--purpose-prefix` 或自动截取 `purpose` 前缀汇总）、音频禁令保护、瞬断重试与文件锁并发记账。
2. **宿主 MCP 工具（适合单次查询或交互式单步操作）**：
   - `mcp__updream__account`（支持 `all_accounts: true`）、`mcp__updream__list_video_models`、`mcp__updream__upload_image`（支持传图片及 `<=20MB` 的 `.mp3` 返回外链作 `reference_audios`）、`mcp__updream__estimate_credits`、`mcp__updream__create_video`、`mcp__updream__wait_task`、`mcp__updream__get_task`、`mcp__updream__cancel_task`。
   - 所有 MCP 工具均支持可选 `account` 参数；直接调 MCP 生成时，同样必须先 `estimate_credits` 核对预算，并在完成后写入项目的 `credits_ledger.csv`。

---

## 标准六步流程

### 1. 规划镜头与复用检索（先读 `references/prompting.md` 与 `references/pricing.md`）
- **先查可复用素材**：检索项目既有 `clips_raw/` 或试片目录，合格片段直接 0 积分复用。
- **主次与景别分配**：带货片以产品为主角（占 70%–85% 镜头）；人物仅作生活方式陪衬（背影、侧身、焦外虚化或只露手脚，声明“不看镜头”），全片仅留 1–2 句主观感受正对镜头口播。“朋友来家里”类引子直接拍产品，不拍多余人物。
- **选模型与模式（详见 `references/pricing.md` 第 1–3 节）**：
  - 常规写实产品、手部交互、人物中远景/侧背影：主力 **`sed2`** + `ref2v`（有人物时 `[@图片1]`=定妆角色图、`[@图片2]`=产品图；人物一致性写“服装、发型和整体风格统一”，**禁写“像同一个人”**）。成片单镜约 2 s 时，Seedance 统一生成最短 **`4 s`** 再裁切。
  - 需严格锁死已验收画面状态（如已完全开好的花、特定未开状态、精确人货比例首帧）：改走 `i2v`（`--first-frame`）。
  - 正脸对镜说话对口型：首选 **`sed2-5`** + `ref2v` + Method B（`--lipsync-audio -a slice.mp3`）；若遇 `sed2-5`“版权限制”拦截，改措辞重试 1 次，仍被拒即改用 `sed2`。
  - 特殊规格需求按需选用非 Seedance 模型：超长镜或 3–10 图 `multiframe` 用 **`kling-v4`** / **`wan-3.0`**（`--quality-mode standard|prime`）；参考视频动作迁移用 **`kling-v3-omni`**（`-v ref.mp4 --quality-mode pro`）；多图动漫/2K-4K `i2v` 用 **`vidu-q4`** / **`vidu-q2-pro`**；2K 物理动态用 **`hailuo-h3`**；1–3 s 短过场用 **`paiwo-v6max`**；视频续写 `clip2v` 用 **`sed2-5`** 或 **`gemini-omni-1.1-flash`**。

### 2. 确认账号、预估积分与预算核验（先读 `references/pricing.md`）
- 多账号环境下可先跑 `account --all-accounts` 核对目标账号余额，确定本片积分上限（如 `--budget-limit 10000`）与 `purpose` 前缀（如 `f02_`）。
- 对所有待生成段落先跑 `estimate` 或 `generate --dry-run`（0 积分），确认 `本片已用 + 全批预估 + 返工预留 <= 预算上限`：
  ```bash
  UPDREAM_ENV=/path/to/.env UPDREAM_LEDGER=$WORK/credits_ledger.csv \
    python3 $SKILL_DIR/scripts/updream.py estimate \
    --account 主账号 --purpose f02_seg01_s01_v1 --budget-limit 10000 \
    --model sed2 --mode ref2v -d 4 --resolution 720p --aspect-ratio 9:16 \
    -r refs/character.png -r refs/product.png -p "..."
  ```

### 3. 提交生成（独立镜头一律并行）
- 单条 `4 s 720p` 约需 **3–5 分钟**。所有互不依赖的镜头**同时后台并行启动**（每镜一个后台进程）；仅“需先看结果再定方案”的环节（480p 探路测试、抽帧接 `i2v`、质检返工）串行等待。
- 对口型镜头生成后，立即运行包络互相关与分段停顿对齐并剥离源音轨（详见 `references/lipsync.md`）：
  ```bash
  python3 $SKILL_DIR/scripts/lipsync_align.py \
    $WORK/clips_raw/f02_seg03_s03_lipsync_v1.mp4 $WORK/audio/voice-master.wav \
    --ref-start 3.60 --ref-duration 2.80 --fps 30 --scale 1080:1920 \
    -o $WORK/clips_cut/03_s03_lipsync.mp4
  ```

### 4. 抽帧与运动量质检（先读 `references/qa.md`）
- 生成后严禁盲剪，先对 `clips_raw/` 跑质检脚本生成**开头/中间/结尾三帧条**、**1:1 首末帧全尺寸对比+差分图**与 **`tblend` 运动量报告**：
  ```bash
  python3 $SKILL_DIR/scripts/qa_clip.py $WORK/clips_raw/ -o $WORK/qa_out
  ```
- 必打开 `_first_last_full.jpg` 与 `_strip3.jpg` 目视核查：植物有无缓慢开花/变大（`SUBJECT_GROWTH_OR_BLOOMING`）、有无违规运镜、**拿成年人人头（约 23 cm）对照同框产品比例是否失真**、手脚有无穿插或物件融化消失、有无第二件产品/可读文字/误看镜头。

### 5. 按规返工（最多返工 3 次）
- 半段可用的素材先裁出合格区间复用，只重做坏掉的子镜头。
- 同一画面**最多返工 3 次（连首试共 4 次）**，每次返工必须传 `--rework-reason "具体问题与改法"` 记入台账；连续出现比例失真或物理变形时，立即改用合成/生成首帧走 `i2v`，不要原词硬抽。

### 6. 台账复盘与结算
- 交付前运行 `python3 $SKILL_DIR/scripts/updream.py ledger --ledger $WORK/credits_ledger.csv --purpose-prefix <prefix>_ --budget-limit <cap>` 核对本片实耗积分、失败单（0 扣分）与返工明细。

---

## 十条硬规则（Checklist）

1. **按场景选已适配模型并锁定账号**：写实带货与对口型默认主力 `sed2` / `sed2-5`，长镜/多帧/动作迁移等从 `references/pricing.md` 已适配的 30 款模型中选型（禁用内部 `test` 及后处理工具 ID）；多账号场景用 `--account` 固定目标账号，严禁按次轮换账号。
2. **先 `estimate` 再 `generate`**：严守 `已用 + 预估 <= 预算上限`；注意 `sed2-5` `i2v` 及多数非 Seedance `i2v` 输出画幅跟随首帧图，传入前必须预裁成目标长宽比。
3. **原生音频绝不进成片**：除 Seedance 对口型镜传 `--lipsync-audio -a <mp3>`（或明确需独立测试模型原生音效时显式传 `--allow-native-audio`）外，一律保持 `audio: false`；`audio: false` 加参考音频不会对口型；剪辑一律加 `-an`。
4. **手机固定机位**：每条写 `"手机拍摄，固定机位，镜头不推不拉不移动，可带轻微手持晃动"`，禁写推/拉/环绕/升降/跟拍/延时摄影/电影感/cinematic。
5. **漂亮且真实的光学肤质**：用清透淡妆、缎面肤质、柔和侧窗光；禁用“逆光金色光晕、柔焦雾化、水光肌”，也禁用“纯素颜、雀斑、黑眼圈、阴天平光”。
6. **植物禁生长开花**：禁用“盛放、绽放、开花、舒展、呼吸”；写明“花早就已经完全开好，大小形状开合程度全程不变”，优先 `i2v`，动态须有可见物理原因（喷雾水珠、轻碰花盆）。
7. **人货同框锁死真实尺寸**：提示词写明产品厘米尺寸（如“高约 35 cm，比人头略高”）且与人同深度并排，质检用人头（~23 cm）核验比例。
8. **画面纯净与物理常识**：全片唯一一件产品，无宠物、无文字、零手物穿插；养护浇水须沿盆边低位浇土（喷雾打花瓣仅限展示镜）。
9. **返工封顶与留痕**：单镜最多返工 3 次（共 4 次），理由必入 CSV 台账。
10. **密钥绝对隔离**：密钥仅存于项目 `.env`（`chmod 600`）或 Magpie 供应商凭据仓，严禁读取打印、严禁复制进 Skill 目录、严禁写入任何日志或文档。
