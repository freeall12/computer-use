# 证据清单（Evidence Inventory）

> 逆向对象：ZCode 桌面 Agent 的 computer use（原生桌面控制）与 browser use（浏览器控制）。
> 采集时间：2026-10-06。环境：macOS（darwin 27.0.0，arm64），ZCode.app 版本以 2026-09-29 构建为准。
> 本文所有路径均为绝对路径；所有结论的出处以「路径:行号」或「命令 + 输出摘录」标注。

---

## 1. 能力载体清单

### 1.1 插件缓存（~/.zcode/cli/plugins/cache/zcode-plugins-official/）

| 载体 | 版本 | 大小（关键文件） | 角色 |
|---|---|---|---|
| `computer-use/0.6.3/` | 0.6.3 | — | CUA SDK/skill/docs 插件（执行在共享 node_repl host） |
| `computer-use/0.6.3/scripts/computer-use-client.mjs` | — | 58,928 B（1209 行） | CUA SDK：模型可见的绑定对象 API 面 |
| `computer-use/0.6.3/skills/computer-use/SKILL.md` | — | 14,290 B | 模型面手册（skill） |
| `computer-use/0.6.3/docs/computer-use.md` | — | 23,218 B | 参数级参考（由 `agent.documentation.get("computer-use")` 按需拉取） |
| `computer-use/0.6.3/node_modules/` | sharp 0.34.x / koffi / semver / detect-libc | libvips dylib 16,001,776 B；koffi.node 1,320,720 B | 截图栅格处理（sharp/libvips）与 FFI（koffi） |
| `browser-use/0.5.1/` | 0.5.1 | — | Browser Use skill/docs/client 插件（**不再携带 dist/，与旧版关键差异**） |
| `browser-use/0.5.1/scripts/browser-client.mjs` | — | 79,261 B（2235 行） | 浏览器 SDK bootstrap（`setupBrowserRuntime`） |
| `browser-use/0.5.1/docs/api.json` | manifest v11 | 32,648 B | 浏览器对象模型清单（Proxy 成员可见性的事实来源） |
| `browser-use/0.5.1/docs/*.md` | — | overview 9,218 B 等 15 个文件 | overview/playwright/recording/screenshot/safety/tab-claiming 等 lookup-only 文档 |
| `browser-use/0.3.0~0.4.2/dist/mcp/server.js` | 0.3.0: 7,208,697 B；0.4.2: 18,559,278 B | — | **旧版自带的独立 node_repl MCP server**（0.5.1 起移除，改由 node-repl-host 提供） |
| `node-repl-host/0.6.0/dist/mcp/server.js` | 0.6.0 | 5,069,197 B | 共享 node_repl MCP 宿主：`js` 工具 + CUA/Browser 双桥接 + CUA broker 转发 |
| `zcode-cua/0.5.10/dist/mcp/server.js` | 0.5.10 | 3,232,538 B | 上一代独立 CUA MCP server（可对比工具面演进） |
| `zcode-cua/0.5.12/dist/mcp/server.js` | 0.5.12 | — | 同上；工具面含 screenshot / open_application / cursor_position 等 25 个工具 |

命令：`ls -laR ~/.zcode/cli/plugins/cache/zcode-plugins-official/`。

### 1.2 应用内资源（/Applications/ZCode.app/Contents/Resources/）

| 载体 | 大小 | 角色 |
|---|---|---|
| `app.asar` | 326,914,570 B | Electron 宿主（main / host / preload / renderer 四层） |
| `app.asar.unpacked/node_modules/node-pty/` | pty.node 103,280 B | 终端（与本主题弱相关） |
| `cua-helper/ZCode Computer Use.app/` | 主二进制 111,706,112 B | CUA Helper（懒启动的后台进程，权限中介 + 动作执行 + 截屏） |
| `cua-helper/.../Resources/ax_native.node` | 986,384 B | 原生 NAPI 模块：AX/CGEvent/ScreenCaptureKit/PiP/Ghost cursor |
| `macos-window-bounds/zcode-window-bounds` | 205,968 B | 窗口边界辅助 CLI |

Helper 安装副本（宿主从 app 包 staging 而来）：
`~/.zcode/computer-use/ZCode Computer Use.app`，安装锁 `.zcode-cua-helper-install.lock`（0 B，2026-08-26），
元数据 `.zcode-cua-helper-meta.json`（338 B），日志目录 `~/.zcode/computer-use/logs/`。

