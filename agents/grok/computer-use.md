# Grok Bot Computer Use（原生桌面控制）完整逆向

> 分析对象：Grok Bot 桌面端 0.66.0（`/Applications/Grok Bot.app`，Electron 42.1.0）内嵌 `Grok Bot Computer Use.app`（CUGrokBotService 1.0.0）。
> 分析方式：只读静态逆向（asar 解包至 /tmp、Mach-O strings、Swift 符号表、随包配置 schema）。未运行被分析对象、未抓包、未触碰凭据。
> 分析日期：2026-10-06。证据行号见 [evidence/inventory.md](evidence/inventory.md)。

## 0. TL;DR

1. **Grok Bot 具备完整的原生桌面控制能力，且是"Cursor 同源代工"**：CU 助手由 Anysphere（Cursor 母公司）以其签名团队 TeamID `DCNK4UB866` 签发（主应用 `com.anysphere.sand`、助手 `co.anysphere.grok-bot-computer-use` 同团队），JS 宿主代码中残留 `CUCursorService` / `cursor-computer-use` 默认值，sidecar 分发 CDN 仍指向 `downloads.cursor.com/computer-use-sidecar`。这是本仓库 9 家分册中**谱系证据最硬**的一家：不是"借鉴"，是同一条产品线的换牌（详见 §9）。
2. 架构为**独立 Swift Helper 进程持 TCC + Unix socket 行分隔 JSON-RPC + 工具面与模型隔离**——仓库公共模式 P1/P2/P9 的标准实现；相对 Cursor 分册所见形态，新增了**编排下沉**：`computer_*` 16 工具的 MCP catalog（含参数 schema、逐字段描述、instructions、拒绝/升级分类表）整体嵌入 Swift 二进制，sidecar 以 `--mcp-stdio --conversation-id` 直接充当模型侧 MCP server。
3. 控制模型分**两档**：companion（默认，按 app 粒度后台驱动，不抢焦点不动真光标，光标悬浮层可视化）与 remote（升级档，整屏接管 + 真光标 + 租约 + Esc 急停 + 辉光覆盖层）。升级边界写在工具描述里（"Escalation only: take over the display... Do not call this to type or fill a form"）。
4. **本机从未激活**：门 `local_computer_use` / `mac_computer_use` 默认 false，本机无 service.json、无安装目录、无进程痕迹——与 Cursor 本机状态完全同构。
5. 另有**云端 CU**：proto 层 `ComputerUseArgs`（Anthropic 风格 11 动作批量 + `desktop_lease_actor_id` 租约）在远程计算机上执行，本机桌面端与手机经 noVNC"computer 控制台"观看与介入。桌面 CU 与云端 CU 共享同一动作词汇的两种编码（本地 snake_case RPC / 云端 proto oneof）。

## 1. 能力载体清单

| 载体 | 路径 | 版本 / 形态 | 角色 |
|---|---|---|---|
| CU 助手 App | `Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app` | 1.0.0，LSUIElement，min macOS 14.0 | TCC 权限持有者 + 工具执行者 |
| CU 助手二进制 | `.../MacOS/CUGrokBotService` | 6.3MB Mach-O universal（x86_64+arm64），Swift `CUCore` 框架 | socket RPC 服务 + MCP stdio 服务 |
| JS 客户端 | asar 内 `dist/local-exec-daemon/main.cjs`（类 `Js`，自识别名 local-cua） | 与 sidecar 变体配置同文件 | 连接管理、launch/relaunch、control 会话 |
| 变体配置 | 同上（表 `BQ`/`Z1`，prod/lab/dev 三套） | appName/bundleId/appSupportDir/executable 四元组 | 多环境隔离 |
| 侧车分发 | 动态配置 `mac_computer_use_sidecar_manifest.sidecarManifestUrl` | `https://downloads.cursor.com/computer-use-sidecar/releases/<ver>/<lane>/<sha40>.json`（Win 另有 x64/arm64 manifest） | CDN 签名分发（本机未触发，包内 Helpers 已自带） |
| CU 专用模型 | 动态配置 `sand_computer_use_playwright_config` | fallback `modelId:"sand-cua"` | 视觉-动作循环的模型选择（配置名含 playwright 为历史命名残留） |
| 指令下发 | 动态配置 `computer_use_mcp_instructions` | `{darwin:{companion,remote}, win32}` | 按模式注入 MCP instructions |

