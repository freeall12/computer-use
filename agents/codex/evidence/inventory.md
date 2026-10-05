# 证据清单：OpenAI Codex computer use / browser use 逆向

- 分析日期：2026-10-06
- 分析对象：本机（macOS，arm64，darwin 27.0.0）安装的 OpenAI Codex 全家桶
- 方法：只读静态分析。`strings`/`file`/`otool` 处理原生二进制；`js-beautify` 局部美化 minified JS；类型声明（.d.ts）与官方随包文档（docs/*.md）逐字阅读。所有解包/美化产物在 `/tmp/codex-re/`，未改动任何被分析对象。
- 标注约定：【实证】= 文件/二进制/命令输出直接可见；【推断】= 由旁证推导，需复核。

## 1. 能力载体清单

| 载体 | 路径 | 版本 | 角色 |
|---|---|---|---|
| Codex CLI（npm 包装） | `/opt/homebrew/lib/node_modules/@openai/codex/` | 0.155.1 | CLI 入口 `bin/codex.js`，按平台拉取原生二进制 |
| Codex 原生二进制（Rust） | `.../@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex` | 0.155.1 | Mach-O arm64，228,803,200 字节；内嵌确认策略 prompt、配置 schema、feature flags |
| Codex 桌面宿主 | `/Applications/ChatGPT.app` | app 构建 26.930.31730（BROWSER_USE_CODEX_APP_VERSION，见 unified-computer-use/.mcp.json） | Electron 宿主；内含 cua_node 运行时与 codex-cli 0.160.0 |
| 桌面内置 codex 二进制 | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/`（codex-package.json `version: "0.160.0"`） | 0.160.0 | 桌面 app 的 agent 后端（app-server） |
| cua_node 运行时 | `/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/` | — | 定制 Node；含 `@oai/cua@0.2.5`、`@oai/cua-repl@0.1.0`、`@oai/browser-desktop@0.1.1`、`@oai/sky@0.7.5`、playwright/playwright-core、sharp、pixelmatch |
| Sky CUA 服务 app | `/Users/laplace/.codex/computer-use/Codex Computer Use.app` | — | bundle id `com.openai.sky.CUAService`；macOS 桌面控制原生服务 |
| SkyComputerUseService | 同上 `Contents/MacOS/SkyComputerUseService` | — | Swift 24.5MB 主服务：AX 树、Skyshot、CGEvent 注入 |
| SkyComputerUseClient | 同上 `Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient` | — | Swift 多路复用二进制：turn-ended 通知器、computer-history MCP、record-and-replay 控制、computer_use MCP 面描述文本 |
| CUALockScreenGuardian | 同上 `Contents/SharedSupport/CUALockScreenGuardian.app` | — | 锁屏守护 |
| Codex Computer Use Installer | 同上 `Contents/SharedSupport/Codex Computer Use Installer.app`（含 CodexComputerUseAuthorizationPlugin.bundle） | — | 安装器 + 系统授权插件 |
| browser 插件 | `/Users/laplace/.codex/plugins/cache/openai-bundled/browser/26.930.31730/` | 26.930.31730 | browser-client.mjs（169,286 B）、browser-service.mjs（1,442,081 B）、browser-accessibility.wasm.br（4,084,148 B，brotli 压缩的 AX 渲染 WASM）、zxing_reader.wasm（1,065,866 B 二维码识别） |
| chrome 插件 | `.../openai-bundled/chrome/26.901.51231/`（有 latest 软链） | 26.901.51231 | Chrome/Edge/Brave/Opera 扩展桥；extension-host/macos/arm64/“ChatGPT for Chrome” 原生宿主 |
| unified-computer-use 插件 | `.../openai-bundled/unified-computer-use/26.930.31730/` | 同左 | 仅静态 manifest：声明 cua_repl MCP server |
| computer-use / computer-history / record-and-replay 插件 | `.../openai-bundled/computer-use@1.0.1001365`、`computer-history@1.0.1001365`、`record-and-replay@1.0.1000621` | — | 技能声明壳 + launcher |
| CodexBar.app | `/Applications/CodexBar.app` | 0.71.0 (162)，`com.steipete.codexbar`，© Peter Steinberger | **第三方**菜单栏应用（steipete/CodexBar，MIT，Sparkle 自更新），监控 Codex/Claude 等编码代理会话与配额；与 OpenAI computer use 栈无隶属关系【实证：Info.plist + 二进制 strings 含 "checking your browser"/配额/cookie 域逻辑】 |

用户配置关键项（`/Users/laplace/.codex/config.toml`）：
- `model = "gpt-6-astra"`、`approval_policy = "never"`、`sandbox_mode = "danger-full-access"`、`approvals_reviewer = "user"`
- `notify = [".../SkyComputerUseClient", "turn-ended"]`（实证：turn 结束回调指向 Sky 客户端二进制）
- 启用插件：`codex-app-tools`、`visualize`、`documents/pdf/spreadsheets/presentations/template-creator`（openai-primary-runtime）、`browser`、`unified-computer-use`、`computer-use`、`computer-history`、`code-review`（均 openai-bundled）
- `~/.codex/browser/config.toml`：`approval_mode = "never_ask"`、`full_cdp_access_enabled = true`、`history_approval_mode/download_approval_mode/upload_approval_mode = "never_ask"`
- `~/.codex/browser/sessions/*.toml`：样例 `019f93f7-….toml` 内容仅 `[full_cdp]\nallowed = ["https://www.liblib.tv"]`（每会话 CDP origin 白名单）

## 2. cua 运行时（@oai/cua / @oai/cua-repl）

### 2.1 包与导出
`@oai/cua@0.2.5`（package.json，作者 noahj）exports：
- `.` → `dist/lib/js/oai_js_cua/src/index.js`（导出 `cua`）
- `./tinyskyAlt` → `tinysky_alt/globals.js`
- `./tinyskyBrowser` → `tinysky_browser/create_tinysky_browser.js`

`@oai/cua-repl@0.1.0`："CUA MCP interface for NodeREPL."，bin `cua-repl.mjs`。
`@oai/sky@0.7.5` exports `.` 与 `./service`；publishConfig 列出可执行文件：SkyComputerUseService、CUALockScreenGuardian、SkyComputerUseClient、Installer、AuthorizationPlugin（normal/relaxed 两个构建变体）。
`@oai/browser-desktop@0.1.1`："Production browser runtime for Codex Desktop."，exports `./scripts/browser-client.mjs` 与 `./service`（→ browser-service.mjs）。

### 2.2 unified-computer-use 插件 .mcp.json（全文关键段，路径 `.../unified-computer-use/26.930.31730/.mcp.json`）
```json
{
  "mcpServers": {
    "cua_repl": {
      "command": "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
      "args": [".../@oai/cua-repl/bin/cua-repl.mjs"],
      "enabled_tools": ["js", "js_reset", "turn_ended"],
      "env": {
        "BROWSER_USE_AVAILABLE_BACKENDS": "chrome,iab,mcpapps",
        "BROWSER_USE_TINYSKY_ENABLED": "1",
        "NODE_REPL_TRUSTED_SERVICES": "{\"browser\":\"@oai/browser-desktop/service\",\"sky\":\"@oai/sky/service\"}",
        "SKY_CUA_SERVICE_PATH": "/Users/laplace/.codex/computer-use/Codex Computer Use.app",
        "CODEX_CLI_PATH": "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
        "CUA_REPL_NODE_REPL_PATH": ".../cua_node/bin/node_repl",
        "CUA_REPL_ENABLED_SURFACES": "browser,computer"
      }
    }
  }
}
```
另有 `NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER/CHROME/COMPUTER_USE` 三条用途指引；`js` 工具 `output_token_limit: 25000`；`startup_timeout_sec: 120`。

### 2.3 cua-repl README（`@oai/cua-repl/README.md` 关键摘录）
- "Desktop copies `@oai/cua-repl/plugin` from the selected `cua_node` runtime…"
- "`CUA_REPL_BROWSER_ENV`：可选 `codex-app`、`training`、`cloud` 或 `orbit`……`cloud` 和 `orbit` 也会选择 CDP 浏览器指令。"
- banner 默认值：`await import("@oai/cua/tinyskyAlt");`（instructions/banner.js）
- "Resetting the REPL runs the banner again with a fresh cache"
- 训练侧：`TinySkyMatrices` / `SetupNode`（qstar.common.tools.unified_tool.variants.cua_cbv10）

### 2.4 随包官方文档（`@oai/cua/docs/`）
| 文件 | 内容 |
|---|---|
| tinysky-alt-core-node-repl.md（298 行） | node_repl 版完整 API（TypeScript 接口全文）+ 工作流 + 输出契约 + 平台差异注记 |
| tinysky-alt-core-cua-repl.md（214 行） | cua_repl 版同上（无 `initialize()` 的 `cua` 声明、无 computer.drag_handle 等） |
| tinysky-alt-confirmations.md（78 行） | Computer Use 确认政策（4 档 + 编号风险目录 [1]–[17]） |
| tinysky-alt-other-browser-apis.md（18 行） | 何时用 Playwright locators 替代 AX |

API 类型全文见 `dist/lib/js/oai_js_cua/src/tinysky_alt/types.d.ts`（TinySkyAlt / TinySkyBrowser / Target / App / Tab / State 等接口，见 computer-use.md 正文引用）。

## 3. Sky（@oai/sky）类型与传输实证

### 3.1 三个平台客户端（`sky_js/src/types/SkyClient.d.ts`）
`SkyClient = FullDesktopComputerUseClient | WindowComputerUseClient | Window2ComputerUseClient`，target 分别为 `"linux" | "mac" | "windows"`。

mac（Window client，`types/window/WindowComputerUseClient.d.ts`）方法面：
`click, drag, get_app_state, list_apps, paste, perform_secondary_action, press_key, scroll, select_text, set_value, type_text, start_audio_recording?, stop_audio_recording?` —— **无 launch/activate 原语**【实证】。

linux（full-desktop，`types/full-desktop/FullDesktopComputerUseClient.d.ts`）额外有：
`activate_window, move, move_relative, key_down, key_up, clipboard_read/write/release, drag_handle, launch_app, get_window_state, list_windows, get_screenshot`（音频录制可选）。

### 3.2 mac JS 客户端（`targets/mac/client.d.ts`）
`MacComputerUseClient` 方法：`listApps, startAudioRecording, stopAudioRecording, getAppPolicy, startApp, getAppState, click, drag, paste, performSecondaryAction, pressKey, scroll, setValue, selectText, typeText`。
```ts
export type MacAppPolicyResult = {
  allowPersistentApproval: boolean;
  decision: "allowed" | "denied" | "forbidden";
  target: MacAppPolicyTarget; // { appPath, bundleIdentifier, displayName, risk: "high"|"low", warningSubtitle? }
};
export type MacWindowAppState = {
  app: AppIdentifier | MacApp;
  appSpecificInstructions?: string | null;
  skyshot?: MacWindowSkyshot;   // { text: string; screenshot?: { url?, mimeType? } | null }
};
```

### 3.3 原生管道（`targets/mac/native-pipe.js`，反混淆要点）
- socket 默认路径：`$SKY_CUA_SERVICE_NATIVE_PIPE_PATH` 否则 `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`
- 帧格式：4 字节 UInt32LE 长度前缀 + JSON；单帧上限 `const k = 8388608`（8 MiB）
- JSON-RPC 2.0，方法：
  - `ping`：参数 `{clientApiVersion}`；响应 `serverApiVersion` 不匹配即抛 `SkyComputerUseAPIVersionMismatch`
  - `request`：参数 `{clientApiVersion, codexTurnMetadata, deadlineUnixMilliseconds, requestType, request}`
- 连接失败自愈链：宿主 services 管道（`NODE_REPL_HOST_SERVICES_PIPE_PATH`）发 `ensureService` `{service:"computer-use"}` → 失败则 `nodeRepl.launchServices.openApplication({applicationPath: $SKY_CUA_SERVICE_PATH 或 $CODEX_HOME/computer-use/Codex Computer Use.app})` 兜底 `{bundleIdentifier:"com.openai.sky.CUAService"}` → 重连（250ms 窗口 → 启动后 5s 窗口）
- 前置条件：`globalThis.nodeRepl` 必须存在且带 `nativePipe.createConnection`（"Sky Computer Use requires the trusted nodeRepl runtime"）

### 3.4 审批遥测（`targets/mac/computer-use-telemetry.d.ts`）
```ts
type ApprovalResult = "accepted" | "canceled" | "declined";
logComputerUseApprovalRequested({bundleIdentifier, eventCreatedAt, toolName});
logComputerUseApprovalResolved({approvalPersistence?: "always"|"session", approvalResult, bundleIdentifier, toolName});
logComputerUseToolCalled({bundleIdentifier?, durationMs, terminalStatus: "cancelled"|"completed"|"failed", toolName});
```
`ComputerUseToolName = keyof T.Window.Client`（即 mac 客户端方法名即工具名）。

## 4. SkyComputerUseService 二进制符号证据（strings，24.5MB Swift）

模块：`ComputerUse`、`ComputerUseCore`、`AccessibilitySupport`、`SystemSoftware`、`SQLite`、`SwiftProtobuf`。
- AX 树与 diff：`AccessibilityNode/AccessibilityRole/AccessibilityRenderingContext`、`AXManualAccessibility`（对 Electron 类 app 手工开 AX 的 SPI）、`AXObserver`、`AXUIElementDestroyed`、`SystemFrontmostApplicationTracker…Observer`、`UIElementRenderDifference(Buffer)`、`axTreeDiffing`、`axTreeDiffingRemovedElementIDRanges`、`enableAXDiffing`、`isAXTreeDiffingEnabled`、`disableDiff`、`AccessibilityDifferenceLineBudgetExceeded`（diff 行数预算超限错误）
- 截屏：`SCStream`（ScreenCaptureKit）、`Skyshot / SkyshotAXTree / SkyshotCapture / SkyshotOperation / SkyshotRequest / SkyshotResult / SkyshotAttachment / SkyshotClassifier / skyshotImageFiles`
- 输入：`CGEvent/CGEventType/CGEventRef/CGEventFlags/CGEventTap*`、`VirtualCursor`、`EditableTextObject`、`draggingSession/dragContinuation/clickEventTap/scrollObserver`
- 锁屏防护：`LockScreenMonitor / LockScreenGuardian / LockScreenController / LockScreenOverlayPresenter / LockScreenPhysicalInputMonitor / LockScreenLoginAuthorizationApprover / SAILockScreenGuardianXPCProtocol`、socket `/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock`、`IPCRequestExemptFromLockScreenAutoUnlock`
- IPC：`ComputerUseIPCJSONRPCSocketHandler/Server/Connection`、`ComputerUseJSONRPCAPIVersion`、`ComputerUseJSONRPCCodexTurnMetadata`、`CodexAppServerJSONRPCConnection/Error`
- 审批：`AppApprovalStore`、`AnalyticsEvents_V1_CodexComputerUseMcpAppApprovalRequested/Resolved`、`AnalyticsEvents_V1_CodexApprovalRequestResponded`、`AnalyticsEvents_V1_CodexMessagesApproval*`、`CODEX_MESSAGES_APPROVAL_OPERATION_{READ_IMAGE,READ_MESSAGES,SEARCH_MESSAGES,SEND_MESSAGE}`、`CODEX_MESSAGES_APPROVAL_PERSISTENCE_{ALWAYS,ONCE,SESSION,TURN}`、`CODEX_MESSAGES_APPROVAL_RESULT_{ACCEPTED,CANCELED,DECLINED,ERROR}`、文案 "Computer Use approval denied via MCP elicitation for app '…'"、"Computer Use could not persist the approval permanently for app '…'"
- 目标策略：`ComputerUseAllowForbiddenTargets`；客户端二进制含 kill-switch 文案（见 §6）
- 允许的宿主 app id（客户端二进制 strings）：`com.openai.chat`（+alpha/beta/nightly/mac）、`com.openai.codex`（+alpha/beta/dev/nightly/computer）、`com.openai.atlas`（+alpha/beta）、`com.openai.sky.app/computer/development.app`、`com.apple.finder`（上下文：`ComputerUseAllowForbiddenTargets` 附近，属策略表数据）【实证为字符串存在，语义归类为推断】

## 5. SkyComputerUseClient 二进制（多路复用 CLI）证据

- computer-history MCP 工具名：`computer_history_status / computer_history_pause / computer_history_resume / computer_history_get_settings / computer_history_update_settings`；`ComputerHistoryMCPServer/Command/Client/ToolDefinitionVersionInput/MCPToolError`
- computer_use MCP 工具描述文本（strings 原文摘录）：
  - list_apps："List the apps on this computer. Returns the set of apps that are currently running, as well as any that have been used in the last 14 days…"
  - start app/get state："Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app"
  - click："Click an element by index or pixel coordinates from screenshot"
  - set_value："Set the value of a settable accessibility element"
  - select_text："Select text inside a text element, or place the text cursor before or after it…"
  - scroll："Scroll an element in a direction by a number of pages"（参数注记 "Scroll direction: up, down, left, or right"）
  - drag："Drag from one point to another using pixel coordinates"
  - key："Press a key or key-combination on the keyboard, including modifier and navigation keys."
  - type："Type literal text using keyboard input"
- record-and-replay："Stop the active event stream recording if one is running and return status including paths to metadata and events during the recording."；用户文案 "ChatGPT will start recording your mouse clicks, text you type, and the content in windows you interact with until you press Stop (up to 30 minutes)."
- 事件名：`computer_use_mcp_tool_called / computer_use_mcp_tool_name / computer_use_mcp_approval_result / computer_use_mcp_approval_persistence / recording_granted / recording_controls_stopped / recording_controls_cancelled`

## 6. kill switch / 会话终止文案（客户端二进制 strings 原文）

> "This session has been stopped because Computer Use is not allowed on the current browser URL. Stop your work and send a final message noting why the session has been ended. Note that Computer Use is not allowed on this URL even if the user navigates to it themselves."

> "This application session has been explicitly stopped by the user for this turn. Stop your work and send a final message noting they stopped the session and you're ready to continue if they want you to. Computer Use can be used again in the next assistant turn."

> "Computer Use permissions are still pending. The user has not finished granting Accessibility and Screen Recording permissions in the ChatGPT Computer Use window. Call this tool again, as the user is almost done finishing granting permissions. Do not end your turn yet, just call this tool again."

## 7. Codex CLI（Rust）二进制字符串证据（0.155.1，536,523 行 strings）

### 7.1 内嵌 prompt
- `browser_use` / `computer_use` 键各映射 "# Computer/Browser Use Confirmation Policy…"（与插件 docs/confirmations.md 同源的模型侧策略）
- `node_repl_policy`："# Computer and Browser Use\n\nApply these rules only to computer and browser use through `node_repl` or `cua_repl`. Review nested tool calls recursively…" 定义 Consequential action / Access change / Non-trivial application state / Computer bypass，风险档 `high/critical/medium/low`，及 exfiltration 评估规则
- auto-review 拒绝话术：`rejection_instructions: "Do not bypass this rejection through a workaround or indirect execution…"`

### 7.2 配置 schema（反序列化键串）
- `BrowserUseConfigToml`：`allow_history_access, default_origin_policy, origins`
- `BrowserUseOriginPolicyConfigToml`：`access, downloads, uploads, full_cdp_access, persistent_approval, access_approval_lifetime, allow_webmcp, disable_auto_review`
- `ComputerUseConfigToml`：`allow_persistent_approval, default_app_access, allow_external_browser_settings_import`；`ComputerUseMacosConfigToml{bundle_ids}`；`ComputerUseWindowsConfigToml{aumids, exes{publisher}}`；`allow_locked_computer_use`
- feature flags：`browser_use, browser_use_full_cdp_access, browser_use_external, computer_use, in_app_browser, in_app_chat, in_app_dictation, in_app_local_automation, in_app_updates, allow_appshots, allow_remote_control, allow_browser_and_computer_use, guardian_approval/guardian, web_search, unified_exec…`
- 企业/托管策略键：`allowed_approval_policies, allowed_sandbox_modes, allowed_permission_profiles, allow_managed_hooks_only, enforce_residency, …`
- 插件 ID 串：`node_repl`、`turn_ended`、`chrome@openai-bundled, chrome-dev@openai-bundled, chrome-internal@openai-bundled, computer-use@openai-bundled, unified-computer-use@openai-bundled, cua_repl, browser@openai-curated-remote`
- 协作模式枚举片段：`…shell_command | browser_use | computer_use | message`；`computer_use_only | sandboxed_exec_commands`（代理运行模式）
- `LocalShellAction`、`initial_cua_call`（动作枚举成员，表明会话动作流里存在“首条 cua 调用”概念）【实证为字符串；具体枚举语义为推断】

### 7.3 后端 URL（非厂商噪声）
`https://chatgpt.com/backend-api/codex`、`https://chatgpt.com/backend-api/wham/app/appcast`、`https://chatgpt.com/codex-backend/agent-identity`、`https://ab.chatgpt.com/otlp/v1/metrics`（statsig key 内嵌）等；`codex_cloud_tasks_diff/exec`（云端任务工具名前缀）。

## 8. browser 插件证据（26.930.31730）

### 8.1 plugin.json
- 仓库字段：`https://github.com/openai/openai/tree/master/lib/oai_browser_use/plugin`（内部单仓路径）
- 别名：`@browser, @browser-use, browser-use, Browser, in-app browser`
- hooks：Interrupt/SubagentStop/Stop → `node_repl` server 的 `turn_ended` 工具（会话结束清理）

### 8.2 docs/api.json —— 浏览器统一 API（root="Agent"）
接口与成员全集（脚本抽取）：
```
Agent: browsers, documentation
Browsers: get, getDefault*, getForUrl*, list        (*documented:false)
Browser: browserId, capabilities, tabs, user*, documentation, history, nameSession
BrowserUser: claimTab, getTabContext, openTabs       (仅 extension 型)
Tabs: content, get, list, new, selected
Tab: ax, capabilities, clipboard, content, cua, dom_cua, dev, id, playwright,
     back, close, forward, getJsDialog, goto, markDeliverable, markHandoff,
     reload, requestManualHandoff, screenshot, title, url
AXAPI: click, drag, get, paste, performSecondaryAction, pressKey, scroll,
       selectText, setValue, typeText, write
ContentAPI: export, exportGsuite, exportYouTubeTranscript
CUAAPI: click, double_click, downloadMedia, drag, keypress, move, scroll, type
DomCUAAPI: 同 CUA + get_visible_dom
PlaywrightAPI/FrameLocator/Locator/Download/FileChooser: 完整 Playwright locator 面
TabClipboardAPI: read, readText, write, writeText
TabDevAPI: logs
AlertDialog/BeforeUnloadDialog/ConfirmDialog/PromptDialog: type/accept/dismiss
Documentation: get
```
browser 型枚举：`"iab" | "extension" | "cdp" | "mcpapps"`（browser-client.mjs `dd = t.enum([...])`）。

### 8.3 capabilities 文档
- browser 级：`management`（Chrome 兼容 windows/tabs/tabGroups/bookmarks，限组织类操作）、`viewport`（视口覆盖 set/reset）、`visibility`（显隐控制）
- tab 级：`cdp`（原始 CDP：`readEvents()` cursor/afterSequence 分页、`Target.attachedToTarget` 子 target、作用域限当前 web origin、要求先导航到 HTTP(S) 页）、`browserAuth`（安全表单凭据收集，值不回传模型）、`botDetection`、`pageAssets`、`webmcp`（`fetchTools()`/`tools.call()`/`tools.description()`）
- 安全错误目录（browser-client.mjs 常量）：`approval_cancelled / approval_failed_closed / approval_unavailable`（decisionSource=approval）、`browser_capability_blocked / browser_capability_unavailable / browser_context_unavailable / browser_navigation_blocked`（=browser）、`enterprise_policy_blocked`（=enterprise）；附"不得绕过/间接执行/换面重试"文案
- extension-ids.json：Chrome/Brave/Opera/Edge store id `hehggadaopoacecdllhhajmbjkdcmajg`（Chrome Web Store "ChatGPT"）、Edge `odlomjlbamekndcpllcnffbgeohgkmjh`
- 会话结束文档：`docs/browser-control-interruption.md`（扩展/用户接管时如何向用户转述）

### 8.4 指令文档（cua-repl instructions）
- `instructions/macos/browser.md`：getTab/createBrowserTab 决策树；`"iab"`、`"chrome"`、`"edge"`、`"mcpapps"`（`getBrowser({id:"mcpapps"})` 取任务侧边栏全屏 MCP App）
- `instructions/macos/browser-cloud.md` 与 `browser-cloud-guidance.md`：云端浏览器 id 固定为 `"cdp"`；"Always prefer this tool over the `control-browser` skill unless…"；browserAuth 能力引导
- `instructions/server.md`：`js` 工具描述 = "UI automation through cua_repl using the initialized cua API."；`code.md` = "JavaScript to execute using the initialized cua_repl runtime."；`reset.md`：重置不关 tab/不杀 app

## 9. ZCode 对照样本（用于差异核对，非 Codex 本体）

- `~/.zcode/cli/plugins/cache/zcode-plugins-official/computer-use/0.6.3/scripts/computer-use-client.mjs` 头注释：逆向基线为 `@oai/cua@0.2.4` 的 `tinysky_alt/types.d.ts` 与 `docs/tinysky-alt-core-node-repl.md`；原则 R1 同名同签 / R2 只加不减 / R3 安全语义只藏不删（state_id、frame 栅格、possibly_sent、controller lease、kill switch 为 **ZCode 自有**安全语义，"Codex 的动作全是 Promise<void>"）
- ZCode 0.5.14 dist/mcp/server.js 注册 30 个 MCP 工具（name: 列表见下），0.6.3 收敛为 14 方法核心面 `cua.computer`
- ZCode 30 工具全名：`cursor_position, double_click, get_app_state, hold_key, key, left_click, left_click_drag, left_mouse_down, left_mouse_up, list_apps, list_displays, list_windows, middle_click, mouse_move, open_application, perform_action, read_clipboard, request_access, right_click, screenshot, scroll, select_text, set_value, stop_computer_control, switch_display, triple_click, type, wait, write_clipboard, zoom`

## 10. 命令输出存档

```
$ file .../bin/codex
Mach-O 64-bit executable arm64                       # 228,803,200 bytes
$ file SkyComputerUseService
Mach-O 64-bit executable arm64                       # 24,509,440 bytes
$ file SkyComputerUseClient
Mach-O 64-bit executable arm64                       # (SharedSupport 下)
$ cat ~/.codex/plugins/.plugin-appserver/codex-cli/codex-package.json
{"layoutVersion":1,"version":"0.160.0","target":"aarch64-apple-darwin",
 "variant":"codex","entrypoint":"bin/codex","resourcesDir":"codex-resources","pathDir":"codex-path"}
$ cat ~/.codex/version.json
{"latest_version":"0.155.1","last_checked_at":"2026-09-21T15:47:55.037076Z","dismissed_version":"0.147.0"}
```

## 11. 本机可见边界（不可见部分）
- 云端 CDP 浏览器（browser id `"cdp"`）的服务端实现、协议与地域均在本机不可见；本机仅有客户端指令文档（browser-cloud.md）与 feature flag `browser_use_external`。
- Sky 服务的 Rust/Swift 源码不可见，仅有符号与文案；`@oai/cua` 的 JS 为编译产物（tslib 打包），未含 sourcemap。
- ChatGPT.app 的 Electron 主进程逻辑在 app.asar 内，本次未解包（cua/browser 全链路已由 Resources/cua_node 与插件缓存完整覆盖，asar 非必需）。
- `@oai/browser`（browser-client.mjs 引用的类型包 `B.GlobalAgentApi`）未在本机 node_modules 中单独出现，仅以打包后形态存在于 browser-client.mjs【推断：随 cua_node 分发时被打平】。
