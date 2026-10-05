# 证据清单（Evidence Inventory）— Grok（xAI Grok CLI + Grok Bot 桌面端）

> 分析基线：2026-10-06，macOS arm64。全部结论来自只读静态分析（plutil / codesign / asar 解包 / strings / 随包文档）。
> 解包产物仅在 `/tmp/grokbot-analysis` 与 `/tmp/cu-service-strings.txt`、`/tmp/grok-cli-strings.txt`，未写入仓库、未修改被分析对象、未触碰凭据。
> 字符串行号指 `strings -n 6`（CU 服务二进制）或 `strings -n 8`（CLI 二进制）输出文件的行号。

---

## 1. 能力载体清单

### 1.1 Grok CLI（xAI 官方终端 Agent）

| 载体 | 路径 / 证据 | 版本 | 备注 |
|---|---|---|---|
| 主二进制 | `~/.grok/bin/agent -> ../downloads/grok-1.0.46-macos-aarch64` | 1.0.46（2026-09-30 发布，CHANGELOG.md） | Mach-O arm64，150,374,256 字节；另存 1.0.41 与无版本号旧包 |
| 版本状态 | `~/.grok/version.json` | `{"version":"1.0.46","stable_version":null,"checked_at":"2026-10-05T18:45:32"}` | — |
| 随包文档 | `~/.grok/README.md`（111,146 字节） | — | 内置工具表、ACP、MCP、Sandbox 全文 |
| 变更日志 | `~/.grok/CHANGELOG.md` / `CHANGELOG.json` | 1.0.45/1.0.46 | 无任何 CU/BU 条目 |
| 内置技能 | `~/.grok/bundled/skills/`（28 项）+ `bundled/manifest.json` | — | `browser` 关键词 0 次命中；技能均为 coding/文档/游戏素材类 |
| 配置 | `~/.grok/config.toml` | — | `permission_mode="always-approve"`、marketplace 指向 `github.com/xai-org/plugin-marketplace` |

**内置工具表（`~/.grok/README.md` "Built-in Tools" 节，行 2361-2382）**：`read_file / search_replace / grep_search / list_dir / bash / web_search / web_fetch / todo_write / task / kill_task / get_task_output / memory_search / memory_get / search_tool / use_tool / lsp`。其中 `web_fetch` 默认禁用（需 `GROK_WEB_FETCH=1`）。**没有任何 computer / browser / screenshot / desktop 类工具。**

### 1.2 Grok Bot 桌面端

| 载体 | 路径 / 证据 | 版本 | 备注 |
|---|---|---|---|
| 主应用 | `/Applications/Grok Bot.app` | 0.66.0（CFBundleVersion 同） | Electron 42.1.0（Electron Framework Info.plist） |
| 包标识 | `Contents/Info.plist` | `CFBundleIdentifier=com.anysphere.sand` | URL scheme `grokbot` + `sand`；版权 "© 2026 SpaceXAI"；LSApplicationCategoryType=developer-tools |
| asar | `Contents/Resources/app.asar`（38,522,610 字节，asar integrity SHA256 见 Info.plist） | package.json `name:"sand"`、`productName:"Grok Bot"`、`homepage:"https://cursor.com"`、`author:"SpaceXAI"`、`sandBuiltAt:"2026-10-01T18:23:52Z"` | 依赖全部为 `@anysphere/*` workspace 包 + `@sand/*` |
| 签名 | `codesign -dv` | TeamIdentifier=**DCNK4UB866**（Anysphere, Inc.，与 Cursor 同一签名团队） | 主应用与 CU 助手同团队 |
| CU 助手 App | `Contents/Helpers/Grok Bot Computer Use.app` | CFBundleShortVersionString=1.0.0，id=`co.anysphere.grok-bot-computer-use` | LSUIElement=true；min macOS 14.0 |
| CU 助手二进制 | `.../Contents/MacOS/CUGrokBotService`（6,299,504 字节） | Mach-O universal（x86_64 + arm64） | Swift 编写（符号前缀 `CUCore`，如 `_TtC6CUCore16CUCompanionToolService`） |
| VNC 预加载 | `dist/electron-preload/preload-vnc.cjs` | — | 内嵌 noVNC 客户端操作（rfb/websock/display 模块注入） |
| 原生模块 | `dist/deps/`（cursor-proclist、sand-notification-settings、tree-sitter 等，runtime-deps-manifest.json） | — | 无 CU/BU 相关原生模块 |
| 运行时数据 | `~/Library/Application Support/Grok Bot/`（Electron 常规目录）+ `sand-statsig-bootstrap.json` | — | **无** `grok-bot-computer-use/` 服务目录；statsig bootstrap 无任何 CU/BU gate 覆盖 |

