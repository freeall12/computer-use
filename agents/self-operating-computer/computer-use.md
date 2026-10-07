# Self-Operating Computer：Computer Use（桌面控制）完整逆向

> 分析基线：上游 `OthersideAI/Self-Operating-Computer` v1.5.8（commit `fac568e`，2025-09-19，MIT）。源码路径相对上游仓库根；已 vendor 至 [../../source/self-operating-computer/vendor/](../../source/self-operating-computer/vendor/PROVENANCE.md)。
> 文中 `operate/…:行号` 均指该 commit。

## 1. 结论先行

1. **载体判定：无 Helper、无 MCP、无常驻进程的终端框架**。`pip install self-operating-computer` 后运行 `operate` CLI（setup.py entry_points → `operate/main.py:9`）。桌面能力 = 15 个 Python 文件，全部逻辑在 `operate/` 包内。
2. **路线判定：纯视觉 + 全局合成输入**。观察只有截图（`screenshot.py:11-27`），动作只有 pyautogui 全局前台合成（`operating_system.py`）——**仓库内零 AX/ScreenCaptureKit/CGEvent 代码**，与 12 家分册的"AX 语义优先"路线互为镜像。
3. **动作语法内嵌 prompt**：没有工具 schema。四操作协议写在 system prompt 文本里（"Your output will be used in a `json.loads` loads statement"，`prompts.py:16`），模型回 JSON 数组，`clean_json` 剥围栏后 `json.loads`（`apis.py:1117-1139`）。
4. **安全模型 = 零**：`\b(lease|approval|kill.?switch|allowlist)\b` 全仓 grep **0 命中**。护栏仅两项：每动作 `sleep(1)`（`operate.py:141`）+ `loop_count > 10` 跳出（`operate.py:120`）。
5. **两代协议同仓共存**：现行 JSON 数组协议（v1.2 起）之外，`misc.py:11-40` 还躺着 v1.0 的行式协议解析器 `parse_operations`（`CLICK {json}` / `TYPE "…"` / `SEARCH "…"` / `DONE`），现行代码零调用。

## 2. 运行链与 TCC 依赖

| 环节 | 事实 | 证据 |
|---|---|---|
| 安装 | `pip install self-operating-computer`；requirements 钉死 `PyAutoGUI==0.9.54`、`easyocr==1.7.1`、`ultralytics==8.0.227`、`rubicon-objc==0.4.7` | `requirements.txt` |
| CLI 参数 | `-m <model>`（默认 `gpt-4-with-ocr`）/ `--voice` / `--verbose` / `--prompt` 直填目标 | `main.py:13-41` |
| 缺 API key | prompt_toolkit 弹窗收集 → **明文追加写 `.env`**（`key='value'` 格式，无 keychain） | `config.py:163-187` |
| macOS 权限 | 需给**运行它的 Terminal app** 授 Screen Recording（截图）+ Accessibility（pyautogui）两项 TCC——README 原文即安装步骤 | 上游 README.md:46-51 |
| 首条消息 | 告知模型"你在终端 app 里，要离开终端就用 OS 搜索" | `prompts.py:198-203` |

## 3. 动作语法表（prompt 内嵌，三档变体）

三套 system prompt（STANDARD / OCR / LABELED）共享同一 4 操作词汇，差异只在 click 的定位字段：

| 操作 | 字段 | 语义 | 定位变体 | 证据 |
|---|---|---|---|---|
| `click` | `x`,`y` | 移动鼠标并点击 | standard：屏幕百分比小数（如 `"0.10"`） | `prompts.py:18-21` |
| | `text` | 点"这段文本" | ocr（**默认档**）：EasyOCR 子串匹配→边界框中心→÷图宽高 round 3 位；找不到回 `"nothing to click"` 换方法 | `prompts.py:139-141`、`ocr.py:53,81-98`、`apis.py:368-409` |
| | `label` | 点 `~x` 标签 | som：YOLOv8 检测按钮 + 红框标签叠加，标签查表→百分比 | `prompts.py:76-78`、`apis.py:646-757` |
| `write` | `content` | 键盘输入 | —— | `prompts.py:23-26` |
| `press` | `keys[]` | 组合键/按键 | hotkey 为同义别名（分派层同分支，`operate.py:148`） | `prompts.py:28-31` |
| `done` | `summary` | 目标完成，终止循环 | —— | `prompts.py:33-36` |

