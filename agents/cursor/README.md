# Cursor 原生 Computer Use 与 Browser Use 逆向分析

> 逆向对象：本机安装的 Cursor 3.22.12（macOS arm64，VSCode 1.128.0 fork）与 cursor-agent CLI 2026.09.23-86fc751。方法：只读静态分析（未解包 asar——该版本代码以明文 JS/内置扩展形式分发，且 `cursor-computer-use` 扩展自带完整 TS 源码），不做抓包、不触碰凭据。全部证据见 [evidence/inventory.md](evidence/inventory.md)。

## 文档导航

| 文件 | 内容 |
|---|---|
| [browser-use.md](browser-use.md) | 浏览器控制完整逆向：内置 Electron 浏览器 + `cursor-ide-browser` MCP server、15+1 工具、快照/ref 机制、合成 DOM 事件、CDP 拒绝列表 |
| [computer-use.md](computer-use.md) | 桌面控制完整逆向：`cursor-computer-use` MCP server、sidecar 架构、macOS companion/remote 双模式、16 工具、AX 树观察、原生输入注入 |
| [evidence/inventory.md](evidence/inventory.md) | 证据清单：路径、版本、关键代码摘录、字节偏移、复现命令、特性开关默认值 |

## TL;DR（30 秒版）

- **两种能力同一形态**：都是 Cursor 在 VSCode fork 上自建的"一方 MCP provider"——内置扩展调 `vscode.cursor.registerMcpProvider()` 把工具挂给 agent，与用户配置的 MCP server 走同一条审批/调用管线。
  - Browser use → provider id **`cursor-ide-browser`**（内置扩展 `cursor-browser-automation`）
  - Computer use → provider id **`cursor-computer-use`**（内置扩展 `cursor-computer-use`）
- **Browser use 本机可用且有使用痕迹**（`~/.cursor/browser-logs/` 有 2026-08/09 的 CDP 截图与 a11y 快照落盘）。实现 = 主进程 `browserViewMainService`（Electron webview）+ 扩展注入 JS：观察靠 `data-cursor-ref` 句柄快照，动作靠合成 DOM 事件，CDP 只是受严格白名单限制的逃生舱。
- **Computer use 本机未启用**（Statsig 门 `mac_computer_use`/`local_computer_use` 默认关；sidecar 未安装）。静态逆向还原了完整工具面（16+2 工具）与 sidecar 架构：macOS Swift helper（CDN 签名分发、Unix socket JSON-RPC、AX 树 + TCC 双权限），Windows Rust sidecar（命名管道 + launch token），Linux 云端 worker 用 xdotool + ffmpeg x11grab。
- **模型侧**：浏览器与桌面控制由服务端专用模型驱动（Statsig 配置默认 `modelId:"sand-cua"`，推断 CUA = Computer Use Agent），浏览器自动化默认以 subagent 形态运行（`browser_subagent` 默认开）。

## 架构分层图

```
                      ┌─────────────────────────────────────┐
                      │ Cursor 云端 (api2/api4/api5.cursor.sh)│
                      │  · agent 会话编排 (agent.v1 protobuf) │
                      │  · 专用控制模型 "sand-cua"            │
                      │  · Statsig 门控下发 (api3 /tev1)      │
                      └──────────────┬──────────────────────┘
                                     │ HTTPS (流式 MCP 工具调用)
┌────────────────────────────────────▼─────────────────────────────────────┐
│ Cursor.app (Electron, VSCode 1.128 fork)                                 │
│                                                                          │
│  渲染进程 workbench (workbench.desktop.main.js / workbench.glass.main.js) │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ composer/agent 运行时 (browser_subagent 默认 on)                     │  │
│  │   │                                                                │  │
│  │   ├─► [MCP provider] cursor-ide-browser  (cursor-browser-automation)│  │
│  │   │     browser_navigate/snapshot/click/.../cdp/lock (16 个)        │  │
│  │   │       │ executeCommand("cursor.browserView.*")                  │  │
│  │   │       │ + 页面注入 JS (快照/动作, data-cursor-ref)               │  │
│  │   │                                                                │  │
│  │   └─► [MCP provider] cursor-computer-use (cursor-computer-use 扩展)  │  │
│  │         computer_screenshot/click/app_state/set_value/... (16 个)   │  │
│  │           │ Unix socket JSON-RPC (service.json 会合)                │  │
│  │           │      [Statsig 门: mac_computer_use, 本机默认关]          │  │
│  └───────────┼────────────────────────────────────────────────────────┘  │
│              │ IPC channel                                               │
│  主进程 main.js                                                          │
│  ┌───────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │ browserViewMainService            │  │ (CU sidecar 由扩展经        │  │
│  │  Electron webview/WebContentsView │  │  /usr/bin/open 拉起的独立   │  │
│  │  标签/截图/网络追踪/console        │  │  helper 进程, 非主进程子模块)│  │
│  │  sendCDPCommand + 拒绝列表        │  │                             │  │
│  └────────────┬──────────────────────┘  └────────────┬────────────────┘  │
└───────────────┼──────────────────────────────────────┼───────────────────┘
       ┌────────▼─────────┐              ┌─────────────▼──────────────┐
       │ 目标网页(内嵌tab) │              │ computer-use-sidecar.app   │
       │ 合成 DOM 事件     │              │ (Swift, CDN 签名分发)       │
       └──────────────────┘              │ AX 树 + TCC 权限 + 真实输入  │
                                          └────────────────────────────┘
  独立 CLI: cursor-agent (~/.local/share/cursor-agent/, endpoint api2.cursor.sh)
    · 同一套 agent.v1 协议; Linux worker 内置 xdotool/ffmpeg 的 CU 执行器
    · 权限: --yolo/--auto-review/--sandbox/--trust/--mode plan|ask
```

