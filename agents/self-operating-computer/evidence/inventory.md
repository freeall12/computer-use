# Self-Operating Computer —— 证据清单（evidence/inventory.md）

> 对象：`github.com/OthersideAI/Self-Operating-Computer`（MIT）。
> 基线：v1.5.8（setup.py:13），commit `fac568eea7da5e24f8bc91bfc1211b65679177eb`（2025-09-19 12:31 -0700，shallow clone HEAD，亦为上游最后一个 commit）。
> 方法：只读静态分析上游开源源码 + 全量 git 历史（645 commits，`git fetch --unshallow`）+ tag 树抽查（v1.0.1 / v1.1.0 / v1.2.0 / v1.2.6 / v1.3.2 / v1.4.6）。分析 clone 位于 `/tmp/soc-src`，未运行任何模型调用、未修改本机文件。
> 所有 `文件:行号` 相对上游仓库根，对应 commit `fac568e`；vendor 副本逐字节一致（`source/self-operating-computer/vendor/`），行号通用。

---

## A. 仓库与许可证

| # | 事实 | 证据 |
|---|---|---|
| A1 | 许可证 MIT，`Copyright (c) 2023 OthersideAI` | `LICENSE:1,3`；全文 vendor 于 `vendor/LICENSE-mit.txt` |
| A2 | 版本 1.5.8 | `setup.py:13`（`version="1.5.8"`）；tag `v1.5.8`（2025-02-28） |
| A3 | HEAD commit 与时间 | `git log -1` → `fac568e` 2025-09-19（"Fix typo in README description"） |
| A4 | 首个提交 2023-11-03 | `git log --reverse` → `88a81ce "Initial commit"` |
| A5 | 自述定位 | `README.md:8` "Released Nov 2023… one of the first examples of full computer-use" |
| A6 | 包结构 | `find operate -name '*.py'` = 15 个文件；最大 `operate/models/apis.py` 1139 行 |
| A7 | 唯一二进制 | `operate/models/weights/best.pt`（YOLOv8 权重，package_data，`setup.py:24-26`）——未 vendor |
| A8 | CLI 入口 | `setup.py:19-22` entry_points `operate=operate.main:main_entry` → `operate/main.py:9-56` |
| A9 | 上游自述兼容性 | `README.md:188` "compatible with Mac OS, Windows, and Linux (with X server installed)" |

## B. 主循环与分派

| # | 事实 | 证据 |
|---|---|---|
| B1 | `while True` 主循环 | `operate/operate.py:107-131` |
| B2 | `loop_count > 10` 强制跳出（最多 11 轮） | `operate/operate.py:119-121` |
| B3 | 每动作前 `time.sleep(1)` | `operate/operate.py:141` |
| B4 | 分派四分支：press/hotkey、write、click、done | `operate/operate.py:148-170` |
| B5 | `done` 打印 summary 并 `return True` 终止 | `operate/operate.py:163-170` |
| B6 | unknown 操作打印错误并终止（"unknown operation response :("） | `operate/operate.py:172-179` |
| B7 | 循环层 catch 一切异常 → 打印 → break（无重试） | `operate/operate.py:122-131` |
| B8 | `session_id` 全链路传递但恒 `None` | `operate/operate.py:105,111-113`；`apis.py:39,42,45,48,51,54,58,61,64` |
| B9 | verbose 模式逐环打印 | `operate/operate.py:108-109,135-139` |
| B10 | voice 模式：`whisper_mic.WhisperMic().listen()` 仅替代 objective 输入 | `operate/operate.py:52-62,84-91` |
| B11 | `--prompt` 直填目标时跳过欢迎对话框 | `operate/operate.py:64-73,81-82` |
| B12 | voice 模式强制 OPENAI_API_KEY（含 Whisper 转写走 OpenAI） | `operate/config.py:135-144` |
| B13 | 缺 key → prompt_toolkit `input_dialog` 收集 | `operate/config.py:163-169` |
| B14 | key 明文追加写 `.env`（`f"\n{key_name}='{key_value}'"`） | `operate/config.py:184-187` |

## C. 动作语法（prompt 内嵌协议）