### 1.3 变体配置表（sidecar 三环境，local-exec-daemon/main.cjs 与 main-app.cjs 各出现一次，字符串完全一致）

```
prod: appName "Grok Bot Computer Use"    bundleId co.anysphere.grok-bot-computer-use      appSupportDir grok-bot-computer-use      executable CUGrokBotService
lab:  appName "Grok Bot Lab Computer Use" bundleId co.anysphere.grok-bot-lab-computer-use  appSupportDir grok-bot-lab-computer-use  executable CUGrokBotLabService
dev:  appName "Grok Bot Dev Computer Use" bundleId co.anysphere.grok-bot-dev-computer-use  appSupportDir grok-bot-dev-computer-use  executable CUGrokBotDevService
```

环境变量：`GROK_BOT_SIDECAR_APP`（强制指定 sidecar 路径）、`CUA_APP_SUPPORT_DIR`、`CUA_DIRECT_LAUNCH`（Cua AI 风格前缀）、`SAND_BOX_COMPUTER_SHARED_DOCKER / _DOCKER_HOST / _SHARED_CONTAINER / _ENTRY`（box 沙箱）。

---

## 2. CU 服务二进制（CUGrokBotService）关键字符串证据

### 2.1 双工具面（同名 catalog 在二进制内嵌两份，`diff` 逐字节一致，位于行 650-1470 与 4316-5136）

`computer_*` 家族 **16 工具**（`"name": "computer_..."` 行号）：`computer_screenshot`(650) `computer_click`(705) `computer_move`(800) `computer_drag`(875) `computer_type`(990) `computer_key`(1070) `computer_scroll`(1134) `computer_wait`(1230) `computer_check_permissions`(1247) `computer_start_control`(1257) `computer_release_control`(1264) `computer_apps`(1271) `computer_resolve_app`(1281) `computer_app_state`(1310) `computer_set_value`(1362) `computer_app_action`(1421)。

`computer_use_*` 家族 **14 工具**（行 448-603 及 JS 侧调用）：`computer_use_screenshot / computer_use_click / computer_use_scroll / computer_use_mouse_move / computer_use_mouse_button / computer_use_drag / computer_use_typing / computer_use_press_key / computer_use_set_value / computer_use_perform_secondary_action / computer_use_app_state / computer_use_select_app / computer_use_apps_list / computer_use_check_permissions`。

### 2.2 传输与协议

- 行 350/581/601/603：`tools/call`、`control/start returned no session`、`tools/call missing tool name`、`computer_use_check_permissions`；行 347-356：`computer_key/computer_scroll/computer_wait/computer_check_permissions/computer_start_control/computer_release_control/computer_apps/computer_resolve_app/computer_app_state/computer_set_value/computer_app_action`（第二工具面注册表）。
- MCP 方法名（行 344-349 区段）：`notifications/initialized` `notifications/cancelled` `initialize` `tools/list` `tools/call`。
- 类符号：`CULocalRPCConnection` `CULocalRPCListener`（`shouldAcquireProcessLock` `peerPolicy`）`CULocalRPCService`（`toolRouter` `admission` `methodHandlers`）`CULocalRPCAdmission`（`activeToolCalls`）`CUMcpServer`（`catalog` `toolset`）`CUMcpStdioMode`（`--mcp-stdio` `--conversation-id is required`）`CUMcpToolset` `CUMcpCancellation`。
- socket：`app-control.sock`；service 状态文件 `service.json`（JS 侧读取 `rpcSocketPath`）；RPC 限制：`RPC response exceeded the size limit`、`RPC socket path is too long`。
- JS 侧客户端类（local-exec-daemon/main.cjs 偏移 ~2705800-2712500）：静态默认值 `appSupportFolder="cursor-computer-use"`、`serviceAppBundleName="Cursor Computer Use"`、`serviceExecutablePath()` 拼 `CUCursorService`；超时 `defaultCallTimeoutMs=45e3`、`launchReadyTimeoutMs=8e3`、`launchPollIntervalMs=200`；launch 用 `/usr/bin/open -g <app>`；`isPreDeliveryConnectionError = ENOENT|ECONNREFUSED → relaunch+retry`；`control/start` 仅 `mode==="remote"`，返回 `sessionId`，`control/release` 携带之。

