# Devin Computer Use（桌面控制）逆向

> 分析对象：Cognition Devin 全家桶（Devin Cloud / Devin CLI "chisel" 3000.6.19 / Devin Desktop，即 Windsurf 更名版）。
> 本机状态：CLI 配置与日志留存（2026-09-11/16/18 三天 ACP 运行），CLI 与 Desktop 二进制已随 Devin.app 卸载。
> 方法：只读静态取证（配置/日志/SQLite/缓存解码）+ 官方文档静态抓取（2026-10-06）+ 本机第三方协议参考实现（oh-my-pi）交叉验证。全部证据见 [evidence/inventory.md](evidence/inventory.md)。

## TL;DR

1. **Devin 的 computer use 是云端能力，不是本地能力。** 工具名就叫 **`computer`**，"available in every desktop-mode session"，跑在 Devin Cloud 会话 VM（或 Outposts 自有机器）里：截图 → 定位元素 → 动作 → 再截图的循环，屏幕固定 1024×768。
2. **本地 CLI（`devin`）没有 CU 工具**（三重负证据：权限系统内置工具匹配器仅 `read/edit/grep/glob/exec`；官方文档 computer-use 页只存在于 Cloud 分区；本机三天运行日志的内部模块清单无任何截屏/输入注入组件）。CLI 对 CU 的参与方式是**代理与观测**：`--cloud` 发云会话、`devin ssh`/`devin forward` 直连云机器、会话 UI 观看/接管。
3. **人接管走同一块屏**：会话 UI 的 "Browser" 标签在组织启用 CU 后改名 **"Computer"**，人可以直接上手完成 SSO/MFA/CAPTCHA——这是 Devin 的"人工兜底"设计，没有逐动作审批队列。
4. 开关是**组织级**的（Settings > Devin > Sessions 的 "Computer use" toggle，仅 admin 可改），启用后每个 desktop-mode 会话都带 `computer` 工具；Devin 判断适合时自主进入桌面模式。
5. **本地侧最接近"computer use"的形状**只有两个，且都不是桌面控制：① CLI 的 OS 级沙箱 + autonomous 模式（shell/fetch 自动批准，属于"无人监督的终端控制"而非 GUI 控制）；② Devin Desktop 的 Previews（网页预览的元素选择/错误捕获回灌 agent，走 `exa.browser_preview_pb` gRPC）。

## 1. 能力载体与拓扑

```
┌────────────────────────────────────────────────────────────────────┐
│ Devin Cloud (app.devin.ai 控制面 / api.devin.ai 数据面)              │
│  · 会话编排 v1/v2/v3 API（sessions/messages/attachments/secrets）   │
│  · 组织级开关：Computer use toggle（admin only，全计划可用）          │
└───────────────┬────────────────────────────────────────────────────┘
                │ 会话创建/消息（REST）；浏览器实时画面走会话 UI
┌───────────────▼────────────────────────────────────────────────────┐
│ 云会话 VM / Outposts 机器（Linux 默认 | Windows | macOS）            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ computer 工具（desktop-mode 会话自带）                         │  │
│  │   观察：截图（1024×768 固定分辨率）                            │  │
│  │   动作：click / type / scroll / 快捷键 / drag                  │  │
│  │   循环：screenshot → identify → act → re-screenshot → repeat  │  │
│  │  macOS VM：合成鼠标键盘（Accessibility TCC）+ Screen Recording │  │
│  │  Chromium CDP：http://localhost:29229（Playwright 可附着）     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  · Interactive Browser / Computer 标签：人工同屏接管                 │
│  · save_browser_profile：把登录态打包进 org blueprint               │
└───────────────┬────────────────────────────────────────────────────┘
                │ 观测/接管投影
┌───────────────▼────────────────────────────────────────────────────┐
│ 本地（macOS 宿主，本机实测痕迹）                                      │
│  · Devin CLI（chisel 3000.6.19，Rust）                              │
│     - 本地工具面：read/edit/grep/glob/exec + MCP —— 无 CU 工具       │
│     - --cloud：任务转交云会话；devin ssh/forward：直连云机器          │
│     - --sandbox（bwrap/Seatbelt）+ autonomous：无人监督=终端级，      │
│       不是 GUI 级                                                   │
│  · Devin Desktop（=Windsurf）：Cascade 本地跑终端/文件编辑，          │
│     Previews 是网页预览回灌（非桌面控制）；作为 ACP 宿主时凭据          │
│     经 authenticate 注入 CLI                                        │
└────────────────────────────────────────────────────────────────────┘
```

| 载体 | 位置 | 形态 |
|---|---|---|
| `computer` 工具 | 云会话 VM（Linux/Windows/macOS/Outposts） | 截图-动作循环的 GUI 控制，1024×768 |
| Interactive Browser / Computer 标签 | 会话 UI | 人机共用同一浏览器/桌面 |
| Devin IDE 标签 | 会话 UI | 会话内 VS Code 环境（可读写切换） |
| 本地 CLI | `~/.local/...`（已随 app 卸载） | 终端 coding agent，无 CU |
| Devin Desktop | `/Applications/Devin.app`（已卸载） | IDE；Previews=网页预览，非 CU |

## 2. 云端 computer 工具（文档口径，静态记录）