| # | 事实 | 证据 |
|---|---|---|
| C1 | "The `pyautogui` library will be used to execute your decision. Your output will be used in a `json.loads` loads statement." | `operate/models/prompts.py:16,74,137`；`apis.py` 内 user prompt 同句 `prompts.py:199,206` |
| C2 | STANDARD 档四操作定义（click x/y 百分比、write content、press keys、done summary） | `prompts.py:11-66` |
| C3 | OCR 档（默认）：click 用 `text`，"nothing to click" 兜底 | `prompts.py:132-196`（尤其 :139-141） |
| C4 | LABELED/SoM 档：click 用 `label`（`~x` 红框标签） | `prompts.py:69-128`（尤其 :76-78,117） |
| C5 | 返回动作数组 `[]`，可一个或多个 | `prompts.py:38,93,156` |
| C6 | 平台自适应：Darwin → `command`/`["command","space"]`/Mac；Windows/Linux → `ctrl`/`["win"]` | `prompts.py:215-226` |
| C7 | prompt 变体选择：`gpt-4-with-som`→LABELED；ocr 族/claude-3/qwen-vl→OCR；其余→STANDARD | `prompts.py:228-250` |
| C8 | 首条消息告知"你在终端里，用 OS 搜索离开" | `prompts.py:198-203` |
| C9 | 注意事项：默认 Chrome、新标签写 URL、反思前动作、点错别重试 | `prompts.py:187-193` |
| C10 | "Don't respond saying you're unable to assist"（三套 prompt 均有） | `prompts.py:63,125,193` |
| C11 | 滚动无专用操作，仅 TODO 注释提及 `press ['pagedown']` | `prompts.py:131` |
| C12 | 遗留死代码 `parse_operations`：v1.0 行式协议（CLICK/TYPE/SEARCH/DONE）解析器，现行零调用 | `operate/utils/misc.py:11-40`；v1.0.1 `operate/main.py` VISION_PROMPT（CLICK `{"x":"50%",...}`/`TYPE "…"`/`SEARCH "…"`/`DONE` 行式语法，含硬编码 Chrome 地址栏坐标 `{x:"50%","y":"9%"}`） |

## D. 模型矩阵与视觉接口

