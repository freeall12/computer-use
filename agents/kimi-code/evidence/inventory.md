# Kimi Code Computer/Browser Use 证据清单

> 逆向日期：2026-10-06。全部为只读分析；解包产物在 `/tmp`（kimicode-asar、webbridge-skill、kimicu-mcp-schemas.json 等），未修改任何被分析对象。
> 本文是 `agents/kimi-code/` 下三份文档的证据底账，每条结论均可回溯到本清单条目。

## 1. 能力载体与版本

| 载体 | 路径 | 版本 | 形态 |
|---|---|---|---|
| CLI | `/Users/laplace/.kimi-code/bin/kimi` | 0.39.1（`kimi --version`）；更新通道 latest 0.43.1（`~/.kimi-code/updates/latest.json`：`"source":"cdn"`） | Mach-O arm64，180,163,648 字节，**Node.js 单文件可执行**（内嵌 `node_use_bundled_v8`、`Support for bundled module loading or virtual file systems are under discussions in https://github.com/nodejs/single-executable`） |
| 桌面端 | `/Applications/Kimi Code.app` | 1.0.4（Info.plist CFBundleShortVersionString；asar 内 package.json `name=kimi-code-app`，`homepage=https://github.com/MoonshotAI/kimi-code-app`） | Electron，bundle id `com.kimi.code.desktop`，app.asar |
| Computer Use 伴生 app | `/Applications/KimiCU.app` | 0.6.6（Info.plist） | 原生 **Swift** 二进制 `Contents/MacOS/kimi-cu`（6,262,448 字节），bundle id `ai.kimi.cu`，`LSUIElement=true` |
| CU 常驻服务 | launchd label `ai.kimi.cu.service` | 同上 | `Contents/Library/LaunchAgents/ai.kimi.cu.service.plist`：`BundleProgram=Contents/MacOS/kimi-cu`，`ProgramArguments=[...,service]`，`MachServices={ai.kimi.cu.service:true}`，`RunAtLoad=false`（按需启动） |
| 浏览器桥守护进程 | `/Users/laplace/.kimi-webbridge/bin/kimi-webbridge` | v2.0.22（daemon.log；`-ldflags "-X dev.msh.team/harness/agent-extension/internal/daemon.Version=v2.0.22"`） | Go（cobra CLI），Mach-O arm64，9,677,250 字节 |
| 浏览器扩展 | Chrome Web Store `fldmhceldgbpfpkbgopacenieobmligc` / Edge Add-ons `bnlffdbcfnanfbknnlaflhlhkocccckg`（webbridge 二进制 strings） | 与 daemon 配对（v2.0.22） | MV3 扩展 + Kimi 侧边栏 |
| CLI 插件 | `~/.kimi-code/plugins/managed/kimi-cu` | 0.6.3（kimi.plugin.json） | 来自 `https://cdn.kimi.com/kimi-computer-use/latest/kimi-cu-plugin.zip`（installed.json originalSource） |
| CLI 插件 | `~/.kimi-code/plugins/managed/kimi-webbridge` | 1.11.3（kimi.plugin.json） | 来自 `https://code.kimi.com/kimi-code/plugins/official/kimi-webbridge.zip` |
| CLI 插件 | `~/.kimi-code/plugins/managed/kimi-datasource` | — | 来自 `https://code.kimi.com/kimi-code/plugins/official/kimi-datasource.zip` |
| CU 运行时数据 | `~/Library/Application Support/KimiCU/` | — | `runtime.sock`、`runtime.token`（本机确认存在） |
| CU 设备标识 | `~/.kimi-cu/identity.json` / `update-state.json` | latestVersion 0.6.6 | `{"device_id":"4a920a7a-…"}` |
| webbridge 数据 | `~/.kimi-webbridge/` | — | `bin/`、`identity.json`（device_id=db1u6iksccb1o2h52u10）、`logs/daemon.log` |
| 桌面用户数据 | `~/Library/Application Support/kimi-code-app` | — | 日志中 "Browser MCP listening on http://127.0.0.1:<port>/mcp" |