## 能力矩阵

| 维度 | Browser Use（本机已验证） | Computer Use（静态还原，本机未启用） |
|---|---|---|
| 提供形态 | 一方 MCP provider `cursor-ide-browser`（内置扩展 `cursor-browser-automation` v1.0.0） | 一方 MCP provider `cursor-computer-use`（内置扩展同 v1.0.0，附 TS 源码） |
| 目标域 | Cursor 内嵌浏览器标签页（可见 + headless）；`cursor-browser-extension` provider 可接用户 Chrome（本机未验证） | macOS 单 app（companion）或全屏（remote）；Windows 桌面；Linux 云 worker |
| 观察机制 | 注入 JS 遍历 composed DOM（含 shadow root）→ a11y 快照 YAML + `data-cursor-ref="eN"` 句柄 + diff；截图为辅助 | 截图（WEBP，固定 canvas）为主；`computer_app_state` 输出 `[id] ROLE name= value= settable actions=` AX 树文本 + snapshot_id |
| 动作机制 | 注入 JS 合成 DOM 事件（Pointer/Mouse/Keyboard/DragEvent + DataTransfer）；**不用 CDP Input**（主进程硬禁） | 原生注入：macOS sidecar（AX 读写 + 真实输入）、Win sidecar（Rust）、Linux xdotool；`Input.*` 在浏览器域内被禁 |
| 引用稳定性 | `element` 描述校验防 ref 漂移；快照 watchdog 自动保活（15s/3s/5min） | `element_id + snapshot_id` 双引用；树变化报 stale；app 快照新鲜时直接复用 |
| 工具数 | 15 注册 + browser_lock（callTool 内） = 16 | macOS companion 16；Windows 加 zoom/batch |
| 权限门 | 导航 origin allowlist（禁 file://）；管理员 browser_protection；browser_lock 用户可 Take Control；CDP 拒绝列表（Input/Browser/Storage/SystemInfo/Target/Tethering 域 + cookie/nav 方法） | macOS TCC 双权限（Accessibility + Screen Recording）+ 权限探测工具 + 自动弹窗路由；macOS 输入租约（start/release control）；CDN 签名校验链 |
| 默认状态 | 开（`browser_subagent:!0`、`browser_mcp_chip:!0`）；内嵌浏览器标签 UI 受 `cursor.browserTabEnabled`（默认 false）控制 | 关（`mac_computer_use`/`local_computer_use`/`windows_computer_use_batch` 全默认 false） |
| 本机痕迹 | `~/.cursor/browser-logs/`（CDP 截图 JSON ×5 + 快照 YAML ×4）；每会话 `mcp-server-cursor-ide-browser.workbench.log` | 无（sidecar 目录不存在，无 helper 进程/service.json） |
| 遥测 | `cursor.internal.recordBrowserTelemEvent`（含 snapshotYaml） | `computer_use.session.duration_ms/action_count/result/action_kind`（CLI 指标） |
| 错误处理 | 结构化 `{success,error,suggestion}` + 防兔子洞提示词（4 次失败即停） | 结构化 refusal `{code,message,escalation:retry/ask_user/use_different_tool/stop}` |

## 与 VSCode fork 底座的关系

- **来自 fork 底座**：editor/editorGroup/auxiliary window 体系（浏览器作为编辑器标签）、extension host 与 `enabledApiProposals` 私有 API 通道、webview 会话/partition 管理、`simple-browser`（上游遗留，与 Cursor 自有浏览器并存）、终端/pseudoterminal（`cursor-agent-host` 用 `cursorPseudoterminal` 提案）。
- **Cursor 自建**：一方 MCP provider 框架（注册、durable snapshot、watchdog、审批理由枚举）、`browserView*` 命令族与主进程服务、CU sidecar 分发体系、Glass UI（`workbench.glass.main.js`，45MB 新前端）里的 CU 权限模态。
- **agent 编排三层扩展**：`cursor-agent-host`（orchestration，AgentExec 扩展宿主）→ `cursor-agent-exec`/`cursor-agent-worker`（执行）→ `cursor-local-agent-runtime`（CPI 本地推理），CU/BU 工具经 MCP 面进入该编排。

## 快速复核入口

```bash
V=/Applications/Cursor.app/Contents/Resources/app
ls $V/extensions | grep cursor-                 # 内置扩展清单
ls $V/extensions/cursor-computer-use/src/mcp/   # CU 源码（tools.ts / mac-mode.ts）
grep -o '"cursor\.browserView\.[a-zA-Z.]*"' -r $V/out/vs | sort -u   # 浏览器命令面
ls ~/.cursor/browser-logs/                      # BU 真实使用痕迹
ls ~/.cursor/computer-use-sidecar/              # CU 未安装（本机为空）
~/.local/bin/cursor-agent --help                # CLI 权限模型
```