### 1.3 运行进程（ps 证据）

```
zcode-node-repl-mcp            # node_repl MCP server（node-repl-host 0.6.0 的 dist/mcp/server.js）
zcode-host-local-1             # 桌面宿主本地 agent 进程（负责拉起 MCP/注入 env）
ZCode（Electron main）+ ZCode Helper (Renderer/GPU)
zcode-cli                      # CLI 进程
```

采样时 Helper 未运行 —— 与「懒启动」设计一致（首次 CUA 调用触发拉起）。
命令：`ps aux | grep -i cua`；`ls /tmp/zcode-cua-501/`（不存在，Helper 停止后 socket 被清理）。

---

## 2. 关键文件摘录与出处

### 2.1 CUA SDK 头注释（逆向基线声明）

文件：`~/.zcode/cli/plugins/cache/zcode-plugins-official/computer-use/0.6.3/scripts/computer-use-client.mjs:1-23`

```js
/**
 * Computer Use SDK —— 模型可见面与 Codex 的 `cua` 逐字同构（去掉 browser 半边）。
 * 设计文档：zcode-cua/docs/refactor-port-specs/2026-09-10-cua-sdk-v3-api.md
 * 逆向基线：@oai/cua@0.2.4 的 tinysky_alt/types.d.ts 与 docs/tinysky-alt-core-node-repl.md
 * 三条原则（文档 §1）：
 *   R1 同名同签 ……
 *   R2 Codex 没有的能力先问能不能删 ……
 *   R3 安全语义只藏不删 —— state_id 强校验、frame 精确栅格、possibly_sent 防重放、
 *      controller lease、kill switch 全部保留，改为内部字段或类型化错误。
 * 与 Codex 的两处不可对齐（文档 §5）：
 *   1. node_repl 的 Worker 每次 `js` 调用都是全新的 ……
 *   2. 动作失败抛 ComputerUseError 并带 actionSent ……
 * 不融合 Browser Use：这里不存在 browsers / getBrowser / createBrowserTab / getTab ……
 */
```

### 2.2 存活的 14 个工具面与变更表

文件：`computer-use-client.mjs:31-72`

```js
const COMPUTER_METHOD_NAMES = Object.freeze([
  "list_apps", "list_windows", "get_app_state",
  "left_click", "scroll", "left_click_drag",
  "type", "set_value", "select_text", "key",
  "perform_action", "paste",
  "request_access", "stop_computer_control",
]);
// 2026-09-16：`open_application` 已在 producer 侧整体删除……
// 启动与激活并入 get_app_state 的透明拉起（与 codex 一致）
const PLATFORM_EXCLUDED_METHODS = Object.freeze({});
const MUTATING_METHODS = new Set([..., "stop_computer_control"]);
```

### 2.3 broker 错误码映射与重试策略

文件：`computer-use-client.mjs:77-131`。要点摘录：

- `ERROR_CODE_BY_BROKER`：`permission_denied→PERMISSION_DENIED`、`controller_busy→CONTROLLER_BUSY`、
  `broker_unavailable→HELPER_UNAVAILABLE`、`stale_socket→HELPER_UNAVAILABLE`、`unimplemented→ACTION_UNAVAILABLE`、
  `method_not_found→INTERNAL` 等（完整 16 项）。
- `REOBSERVE_CODES = {ELEMENT_UNAVAILABLE, STALE_STATE, STRUCTURED_STATE_UNAVAILABLE}`；
  `NEVER_RETRY_CODES = {CONTROLLER_BUSY, CONTROL_STOPPED, PERMISSION_DENIED, NOT_AUTHORIZED, VERSION_MISMATCH, ACTION_UNAVAILABLE, NOT_SETTABLE, NOT_SELECTABLE}`。
- `actionSent` 默认 false（注释：「默认 false 是**故意**的保守方向」）；
  `retry` 字段按 `actionSent ? "reobserve" : NEVER_RETRY ? "never" : REOBSERVE ? "reobserve" : "retry"` 推导。

### 2.4 Helper 冷启动 not-ready 契约

文件：`computer-use-client.mjs:248-277`

```js
const NOT_READY_KIND = "CUA_NOT_READY";
const NOT_READY_MAX_ATTEMPTS = 6;
const NOT_READY_BACKOFF_MS = [250, 500, 750, 1000, 1500];
```
producer 在 Helper 冷启动时返回非 error 结果 `{kind:"CUA_NOT_READY", reasonCode:"broker_not_accepting",
retryable:true, ...}`；SDK 按 backoff 重试同一调用（最多 6 次），`retryable=false` 或
`dispatch_status=possibly_sent` 时绝不重放。