官方文档 [docs.devin.ai/work-with-devin/computer-use](https://docs.devin.ai/work-with-devin/computer-use)（2026-10-06 抓取）关键原文：

- "Devin gets **a full desktop environment — not just a browser**. It can move the mouse, click on UI elements, type on the keyboard, take screenshots."
- "The **`computer` tool** is available in every desktop-mode session."
- 屏幕模型："It sees the screen as a **1024×768** display."
- 循环："screenshot → identify elements → act (click, type, scroll, keyboard shortcuts, drag) → re-screenshot → repeat."
- 平台矩阵：Linux（默认全桌面）；Windows（可测 WPF/WinForms）；macOS（含 iOS Simulator，快捷键用 ⌘；"synthetic mouse and keyboard input" 需 Accessibility TCC，截屏需 Screen Recording）；Outposts：Linux 需 `DISPLAY` 指向运行中的 X server（可用 Xvfb），macOS 复用既有桌面会话，Windows 用既有交互桌面（需自装 Chrome）。
- 触发方式：建 PR 后点 "Test the app"、自然语言请求、或 Devin 自判适合桌面交互时自主进入。
- 无逐动作审批模型（与 Cursor 的 CU 审批卡、Synara 的前台授权引擎形成对照——Devin 把"人审批"放在组织开关与会话接管两层）。

## 3. 会话工具面里与 CU 相邻的部分

[devin-session-tools](https://docs.devin.ai/work-with-devin/devin-session-tools) 记载的会话工具/标签：

| 名称 | 形态 | CU 关联 |
|---|---|---|
| Shell / Terminal | 会话内全量命令行 + 历史/输出预览，只读↔可写切换 | 与 computer 并列的"程序化控制"通道 |
| Devin IDE | 会话内 VS Code 环境 | 人接管 Devin 的编辑任务 |
| Interactive Browser | 会话 UI "Browser" 标签 | **CU 启用后改名 "Computer"**；SSO/MFA/CAPTCHA 人肉兜底 |
| Side Chats（`/btw`） | 只读问答面板 | 不打断主会话 |
| Progress | shell 命令/代码编辑/浏览器活动统一日志 | CU 动作的可观测投影 |

## 4. 本地投影：CLI 与 Desktop 各自"没有 CU"的证据链

三重负证据（inventory C6）：

1. **权限系统白名单**：CLI 权限文档的内置工具匹配器只有裸工具名 `read, edit, grep, glob, exec`（加 plan profile 的 `exit_plan_mode`）与 `mcp__…` 族——没有任何 `computer_*`/`screenshot` 类工具（对照 Cursor 分册的 16 个 `computer_*`、Synara 分册的 33 个 `computer_*`）。
2. **文档分区**：docs.devin.ai 站点地图里 computer-use 只在 Cloud 分区（`/work-with-devin/computer-use`），CLI 分区（`/cli/*` 全 40+ 页）无 computer/browser 能力页。
3. **运行日志**：本机三天 ACP 运行日志的全部内部模块中，工具箱只有 `toolbox::tools::exec`（含起 shell 前的 login-shell env 快照）与 `toolbox::tools::mcp`；无截图/CGEvent/AX/ScreenCapture 类模块（对照 Synara 的 cua-driver strings）。

**本地确实存在、但不是 CU 的东西**：

- `--sandbox` + `--permission-mode autonomous`：OS 级隔离（Linux bwrap+socat、macOS Seatbelt、Windows 不支持即硬失败 fail-closed）+ loopback 网络代理（`allowed_domains`/`denied_domains`/`network_mode: full|limited`）+ `sandbox.excluded` 豁免规则。这是"无人监督的**终端**控制"，与 GUI 无关。
- Devin Desktop 的 Previews：网页预览的元素选择与错误捕获回灌 agent——本地浏览器**预览**通道，见 [browser-use.md](browser-use.md) §4。

## 5. 安全模型（CU 侧）

| 层 | 机制 | 证据 |
|---|---|---|
| 组织 | "Computer use" toggle，仅 org admin；全计划可用 | computer-use.md |
| 会话 | 人可随时在 Browser/Computer 标签接管；blueprint 变更（如存 profile）需批准步骤 | devin-session-tools、browser-auth |
| 凭据 | 登录态存 org blueprint（≤200MB，Chrome 密码库与缓存排除、扩展不恢复）；推荐服务账号；真正的密码走 Secrets | browser-auth.md |
| 云 VM 内 | macOS VM 的 TCC（Accessibility+Screen Recording）由平台方管理，与宿主机器无关 | computer-use.md |
| Outposts | 自有机器上跑 desktop-mode 需 X 会话/既有桌面；录屏需 ffmpeg | computer-use.md |

## 6. 与其他分册的横向对照

- **Cursor**：本地 sidecar（Swift/Rust）+ TCC 真实输入 + 逐动作审批/结构化 refusal——Devin 没有本地 sidecar，审批浓缩为组织开关 + 会话接管。
- **Synara**：cua-driver 本地引擎 + escape 急停 + activation shield——Devin 云端 VM 内的实现未公开，等价物不可考。
- **codex/claude-code**：两家都是"本地 CLI + 云端可选"，CU 都靠本地原生 helper；Devin 是唯一"CU 全云端、本地零 GUI 工具"的样本。
- **zcode**：同为"本地插件无 CU、CU 靠外置能力"形态，但 ZCode 的 browser use 是本地一等公民，Devin CLI 连 BU 都没有（见 browser-use.md）。

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