**平台自适应键位**（`prompts.py:215-226`）：Darwin → `command` + OS 搜索 `["command","space"]`（Spotlight）；Windows/Linux → `ctrl` + `["win"]`。prompt 注入示例（打开 Chrome = Spotlight→输入→回车）随平台换键。

**遗留死代码**：`misc.py:11-40` `parse_operations` 解析 v1.0 行式协议（CLICK/TYPE/SEARCH/DONE），现行零调用——`SEARCH` 操作（OS 级搜索打开程序）在 JSON 协议中被 `press+write` 替代，未保留。

## 4. 主循环（唯一的状态机）

```
while True（operate.py:107）
 ├─ get_next_action(model, messages, objective, session_id)   # 截屏+模型调用，返回(动作数组, session_id)
 │    └─ 失败 → gpt_4_fallback：messages[0] 换 gpt-4o prompt → 重试
 ├─ operate(operations, model)                                # 逐动作分派，每动作前 sleep(1)
 │    ├─ press/hotkey → OperatingSystem.press(keys)
 │    ├─ write       → OperatingSystem.write(content)
 │    ├─ click       → mouse({x,y}) → click_at_percentage
 │    ├─ done        → 打印 summary → return True（唯一正常出口）
 │    └─ unknown     → 打印错误 → return True（停）
 ├─ loop_count += 1；loop_count > 10 → break                  # 最多 11 轮
 └─ catch 一切异常 → 打印 → break（无重试、无恢复）
```

要点：`session_id` 参数全链路传递但恒为 `None`（`apis.py` 各分支 return `..., None`）——预留未用。模型层失败与循环层失败语义不同：前者**无界递归重试**（`apis.py:142` `return call_gpt_4o(messages)`，烧完额度为止），后者直接放弃。

## 5. 观察链（纯视觉，三级定位并存）

| 环节 | 实现 | 证据 |
|---|---|---|
| 截图三分支 | mac `screencapture -C`（`-C` 含鼠标光标）；win `pyautogui.screenshot()`；linux Xlib 取尺寸 + PIL `ImageGrab.grab`（免 scrot 依赖） | `screenshot.py:11-27` |
| 压缩 | claude-3 档缩至宽 2560 JPEG q85（绕 5MB API 限制）；qwen-vl 档 `compress_screenshot` JPEG q85 白底 | `apis.py:884-911`、`screenshot.py:30-42` |
| OCR 定位 | `easyocr.Reader(["en"])` 每次点击**重新实例化**（无缓存）；`get_text_element` 子串匹配取**最后一个**命中（循环不 break）；claude-3 档只取文本**前 3 字符**匹配（注释自述"更高成功率"） | `apis.py:377-384,991-993`、`ocr.py:46-56` |
| SoM 定位 | YOLOv8 `weights/best.pt`（约 30MB 按钮检测权重，package_data 随包分发）；`add_labels` 画红框 + `~x` 标签；命中失败→fallback 纯视觉 | `apis.py:653-654,730-752`、`label.py` |
| 历史 | 截图固定写 `screenshots/screenshot.png` 同名覆盖，整段对话史（含历张截图 base64）无裁剪地追加进 messages——上下文随轮数线性膨胀 | `apis.py:78,106,127` |

**SoM 判定**：`gpt-4-with-som` 是经典 Set-of-Mark（视觉检测按钮 + 编号叠加，引用 arXiv:2310.11441），非 Goose 那种 AX 产生的标注——本仓库 CU 侧"经典 SoM 唯一例"。

## 6. 动作注入（pyautogui 形状学）

