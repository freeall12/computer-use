# Devin 的 Computer Use：云端 VM 里的 `computer` 工具，本地零 GUI 工具

> 对象：Devin Cloud / Devin CLI "chisel" 3000.6.19 / Devin Desktop（= Windsurf 更名版）。
> 本机状态：CLI 配置与日志留存（2026-09-11/16/18 三天 ACP 运行），CLI 与 Desktop 二进制已随 Devin.app 卸载。
> 方法：只读静态取证（配置/日志/SQLite/缓存解码）+ 官方文档静态抓取（2026-10-06）+ 本机第三方参考实现（oh-my-pi）交叉验证；未抓包、未触碰凭据（合规声明仅此一处）。证据见 [evidence/inventory.md](evidence/inventory.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 核心判定 | **CU 是云端能力，不是本地能力**——工具名就叫 `computer`，跑在云会话 VM / Outposts 里 |
| 屏幕模型 | 固定 1024×768；screenshot → identify → act → re-screenshot 循环 |
| 本地 CLI | 零 CU 工具（三重负证据，§4）；参与方式 = 代理与观测 |
| 人接管 | 会话 UI "Browser" 标签在 CU 启用后改名 "Computer"，人直接上手 SSO/MFA/CAPTCHA |
| 审批 | 组织级开关（admin only），无逐动作审批队列 |
| 最接近 CU 的本地形态 | OS 级沙箱 + autonomous（终端级）；Desktop Previews（预览回灌）——都不是桌面控制 |

## 架构一图

```
Devin Cloud：组织开关（admin）→ desktop-mode 会话自带 computer 工具
 ▼ 会话创建/消息（REST v1-v3）
云会话 VM / Outposts（Linux 默认 | Windows | macOS）
 ├─ 观察：截图 1024×768（固定分辨率）
 ├─ 动作：click / type / scroll / 快捷键 / drag
 └─ macOS VM：合成鼠标键盘（Accessibility TCC）+ Screen Recording
     Chromium CDP：http://localhost:29229（Playwright 可附着）
 ▼ 观测/接管投影
本地：会话 UI "Computer" 标签同屏接管；CLI --cloud / ssh / forward（无 CU 工具）
```

## 1. 能力载体与拓扑

| 载体 | 位置 | 形态 |
|---|---|---|
| `computer` 工具 | 云会话 VM（Linux/Windows/macOS/Outposts） | 截图-动作循环的 GUI 控制，1024×768 |
| Interactive Browser / Computer 标签 | 会话 UI | 人机共用同一浏览器/桌面 |
| Devin IDE 标签 | 会话 UI | 会话内 VS Code 环境（可读写切换） |
| 本地 CLI | `~/.local/...`（已随 app 卸载） | 终端 coding agent，无 CU |
| Devin Desktop | `/Applications/Devin.app`（已卸载） | IDE；Previews=网页预览，非 CU |

## 2. 云端 computer 工具（官方文档口径）

| 维度 | 文档口径（docs.devin.ai/work-with-devin/computer-use，2026-10-06 抓取） |
|---|---|
| 能力范围 | "a full desktop environment — not just a browser"：移动鼠标、点击 UI 元素、键盘输入、截图 |
| 可用性 | "The `computer` tool is available in every desktop-mode session" |
| 屏幕模型 | "It sees the screen as a **1024×768** display" |
| 循环 | screenshot → identify elements → act（click/type/scroll/keyboard shortcuts/drag）→ re-screenshot → repeat |
| 触发方式 | 建 PR 后点 "Test the app"、自然语言请求、或 Devin 自判适合时自主进入桌面模式 |
| 平台矩阵 | Linux 默认全桌面；Windows 可测 WPF/WinForms；macOS 含 iOS Simulator（⌘ 快捷键，合成输入需 Accessibility TCC + Screen Recording）；Outposts：Linux 需 `DISPLAY`/Xvfb，macOS 复用既有桌面会话，Windows 用既有交互桌面（自装 Chrome） |
| 审批 | 无逐动作审批模型（对照 Cursor 审批卡、Synara 前台授权引擎）——"人审批"浓缩为组织开关 + 会话接管两层 |

## 3. 会话工具面里与 CU 相邻的部分

| 名称 | 形态 | CU 关联 |
|---|---|---|
| Shell / Terminal | 会话内全量命令行 + 历史/输出预览，只读↔可写切换 | 与 computer 并列的"程序化控制"通道 |
| Devin IDE | 会话内 VS Code 环境 | 人接管 Devin 的编辑任务 |
| Interactive Browser | 会话 UI "Browser" 标签 | **CU 启用后改名 "Computer"**；SSO/MFA/CAPTCHA 人肉兜底 |
| Side Chats（`/btw`） | 只读问答面板 | 不打断主会话 |
| Progress | shell/代码编辑/浏览器活动统一日志 | CU 动作的可观测投影 |

## 4. 本地投影：CLI 与 Desktop 的"没有 CU"证据链

**三重负证据（inventory C6）证明本地 CLI 无任何 CU 工具。**

1. **权限系统白名单**：CLI 权限文档的内置工具匹配器仅 `read, edit, grep, glob, exec`（+ plan profile 的 `exit_plan_mode`）与 `mcp__…` 族——没有任何 `computer_*`/`screenshot` 类工具（对照 Cursor 16 个 `computer_*`、Synara 33 个）。
2. **文档分区**：docs.devin.ai 站点地图里 computer-use 只在 Cloud 分区；CLI 分区（40+ 页）无 computer/browser 能力页。
3. **运行日志**：本机三天 ACP 运行日志的全部内部模块中，工具箱只有 `toolbox::tools::exec`（含 login-shell env 快照）与 `toolbox::tools::mcp`——无截图/CGEvent/AX/ScreenCapture 类模块。

**本地确实存在、但不是 CU 的东西：**

| 形态 | 内容 | 为什么不是 CU |
|---|---|---|
| `--sandbox` + `--permission-mode autonomous` | OS 级隔离（Linux bwrap+socat、macOS Seatbelt、Windows 不支持即硬失败）+ loopback 网络代理 + `sandbox.excluded` 豁免 | "无人监督的**终端**控制"，与 GUI 无关 |
| Devin Desktop 的 Previews | 网页预览的元素选择与错误捕获回灌 agent | 本地浏览器**预览**通道，见 [browser-use.md §3](browser-use.md) |

## 5. 安全模型（CU 侧）

| 层 | 机制 | 证据 |
|---|---|---|
| 组织 | "Computer use" toggle，仅 org admin；全计划可用 | computer-use 文档 |
| 会话 | 人可随时在 Browser/Computer 标签接管；blueprint 变更（如存 profile）需批准步骤 | devin-session-tools、browser-auth |
| 凭据 | 登录态存 org blueprint（≤200MB，Chrome 密码库与缓存排除、扩展不恢复）；推荐服务账号；真正的密码走 Secrets | browser-auth |
| 云 VM 内 | macOS VM 的 TCC（Accessibility+Screen Recording）由平台方管理，与宿主机器无关 | computer-use 文档 |
| Outposts | 自有机器跑 desktop-mode 需 X 会话/既有桌面；录屏需 ffmpeg | computer-use 文档 |

## 6. 横向对照：唯一"CU 全云端、本地零 GUI 工具"的样本

| 对照 | 差异一句话 |
|---|---|
| Cursor | 本地 sidecar + TCC 真实输入 + 逐动作审批/结构化 refusal——Devin 无本地 sidecar，审批浓缩为组织开关 + 会话接管 |
| Synara | cua-driver 本地引擎 + escape 急停 + activation shield——Devin 云 VM 内实现未公开，等价物不可考 |
| codex / claude-code | 两家都是"本地 CLI + 云端可选"，CU 靠本地原生 helper |
| zcode | 同为"本地插件无 CU"，但 ZCode 的 browser use 是本地一等公民；Devin CLI 连 BU 都没有（见 browser-use.md） |

## 7. 快速复核入口

```bash
# 1) CLI 版本与 ACP 能力位（browser_preview 等）
gunzip -c ~/.local/share/devin/cli/logs/devin_20260911-125208_13731.log.gz | grep -m1 'client capabilities'
# 2) CLI 内部模块清单（应无截图/注入模块）
cat ~/.local/share/devin/cli/logs/*.log | grep -oE '[a-z_]+::tools::[a-z_:]+' | sort -u
# 3) 云端点实锤（payload 为 base64）
python3 -c 'import json,base64;print(base64.b64decode(json.load(open(__import__("glob").glob(__import__("os").path.expanduser("~/.cache/devin/cli/devin_deployment.*.bin"))[0]))["payload"]).decode())'
# 4) sessions.db 工具调用以 ACP JSON 存储（schema 注释）
sqlite3 ~/.local/share/devin/cli/sessions.db '.schema tool_call_state'
# 5) 官方 CU 文档
open https://docs.devin.ai/work-with-devin/computer-use
```