## 2. 只读探针输出（2026-10-06 实测）

```
$ /Applications/KimiCU.app/Contents/MacOS/kimi-cu service-status
SMAppService status=1 (1=enabled,2=requiresApproval,3=notFound,0=notRegistered); fallback plist exists=false

$ /Applications/KimiCU.app/Contents/MacOS/kimi-cu xpc-ping
permissionStatus: accessibility=true screenRecording=true
runtimeSocket: listening

$ pgrep -fl kimi-cu
7339 Contents/MacOS/kimi-cu service        ← 服务常驻运行中
```

`unknown command: --help`（kimi-cu 无 `--help`；strings 中可见子命令：`install`/`uninstall`/`doctor`/`probe`/`tap-pid`/`keywin-probe`/`service`/`mcp`/`service-status`/`xpc-ping`/`request-permissions`/`upgrade`，以及 usage 串 `usage: kimi-cu probe <app name or .app path>` 等）。

## 3. KimiCU 二进制静态证据

### 3.1 链接库（`otool -L`）
AppKit、ApplicationServices、CoreGraphics、QuartzCore、**ScreenCaptureKit**、Security、ServiceManagement、SwiftUI、Carbon、CFNetwork、ImageIO + 全套 Swift runtime。→ 截图走 ScreenCaptureKit，事件注入走 CoreGraphics/ApplicationServices，权限 UI 用 SwiftUI，服务注册用 ServiceManagement（SMAppService）。

### 3.2 Swift 模块符号统计（`nm` 全表 21,192 符号，按模块聚类）

| 模块 | 符号数 | 职责 |
|---|---|---|
| ServiceIPC | 7343 | UDS/XPC 服务层（AXNotificationMonitor、ObservedSnapshotStore、AXSnapshotLifecycle、ReplUdsBridge 均在此模块内嵌套类中） |
| kimi（主 app） | 1250 | 安装/权限面板/托盘 |
| BackgroundInput(+AAO) | 1016+317 | 后台定向输入 |
| AXTree | 854 | 无障碍树 |
| Permissions | 826 | TCC 权限 |
| NodeRepl | 800 | 内嵌 node-repl 宿主 |
| Telemetry | 504 | 遥测 |
| AXAction | 320+33 | AX 动作 |
| Windows | 185 | 窗口管理 |
| Screenshot(+AAO) | 176+52 | ScreenCaptureKit 截图（`Screenshot.CaptureMode`、`Screenshot.Detail`、`meanAbsDiff`、`changedFraction`、`regionDiffRatio`、`isBlankImage`、`captureWindowRegionPixels`、`triggerRecordingPrompt`、`isAuthMaskBundle`） |
| MCPServer | 175 | 内嵌 stdio MCP server |
| Overlay | 118 | 点击光效/光标浮层 |
| SkyLight(+AAO) | 71 | 私有窗口服务框架（窗口路由事件通道） |
| KeyDSL | 32+14 | xdotool 风格按键 DSL |
| SignedKeyboard(+AAO) | 19 | 签名键盘事件注入 |

### 3.3 THIRD_PARTY_NOTICES.md（全文摘录，`Contents/Resources/THIRD_PARTY_NOTICES.md`）
> "Background-Chromium keyboard delivery in KimiCU uses an authentication-envelope mechanism (`SLSEventAuthenticationMessage` + `SLEventPostToPid`) that was publicly documented and implemented by **Cua AI, Inc.** in the MIT-licensed [cua-driver](https://github.com/trycua/cua). KimiCU's implementation in `Sources/SignedKeyboard/` is independently written"

二进制 strings 印证：`SLSEventAuthenticationMessage`、`SLEventPostToPid`、`_SLEventPostToPid`、`bg-input falls back to public CGEventPostToPid`。