### 2.5 diff 基线与 `tree_shown_to_model` 台账

文件：`computer-use-client.mjs:594-621`（observe()）与 `974-995`（bindApp 的绑定观察）

```js
if (yieldsTree === true && binding.treeSeen !== true) args.disable_diffing = true;
if (yieldsTree !== true) args.tree_shown_to_model = false;
```
注释（节选，`computer-use-client.mjs:598-606`）：「Bug 根因（2026-09-13 真机，会话 sess_04f97297）：
Helper 的 diff 基线是 snapshotCache.get(pid, window) —— 该 pid+窗口的上一次 capture，不管发起者是谁、
模型有没有看见。……飞书 930 个元素只吐出 8 行 AXMenuItem enabled 抖动」。
`bindApp` 的隐藏观察必须带 `tree_shown_to_model: false`（`:981`），否则「索引位移校验拿当前树
跟当前树自比，必然一致，静默点错元素的保护完全失效」（`:978-980` 注释）。

### 2.6 getApp 的身份收敛与窗口钉住校验

文件：`computer-use-client.mjs:1001-1043`

- 绑定成功后把 appRef 收敛为 `{pid, bundle_id, window_id?}`（真机 bug：「观察路径宽容、输入路径严格」——
  `getApp("地图")` 能观察但 `press_key_to_app` 按 name 严格匹配零行）。
- `window_id_fallback === true` 时抛 `STALE_STATE`（「Helper 静默降级到最前窗口并只回一句 note」）。

### 2.7 node_repl 桥接注入（宿主侧）

文件：`~/.zcode/cli/plugins/cache/zcode-plugins-official/node-repl-host/0.6.0/dist/mcp/server.js`

- 桥接符号（`server.js:116866`、`:117069`）：
  - `Symbol.for("zcode.node-repl.browser-control-bridge")` → `{list, execute, documentationRoot, assertAvailable}`
  - `Symbol.for("zcode.node-repl.computer-use-bridge")` → `{call, documentationRoot, assertAvailable}`
- 子代理禁用（`server.js:116883-116886`）：`requestMeta.runtime_scope === "subagent"` 时
  `assertAvailable()` 抛 `"Browser is not available in subagent"` / `"Computer Use is not available in subagent"`。
- 每次 `js` 调用 = 一个全新 `Worker(new URL(import.meta.url))`，workerData 携带
  `{code, kind:"zcode-node-repl-call", requestMeta, syncTimeoutMs, cuaBroker}`（`server.js:117750-117768`）；
  执行完即 `worker.terminate()`。会话键按 `session_id` 串行化（`serialized(sessionKey, ...)`，`server.js:117703`）。
- node_repl → CUA 转发 broker（`server.js` `src/cua-broker.ts` 段）：本地 socket
  `/tmp/zcode-cua-<uid>/znrc-<uuid>.sock`（win32 命名管道），token = 32 字节随机 hex，
  `MAX_REQUEST_BYTES = 1 MiB`；响应上限 32 MiB。
- 传输格式：`{"id":<uuid>,"token":<hex>,"method":"get_app_state","input":{...},"context":{runtimeScope,sessionId,workspaceKey,turnId?,clientMode,deliveryKind,trace?}}\n`。

### 2.8 CUA 权限中介（Helper 侧 broker）协议常量

文件：`server.js:108713-109100`（`src/permission-broker` 打包段）

```
MAX_FRAME_BYTES = 64 MiB; MAX_HOLD_DURATION = 30s; DEFAULT_RPC_DEADLINE_CAP = 45s
ALLOW_ANY_PEER_ENV = "ZCODE_CUA_BROKER_ALLOW_ANY_PEER"; ALLOW_DEV_BROKER_ENV = "ZCODE_CUA_ALLOW_DEV_BROKER"
CUA_NOT_READY_KIND = "CUA_NOT_READY"
REASON: broker_not_accepting / permission_refresh_in_progress / permission_refresh_invalid /
        broker_response_ambiguous / caller_timeout / restart_deferred_active_turn
CUA_BROKER_IPC_VERSION = 2   // authenticate 行：{id:0, method:"authenticate", params:{clientApiVersion:2,...}}
```
socket 信任校验（`defaultPeerCredentialChecker`）：`stat(socket)` 的 uid 必须是自身 euid 或 0，
mode 不可 world-writable（`server.js:108916-108943`）；win32 管道名必须匹配
`^\\\\\.\\pipe\\zcode-cua-helper-(?:[0-9a-f]{8,}|default)$`。