### 2.3 观察（截图 + AX 树）

- 截图：行 496-503 `Screen Recording permission is required...`；`ScreenCaptureKit did not return a current window image.`、`Window must lie within one display for coordinate capture.`、`Window transform changed during capture.`、`Captured window ... source) padded to`（截图补边）、`Coordinates are in a screenshot padding bar.`、`screenshotScale must be positive`、`Computer-use screenshot cannot fit within`、`Failed to encode computer-use screenshot as JPEG (encoder returned nil).`、`Screenshot omitted: could not be encoded under 1 MiB`、1280×800 画布（catalog 描述原文 "fixed 1280×800 screenshot canvas, origin (0, 0) at the top-left"，坐标上限 x≤1279 / y≤799）。
- AX 树：行 509-520 `computer_use_app_state` 描述 "element(s) omitted to fit the text budget; call ... to drill in"、"Tree truncated at N nodes or depth"；行 508 "element(s) added under the same snapshot_id; earlier ids stay valid until you read computer_use_app_state again or the window changes"；`computer_app_state` 输出格式 "[id] ROLE name= value= settable actions="（行 1316 catalog 原文）；staleness 原因枚举（行 430-436 区段）：`the snapshot window is no longer current` / `a window or sheet appeared or disappeared` / `the accessibility tree structure changed` / `the focused window or sheet changed` / `the front window changed`；`Snapshot scope [`、`Accessibility window ... is unavailable`、`Accessibility tree was empty.`、`Reused live snapshot (tree unchanged).`、`The window is occluded (covered, minimized, or off-Space). The image is still current; coordinate actions reach a covered window.`

### 2.4 动作

- AX 语义通路：`AXUIElementPerformAction(kAXPressAction) failed with AXError.`、`AXUIElementPerformAction(AXScrollToVisible) failed with AXError.`、`AXUIElementSetAttributeValue(kAXValueAttribute) failed with AXError.`、` AXValue could not be read back.`、` AXValue read back as , not the written text.`（写后回读校验）、`AXSelected was accepted but reads back false; the app did not select the row.`、`Element does not support AXScrollToVisible. Use screenshot coordinates to scroll.`、`Element is an oversized ... without a genuine control. Use screenshot coordinates instead.`（防巨型元素误点）、`element_id clicks are a single left AXPress. Use screenshot coordinates for other buttons or multi-click.`、`Do not combine element_id with coordinate arguments.`、`coordinate_token requires a coordinate-selected text target.`。
- 事件通路（remote）：`Could not create keyboard event`、`Could not create mouse ...`、`otherMouseDragged/leftMouseDragged`（AppKit 合成事件）、`EventSequencer`（`nextNumber`，输入定序）、`CUPointerMoveHop`、`Could not read the current cursor position.`、`Move the pointer before pressing a mouse button.`、`An active remote control session is required before ... can send input.`、`Target identity for pid ... is stale. No input was posted.`、`Coordinate clamped from the padding bar to the display edge.`、键名文法 `key must name a key such as Return, Enter, Tab, or cmd+l`、`Unsupported key modifier`、unicode 输入 `Could not create Unicode keyboard events`。

### 2.5 安全模型