### 3.4 内嵌 MCP schema JSON（工具面主证据）
`strings` 定位 `{"schemas":…`（文件偏移 2,604,544），JSONDecoder raw_decode 完整解析出 **18 个工具**，存档 `/tmp/kimicu-mcp-schemas.json`（24,840 字节）。
工具：list_apps / list_windows / get_window / launch_app / get_app_state / get_window_state / activate_window / click / type_text / paste / press_key / scroll / set_value / perform_secondary_action / select_text / drag / drag_paths / debug_tap。
同一 JSON 的 `native` 字段额外列出 **js**（`code`,`timeout_ms`）与 `js_reset` 的别名表 → 原生 ToolRouter 还接受 js 工具。schema 描述中的关键技术点（均直接引自该 JSON）：

- click：`"It never uses a HID tap or moves the real pointer"`；`channel` 枚举 `auto|skylight|public`，描述含 "auto (default) uses the SkyLight window-routed channel (the WindowServer stage enriches events with window number/local coords). public delivers the whole sequence (hover, primer, down/up) as NSEvent-factory events carrying the window number via postToPid…"；`allow_foreground_fallback`（"service default: never-front"）；`verify_after`（"An unobserved effect returns ok:true, verified:false and verification_required"）。
- type_text：`"Cursor-safe with no HID or real-pointer movement"`；`verified:false, verification_required:"screenshot"`（Electron 输入无 AX 回读时）。
- set_value：`"Native controls use AXValue. Electron/Web text controls use a no-raise background replacement path"`。
- drag：`"A drag starting in a native window's title bar moves the window via a verified AXPosition write (synthetic events cannot engage the WindowServer move session)"`。
- press_key：`"xdotool-style DSL, e.g. \"return\", \"cmd+a\", \"cmd+shift+t\""`；`"press_key posts keys in the background by default, which lands even when the target window is fully covered by other windows (verified for native apps on macOS 26)"`。
- scroll：`page` 优先（正数向上）、dx/dy 为 legacy；`"Returns ok:false when no movement is detected"`。
- get_app_state：`"Screenshot and/or convergent Accessibility tree"`；mode=full/image/ax；`disable_diff`（"session diff"）；`ax_filter`；`rect`；`additional_window_ids`（max 3）；输出含 `is_electron, has_cef, has_chromium_input_surface`。
- snapshot_id：`"AX snapshot identity from the observation that supplied index; stale or other-context IDs are rejected"`。
- drag_paths：1..500 strokes，每 stroke 2..1024 点，`abort_if_cursor_in_window`。
- debug_tap：`"start an annotated-session event tap on a pid inside the service for N seconds (default 30), logging every event delivered to that pid to /tmp/kimicu-pidtap-<pid>.log. Read-only."`
- list_apps 返回 `has_cef, has_chromium_input_surface`（Chromium 路由判别）。

### 3.5 安全/审批相关 strings（节选，均出自 kimi-cu 二进制）
```
KIMICU_RUNTIME_APPROVAL_TOKEN_FILE / KIMICU_RUNTIME_REQUIRE_APPROVAL_TOKEN
approval_required / requires_approval_token / approval_token is invalid or missing
kimi-cu runtime: rejected peer identity / rejected peer uid= / service: rejected untrusted peer pid=
kimi-cu runtime: listening on UDS / unable to start authenticated UDS
named pipe path is outside the startup allowlist:
delivery_unverified: input events were sent but the text was not observed via AX readback…
focus_unverified: target exposes no AX readback surface…
snapshot_id is stale or belongs to another observation context
CLI may lack accessibility permission; the launchd Service holds it for MCP
KIMI_CU_TRUST_AX_MIRROR / KIMI_CU_NODE_REPL_TRUSTED_SERVICES / KIMI_NODE_REPL_TRUSTED_CONFIG
node executable not found (set KIMI_CU_NODE_REPL_NODE, bundle bin/node in the repl home, …)
node-repl runtime not found (set KIMI_CU_NODE_REPL_HOME to a directory containing runtime/kernel.mjs and runtime/trusted-worker.mjs)
```