broker socket 路径解析（`server.js` `src/broker/socketPath.ts` 段）：

```js
BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET"
BROKER_SOCKET_FILENAME = "broker.sock"
darwin: join("/tmp", `zcode-cua-${uid}`)   // XDG_RUNTIME_DIR 优先
win32:  \\\\.\\pipe\\zcode-cua-helper-default
STALE_SOCKET_MAX_AGE_MS = 24h
```

### 2.9 not-ready 语义（工具层）

`server.js:108769-108790`：

```
BROKER_RESPONSE_AMBIGUOUS_MESSAGE = "The Helper may have accepted this action, but its response was lost.
  Do not replay it automatically; observe the target state first."   // retryable=false
NOT_READY_MESSAGE = "The ZCode Computer Use is starting up and its permission broker socket is not
  accepting connections yet. Retry the same tool call after a brief wait."  // retryable=true
```
`request_delivery_state === "possibly_sent"` 时强制 `broker_response_ambiguous` + 不可重试（`server.js:108830`）。

### 2.10 工具分层（tier table）与 kill switch

文件：`server.js:111255-111282`：

```
READ_ONLY: list_apps, list_windows, get_app_state, request_access
T1_INPUT:  left_click, scroll, left_click_drag, type, set_value, select_text, key, perform_action, paste
SAFETY_CONTROL: stop_computer_control
```
`KillSwitch`（`server.js:110447-110490`）：`stop(reason)` 闩锁（幂等，保留第一个 reason）；
每个工具入口 `ensureRunning()` 在任何 backend 读取前 fail-hard（抛 `ControlStopped`）；
`request_access` 与 `stop_computer_control` 豁免（`KILL_SWITCH_EXEMPT`，`server.js:111869`）。

### 2.11 动作后稳定等待（ActionSettler）

文件：`server.js:110330-110412`（中文注释原文）：
「一次动作成功之后调用：把该 target 的 deadline 推到 now + postActionMs……只推高不回退」；
「快路径不经过 observationBaseMs：树一旦与动作前不同就直接返回，实际等待就是那 300ms」。
常量：`postActionMs=300ms`、`observationBaseMs=1s`、`observationCeilingMs=5s`、`stabilityPollMs` 指数退避
（默认值见 `DEFAULT_POST_ACTION_MS` 等常量段）。

### 2.12 模型可见树台账（索引位移防错）

文件：`server.js:111082-111133`。`recordModelVisibleTree(state)` 中文注释原文：
「记下这棵树的元素身份——只在树真的跨越到模型时调用（observation.ts 的 publicAppState 处），
否则台账会把模型没看过的树当成看过的，校验反而失真。」
台账按 `MAX_MODEL_VISIBLE_TREES` 容量 LRU；每元素存 `{fingerprint（含 app/window 上下文）, displayTitle（原样标题）}`；
配套查询 `modelVisibleIdentityAt` / `modelVisibleIdentityCount`（对应 codex 的
`elementAmbiguousBeforeRefetch` 档：「判据在原始树里就已经不唯一时，重取无从开始」）。

### 2.13 Helper 主进程 = Node SEA

```
$ file ".../MacOS/ZCode Computer Use"
→ Mach-O 64-bit executable arm64
$ strings ... | grep NODE_SEA
→ "Invalid snapshot data in single executable binary"
→ NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1
```
内嵌 `helper.cjs` 构建路径证据（strings）：
`/Users/codegeex/builds/BSsaHRPRU/1/codegeex/z-code/.tmp/cua-helper-build-HJZzDq/helper.cjs`。
otool -L 仅链接 CoreFoundation / Security / libc++ / libSystem —— Node 静态内联，macOS API 全部走
`ax_native.node`。

### 2.14 ax_native.node 符号表（关键导出）

命令：`nm -gU ax_native.node`（共 105 行导出）。按功能分组摘录：

- CGEvent 键盘：`_ZCodePostKeyboardEventToWindowP9__CGEventij`（唯一显式 CGEvent 符号）
- Ghost 合成光标（可视化反馈层）：`GhostInit/Show/Hide/Move/MoveTarget/State/RenderPng/ClickRipple/
  SetEnabled/SetCapture/SetControllerStatus` + 数据符号 `_ghost_cursor_move_to` 等