| # | 事实 | 证据 |
|---|---|---|
| D1 | 9 模型分发表 + `ModelNotRecognizedException` | `operate/models/apis.py:34-65`、`operate/exceptions.py` |
| D2 | 默认模型 `gpt-4-with-ocr` | `main.py:18`；README.md:148-150 |
| D3 | gpt-4 档：gpt-4o + presence_penalty=1, frequency_penalty=1，直出百分比坐标 | `apis.py:68-142`（:108-113） |
| D4 | OCR 定位：`easyocr.Reader(["en"])` 每次点击重新实例化；`get_text_element` 子串匹配、循环不 break（取最后命中）；坐标=边界框中心÷图宽高 round 3 | `apis.py:377-391`；`operate/utils/ocr.py:46-56,81-98` |
| D5 | claude-3 档 OCR 只取文本前 3 字符匹配（"higher success rate" 注释） | `apis.py:990-993` |
| D6 | SoM：YOLOv8 `best.pt` 经 `pkg_resources` 加载；`add_labels` 标注；标签 miss → fallback；**`apis.py:778` 的 `return processed_content` 在 for 循环内——每轮只处理第一个操作**（上游缺陷） | `apis.py:653-654,666,717-778` |
| D7 | qwen-vl：DashScope 兼容模式 `qwen2.5-vl-72b-instruct` | `apis.py:188-191`；`config.py:87-93` |
| D8 | claude-3：5MB 限制→缩至宽 2560 JPEG q85；system prompt 走独立参数；JSON 解析失败用"纠错 prompt"重问 | `apis.py:884-911,939-968` |
| D9 | gemini-pro-vision：system prompt 作为首条 generate_content 内容；`response.text[1:]` 硬剥首字符 | `apis.py:262-302`（:282-290） |
| D10 | llava（Ollama 本地）：消息附图片路径，调用后置 `images=None` 防 Ollama 超时；失败无 fallback 仅打印 | `apis.py:790-865`（:830,848-852） |
| D11 | `agent-1` 占位符 `return "coming soon"` | `apis.py:55-56` |
| D12 | 兜底链：非 OpenAI 档异常 → `gpt_4_fallback`（messages[0] 换 gpt-4o system prompt）→ `call_gpt_4o`；claude-3 先做消息形状转换（image source→image_url） | `apis.py:1077-1090`、claude 转换 :1034-1060 |
| D13 | gpt-4o 自身失败 → **无界递归重试**（`return call_gpt_4o(messages)`），无次数上限 | `apis.py:131-142`（同型 :253-260,304-311,417-424,780-787） |
| D14 | `clean_json` 剥 ```json 围栏 + 逐行 trim | `apis.py:1117-1139` |
| D15 | 消息史：assistant 原文（clean 后）append；用户消息带新截图 base64——上下文线性膨胀，无裁剪 | `apis.py:106,127,350,362-364,411-413` |

## E. 观察与动作（截图 + 输入合成）

| # | 事实 | 证据 |
|---|---|---|
| E1 | 截图三分支：win `pyautogui.screenshot()`；linux Xlib `Display().screen()` 尺寸 + PIL `ImageGrab.grab`（"prevent scrot dependency"）；mac `screencapture -C`（含光标） | `operate/utils/screenshot.py:11-27` |
| E2 | 不支持平台仅 print 跳过（返回空文件路径） | `screenshot.py:26-27` |
| E3 | `compress_screenshot`：透明通道垫白底 JPEG q85 | `screenshot.py:30-42` |
| E4 | `write`：`content.replace("\\n","\n")` 后逐字符 `pyautogui.write(char)` | `operate/utils/operating_system.py:10-16` |
| E5 | `press`：全部 `keyDown` → `sleep(0.1)` → 全部 `keyUp`（combo 语义） | `operating_system.py:18-26` |
| E6 | `mouse`→`click_at_percentage`：`pyautogui.size()` 百分比→像素（`int(w*pct)`） | `operating_system.py:28-50` |
| E7 | moveTo(duration=0.2) 直线移动 + 0.5s 装饰性画圈（circle_radius=50）+ click 圆心 | `operating_system.py:39-63`（:52-61） |
| E8 | 输入合成所有异常仅 print 吞掉（动作失败对循环不可见） | `operating_system.py:15-16,25-26,36-37,62-63` |
| E9 | TCC：Screen Recording + Accessibility 授予运行终端 app（README 安装步骤图文） | 上游 `README.md:46-51`、`readme/terminal-access-*.png` |
| E10 | 依赖钉死：`PyAutoGUI==0.9.54`、`easyocr==1.7.1`、`ultralytics==8.0.227`、`rubicon-objc==0.4.7`、`prompt-toolkit==3.0.39` | `requirements.txt` |
| E11 | voice 依赖单独文件（仅 `whisper-mic` 一行）+ portaudio 系统依赖说明 | `requirements-audio.txt`；上游 README.md:117-143 |

## F. 评测与遗留

| # | 事实 | 证据 |
|---|---|---|
| F1 | `evaluate.py` 两个内置用例 + GPT-4V-as-judge（`guideline_met` 布尔 + reason） | `evaluate.py:13-16,21-25` |
| F2 | 评测流程：子进程 `operate -m <model> --prompt "<objective>"` → 读最后截图 → gpt-4o 判定 | `evaluate.py:118-137`（:91-112 判定函数） |
| F3 | `ModelNotRecognizedException` 唯一自定义异常 | `operate/exceptions.py:1-15` |
| F4 | Config 单例（`__new__` 实现）+ dotenv + 实例变量兜底 | `operate/config.py:23-48` |
| F5 | `.example_env`（v1.1.0 树内）→ 现行为 `.env` 追加写 | v1.1.0 `git ls-tree`；`config.py:184-187` |

## G. 版本演进（tag 树抽查）

| tag | 日期 | 关键变化 | 证据 |
|---|---|---|---|
| v1.0.1 | 2023-12-06 | 行式协议 CLICK/TYPE/SEARCH/DONE；硬编码 Chrome 坐标；仅 gpt-4 | v1.0.1 `operate/main.py` VISION_PROMPT |
| v1.1.0 | 2024-01-07 | voice 模式（whisper-mic） | v1.1.0 `main.py:21-26`、`requirements-audio.txt` |
| v1.2.0 | 2024-01-16 | JSON 数组协议（click/write/press/done）+ 多模型分发 + SoM | v1.2.0 `apis.py:41-48`、README "Set-of-Mark Prompting" 节 |
| v1.2.6 | 2024-01-24 | OCR 方法引入（`utils/ocr.py` 首次出现） | `git log --diff-filter=A -- operate/utils/ocr.py` → tag --contains |
| v1.3.0 | 2024-02-08 | OCR 成默认档（`default="gpt-4-with-ocr"`） | v1.3.x `main.py` argparse default |
| v1.4.0 | 2024-03-20 | claude-3 支持（roywei PR #180 合入） | `git log --grep claude` e116564 等 |
| v1.5.0 | 2024-12-17 | o1 / `o1-with-ocr` | `git show v1.5.0` 523d1af/ac71d7a |
| v1.5.8 | 2025-02-28 | gpt-4.1、qwen-vl、截图压缩（4c471cc）；此后仅 README 微调至 2025-09 | `git log` 9a38c7b,6e1c7c7,4c471cc |

## H. 负证据判定（任务假设的三个特性不存在）

> 结论：**OS Mode、AT-SUMMARIZER、agent exchange 在上游全部历史中不存在。** 五面法核查：

| 面 | 核查方式 | 结果 |
|---|---|---|
| 全历史文本 | `git log --all -S "AT-SUMMARIZER"` / `-S "os-mode"` / `-S "SUMMARIZER" -i` / `git grep` 遍历 645 commits | **0 命中** |
| 路径 | `git log --all -- '**/os_mode*'`、`git ls-tree` v1.1.0/v1.2.0/v1.3.2 | 无任何 os_mode/hosted 目录 |
| 分支 | `git branch -r` | 仅 `origin/main` 一条线 |
| 模型面 | 全历史模型字符串 = gpt-4 / som / ocr 族 / claude-3 / qwen-vl / gemini / llava / agent-1 | 无 hosted/os-mode 档 |
| 最接近物 | `agent-1` 占位符 `return "coming soon"`（apis.py:55-56） | 唯一"未来 agent 化"痕迹，无实现 |

**判定**：任务简报中"OS Mode（AT-SUMMARIZER 等 harness 变体）、agent exchange 机制"系对本项目的误记（可能混自其他同期项目）。本分册以仓库实际内容为准：harness 变体 = 三套 system prompt（STANDARD/OCR/LABELED），"exchange" = 无。

## I. 安全面零命中（词频核查）

```bash
cd /tmp/soc-src
grep -rniE "\b(lease|approval|kill.?switch|allowlist)\b" operate/ | wc -l        # 0
grep -rniE "\b(lease|approval|kill.?switch|allowlist|verify|replay|guard)\b" operate/ | wc -l  # 0
```

对照：12 家分册（`agents/*/computer-use.md`）的安全机制词汇——租约（ZCode/MiniMax/Kimi/Cursor/Grok）、possibly_sent 防重放（ZCode）、generation fencing（MiniMax）、verify_after（Synara/Qoder）、tier 白名单（Claude）、URL 禁区（Qoder/Codex）——在本仓库**零对应物**。唯一形似的 `prompt_and_save_api_key`（config.py:163）是凭据收集而非动作授权。

## J. 方法与合规

1. 只读静态分析上游 MIT 开源仓库；未运行框架（无模型调用、无 pyautogui 执行）、未抓包、无凭据接触。
2. vendor 副本 15 文件 `cmp` 逐字节一致；排除二进制权重 `best.pt`；LICENSE 全文原样保留（MIT 无附加要求）。
3. 引用上游文本均为说明性短引（≤10 行/处），符合仓库 CONTRIBUTING 口径。
4. 分析 clone `/tmp/soc-src` 位于系统临时目录，不进入本仓库。