## 4. node-repl 包（随 KimiCU.app 分发，未加壳明文 JS）

路径 `Contents/Resources/node-repl/`。关键文件与结论：

| 文件 | 证据 |
|---|---|
| `bin/node`（112,937,728 字节） | 随包分发的 Node 运行时 |
| `package.json` | `kimi-cu-node-repl`，依赖 `meriyah 7.0.0`（JS 解析器，用于 cell 编译静态检查） |
| `config/trusted-services.json` | `{"kimi-cu":{"module_root":"packages/kimi-cu/trusted-service","entry":"service.mjs","config":{"endpoint":"\\\\.\\pipe\\kimi-cu-runtime","minimum_runtime_version":"0.6.6"}}}`（endpoint 是 Windows 命名管道模板 → 跨平台配置生成器产物；macOS 实际走 UDS） |
| `runtime/kernel-protocol.mjs` | `PROTOCOL_VERSION=1`；SupervisorToKernel: EXEC/CANCEL_EXEC/TRUSTED_SERVICE_RESPONSE/SHUTDOWN；KernelToSupervisor: KERNEL_READY/TRUSTED_SERVICE_REQUEST/EXEC_RESULT/SUBMITTED_CODE_COMPLETE；NDJSON |
| `runtime/trusted-protocol.mjs` | EXEC_START/EXEC_END/SERVICE/SHUTDOWN/NATIVE_PIPE_OPENED/DATA/CLOSED/TRUSTED_WORKER_READY/TRUSTED_EXEC_STARTED/ENDED… |
| `packages/kimi-cu/public/index.mjs` | `@kimi/cu` facade：18 个方法同名导出 + `target:"mac"`；注释 "macOS KimiCU code-mode facade. The legacy MCP remains a separate adapter."；经 `globalThis.nodeRepl.rpc("kimi-cu",{version:1,method,args})` 调用 |
| `packages/kimi-cu/trusted-service/wire.mjs` | UDS 帧格式 `KimiCU-UDS-1`：4 字节 LE 长度 + UTF-8 JSON，MAX_FRAME_BYTES=8MiB |
| `packages/kimi-cu/trusted-service/uds-client.mjs` | socket 路径 `~/Library/Application Support/KimiCU/runtime.sock`（env `KIMICU_RUNTIME_SOCKET` 可覆盖）；token 文件 `runtime.token`；hello `{type:"hello",token,protocol:"KimiCU-UDS-1",versions:[1],client_name:"kimi-cu-node-repl",observation_context}`；invoke 携带 `session_id`/`deadline_ms`/`approval_token`；超时自动发 `cancel`；截图以 `attachments[]` 返回并挂到 `value.screenshot` |
| `packages/kimi-cu/trusted-service/tool-catalog.mjs` | `CATALOG_SHA256=f37c03…f41d`；METHODS 白名单（allowed/required/requiresTarget/pointOrIndex 等约束）+ ARGUMENT_ALIASES（snake/camel 双轨）；文件头 "Generated by scripts/generate-tool-catalog.py; edit protocol/tool-catalog.json." |
| `packages/kimi-cu/trusted-service/schema.mjs` | 严格校验：未知字段拒绝（KIMI_CU_UNKNOWN_FIELD）；枚举 `MOUSE_BUTTONS=[left,right,middle,l,r,m]`、`APP_STATE_MODES=[full,image,ax]`、`PASTE_FORMATS=[text,md,html]`、`SELECTION_TYPES=[text,cursor_before,cursor_after]`；`MAX_DRAG_PATHS=500`、`MAX_PATH_POINTS=1024`；注释 "Integer ranges mirror the Swift ToolRouter argument types (ToolTypes.swift)"；window 对象 `{app,id,title}`；target 判定 window/app/pid/window_id 四选一 |
| `packages/kimi-cu/trusted-service/service.mjs` | 每 exec（cell）一条懒连接 UDS 会话；hello 后 `assertRuntimeCompatible`（版本门，minimum_runtime_version）；响应附件规范化 base64 校验后经 `api.emitImage` 发给模型，JSON 里替换为 `"[provided as MCP image content]"` 占位 |
| `packages/kimi-cu/trusted-service/compatibility.mjs` | `UPGRADE_URL="https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh"`；语义化版本门；错误码 KIMI_CU_RUNTIME_TOO_OLD / KIMI_CU_RUNTIME_VERSION_UNKNOWN |