- PiP 画中画（任务可视层）：`PipStart/PipStartVerified/PipStartVerifiedAsync/PipStartVerifiedCompositeAsync/
  PipStop/PipStopTarget/PipDismiss/PipIsDismissed/PipBeginTurn/PipTaskCompleted/PipFreezeGroup/
  PipSetActiveGroup/PipGetLeadTarget/PipGetStackCount/PipGetStackTargets/PipGetWindowBounds/
  PipIsInteractionReady/PipVerifyInitialHitSurface/PipSetLiveLegacyCaptureDelay/...`
  （含一批 `PipSimulate*` 故障注入钩子）
- 后台输入（合成焦点）：`RegisterBackgroundInput` + `_background_input_ms_since_focus_end_for_pid`、
  `_background_input_busy`
- 安全：`PeerCodeSigningSummary`、`ParentProcessPid`、`ResponsibleProcessPid`、`SetCpsActivationDisabled`、
  `CuaCopyWindowAcceptsLeftMouseDown`
- Objective-C 类：`ZCodeCuaPasteDataProvider`（剪贴板 paste 数据提供）、`ZCodeOneShotStreamOutput`、
  `ZcPipController/ZcPipImageView/ZcPipCloseButtonView/ZcPipCompletionBadgeView`
- AX 选择器字符串（strings）：`AXUIElement` 系全套 —— `AXTitle/AXValue/AXRole/AXSubrole/AXPosition/AXSize/
  AXFocusedWindow/AXFocusedUIElement/AXManualAccessibility/AXEnhancedUserInterface/AXPress/AXRaise/
  AXSelectedTextRange/AXVisibleChildren/...`；`CGEventSetWindowLocation`
- 链接库（otool -L）：Cocoa、ApplicationServices、CoreGraphics、ImageIO、Security、QuartzCore、
  **ScreenCaptureKit（weak）**、CoreMedia、CoreVideo、AppKit、CoreFoundation、CoreServices、Foundation、libobjc

### 2.15 Helper RPC 方法名（SEA 二进制 strings 提取）

命令：`grep -ao "capture_app[a-z_]*\|press_key[a-z_]*\|..." <helper binary> | sort | uniq -c`

```
33 press_key_to_app    32 type_text_to_app    28 capture_app    22 hold_key_to_app
16 set_value           12 press_key            9 type_text       9 hold_key
 9 capture_surfaces     8 select_text          7 request_access  7 perform_action
 7 list_windows         1 stop_computer_control  1 paste_provided/legacy_path/failed
 1 background_input_busy（ax_native）
```
`*_to_app` 后缀 = 面向具体 app/窗口的后台键盘路径（合成焦点会话）；
`capture_surfaces` = 多 surface（attached_dialog/open_panel/save_panel/popover）捕获。

### 2.16 真实运行日志（~/.zcode/computer-use/logs/zcode-cua-helper-2026-10-05.jsonl）

- 权限中介 socket：`"permission broker socket is already in use: /tmp/zcode-cua-501/broker.sock"`
  （证明 Helper 在 `/tmp/zcode-cua-<uid>/broker.sock` 宿主权限中介）。
- 同行调用栈暴露内嵌脚本名 `helper.cjs` 与函数 `CuaPermissionBrokerServer.unlinkStaleSocketIfSafe`。
- 端到端动作证据（AX 路径）：
  ```json
  {"event":"cua.element_action","context":{"action":"AXPress","role":"AXButton","kind":"button",
   "target_pid":65178,"target_bundle_id":"com.minimax.hub","target_active":false,
   "identity_resolved":true,"window_id":8613,"bracketable":true}}
  {"event":"cua.element_press_focus","context":{"label":"项目库","ref":"axh-2204",
   "bounds":[116,152,264,34],"ax_ok":true,"guardEngaged":true,"frontmostPid":57104,
   "focusSetStatus":"invalid_element","pressMs":2.15}}
  ```
  → AXPress 前置焦点 guard（`guardEngaged`）、前台 PID 检查、合成焦点失败上报
  （`focusSetStatus:"invalid_element"` 但 `ax_ok:true` —— 动作仍被受理）。