- 权限：`--probe-permissions`、`accessibility` `screenRecording`（probe 键）、`permissions/status` `permissions/open-settings`（RPC 方法）、`The helper opened System Settings at ...`、`Remote control requires permission for Screen Recording`、`Accessibility permission is required before ... can send input.`。
- socket 对端策略：`refused: parent process ... is not a peer the service's socket policy admits`、`belongs to another user`、`refused: the parent process is launchd; a host must spawn this executable`；类字段 `localRPCTrustedTeamIdentifiers` `codeSigningTeamIdentifier` `allowsUnsafeSameUserRPC` `peerPolicy`；`anchor apple generic`（codesign 需求）。
- 租约与会话：类 `CURemoteControlLease`（`active` `stoppedSessionID` `releaseHeldInput`）、`CURemoteControlPermit`（`revocation` `heldInputs`）、`remoteControlLease`；错误 `Remote control is busy with another session.`、`Remote control session is not active.`、`control/start requires remote mode`、`control/release requires a remote session ID`。
- 急停：`CURemoteEscapeTap`（event tap 监听 Esc：`Remote control could not arm its stop key (event tap denied)`、`escape_tap_armed enabled=`）、`CUCompanionStops`（`The user stopped computer use.`）、`USER_ABORTED: The user stopped the current control session. Do not call input, start-control, or release-control tools again in this turn.`、`best-effort control/release failed:`。
- 可视化：`CUCursorOverlay`（`overlay-debug.log` `move(timeout:perform:draw:)`）、`CUPointerLayer`/`CUPointerPanel`（companion 光标悬浮层）、`CURemoteControlGlowOverlay`（`glowPanel` `remote_control_glow size=`）、`CURemoteControlPointerIcon`、`CURemoteControlOverlayController`（`beginPointerPassThrough()` `overlay_reanchored` `watchingDisplays`）。catalog 原文：`(a cursor overlay is still shown)`、`Raise would bring the window forward. Companion does not raise.`
- 生命周期：`CUA_IDLE_EXIT_SECONDS`（空闲自退出）、`CUServiceTerminationDelegate`、`CUAppLifecycle`、`CUProductConfiguration`（`CUProductContext.bootstrap(_:) must run at process startup`；字段 `bundleIdentifier` `appSupportDirectoryName` `installRelativePath` `codeSigningTeamIdentifier`）、`CUProductContext is already bootstrapped as ...; refusing to switch to`。
- 升级/拒绝分类（行 1489-1510，catalog `instructions` + `refusals` 原文）：错误返回 `isError=true` + `structuredContent {code, message, escalation:{recommended, reason}}`；`escalationByCode`：`capture_failed/invalid_arguments/input_failed/timeout→retry`；`secure_desktop/input_desktop_unavailable/target_elevated/unsupported_request/sidecar_unavailable/session_busy/permission_required→ask_user`；`screenshot_required/unknown_tool/outcome_unknown/session_required→use_different_tool`；`user_aborted→stop`。并发约束原文：`Do not call Computer Use tools in parallel; they act on one machine and run one at a time.`

### 2.6 辅助面（同一 sidecar 承载的相邻能力，非 CU/BU 本体）

- iMessage/Messages 工具（JS 侧 local-exec-daemon 偏移 ~2000870 后）：`snapshot-messages-db / copy-attachment / send-message / check-messages-permissions / find-contacts / resolve-handles`；AppleEvents 错误 `-1743 → messages_automation...`；对应助手 Info.plist 的 `NSContactsUsageDescription`（"find the people you ask them to text by name"）与 `NSAppleEventsUsageDescription`。
- permissions 打开系统设置：`com.apple.SystemSettings` `com.apple.systempreferences` 字符串。

---

## 3. 宿主侧（asar / dist）关键证据

### 3.1 Feature Flags（electron-main/main-app.cjs 偏移 ~1137490-1137700、1110039、1111390-1145470；默认值均为代码内 fallback）

```
local_computer_use            default:false
mac_computer_use              default:false
windows_computer_use_batch    default:false
computer_use_next_action      default:false
sand_computer_use_unicode_typing default:false
sand_mobile_agent_computer_console default:true
browser_subagent              default:true
browser_subagent_gating       default:false
browser_cpp_telemetry         default:true
browser_mcp_chip              default:true
playwright_autorun            default:true
internal_browser_evaluate     default:false
sand_browser_fingerprint_spoof default:false
sand_enable_spoof_gpu         default:false
sand_web_bot_auth_signing     default:true（sign_xhr_fetch true / sign_iframes false）
sand_import_chrome_cookies    （gate 名，见 PKe() 检查 "behind the sand_import_chrome_cookies gate"）
sand_messages_tools           （gate 名，同上模式）
hosted_mcp_routing_enabled    default:false
```

### 3.2 动态配置（同一文件，偏移 ~1207000-1217000）

- `mac_computer_use_sidecar_manifest.sidecarManifestUrl` 正则：`^https://downloads\.cursor\.com/computer-use-sidecar/releases/[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*/[0-9a-f]{40}\.json$`（Windows 为 `...-win32-x64.json / -win32-arm64.json`）——**sidecar 分发 CDN 仍是 downloads.cursor.com**。
- `computer_use_mcp_instructions: {darwin:{companion, remote}, win32}`——CU MCP 的按模式指令文本由服务端下发。
- `sand_computer_use_playwright_config` fallback：`{modelId:"sand-cua", maxMode:false, parameters:[]}`——CU 专用视觉模型名 **sand-cua**。
- `sand_min_client_version.novnc_port_token_min_version` / `hosted_mcp_oauth_callback_min_version`——noVNC 端口 token 与托管 MCP OAuth 回调版本协商。