## 5. kimi CLI 主二进制（Node SEA，esbuild 打包，region 注释保留源码路径）

- `strings` 提取 `//#region ../../packages/...` 路径 1,679 条（存档 /tmp/kimi-regions.txt）。顶层包：agent-core-v2(865)/agent-core(342)/kap-server(144)/minidb(55)/klient(42)/pi-tui(39)/kosong(25)/acp-server(25)/oauth(24)/transcript(19)/node-sdk(19)/acp-adapter(17)/protocol(14)/telemetry(8)/kaos(7)/tree-sitter-bash(6)。
- 内置工具（`src/agent/tools/**`）：agent(子代理)、ask-user-question、edit、fetch-url、bash、glob、grep、read、write、read-media-file、select-tools、task(list/output/stop/wait)、web-search、cron-create/delete/list、goal(create/get)。**无内置 computer use / browser use 工具**——CU/BU 全部经插件 MCP 提供。
- capability 层（`src/app/capability/`）：`capability.ts`、`capabilityService.ts`、`entries/kimiCu.ts`、`entries/kimiWebbridge.ts`（两 region 已完整提出至 /tmp/kimicu-entry.mjs、/tmp/kimiwebbridge-entry.mjs，见 §6/§7 摘录）。
- 模型列表 JSON 内嵌（字符串证据）：支持 kimi-k3、claude-haiku-4-5、gemini、doubao、hermes、claw、sonar-pro 等多家族模型的模型表。

### 6. kimiCu.ts 关键摘录（/tmp/kimicu-entry.mjs）
- 描述（displayName "Kimi Computer Use"）：`"macOS GUI automation in the background — read app UIs and click, type, scroll, and drag without taking over your mouse or foregrounding apps."`
- 安装层：
  - plugin 层：`MAC_PLUGIN_ID="kimi-cu"`，zip `kimiCdnContentUrl("kimi-computer-use/latest/kimi-cu-plugin.zip")`；Windows `kimi-cu-win` + `kimi-computer-use-windows/latest/kimi-cu-win-plugin.zip`。
  - app 层：下载 `kimi-computer-use/latest/KimiCU.app.zip` → `ditto -x -k` → 停旧进程（`kimi-cu uninstall` + `launchctl bootout gui/$uid/ai.kimi.cu.service` + `pkill -f 'KimiCU.app/Contents/MacOS/kimi-cu[[:space:]]+(service|overlay)'`）→ `ditto` 到 /Applications（失败时 `osascript … with administrator privileges` 提权）→ `xattr -dr com.apple.quarantine`。
  - service 层：`kimi-cu install` 注册 SMAppService/LaunchAgent；`service-status` 探测 `status=1`。
  - permissions 层：`kimi-cu request-permissions --ax --screen`。
  - legacy MCP 迁移：从 `~/.kimi-code/mcp.json` 摘除 `mcpServers["kimi-cu"]`（command=appBin, args=["mcp"]或["mcp","-s","user"]）。
- 健康探测：`kimi-cu service-status`（`status=1`）、`kimi-cu xpc-ping`（正则 `/(?:permissions|permissionStatus):\s+accessibility=(true|false)\s+screenRecording=(true|false)/`）。
- Windows：doctor 走 PowerShell（`%LOCALAPPDATA%\KimiCU\kimi-cu.exe` / `%ProgramFiles%\KimiCU\kimi-cu.exe` / env `KIMI_CU_WINDOWS_EXE`/`KIMI_CU_WINDOWS_HOME`；`mcp=true&helper=embedded` 判定），安装器 `setup_windows.ps1`。