- 坐标路径证据（event 路径）：
  ```json
  {"event":"macOS window pointer dispatched","context":{"pointer_action":"click_to_window",
   "action_sent":true,"native_args":"[65178,\"com.minimax.hub\",8613,[116,33,1280,800],581.5,433.5,\"left\",1,null]"}}
  ```
  → 坐标点击被归一为「pid + bundle_id + window_id + 窗口 bounds + 窗口内相对坐标」派发（非全局屏幕坐标）。
- PiP 会话证据：`{"event":"PiP presentation turn reset applied","context":{"sessionId":"sess_e902...",
   "turnId":"turn_b35c...","supersededCapture":false}}` —— PiP 展示层按 session/turn 生命周期复位。
- 安全体证据：`"cua broker rejected connection: peer verification failed"`（对端校验拒绝过一次连接）。
- 安装元数据 `~/.zcode/computer-use/.zcode-cua-helper-meta.json`：
  ```json
  {"provider":"zcode-cua-helper","version":"0.0.0-dev","buildId":"pipeline-298526-10bbcea5",
   "platform":"darwin-arm64","source":"bundled:zcode-app","bundleId":"dev.zcode.cua-helper",
   "displayName":"ZCode Computer Use","teamIdentifier":"8A5X4JJ39T",
   "verificationMode":"release","releaseEligible":true}
  ```

### 2.17 Helper 代码签名

```
$ codesign -dv ".../ZCode Computer Use.app"
Identifier=dev.zcode.cua-helper  TeamIdentifier=8A5X4JJ39T
flags=0x10000(runtime)  Runtime Version=15.0.0   ← Hardened Runtime
```
Info.plist：`LSUIElement=true`（后台 helper）、`NSAppleEventsUsageDescription`（控制 System Events 激活目标 app）、
`LSMinimumSystemVersion=12.0`、`ZCodeCUAHelperBuildId=pipeline-298526-10bbcea5`。

### 2.18 宿主侧 Helper 安装/拉起（app.asar 解包证据）

解包：`npx @electron/asar extract app.asar /tmp/zcode-asar`（只读分析，原件未动）。
文件 `/tmp/zcode-asar/out/host/index.js`（压缩 JS，以下为函数名字符串）：

- 安装计划：`expectedTeamIdentifier: ... || "8A5X4JJ39T"`（TeamID 硬钉）、
  `"embedded Computer Use Helper build identity; refusing an unpinned Helper install"`、
  bundled 来源 `process.resourcesPath + "/cua-helper"`（env `ZCODE_CUA_BUNDLED_HELPER_APP_PATH` 可覆盖）、
  下载来源 `ZCode-CUA-Helper-${version}-mac-${arch}.zip`（`ZCODE_CUA_HELPER_DOWNLOAD_URL`，上限 200MB）。
- staging：先装到 `.cua-helper-install-<rand>` 临时目录 → 校验 → 原子 promote 到 `appPath`；
  安装锁 `.zcode-cua-helper-install.lock` + `acquireMacOSCuaHelperInstallLease`（持有期复查 lock 的
  dev/ino 防并发安装）。
- socket 注入：`injectPermissionBrokerConfig` —— 给 Helper argv 加 `--permission-broker-socket <path>`，
  env 加 `ZCODE_CUA_PERMISSION_BROKER_SOCKET` 与 `ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER`；
  `mintBrokerSocketPath()` 生成**每会话** socket `broker-<8字节hex>.sock`（并清理 24h 前的陈旧 socket）；
  `publishCuaBrokerRefreshMarker()` 以 `wx` 独占创建 + fsync + rename 原子发布刷新标记。
- 拉起参数常量：`--controller-variant`（stable/preview/dev-desktop/standalone）、`--disable-cps-activation`、
  `--allow-unsigned-launcher-local-dev`、env `ZCODE_CUA_LAUNCHER_PID`。
- 未受信 MCP 拒绝：`isUnbrokeredZCodeCuaAgentMcpServer` —— 没有 broker env 的 CUA MCP server 会被
  `omitUnbrokeredZCodeCuaAgentMcpServers` 剔除；官方插件身份还需通过
  `isAuthorizedOfficialZCodeCuaPluginServer`（pluginAuthority 校验）。

### 2.19 浏览器对象模型清单（api.json manifest v11）

文件：`~/.zcode/cli/plugins/cache/zcode-plugins-official/browser-use/0.5.1/docs/api.json`
（`python3` 解析输出）：