TCC 声明（助手 Info.plist 原文要点）：`NSAccessibilityUsageDescription`（"reads and controls on-screen apps so Grok Bot agents can operate your Mac on your behalf"）、`NSScreenCaptureUsageDescription`（"captures your screen so Grok Bot agents can see the apps they are operating"）、`NSAppleEventsUsageDescription`（另承载 iMessage 通路）、`NSContactsUsageDescription`（iMessage 收件人解析，非 CU 本体）。

## 2. 架构分层与调用链

```
┌────────────────────────────────────────────────────────────────────────┐
│ 模型侧（对话/编排）                                                       │
│  · 云端 agent（后端 ToolCall 流，computer_use_tool_call #23）             │
│  · 本地 harness（local-exec-daemon，工具来源注册表 "cursor-app-control"） │
├─────────────── A：本地 CU（companion/remote 两档）───────────────────────┤
│ JS 客户端（daemon 内 local-cua 类）                                       │
│  · ensureSocketPath → 读 service.json → rpcSocketPath                    │
│  · launch：/usr/bin/open -g <助手.app>（或 CUA_DIRECT_LAUNCH=1 直启）     │
│  · ENOENT/ECONNREFUSED → relaunch+retry（8s ready 超时，200ms 轮询 ping） │
│      ↓ Unix domain socket，行分隔 JSON（id/method/requestID/arguments）  │
│ CUGrokBotService（Swift CUCore）                                         │
│  · CULocalRPCListener（peerPolicy + processLock + TrustedTeamIDs）       │
│  · 方法面：ping / initialize / tools/list / tools/call /                 │
│    control/start / control/release / permissions/status /                │
│    permissions/open-settings（+ notifications/initialized/cancelled）    │
│  · CUCompanionToolService（app 粒度：AX 语义 + SCK 单窗截屏）              │
│  · CURemoteToolService（整屏：CGEvent/AppKit 事件注入 + 光标覆盖层）       │
│  · CUMcpServer/CUMcpStdioMode（--mcp-stdio --conversation-id，           │
│    内嵌 16 工具 computer_* catalog + instructions + refusals 表）         │
├─────────────── B：云端 CU（远程计算机）──────────────────────────────────┤
│ 后端下发 ComputerUseArgs（11 动作批量 + desktop_lease_actor_id +         │
│ screenshot_settle_ms + bind_unmapped_characters）→ 远程 VM 执行；         │
│ 本机/手机经 vncProxy{primaryUrl,forkBaseUrl,networkToken} + noVNC        │
│ （websockify；preload-vnc 做剪贴板同步、QEMU 键事件、帧节流）观看/介入     │
└────────────────────────────────────────────────────────────────────────┘
```

**工具面到达模型的两条路径**：
- 路径 A1（编排下沉，新代际）：sidecar `--mcp-stdio` 直接作为 MCP server 挂给会话，模型看到 `computer_*` 16 工具（描述/schema/instructions/refusals 全部二进制内嵌，另由 `computer_use_mcp_instructions` 动态配置补充按模式文本）。
- 路径 A2（宿主编排）：daemon 内 local-cua 类把 `computer_use_*` 14 个动词经 socket `tools/call` 直发（截图/点击/滚动/移动/按键/拖拽/输入/set_value/次级动作/app_state/选 app/列 app/查权限），`control/start(mode:"remote")` 起会话拿 `sessionId`，后续调用携带。

## 3. 完整工具面

### 3.1 `computer_*` 家族（companion MCP catalog，16 工具，二进制内嵌原文）

