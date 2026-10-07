# Self-Operating Computer（OthersideAI）· CU 范式的"化石级对照组"

> 对象：OthersideAI（HyperWrite）开源框架 **Self-Operating Computer**——"多模态模型直接操作鼠标键盘"的经典开源 CU 框架，README 自述 "Released Nov 2023… one of the first examples of full computer-use"（上游 README.md:8）。
> 方法：只读静态分析上游开源仓库（MIT，整仓即源码）。基线 **v1.5.8**，commit `fac568e`（2025-09-19，上游最后提交）；首个提交 `88a81ce`（2023-11-03）。本机无安装（框架类项目，无常驻产品形态）。
> 详细证据见 [evidence/inventory.md](evidence/inventory.md)；桌面控制见 [computer-use.md](computer-use.md)；浏览器判定见 [browser-use.md](browser-use.md)；源码层见 [../../source/self-operating-computer/](../../source/self-operating-computer/README.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 载体 | Python 包 `operate/`（pip 安装，CLI 入口 `operate`）· v1.5.8 |
| 形态 | 终端框架（无 Helper / 无 MCP / 无常驻进程） |
| CU 工具面 | **4 个 prompt 内嵌操作**（click/write/press/done）· 9 模型适配器 |
| BU 工具面 | 0 · 浏览器=CU 的键盘路径（无任何浏览器 API） |
| 安全模型 | **无**（仅 sleep(1) + 11 轮上限） |
| 本机可用 | ⚙️ 不适用（框架需自备 API key + TCC 授权运行） |

> 一句话结论：**它把"模型+截图+pyautogui"三件事做成了一个没有任何安全层的 while 循环——2026 年的 12 家分册恰好是它的反面教材清单。**

## 架构一图

```
用户 objective（终端输入 / --voice 经 WhisperMic 听写）
 └─ get_system_prompt()   动作语法写进 system prompt（4 操作 JSON 协议）
     └─ while True（operate.py:107，loop_count>10 出口）
         ├─ capture_screen_with_cursor()   mac: screencapture -C / win: pyautogui / linux: Xlib
         ├─ get_next_action(model)         9 模型分发（gpt-4o/o1/gpt-4.1/qwen-vl/claude-3/gemini/llava）
         │    └─ 失败 → gpt_4_fallback 换 system prompt 重试（无界递归）
         ├─ clean_json + json.loads        剥 ```json 围栏 → 动作数组
         ├─ click 定位三分支                百分比坐标 / EasyOCR 文本→中心 / YOLOv8 SoM 标签
         └─ OperatingSystem                pyautogui 合成输入（逐字符写 / combo 键 / 画圈点击）
              └─ macOS TCC：Screen Recording + Accessibility 授予【运行它的终端 app】
```

## TL;DR

1. **极简派基线**：15 个 Python 文件 = 全部 CU 能力。观察=纯截图（无 AX 树、无元素句柄），动作=pyautogui 全局合成（无窗口定向、无后台交付）——与 12 家的"AX 语义优先"路线完全相反。
2. **动作语法活在 prompt 里**：没有工具 schema，四操作协议直接写在 system prompt 文本中（"Your output will be used in a `json.loads`"，prompts.py:16），输出即 `[{"operation":"click",...}]` JSON 数组。
3. **定位三级演化并存**：v1 百分比裸坐标（standard）→ OCR 文本定位（EasyOCR 子串匹配→边界框中心，**默认档**）→ SoM 标签（YOLOv8 `best.pt` 检测按钮 + `~x` 标签）。
4. **安全模型 = 零**：无租约、无防重放、无动作验证、无应用白名单、无急停、无审计（见 [computer-use.md §7](computer-use.md) 差距矩阵）。唯一护栏是 `loop_count > 10`（operate.py:120）。
5. **遗留死代码是活化石**：`misc.py:11-40` 的 `parse_operations`（v1.0 行式协议 `CLICK{}`/`TYPE`/`SEARCH`/`DONE`）在现行代码零调用——同一仓库里躺着两代协议。
6. **负证据**：全历史（645 commits，v1.0.1→v1.5.8）**无 OS Mode、无 AT-SUMMARIZER、无 agent exchange、无任何 hosted API**——仅有 `agent-1` 占位符返回 "coming soon"（apis.py:55-56）。

## 能力矩阵（对 12 家的对照口径）

| 能力 | Self-Operating Computer v1.5.8 | 对照：12 家共性 | 对照：Goose（次简） |
|---|---|---|---|
| 观察机制 | 纯截图（含光标 `-C`） | AX 树 diff / 快照 / SCK | Peekaboo AX 标注截图 |
| 定位 | 百分比 / OCR 文本 / SoM 标签 | elementIndex / ref 句柄 / snapshot_id | 元素 ID（AX 产生） |
| 动作注入 | pyautogui 前台全局合成 | AX 语义 + CGEvent 双路由 | Peekaboo（CGEvent+AX） |
| 后台操作 | ❌ 全前台 | 9 家有 | ❌ |
| 租约/防重放/验证 | ❌ / ❌ / ❌ | 主流三件套 | ❌ / ❌ / 补拍截图 |
| 急停 | ❌（Ctrl-C 杀进程） | Esc / STOP / kill switch | ❌ |
| 工具面 | 4 操作（prompt 内嵌） | 1–40 工具/方法 | 1 工具透传 |
| 执行层 | 自带（pyautogui 库） | 自研 Helper / 内嵌 driver | 第三方 CLI |
| 许可证 | MIT（整仓开源） | 多数专有 | Apache-2.0 |

## 快速验证

```bash
git clone --depth 1 https://github.com/OthersideAI/Self-Operating-Computer /tmp/soc-src
cd /tmp/soc-src && git log -1 --format='%h %ci'   # fac568e 2025-09-19
grep -c "" operate/models/apis.py                  # 1139 行（最大文件，9 个模型适配器）
grep -rn "pyautogui" operate/utils/operating_system.py | wc -l   # 8 处
grep -rniE "\b(lease|approval|kill.?switch|allowlist)\b" operate/ | wc -l   # 0 处（安全机制零命中）
node source/self-operating-computer/reference/test.mjs           # ALL PASSED (12 checks)
```

## 文档结构

- [computer-use.md](computer-use.md) — 主循环、动作语法表、9 模型矩阵、输入合成、安全差距矩阵、平台依赖表
- [browser-use.md](browser-use.md) — BU 判定书：零浏览器 API，浏览器=CU 键盘路径
- [evidence/inventory.md](evidence/inventory.md) — 文件:行号级证据映射 + 负证据五面法