| 动作 | 实现 | 证据 |
|---|---|---|
| `write` | `content.replace("\\n","\n")` 后**逐字符** `pyautogui.write(char)`（无打字速率模拟、无剪贴板粘贴路径） | `operating_system.py:10-16` |
| `press` | 组合键 = 全部 `keyDown` → `sleep(0.1)` → 全部 `keyUp`（combo 语义） | `operating_system.py:18-26` |
| `click` | `pyautogui.size()` 百分比→像素 → `moveTo(duration=0.2)` 直线移动 → **0.5s 装饰性画圈**（半径 50px，`moveTo` 32 次左右）→ `click` 圆心 | `operating_system.py:39-63` |
| 错误处理 | 每个方法 try/except 后仅 `print`，异常**被吞掉**——动作失败对循环层不可见，无重试无上报 | `operating_system.py:15,25,36` |

画圈是全项目唯一的"人类可见性"设计（让目标可见移动轨迹），但代码注释与 README 均未把它当安全机制——它就是动画。

## 7. 安全差距矩阵（对照 12 家）

| 机制 | 12 家主流做法 | Self-Operating Computer | 差距 |
|---|---|---|---|
| 执行租约 | ZCode/MiniMax/Kimi 会话租约 + CONTROLLER_BUSY | 无 | 无并发防护 |
| 防重放 | possibly_sent / generation fencing | 无 | 动作可重复投递 |
| 动作验证 | verify_after 三态 / AX 回读 | 无（prompt 里一句"reflect on previous actions"，`prompts.py:191`） | 验证靠模型自觉 |
| 应用白名单 | Claude tier / Cursor origin 拒绝列表 | 无 | 全盘可点 |
| 急停 | Esc / STOP / kill switch | 无（Ctrl-C 杀进程，`main.py:51-52`） | 无软急停 |
| 失败语义 | 错误码→分档建议（Grok 16 码） | unknown 即停；模型层无界重试 | 两极都有问题 |
| 凭据管理 | 钥匙串 / env 隔离 | 明文追加 `.env`（`config.py:184-187`） | 凭据裸奔 |
| 可见性 | 光标可视化 / PiP / 审计日志 | 画圈动画（非安全设计） | 仅氛围级 |

**对照组价值**：12 家的每个安全机制都是对这套范式的已知事故的修补。它的 "Don't respond saying you're unable to assist"（`prompts.py:63,125,193`）更是把"压过模型拒绝倾向"写进了默认 prompt——2026 年看是安全反面教材，2023-11 看是"能用"的最低标准。

## 8. 平台依赖表

| 平台 | 截图 | 输入合成 | 权限 | 证据 |
|---|---|---|---|---|
| macOS | `screencapture -C` 子进程 | pyautogui（CGEvent 系 + rubicon-objc） | Terminal app 需 TCC：Screen Recording + Accessibility | `screenshot.py:23-25`、上游 README.md:46-51 |
| Windows | `pyautogui.screenshot()` | pyautogui（Win32 SendInput 封装） | 无系统级权限门槛 | `screenshot.py:14-16` |
| Linux | Xlib 尺寸 + PIL ImageGrab | pyautogui（X11） | 需 X server（README 明示不支持的组合直接 print 跳过） | `screenshot.py:17-22,27` |

## 9. Voice 输入与评测

- `--voice`：`whisper_mic.WhisperMic().listen()` 只替代**目标输入**（objective），动作循环不变；voice 模式强制要求 OPENAI_API_KEY（`operate.py:52-62,84-91`、`config.py:135-144`）。
- `evaluate.py`：2 个内置用例（"Go to Github.com" / "Go to Youtube.com and play a video"），子进程跑 `operate --prompt` 后把**最后一张截图**交给 gpt-4o 按 guideline 判 `guideline_met`——GPT-4V-as-judge 的最简评测（`evaluate.py:13-16,91-112`）。
- `agent-1`：模型占位符，直接返回 `"coming soon"`（`apis.py:55-56`）——上游对后续 agent 化的唯一痕迹。