坐标基准统一为**固定 1280×800 截图画布**（原点左上，x≤1279 / y≤799），多屏窗口截屏缩放进画布；catalog 描述原文："Coordinates are pixels in the fixed 1280×800 screenshot canvas"。

| 工具 | 参数（schema 要点） | 语义 | annotations |
|---|---|---|---|
| `computer_screenshot` | `target?`（`{scope:"screen"}` 或 `{scope:"app",pid,target_id}`） | 截主屏或单 app 窗口；活快照新鲜时复用 snapshot_id 且不重走 AX；带 snapshot_id 时不返回树 | readOnlyHint |
| `computer_click` | `x,y`(必填), `button`(left/right/middle), `count`(1-3), `coordinate_token`(app target 必填), `step`(≤120 字用户活动列表文案) | 坐标点击；返回点击后截图（app target 仅返回文本） | — |
| `computer_move` | `x,y`, `coordinate_token`, `target?` | 悬停移动（展开 hover UI）；返回截图 | — |
| `computer_drag` | `from{x,y}`, `to{x,y}`, `button`, `coordinate_token`, `step` | 按下-拖动-释放 | — |
| `computer_type` | `target`(仅 app scope，**screen-scope 输入直接拒绝**), `element_id`+`snapshot_id` 或点击选中域/焦点域, `text` | 打字；catalog 原文 "Prefer computer_set_value or computer_type with element_id... A missed click target is refused... Does not raise or move the real cursor" | — |
| `computer_key` | `key`（"Return"/"Escape"/"cmd+l" 等，`+` 组合修饰键）, `target?` | 按键/组合键；返回截图 | — |
| `computer_scroll` | `x,y`, `direction`(up/down/left/right), `amount`, `coordinate_token`, `target?` | 坐标滚动；返回截图 | — |
| `computer_wait` | `ms`(0-30000，默认 1000) | 等待页面/动画稳定；仅文本 | readOnlyHint |
| `computer_check_permissions` | 无 | 被动上报辅助功能+屏幕录制授权态；catalog 原文 "Not needed before acting"，且明示禁止并行调用 | readOnlyHint |
| `computer_start_control` | 无 | **升级阀**：接管整屏 + 移动真光标；"App targets need no session. Do not call this to type or fill a form." | — |
| `computer_release_control` | 无 | 结束整屏接管 | — |
| `computer_apps` | 无 | 列出可驱动的运行中 app（"running app(s)"; Spotlight/通知中心/菜单栏 extra 明示不支持） | — |
| `computer_resolve_app` | `pid|bundle_id|app_path|app_name` 四选一, `step?` | 解析（未运行则**不激活启动**："Launched app without activation"）并返回 pid+target_id | — |
| `computer_app_state` | `target`(app), `element_id`?(钻取展开), `snapshot_id`? | 读 AX 树为文本（"[id] ROLE name= value= settable actions="，按深度缩进；预算截断行尾 "(+N descendants omitted)"，传 element_id 展开并入同一 snapshot）；末行 snapshot_id | readOnlyHint |
| `computer_set_value` | `target`, `element_id`, `snapshot_id`, `value`, `step?` | AX 写值替换（不走键盘）；文本返回；树未变则 snapshot 继续有效 | — |
| `computer_app_action` | `target`, `element_id`, `snapshot_id`, `action`（"press" 或元素 actions= 列表项如 show-menu/scroll-to-visible） | 对树内元素执行 AX 动作；"Prefer this over coordinate clicks when the element is in the tree" | — |

**instructions 原文要点**（行 1489-1502）：默认走 app target，"Do not call computer_start_control first"；`computer_start_control` 仅当用户要求接管屏幕；动作被权限拒绝时把拒绝文本转告用户并在授权后重试；禁止并行调用 CU 工具。

### 3.2 `computer_use_*` 家族（daemon 直连 RPC 面，14 动词）

`screenshot{}` / `click{method:"coordinate",x?,y?,button,count,modifier_keys}` / `scroll{x?,y?,direction,amount,modifier_keys}` / `mouse_move{x,y}` / `mouse_button{button,action:down|up}` / `drag{button,path:[{x,y}≥2点],modifier_keys}` / `typing{value}` / `press_key{key,hold_duration_ms}` / `set_value{...}` / `perform_secondary_action` / `app_state` / `select_app` / `apps_list` / `check_permissions{}`。

