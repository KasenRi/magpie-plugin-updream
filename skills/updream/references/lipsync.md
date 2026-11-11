# UPdream (Seedance) 对口型方案（Method B）与音频铁律

## 1. 两条不可违背的音频铁律

1. **Seedance 原生生成的声音永远不进成片**：成片声音 100% 只用我们自己的配音母带与混音（`voice-master.wav` / `mix-master.wav`）。所有剪辑切片与合成命令一律加 `-an` 剥离源音轨。
2. **除对镜说话的对口型镜头外，其余所有镜头一律 `audio: false`**：`scripts/updream.py` 默认锁死 `audio=False`，只有在同时传入 `--lipsync-audio` 和 `--ref-audio <slice.mp3>` 时才允许开启底层音频通道。

---

## 2. 为什么不能用 `audio: false` + 参考音频（方法 A 已证伪）

在 `480p` 逐 0.1 秒抽帧实测（`f013_test_s03_lipsync_480p`）中已确认：
- 当 `audio: false`（底层 `supports_audio: false`）时，即使传入 `reference_audios` 并在提示词中要求按 `[@音频1]` 对口型，Seedance 也会关闭底层音画联合解码器，人物嘴部只做与语音无关的随机张合——**在开口元音处完全闭嘴，反而在句末静音段持续张嘴嘟嘴乱动**。
- **结论**：不要再花积分测试 `audio: false` 对口型；所有对镜说话镜头直接采用下述 **方法 B**。

---

## 3. 方法 B 标准工作流（`audio: true` 驱动口型 → 包络互相关对齐 → `-an` 剥离音轨）

### 第 1 步：从配音母带切出本句参考音频（`.mp3`）
根据校准后的词级时间表（如 DTW 对齐的 `words.json`），从我方 `voice-master.wav` 切出该镜头对应的口播片段，前后各留 `0.10–0.20 s` 静音余量，导出为 `.mp3`（单文件 ≤ 20 MB）：

```bash
ffmpeg -y -ss 3.70 -t 2.60 -i audio/voice-master.wav -ac 1 -ar 24000 -b:a 128k refs/lipsync_s03.mp3
```

### 第 2 步：上传音频并提交对口型生成
- **CLI 方式**（`scripts/updream.py` 会自动调用 `upload_image` 把本地 `.mp3` 上传为 `https://...` 外链并填入 `reference_audios`）：
  ```bash
  python3 .claude/skills/updream/scripts/updream.py generate \
    --env /path/to/.env \
    --ledger work/credits_ledger.csv \
    --budget-limit 10000 \
    --purpose f02_seg03_s03_lipsync_v1 \
    --model sed2-5 \
    --mode ref2v \
    -d 4 \
    --resolution 720p \
    --aspect-ratio 9:16 \
    --lipsync-audio \
    -r refs/character.png \
    -r refs/product.png \
    -a refs/lipsync_s03.mp3 \
    -o work/clips_raw \
    -p "竖屏9:16，手机拍摄，固定机位，自拍视角，镜头不推不拉不移动，可带轻微手持晃动……参考[@图片1]人物形象，服装、发型和整体风格统一……身旁同深度桌面摆放唯一一件[@图片2]产品（高约35cm，比人头略高，全程完整入镜）。她正对镜头自然亲切地按照[@音频1]说出台词：“……”，嘴唇开合口型与[@音频1]每个字音节一致，不嘟嘴不做夸张表情，说完最后一个字后自然闭嘴露出温柔浅笑。上午柔和侧窗光，无逆光光晕，无文字。"
  ```
- **MCP 直调方式**：先调 `mcp__updream__upload_image(path="/abs/path/lipsync_s03.mp3")` 拿到 `url`（`upload_image` 原生支持 `.mp3`），再调 `mcp__updream__create_video(..., audio=True, reference_audios=[url])`。
- **模型回退**：首选 `sed2-5`（口型细节与面部微表情最自然）；若遇 `"生成视频涉及版权限制"`，去敏提示词重试 1 次，仍被拒则改用 `--model sed2`。

### 第 3 步：语音包络互相关求偏移与句间分段对齐
Seedance 生成的视频通常会在开头多垫 `0.10–0.35 s` 准备动作，且在长句中间的逗号停顿处，模型的停顿时长可能比我方配音多或少 `0.10–0.35 s`。直接硬切第 0 秒会导致口型错位。

运行内置对齐脚本 `scripts/lipsync_align.py`（可直接传入总配音 `voice-master.wav` 与该镜在成片中的切点 `--ref-start` / `--ref-duration`）：

```bash
python3 .claude/skills/updream/scripts/lipsync_align.py \
  work/clips_raw/f02_seg03_s03_lipsync_v1.mp4 \
  audio/voice-master.wav \
  --ref-start 3.60 \
  --ref-duration 2.80 \
  --fps 30 \
  --scale 1080:1920 \
  -o work/clips_cut/03_s03_lipsync.mp4
```

脚本会自动执行两种策略之一：
1. **单句或停顿一致（`single_offset`，分句偏移差 `<= 0.06 s`）**：
   - 直接以最佳互相关偏移 `-ss <start_s>` 裁切目标帧数，保持 `1.00x` 原速，误差通常 `<= 0.03 s`（约 1 帧内）。
2. **多子句逗号停顿漂移（`piecewise_pause_warp`，分句偏移差 `> 0.06 s`）**：
   - **说话子句段保持 `1.00x` 原速**（`setpts=PTS-STARTPTS`，绝不在人物张嘴说话时快放或慢放导致嘴皮抽搐）；
   - **仅在两句之间的闭嘴/停顿间隙做平滑变速**（`setpts=<factor>*(PTS-STARTPTS)`），并在句末闭嘴浅笑段按需自然延展（`tpad=stop_mode=clone`），无缝拼成精确帧数且无跳切。

### 第 4 步：核验与剥离音轨（`-an`）
- `lipsync_align.py` 输出的所有命令和 `-o` 渲染文件均强制带 `-an`（零音轨）。
- 如需肉眼复核关键重音字（如开口元音、双唇音、句末闭唇时刻），可按 `0.1 s` 步长抽嘴部特写条对照配音能量确认句末已自然闭嘴微笑。