```
Agent(2): browsers, documentation
Browsers(5): list, get, getDefault, getForUrl, open
Browser(6): browserId, capabilities, tabs, nameSession, user, documentation
BrowserUser(3): claimTab, history(unsupported:iab), openTabs
Tabs(5): list, selected, get, new, finalize(unsupported:iab/cdp)
Tab(20): id, capabilities, goto, back, forward, reload, close, url, title, screenshot, getJsDialog,
         setViewportSize, viewportSize, recording, finalize, markDeliverable, markHandoff, cua, dom_cua, playwright
BrowserRecordingAPI(3): start, status, cancel
PlaywrightAPI(16): domSnapshot, elementInfo, elementScreenshot, evaluate, expectNavigation, frameLocator,
         getBy*, locator, waitForEvent, waitForLoadState, waitForTimeout, waitForURL
PlaywrightLocator(32): all, allTextContents, and, check, click, count, dblclick, downloadMedia, evaluate,
         fill, filter, first, getAttribute, getBy*, innerText, isEnabled, isVisible, last, locator, nth,
         or, press, selectOption, setChecked, textContent, type, uncheck, waitFor
CUAAPI(8): click, double_click, downloadMedia(unsupported:iab), drag, keypress, move, scroll, type
DomCUAAPI(7): click, double_click, downloadMedia(unsupported:iab), get_visible_dom, keypress, scroll, type
```
成员可见性由 `BrowserApiPolicy` + `createBrowserApiProxy`（Proxy `hideUnknown`）执行：
`unsupportedByDefaultIn` 与 `requiresCapabilities`（`browser:<id>` / `tab:<id>`）不满足的成员被隐藏
（`browser-client.mjs:450-548`）。

### 2.20 浏览器传输桥（node_repl → 桌面宿主 broker）

文件：`browser-client.mjs:2212-2226`：

```js
var NODE_REPL_BROWSER_BRIDGE_SYMBOL = Symbol.for("zcode.node-repl.browser-control-bridge");
```
文件：`node-repl-host/0.6.0/dist/mcp/server.js:116828-116829`：

```js
var NODE_REPL_BROWSER_BROKER_SOCKET_ENV = "ZCODE_NODE_REPL_BROWSER_BROKER_SOCKET";
var NODE_REPL_BROWSER_BROKER_TOKEN_ENV  = "ZCODE_NODE_REPL_BROWSER_BROKER_TOKEN";
```
协议：newline-delimited JSON over local socket；请求
`{"id":<uuid>,"token":...,"op":"list"|"execute","browserId","browserGeneration","command":{method,...}}`；
响应带 zod schema 校验（`nodeReplBrowserBrokerResponseSchema`）+ `id` 回对照校验；32 MiB 响应上限。
`mergeBrowserResponseMeta` 把 `codex/browserUse`、`codex/toolSurface{kind:"browserUse",backend,browserId,openTabIds}`、
`browser_use:{url}`、`zcode/browserTurnScreenshot` 等合并进 MCP `_meta`（宿主专用，模型不可见）；
截图结果进入 `session.recordBrowserScreenshot`。

### 2.21 浏览器命令层（RawTab 方法 → wire method）

文件：`browser-client.mjs:1551-1625`（`RawTab` 类）。wire method 全集：
`navigate/getState/screenshot/back/forward/reload/snapshot/click/type/press/scroll/hover/select/check/drag/
close/elementInfo/evaluate/getDialog/handleDialog`，加上高层命令
`playwright`（action 袋）、`playwrightWaitForTimeout`、`browserVisibilityGet/Set`、
`recordingStart/recordingStatus/recordingCancel`、`browserViewportSet`、`listUserTabs/nameSession/finalizeTabs` 等
（宿主侧 schema 见 `/tmp/zcode-asar/out/host/chunk-AIU63WBB.js` 的
`"navigate","back",...,"handleDialog"` 枚举）。
Playwright locator 串行化为 `internal:role=...` 等 Playwright selector 字符串
（`roleSelector/textSelector/labelSelector/...`，`browser-client.mjs:984-1003`）。

### 2.22 Electron main 侧 IAB

文件：`/tmp/zcode-asar/out/main/index.js`：
- `executeBrowserCommandOnView`（`s(Ys,"executeBrowserCommandOnView")`）—— 命令落到具体 view；
  超时/取消归类为 `cancelled` / `timeout` / `execution_error`。
- 录制：`out/main/browserWebmRecorder.js` + preload `browserVideoRecorder.cjs`；
  chunk-SPTKPKUJ.js 中 `webm` 出现 8 次；docs/recording.md 明确「ZCode uses Electron's built-in
  Chromium MediaRecorder; recording does not require FFmpeg」。