与 `computer_*` 的关系：这是**低层动作词汇**（约等于 Cursor 扩展 TS 层所见 RPC 面），`computer_*` 是**高层语义词汇**（app target 默认、element_id/snapshot_id 句柄、refusals 分类、step 用户文案）。两套并存于同一二进制，分别服务宿主编排与模型直连 MCP 两种挂法。

### 3.3 云端 `ComputerUseAction`（proto，11 动作）

`mouse_move(coordinate) / click(button,count) / mouse_down / mouse_up / drag(path,button,modifier_keys) / scroll(coordinate?,direction,amount,modifier_keys?) / type(text) / key(key,hold_duration_ms?,stroke:TAP|DOWN|UP) / wait(duration_ms) / screenshot / cursor_position`；MouseButton 含 BACK/FORWARD。批量载荷 `ComputerUseArgs` 附带 `description`（动作意图描述）、`desktop_lease_actor_id`（租约执行者）、`screenshot_settle_ms`（动作后截图稳定等待）、`bind_unmapped_characters`（unicode 输入绑定，对应本地 flag `sand_computer_use_unicode_typing`）。

## 4. 观察机制

- **像素通道**：ScreenCaptureKit **按窗口**捕获（非整屏 grab），捕获期间持续校验窗口同一性（"Target identity changed before/during capture"、"Window transform changed during capture"、"Window must lie within one display"）；JPEG 编码且**单张预算 1 MiB**（超限降级为文本提示重拍）；统一缩放进 1280×800 画布，画布外补边（padding bar），坐标越界落入补边时被识别并拒绝/钳制（"Coordinates are in a screenshot padding bar" / "Coordinate clamped from the padding bar to the display edge"）。
- **结构通道**：AX 树文本化，一行一元素，`[id] ROLE name= value= settable actions=` 格式、深度缩进；预算截断 + element_id 钻取展开；snapshot_id 台账跨工具复用（截图复用活快照时明示 "Reused live snapshot (tree unchanged)"，提示模型不要再调 app_state）。
- **双句柄防漂移**：元素句柄 `snapshot_id + element_id`（AX 通路）与坐标句柄 `coordinate_token`（截图通路）分离，各自绑定新鲜度；staleness 归因到五种具体原因（窗口不再当前/出现消失/树结构变化/焦点窗口变化/前台窗口变化），错误消息直接指示补救动作（"read computer_use_app_state before using element ids"）。
- **遮挡语义**：窗口被遮挡/最小化/不在当前 Space 时截图仍然有效且**坐标动作可命中被遮挡窗口**（"The image is still current; coordinate actions reach a covered window"）——后台定向输入路线（对照仓库 P4），配合 "Companion does not raise"（SkyLight 级不抬升，字符串证据 `skylight-no-raise`）。
- **云端通道**：动作批量执行后按 `screenshot_settle_ms` 等待再截图回传；手机/桌面经 noVNC 帧流观察（带黑帧检测的 liveness 探针与帧节流）。

## 5. 动作机制

- **AX 语义通路（companion 默认）**：AXPress / AXShowMenu 等具名动作（`computer_app_action`）、AXValue 写值（`computer_set_value`）+ **写后回读校验**（"AXValue read back as ..., not the written text"）、AXSelected 行选中（回读 false 即报 "the app did not select the row. Use screenshot coordinates"）、AXScrollToVisible 滚动入视（不支持时明确拒绝并指向坐标路径）。防御性规则：element_id 点击只允许单击左键 AXPress；巨型无语义元素拒绝点击；element_id 与坐标参数互斥。
- **事件通路（remote）**：CGEvent/AppKit 合成事件（`Could not create keyboard event`、`leftMouseDragged` 等），`EventSequencer` 全序号定序，`CUPointerMoveHop` 指针移动分步；键名文法解析（"Return/Enter/Tab/cmd+l"、修饰键 `+` 组合、unicode 键盘事件直发）；拖拽要求 ≥2 点路径。动作前校验 target 身份（"Target identity for pid ... is stale. No input was posted."——**未投递即失败，不做半截动作**）。
- **投递后语义**：超时动作明确警示缓存几何可能失真（"The timed-out action may have left cached screenshot geometry stale. Call computer_use_screenshot before another coordinate action"）。