### 3.3 云端协议（electron-main/proto.cjs）

- `ToolCall` oneof 共 68 个工具位（`static $()` 反射表，偏移 ~473700），CU 相关：`generate_image_tool_call`(#21) `record_screen_tool_call`(#22) `computer_use_tool_call`(#23) `setup_vm_environment_tool_call`(#26)；网络观察类：`web_search_tool_call`(#13) `fetch_tool_call`(#19) `web_fetch_tool_call`(#30) `x_search_tool_call`(#67)。
- `ComputerUseArgs|1 tool_call_id|2 actions[]|3 description?|4 bind_unmapped_characters?|5 desktop_lease_actor_id?|6 screenshot_settle_ms?`——批量动作 + **desktop_lease_actor_id**（云端租约）+ 截图稳定等待。
- `ComputerUseAction` 11 动作：`mouse_move(1 coordinate) click(button,count) mouse_down(button) mouse_up(button) drag(path,button,modifier_keys) scroll(coordinate?,direction,amount,modifier_keys?) type(text) key(key,hold_duration_ms?,stroke) wait(duration_ms) screenshot cursor_position`；枚举 `MouseButton{LEFT,RIGHT,MIDDLE,BACK,FORWARD}`、`ScrollDirection{UP,DOWN,LEFT,RIGHT}`、`KeyStroke{TAP,DOWN,UP}`、`Coordinate{x:int32,y:int32}`——Anthropic computer-use 风格动作集。
- `RecordScreenArgs{mode: START_RECORDING|SAVE_RECORDING|DISCARD_RECORDING, tool_call_id, save_as_filename?}`。
- 环境握手字段（local-exec-daemon/main.cjs 偏移 ~2104922）：`...|19 computer_use_supported 8?|...`——客户端向服务端上报 CU 可用性。
- 会话帧 `GrokBotTranscriptWatchFrame|...|7 computer_actions #6 frame|...`（node-agent-coordinator/main.cjs 偏移 ~306884）——CU 动作实时帧推送给转录观察端。

### 3.4 noVNC 远程计算机控制台

- `preload-vnc.cjs`：RPC edge `box-vnc {readClipboard, writeClipboard}`；剪贴板回环检测 `shouldSendHostText/resolveVmText`；noVNC 模块注入点 `keyEvent/QEMUExtendedKeyEvent/pointerEvent/_damage/_recvMessage/fbUpdateRequest/flip`；帧节流 `__sandVncFrameHold`（minIntervalMs 步进发送 fbUpdateRequest）；liveness 心跳 `sand:vnc-liveness`（10s×3）；按键回显抑制键表（KeyA/KeyC/KeyV/KeyX/KeyZ + forceShift）。
- 渲染端（renderer/assets/index-ZYxf-aBb.js 偏移 ~1237907）：`noVNC_connected` 探测、五点采样 `getImageData` 检测黑帧、`computer-preview-connecting-indicator`、帧捕获 JPEG(0.7)——即"computer 预览"控制台。
- main-app.cjs 偏移 ~1756833：网关描述 `{baseUrl, token?, headers?, vncProxy:{primaryUrl, forkBaseUrl, networkToken}}`——桌面端经代理连远程计算机 VNC。

### 3.5 浏览器侧负证据（本机静态检索）

- `grep -r "browser_click|browser_navigate|browser_snapshot"` → dist 全目录 0 命中。
- `chrome-devtools`、`remote-debugging-port`、`devtools://`、`computer_browser`、`open_browser` → 0 命中。
- `browserView` 仅出现在进程遥测分类枚举（main-core.cjs 偏移 ~262373：`["background_page","browser_view","remote","webview","offscreen","unknown"]`），非 UI 构造调用。
- `playwright` 命中仅三处：渲染端 MCP 目录 brand 图标（`playwright:{kind:"brand",background:"#2EAD33",...}`）、daemon 的缓存目录环境变量（`PLAYWRIGHT_BROWSERS_PATH`）、feature flag `playwright_autorun`。
- 工具来源注册表（local-exec-daemon/main.cjs 偏移 ~2259851 后）：`cursor-app-control / cursor-backend-control / cursor-browser-extension / cursor-ide-browser / cursor-dev-control / custom-user-tools / fsd / cursor-subscriptions / cursor-cloud / suggestions / Cursor Slack Tools / Cursor Automation Tools`——浏览器工具的**来源标签**存在（extension / ide-browser），但工具本体定义不在本机（云端下发）。
- Chrome cookie 导入（main-app.cjs 偏移 ~1574343 起）：错误类 `ChromeCookieImportPermissionError("macOS Finder could not copy Chrome's cookie file")`（经 Finder AppleScript 拷贝 Chrome Cookies 文件以绕过 Chrome 自身文件保护）；审批流 `presentCookieOriginApproval({origins, requestId, agentId})`；执行 `importChromeCookies({cookies})`（collect → 逐 profile 收集 → 上传）；coordinator 侧审批通道 `/cookie-origin-approval/requests|responses`，决策枚举 `approve-once / always-allow / deny`（默认 deny）。

### 3.6 box（沙箱计算机）

- local-exec-daemon/main.cjs 偏移 ~1899441：`boxComputer:{runtime:{shared, containerName("cursor-box-shared"), dockerHost, dockerPath:"docker"}, entry: SAND_BOX_COMPUTER_ENTRY ?? <dist>/../../../projects/cursor-box-computer/dist/mcp.js}`——box 浏览器/计算机是 **docker 容器 + 独立 MCP server**（`cursor-box-computer`，本机包内不含该 entry，运行时部署）。
- 工具对：`CopyToBox / CopyFromBox`（与 Shell/Read/AwaitShell 并列出现在本地工具关闭提示文案中）。

---

## 4. 谱系证据（与已测 8 家对照）

1. **签名与包名**：Grok Bot 主应用 id `com.anysphere.sand`、CU 助手 id `co.anysphere.grok-bot-computer-use`、两者 TeamID `DCNK4UB866`（Anysphere, Inc.）——Cursor 官方分册（agents/cursor/computer-use.md）记录 sidecar 签名 pinnedSignerSubjects 为 `Anysphere, Inc.`、TeamID `DCNK4UB866`，完全一致。
2. **代码残留**：asar package.json `homepage:"https://cursor.com"`；依赖 `cursor-proclist`（file:../vscode/native-modules/cursor-proclist）；JS 客户端类静态默认值 `appSupportFolder="cursor-computer-use"` / `serviceAppBundleName="Cursor Computer Use"` / 可执行名 `CUCursorService`（运行时被产品配置覆盖为 Grok Bot 名）；工具来源注册表前缀 `cursor-*`；sidecar CDN `downloads.cursor.com/computer-use-sidecar`。
3. **协议同构**：Unix socket + 行分隔 JSON-RPC、`computer_use_*` 动作 RPC 名与 Cursor 分册静态还原的 RPC 面逐名一致（computer_use_click/scroll/mouse_move/mouse_button/drag/typing/press_key）；`sand_computer_use_playwright_config`（modelId `sand-cua`）与 Cursor 架构图中的同一配置同名同值。
4. **CU 服务内嵌 `--mcp-stdio` 模式 + 16 工具 `computer_*` companion catalog** 为相对 Cursor 分册所见形态的**新增代际**（Cursor 侧当时为扩展 TS 层承载工具编排；Grok Bot 侧编排已下沉进 Swift sidecar）。
5. **Synara 交叉印证**：agents/synara/README.md 记录 Synara 编排服务器 provider 列表含 `grok`——第三方编排器亦将其视为一类可挂接 agent。
6. **Grok CLI 无 CU/BU**：README 内置工具表（见 §1.1）+ 二进制 strings 12 处 `computer` 命中全部为 OpenAI Responses API 协议类型名（`ComputerToolCall`/`ClickParam`/`DragParam`/`ScrollParam`/`KeyPressAction`/`DoubleClickAction` 等，行 9542 区段，属 API 兼容层而非本地能力）；93 处 `browser` 命中为 OAuth 浏览器登录文案与 MCP 文档示例（`@modelcontextprotocol/server-puppeteer`，行 29124）。

## 5. 本机可用性判定

- 桌面端 CU：**载体完整在位，门控全关，从未激活**。证据：flags `local_computer_use`/`mac_computer_use` 默认 false 且本机 statsig bootstrap 无覆盖；`~/Library/Application Support/grok-bot-computer-use/` 不存在；`~/.cursor/cursor-computer-use/` 不存在（JS 默认安装目录）；无 sidecar 进程/日志痕迹。→ 与 Cursor 本机状态同构（Cursor 分册："sidecar 从未安装"）。
- 桌面端 BU：云侧能力（browser_subagent 默认开），本机无法静态验证云端行为；本地侧无浏览器控制工具面。
- Grok CLI：无 CU/BU，判定为"能力不存在"，非"未启用"。