- JS 对话框：preload `embeddedBrowserJavaScriptDialog.cjs`；CUA 权限面板：preload `cuaPermissionPanel.cjs`。
- 后端类型枚举：`"iab","extension","cdp"`（`/tmp/zcode-asar/out/host/chunk-AIU63WBB.js`）。

### 2.23 新旧版本演进证据

- 旧 `zcode-cua/0.5.12/dist/mcp/server.js` 工具名（grep `name: "..."`）：
  `screenshot, cursor_position, double_click, right_click, middle_click, mouse_move, left_mouse_down,
  left_mouse_up, hold_key, key, open_application, list_displays, switch_display, read_clipboard, ...
  list_apps, list_windows, get_app_state, left_click, left_click_drag, scroll, type, set_value,
  select_text, perform_action, request_access, stop_computer_control` —— **屏幕级**工具面。
- 现 0.6.3：收缩为 **app 级 14 工具**；`open_application` 删除（透明拉起并入 get_app_state）；
  屏幕级原语（screenshot/cursor_position/mouse_move/多显示器）全部退场。
- `check-cua-baseline.mjs:21-22`：producer pin 形如
  `git+https://dev.aminer.cn/codegeex/zcode-cua.git#<40位commit>`，双别名
  （`@zcode/zcode-cua` 与 `@zcode/zcode-cua-helper-runtime`）必须钉同一 commit。
- browser-use 0.4.2 → 0.5.1：`dist/mcp/server.js`（18.5MB）整体移除，node_repl 宿主独立为
  `node-repl-host` 包；README 说明 `js_reset`/`js_add_node_module_dir` 于 2026-09-18 移除。
- node-repl-host README（中文原文）：「宿主是官方能力共用的……注册侧本来就已经收在 CLI 核心
  （bootstrap/src/app/built-in-node-repl.ts，判据是 bua 或 cua 任一启用）」。

### 2.24 与 video2code 插件的关系

`video2code/0.6.0/skills/env-setup/SKILL.md`：
「Browser interaction and recording use ZCode's built-in Browser Use WebView, so Playwright and external
Chromium are intentionally not installed.」「ZCode IAB + Browser Use recording API | URL 浏览、截图、交互和录制」
「内置 Browser Use 提供，版本不支持时应升级 ZCode，不要在插件环境里补装浏览器。」

---

## 3. 复现命令汇总

```bash
# 插件清单
ls -laR ~/.zcode/cli/plugins/cache/zcode-plugins-official/

# Helper 二进制
file "/Applications/ZCode.app/Contents/Resources/cua-helper/ZCode Computer Use.app/Contents/MacOS/ZCode Computer Use"
otool -L ".../Resources/ax_native.node"
nm -gU ".../Resources/ax_native.node"
strings ".../MacOS/ZCode Computer Use" | grep -ao "capture_app\|press_key_to_app\|..."

# 签名
codesign -dv "/Applications/ZCode.app/Contents/Resources/cua-helper/ZCode Computer Use.app"

# app.asar 解包（只读）
npx @electron/asar extract /Applications/ZCode.app/Contents/Resources/app.asar /tmp/zcode-asar

# 运行日志
cat ~/.zcode/computer-use/logs/zcode-cua-helper-$(date +%Y-%m-%d).jsonl
cat ~/.zcode/computer-use/.zcode-cua-helper-meta.json
```

## 4. 置信度标注

| 结论 | 置信度 | 依据 |
|---|---|---|
| 三层链路（node_repl 沙箱 → 会话/中介 → Helper → AX/CGEvent） | 高 | 源码 + 日志 + 二进制三重印证 |
| broker socket 路径/协议/token | 高 | server.js 常量 + 日志实证 |
| ax_native 各 API 组的用途 | 中高 | 符号名 + 选配日志；PiP/Ghost 具体触发策略未见源码 |
| controller lease 的宿主侧实现 | 中 | SDK/工具层语义明确；桌面宿主 `controllerLease` 注入点未解包到（可选依赖） |
| `extension` 后端（Chrome 扩展）能力边界 | 低 | 仅见类型枚举，本机无该后端运行证据 |
| Codex 对齐的逐字程度 | 中 | 依据 SDK 头注释的自述（R1/R2/R3）与注释中引用的 codex 行为，未见 Codex 原始代码 |