## 6. 安全模型

1. **进程身份链**：sidecar 由宿主 App 的 `Contents/Helpers` 携带（同一签名团队），运行时也可经 CDN manifest 更新分发；socket 对端校验基于 **codesign 团队标识白名单**（`localRPCTrustedTeamIdentifiers` + `codeSigningTeamIdentifier` + `peerPolicy`），拒绝跨用户进程与 launchd 直启（"a host must spawn this executable"）；`anchor apple generic` 校验。
2. **TCC 归助手**：Accessibility + Screen Recording（+ AppleEvents/Contacts 给 iMessage 面）全部声明在助手 App；权限被动探测（`--probe-permissions`、`permissions/status`）与主动引导（`permissions/open-settings` 打开 System Settings 对应面板）分离；动作遇权限缺失的失败消息内嵌用户操作指引。
3. **两档控制 + 显式升级阀**：companion 免会话、不动真光标、不抬升窗口；`computer_start_control` 才整屏接管，且 catalog 指令层明令"输入/填表不得升级"。
4. **租约与会话互斥**：remote 会话由 `CURemoteControlLease` 管理（活跃会话唯一："Remote control is busy with another session"）；`CURemoteControlPermit` 持有在途输入（heldInputs）支持即时撤销；云端侧对应 `desktop_lease_actor_id`。
5. **急停三路**：物理 Esc（`CURemoteEscapeTap` event tap，arm 失败即报权限问题）、用户 Stop（`CUCompanionStops` / "The user stopped computer use."）、协议级 `USER_ABORTED` 错误码（附行为指令："Do not call input, start-control, or release-control tools again in this turn"）；异常路径兜底 `best-effort control/release`。
6. **结构化拒绝与升级分类**：每个失败返回 `isError=true + structuredContent{code, message, escalation:{recommended, reason}}`，16 个错误码静态映射到四档建议——`retry`（未生效，改参重发安全）/ `ask_user`（只有机器前的人能解决：secure_desktop、input_desktop_unavailable、target_elevated、permission_required、session_busy、sidecar_unavailable、unsupported_request）/ `use_different_tool`（先跑指定工具，多为 screenshot_required）/ `stop`（user_aborted，本回合终止输入）。这套"错误即指令"的面是 9 家分册中**最完整的模型侧失败协议**。
7. **可视化共驾**：companion 光标悬浮层（`CUPointerLayer/Panel`，catalog 明示 "a cursor overlay is still shown"）；remote 辉光覆盖层 + 指针图标 + 透传点击（`beginPointerPassThrough`）+ 覆盖层重锚定——人始终看得到 agent 在"指"哪里。
8. **生命周期卫生**：`CUA_IDLE_EXIT_SECONDS` 空闲自退出；产品上下文 bootstrap 单次锁定（防同进程双产品配置混跑）；安装采用临时目录 + 原子 rename + 逐字节比对（daemon 侧 `hxt/mxt`），装完才拉起。
9. **门控 fail-closed**：`local_computer_use`/`mac_computer_use`/`computer_use_next_action`/`windows_computer_use_batch` 默认全关；`computer_use_supported` 由客户端在会话握手中上报，服务端据此决定是否下发 CU 工具（未启用 = 工具不存在，仓库模式 P11）。

## 7. 错误码全景（结构化 structuredContent.code）