### 7. kimiWebbridge.ts 关键摘录（/tmp/kimiwebbridge-entry.mjs）
- `DEFAULT_DAEMON_BASE_URL="http://127.0.0.1:10086"`；二进制资产 `webbridge/latest/releases/kimi-webbridge-{darwin-arm64,darwin-amd64,linux-arm64,linux-amd64,windows-amd64.exe}`。
- install：下载二进制到 `~/.kimi-webbridge/bin/` → `kimi-webbridge start`（轮询 /status 20×500ms）→ 安装插件 `plugins/official/kimi-webbridge.zip`（region profile CDN）→ 迁移旧的独立 skill（`~/.kimi-code/skills/kimi-webbridge`、`~/.agents/skills/kimi-webbridge` 备份到 `~/.kimi-code/backups/kimi-webbridge-skills/`）。
- detect 五步：daemon-binary / daemon / skill(插件) / standalone-skill-migration / extension（`daemon.extension_connected`）。

## 8. kimi-webbridge 守护进程（Go）

- 源码包路径（strings）：`dev.msh.team/harness/agent-extension/internal/{cli/daemon,daemon,skillpaths}`；daemon 子模块文件名：server.go、session.go、allowlist.go、hygiene.go、save_pdf.go、screenshot.go、sidepanel_control.go、skill_status.go、trajectory.go；skillpaths：DetectAgentTargets/claudeCodeSkillsDir/codexSkillsDir/hermesSkillsDir/kimiSkillsDirs/openClawSkillsDir。
- daemon.log 实录：`[agent-extension-daemon] listening on 127.0.0.1:10086`；`[ws] extension connected`；`[ws] hello from extension v2.0.22 (daemon v2.0.22)`；遥测发 DataRangers（`gator.volces.com`/`mcs.ctobsnssdk.com`，AppKey 20013735）。
- HTTP 语义（strings）：`use POST to inject or GET to poll`（prompt）、`use POST to append or GET to list`（trajectory）、`use GET to poll`；`/internal/sidepanel-control` 路由；`save_as_pdf: PDF size %d bytes exceeds %d byte limit`；`unknown mode: Sec-Fetch-Site`；screenshot 写盘 `kimi-webbridge-screenshots` 目录；`[ws] late tool_result for %s (caller canceled or timed out…)`；`[session] %s: stale tab %d in payload`。
- 安全 strings：`any client on the network can drive your browser`（绑非回环告警）、`request Origin %q is not a valid URL with a host`、`skill tarball missing %s/SKILL.md`、`manifest missing sha256 for this binary; refusing to install unverified content`。
- skill 分发：`https://cdn.kimi.com/webbridge/latest/version.json`（实测 v2.0.22，5 平台二进制+sha256）；`{version}/skills/kimi-webbridge.tar.gz` 与 `kimi-webbridge-windows.tar.gz`（实测下载解包成功，内容为 SKILL.md + references/*.md）。
- 自述（--help）：`Kimi Browser Extension daemon and toolkit (formerly Kimi WebBridge)`；子命令 start/stop/restart/status/logs/install-skill/upgrade/uninstall；`no supported AI-agent runtime detected (Claude Code / Codex / Kimi CLI / OpenClaw / Hermes)`。

### 8.1 官方 SKILL.md（v2.0.22，从 CDN tarball 解包 /tmp/webbridge-skill/）
工具表：navigate / find_tab / snapshot（AX 树 + `@e` refs）/ click（合成 `el.click()`）/ fill（input/textarea + contenteditable：ProseMirror/Lexical/Slate）/ evaluate / **cdp**（`chrome.debugger` 直通；`Target.activateTarget` 被拒；`Page.bringToFront` 限制描述）/ screenshot（写盘返回 path）/ network（start/stop/list/detail，含响应体）/ upload / save_as_pdf（≤100MB）/ list_tabs / close_tab / close_session。
关键行为：session=tab group（`group_title`）；`find_tab active:true` 借用用户当前 tab（`borrowed:true`）；`event.isTrusted` 严格站点合成事件失效 → cdp `Emulation.setFocusEmulationEnabled`；iframe 只见 top document，`read_page {"frame":"#f1"}`、`wait {"frame":"any"}`；envelope `{"ok":true,"data":…}` / `{"ok":false,"error":{code,message}}`。
operations.md：`daemon.pid`/`daemon.addr`/`config.json {addr}`；/status 字段 running/port/version/uptime_seconds/extension_connected/extension_id/extension_version/skills + `version_mismatch`/`skill_mismatch`/`update_available`（各带 command）。

## 9. 桌面端（Kimi Code.app 1.0.4，asar 解包 /tmp/kimicode-asar）

- `out/` 内含 `screenshot-gqZU6x82.cjs`（10.9MB，内嵌 agent-core-v2 全套 = 桌面内嵌 agent 服务）+ `browser-control-preload.cjs` / `browser-overlay-preload.cjs` / `browser-receipt-worker.cjs`。
- 桌面日志（`~/.kimi-code/logs/kimi-code-desktop.log`）：
  - `[kimi-desktop] Browser MCP listening on http://127.0.0.1:53291/mcp`（每次启动随机端口）
  - `[kimi-desktop] embedded server listening on http://127.0.0.1:53294`
  - `[screenshot] overlay-painted display=1 …`
- `browser-mcp-registration.ts` region：`registerDesktopBrowserMcp` 把桌面浏览器作为 **per-session ephemeral MCP** 注入（`deferred:true`，请求头 `X-Kimi-Session-Id: <sessionId>`）。
- `browser-mcp.ts` region：单一工具 `TOOL_NAME="run"`，协议 `BROWSER_AUTOMATION_PROTOCOL="kimi.browser/1.0.0"`；描述含 takeover 语义 `BROWSER_USER_TAKEOVER`（"stop browser calls for this turn; control becomes available in a new user turn"）、`browser.get_state` 返回 activeTabId/visibleTabId、TOON 格式快照（page.text.snapshot maxChars 默认 12000、page.elements.snapshot 默认 limit=100/maxChars=8000）、page.visual.crop 缓存 60s 等。
- `browser-tool-schema.ts` region：`Requests` 数组 43 个操作（browser.get_history/get_downloads/get_device_profiles/get_state/activate_panel/create_tab/release_tab/activate_tab/switch_tab/close_tab；tab.set_device_mode/get_state/navigate/search/go_back/go_forward/reload/stop_loading/wait_for_load；page.wait_for/text.snapshot/visual.snapshot/visual.crop/visual.click/visual.click_if_interactive/visual.hover/visual.scroll/visual.drag/visual.type_text/visual.press_key/elements.snapshot；page.element.click/hover/fill/type_text/press_key/select_option/set_checked/scroll_into_view）。
- `browser-control.ts`（preload）校验器：surface `{browserId,revision,labels{running,elapsed,takeover,takeoverHint,pointer,typing,key,scrolling,activityTarget,activities{reading,inspecting,capturing,clicking,hovering,typing,pressing,selecting,checking,scrolling,dragging,navigating,waiting}},colorScheme,reducedMotion,corners[≤4],insets}`；pointer 事件 kind=`move|down|up|type|key|scroll|reset|blocked`；activity `{id,activity,scan,target,rect}`；`kimiBrowserControl` contextBridge：ready/takeOver/onSurface/onActivity/onResizing/onPointer；IPC `kimi:browser-control-{ready,takeover,surface,activity,resizing,pointer,ownership}`。
- 共 84 个 `kimi:browser-*` IPC 通道（annotation 采集/拾取/显示、receipts 读取/复制/删除、permission requests、device mode、focus emulation `browser-set-focus-emulation`、downloads、sessions、sites 等）。
- `browser-receipts.ts` region：`AUTOMATION_WORLD_ID$1=1001`；receipts 存 `userData/browser-receipts/<sessionId>/`，截图 ≤720px 宽、JPEG q72、保留 `RETENTION_MS=720*60*60*1000`（30 天）、`PRUNE_INTERVAL_MS=24h`；frame marks 归一化 point/box。
- `browser-annotation-script.ts` region：`BROWSER_ANNOTATION_WORLD=1002`（与 automation world 1001 分离）；contextmenu 追踪（仅 `event.isTrusted`）、annotation picker（glass+highlight+badge overlay）。
- `browser-automation.ts` 等：ClickCandidate `{ref,tagName,role,name,id,classes,clickable,disabled,evidence:native|role|handler|pointer|none,bounds}`；`BROWSER_LOCAL_FILE_REFUSAL`（本地文件页拒绝读取/控制）。
- 桌面 package.json 依赖：`@modelcontextprotocol/sdk ^1.29.0`、`node-pty`、`@toon-format/toon 4.1.1`、`typebox ^1.3.30`。

## 10. 会话实录证据（~/.kimi-code/sessions/*/agents/*/wire.jsonl）

- `mcp.tools_discovered` 事件：`serverName="plugin-kimi-cu:mac"`，tools[] 与二进制内嵌 schema 一致（list_apps 描述逐字相同）。
- 实际工具名调用统计（跨会话 grep）：list_apps/list_windows/get_window/launch_app/get_app_state/get_window_state/activate_window/click/type_text/paste/press_key/scroll/set_value/perform_secondary_action/select_text/drag/drag_paths/debug_tap/js/js_reset + kimi-datasource 的 get_data_source_desc/call_data_source_tool。

## 11. CLI 配置（~/.kimi-code/）

- `config.toml`：`default_permission_mode="auto"`；providers：`aigw`（type=openai，自建网关）与 `managed:kimi-code`（type=kimi，`https://api.kimi.com/coding/v1`，OAuth file storage）；模型条目含 `max_context_size=1048576`、`capabilities=["thinking","always_thinking","tool_use"]`、`support_efforts=["low","high","max"]`。**（内含 API key，本仓库文档一律脱敏）**
- `mcp.json`：遗留 standalone 注册 `kimi-cu`（command=`/Applications/KimiCU.app/Contents/MacOS/kimi-cu`, args=`["mcp","-s","user"]`）——即 MCP server 内嵌于 kimi-cu 二进制，stdio 传输。
- `tui.toml`、`hooks/`、`search-index/`、`workspace-trust/`、`server/`（instances/events）、`server.token`。

## 12. 对照系（ZCode / Codex）

- ZCode 逆向笔记（本机 `/Users/laplace/Desktop/reverse/zcode/notes/COMPUTER_USE_RESTORATION.md`）：ZCode 3.12.3 = host 安装+验签 helper（`~/.zcode/computer-use/.../ZCode Computer Use.app`，open -n -g 启动 + 一次性 token）→ MCP `zcode-cua`（30 工具）NDJSON/UDS → Helper broker（63 方法）→ `ax_native.node`；`brokerRuntimeDir` 随机 socket 名；Windows 走命名管道 `\\.\pipe\zcode-cua-helper-<hex>`。
- Codex（本机 `~/.codex/`）：`browser/config.toml`、`chrome-native-hosts-v2.json`（`{"schemaVersion":2,"entries":[]}`）——Chrome native messaging 痕迹（本机 entries 为空）。
- ZCode 本会话可用的 node_repl/cu 工具面（get_app_state/click/type_text/press_key/scroll/set_value/perform_secondary_action/select_text/drag/paste/drag_paths/list_apps/list_windows/launch_app…）与 KimiCU 工具面几乎一一对应（ZCode 多 screenshot_display.bounds、screenshot；KimiCU 多 paste/debug_tap/js）。

## 13. 本仓库文档引用约定

- 专有代码引用每处 ≤10 行，注明文件路径或二进制 strings 出处。
- 推断性结论标「推断」；本机未实证的能力标「未在本机发现」。