`capture_failed / invalid_arguments / input_failed / timeout`（retry）；`secure_desktop / input_desktop_unavailable / target_elevated / unsupported_request / sidecar_unavailable / session_busy / permission_required`（ask_user）；`screenshot_required / unknown_tool / outcome_unknown / session_required`（use_different_tool）；`user_aborted`（stop）。另有传输层：RPC 超时/响应超限/socket 过长/service 不可用、launch 失败（`sidecar did not publish service.json after launch` / `did not become ready in time`）。

## 8. 与云端 CU（远程计算机）的关系

- 本地助手服务"这台 Mac"；云端 `computer_use_tool_call` 服务托管 VM（"box"/remote computer）。两者共享动作词汇（proto 11 动作 ≈ 本地事件通路动词的超集）与租约概念（`desktop_lease_actor_id` ≈ remoteControlLease）。
- 人的介入面：`sand_mobile_agent_computer_console`（默认开）给手机与桌面提供 noVNC 控制台——不只是观看（黑帧检测/帧节流保帧率），还能介入（pointer/key 事件、剪贴板双向同步 `box-vnc{readClipboard,writeClipboard}`、主机输入回环抑制防回显）。这是把"人机共驾"延伸到云 VM 的设计。
- `record_screen`（START/SAVE/DISCARD_RECORDING）是独立工具位，服务会话回放/审计，不是 CU 观察通道。

## 9. 谱系关系（与已测 8 家对照）

- **与 Cursor：同一血统，代际更新**。证据链（全静态、可复核）：① TeamID `DCNK4UB866` / Anysphere 双方一致；② 主包 `com.anysphere.sand`、package.json homepage `cursor.com`、依赖 `cursor-proclist`；③ JS 客户端类默认值 `cursor-computer-use`/`Cursor Computer Use`/`CUCursorService`（运行时被 Grok Bot 产品表覆盖）；④ sidecar CDN 域名 downloads.cursor.com；⑤ `sand_*` flag 家族与 `sand-cua` 模型名在两家二进制中同名同值。相对 Cursor 分册记录的形态（扩展 TS 层承载 16 工具编排），Grok Bot 的代际差异是**编排下沉进 Swift sidecar**（--mcp-stdio + 内嵌 catalog + refusals 分类表）以及 companion/remote 双指令由服务端动态配置下发。
- **与 Codex（Sky 服务）/ Claude（SkyLight/CGS）/ Kimi（SLS 签名事件）**：同为"独立 Helper + 私有/系统能力做后台定向输入"路线；Grok Bot 的特色是遮挡窗口坐标可命中 + 不抬升（`skylight-no-raise`），与 Claude 的 SkyLight 后台操作同类。
- **与 trycua 系（MiniMax/Synara/Kimi）**：无内嵌关系，但共享 Cua AI 风格的环境变量命名（`CUA_APP_SUPPORT_DIR`/`CUA_DIRECT_LAUNCH`/`CUA_IDLE_EXIT_SECONDS`）——间接佐证 sidecar 的 Swift 基座与 Cua AI 同源或同作者传承（对照 Cursor 分册："sidecar 为 Swift 应用 computer-use-sidecar（CDN 分发）"，其上游即 Cua 系）。此点为推断，标注置信度中。
- **与 Grok CLI 的关系**：无。CLI 是独立的终端 agent（自有工具面 16 件，无 CU/BU），桌面端不复用其二进制或工具协议。

## 10. 本机可用性判定与复现命令

判定：**载体完整在位（助手 App + 二进制 + 宿主客户端 + 变体表 + CDN 分发通道），门控全关，本机从未激活**（无 service.json、无安装目录、无进程痕迹）。静态还原的工具面即上两节，非本机实测会话。

```bash
plutil -p "/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app/Contents/Info.plist"
codesign -dv "/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app"   # TeamID DCNK4UB866
npx asar extract "/Applications/Grok Bot.app/Contents/Resources/app.asar" /tmp/grokbot-analysis/app
strings -n 6 "/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app/Contents/MacOS/CUGrokBotService" | sed -n '640,1520p'   # 内嵌 MCP catalog
ls ~/Library/"Application Support"/grok-bot-computer-use 2>/dev/null                   # 不存在 → 未激活
```
