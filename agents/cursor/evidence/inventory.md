# Cursor CU/BU 逆向证据清单

> 分析对象：本机安装的 Cursor（macOS arm64）。所有路径均为绝对路径；压缩 JS 为单行打包产物，行号无意义，故以"模块名标记 + 字节偏移 + 复现命令"方式给出定位依据。全部操作只读，未修改被分析对象。

## 1. 软件版本与载体

| 项 | 值 | 证据 |
|---|---|---|
| Cursor 版本 | 3.22.12（distro d5c0e77） | `/Applications/Cursor.app/Contents/Resources/app/package.json` |
| VSCode 底座 | 1.128.0（quality: stable） | `/Applications/Cursor.app/Contents/Resources/app/product.json` |
| 主进程入口 | `./out/main.js`（2.6 MB） | package.json `main` 字段 |
| 渲染层 bundle | `out/vs/workbench/workbench.desktop.main.js`（38.7 MB）、`workbench.glass.main.js`（45.4 MB，新 Glass UI） | `ls -la out/vs/workbench/` |
| CLI | cursor-agent 2026.09.23-86fc751，符号链接 `~/.local/bin/cursor-agent` → `~/.local/share/cursor-agent/versions/2026.09.23-86fc751/cursor-agent`（bash 启动器，exec Node + `index.js`，8.7 MB，另有 79 个分块 `*.index.js`） | `readlink`、`file`、`wc -c` |
| Electron 主框架 | `Cursor.app/Contents/Frameworks/Electron Framework.framework`，Helper 四件套（含 `Cursor Helper (Plugin).app`） | `ls Contents/Frameworks/` |

复现命令：

```bash
cat /Applications/Cursor.app/Contents/Resources/app/package.json
cat /Applications/Cursor.app/Contents/Resources/app/product.json | head -50
```

## 2. 关键内置扩展（app 自带，非用户安装）

目录：`/Applications/Cursor.app/Contents/Resources/app/extensions/`（共 117 项，其中 Cursor 自有 23 个）。与 CU/BU 直接相关：

| 扩展 | package.json 摘录 | 作用 |
|---|---|---|
| `cursor-computer-use` | `"description":"Computer use in Cursor"`, `main:./dist/extension.js`, `enabledApiProposals:["cursor","cursorPublic"]`, `extensionKind:["ui"]` | 本地 computer use（sidecar 架构），**附带完整 TypeScript 源码 `src/`** |
| `cursor-browser-automation` | `"description":"MCP server for browser automation in Cursor"`, `enabledApiProposals:["control","cursor","cursorTracing"]` | 浏览器控制 MCP server（`cursor-ide-browser`） |
| `cursor-agent-host` | `"Hosts Cursor agent orchestration in the AgentExec extension host"`, API proposals `["control","cursor","cursorNoDeps","cursorAgentHost","cursorTracing","cursorPseudoterminal"]` | agent 编排宿主 |
| `cursor-agent-exec` / `cursor-agent-worker` | 同族 | agent 执行/worker 宿主 |
| `cursor-local-agent-runtime` | `"Hosts Cursor Private Inference outside workspace extension hosts"` | 本地推理运行时 |

用户侧扩展（`~/.cursor/extensions/`）仅 anysphere.remote-ssh/remote-containers，与 CU/BU 无关。

**首次启动扩展 ID 清单**（workbench.desktop.main.js，字节偏移 ~490759）：

```
zUr=[...VUr,"anysphere.cursor-deeplink","anysphere.cursor-resolver-helper",
     "anysphere.cursor-socket","cursor.cursor-computer-use",
     "vscode.github-authentication"]
ngc=["cursor.cursor-browser-automation","anysphere.cursor-always-local", ...]
```

即 `cursor.cursor-computer-use` 与 `cursor.cursor-browser-automation` 是官方内置扩展 ID。

## 3. Browser Use 证据链

### 3.1 MCP provider 注册与身份

- `cursor-browser-automation/dist/extension.js`（222 KB，字节偏移 ~193747）：

```js
class Pt{constructor(){this.id="cursor-ide-browser",this.cdpTurnTracker=new l,...
```

- 激活函数（同文件）：

```js
async function Lt(t){...
  const n=s.cursor.registerMcpProvider(Nt);  // Cursor 私有扩展 API
  t.subscriptions.push(n);
  Mt.requestPush("activation"),...
  const o=s.commands.registerCommand("cursor.browserAutomation.reinjectUIScript",Ot);
```

- workbench 侧内部 provider 常量（workbench.desktop.main.js 模块 `mcpConstants.js`，偏移 ~16305010）：

```js
$_t="cursor-browser-extension", H_t="cursor-ide-browser",
wUi="cursor-app-control", xJs="cursor-subscriptions",
M1d="cursor-dev-control", N1d="cursor-computer-use",
IJs=new Set([wUi,yUi,xJs,M1d,P1d,L1d,Xie,Mj,N1d])
```

即存在 7 个一方（first-party）内部 MCP provider 标识。

### 3.2 完整工具面（15 个注册工具 + callTool 分发里的 browser_lock）

提取命令：

```bash
python3 - <<'EOF'
import re
data=open('.../cursor-browser-automation/dist/extension.js').read()
re.findall(r'\{name:"(browser_[a-z_]+)",description:"((?:[^"\\]|\\.)*)",parameters:JSON\.stringify\(',data)
EOF
```

输出：`browser_navigate, browser_snapshot, browser_click, browser_mouse_click_xy, browser_type, browser_fill, browser_select_option, browser_press_key, browser_scroll, browser_drag, browser_get_bounding_box, browser_highlight, browser_tabs, browser_cdp, browser_take_screenshot`；`callTool` 分发中另有 `browser_lock`。

工具描述原文（节选，含语义）：

- browser_navigate：`"Navigate to a URL. By default reuses an existing tab; set newTab: true to open in a new tab."` 参数含 `url`(必填)、`viewId`、`position:["active","side"]`、`take_screenshot_afterwards`、`newTab`。
- browser_snapshot：`"Capture accessibility snapshot of the current page, this is better than screenshot"`，参数 `interactive/maxDepth(默认20)/compact/selector/includeDiff`。
- browser_click：`"Click an element by ref from browser_snapshot. Use this instead of CDP Input.* methods."`，参数 `ref`(必填)/element/offsetX/offsetY/doubleClick/button/modifiers/holdDurationMs。
- browser_cdp：`"Send a Chrome DevTools Protocol command... Browser-wide, storage, cookie, permission, download, target-management, and system-level commands are denied."`
- browser_lock：`"Lock or unlock the browser to control whether the user can interact while you work... the user can still click 'Take Control' to unlock if needed."`

系统提示词全文（`VISION:`/`NOTES:`/`AVOID RABBIT HOLES:` 等段落）见 browser-use.md 第 6 节，来源同文件偏移 ~198537。

### 3.3 观察：快照 + ref 机制

- ref 赋值（extension.js 内嵌页面脚本，偏移 ~28570）：

```js
ref = 'e' + refCounter++;
el.setAttribute('data-cursor-ref', ref);
```

- 按 ref 查找（遍历 composed DOM，含开放 shadow root）：

```js
function findElementByRef(ref){ ... candidate.getAttribute('data-cursor-ref')===ref ... }
```

- 过期防护：`assertDescriptionMatches(element, ref, expectedDescription)` —— 校验元素当前 tag/role/aria-label/text 与快照时一致。
- 快照 YAML 格式与 `~/.cursor/browser-logs/snapshot-*.log` 落盘格式完全一致（`role/name/ref/placeholder/value/states:[current]/nth`）。

### 3.4 动作：注入 JS 合成 DOM 事件

- 拖拽实现（extension.js 偏移 ~250000 起，模板字符串注入）：`new DataTransfer()` + `PointerEvent('pointerdown')` + `MouseEvent('mousedown')` + `DragEvent('dragstart'/'drag'/'dragenter'/'dragover')` 全链路派发。
- 输入实现：`element.focus()` → `element.click()`（聚焦失败兜底）→ 设值。
- UI 常驻脚本经 `executeCommand("cursor.browserView.executeJavaScriptInIsolatedWorld", ...)` 注入隔离世界。

### 3.5 CDP 通道与拒绝列表（main.js）

- 处理函数（main.js 偏移 ~1790998，模块 `browserViewMainService.js`）：

```js
async sendCDPCommand(e,t,n,r){ const s=Wx(t); if(s) throw ...;
  const o=a.debugger; o.isAttached()||o.attach("1.3");
  return await o.sendCommand(t,n||{}) }
```

- 拒绝集（main.js 偏移 ~250543）：

```js
t5=new Set(["Browser","Input","Storage","SystemInfo","Target","Tethering"]),
n5=new Set(["DOM.setFileInputFiles","Network.clearBrowserCache",
 "Network.clearBrowserCookies","Network.deleteCookies","Network.getAllCookies",
 "Network.getCookies","Network.setCookie","Network.setCookies",
 "Page.getNavigationHistory","Page.navigate","Page.navigateToHistoryEntry"])
```

- `Input.*` 单独拒绝并给出原因：`"CDP Input.* methods are focus-sensitive in Electron webviews. Use dedicated browser tools..."`。

### 3.6 浏览器宿主（主进程）

- `browserViewMainService.js`（main.js 偏移 ~1754696）：每个窗口 Map 管理 Electron `webview` 类型 webContents；`webRequest.onBeforeRequest/onCompleted/onErrorOccurred` 记录网络请求；`consoleLogs` 数组收集控制台；外部协议跳转弹窗确认（`confirmExternalSchemeNavigation`）；证书错误处理。
- 渲染层命令面（`grep -o '"cursor\.browser[a-zA-Z.]*"' -r vs/` 共 33 个命令 ID）：`cursor.browserView.newTab/newHeadlessTab/listTabs/selectTab/navigate/reload/goBack/goForward/getURL/getTitle/resize/setLocked/isLocked/setRecordingType/takeScreenshot/updateScreenshot/executeJavaScript/executeJavaScriptInIsolatedWorld/getNetworkRequests/getConsoleLogs/sendCDPCommand/debug.orphanView/debug.crashRenderer` 等。

### 3.7 真实运行痕迹

- `~/.cursor/browser-logs/`：5 个 `cdp-response-Page.captureScreenshot-*.json`（2026-09-17）、1 个 `cdp-response-Runtime.evaluate-*.json`（2026-08-24）、4 个 `snapshot-*.log`（2026-08-24/25，YAML a11y 快照）。写入者即 browser-automation 扩展：`const xt=u.join(p.homedir(),".cursor","browser-logs")`。
- 每次会话都会创建 `~/Library/Application Support/Cursor/logs/<ts>/window1/mcp-server-cursor-ide-browser.workbench.log`（本机均为 0 字节 = provider 注册且无错误）。

### 3.8 导航安全策略（渲染层）

workbench.desktop.main.js 偏移 ~29842015：

```
"file:// URLs are not allowed. The browser navigation tool can only access
web URLs (http:// or https://). ..."
if(!this.isOriginAllowed(i,n.allowlist)) throw new Error(
 `Navigation to ${i} is blocked by administrator settings. Allowed origins: ...`)
```

命令 `cursor.browserOriginAllowlist.ensurePageOriginAllowed` / `ensureNavigationAllowed` 由扩展在 navigate 前调用。

## 4. Computer Use 证据链

### 4.1 扩展与注册

`extensions/cursor-computer-use/`（dist 272 KB + 9 个 webpack 分块；**src/ 保留完整 TS 源码**）：

- `src/mcp/tools.ts:76`：`export const COMPUTER_USE_MCP_SERVER_ID = "cursor-computer-use";`
- `src/extension.ts:547`：`context.subscriptions.push(vscode.cursor.registerMcpProvider(provider));`
- `src/extension.ts:213-226`：激活受 Statsig 门控，darwin 用 `MAC_COMPUTER_USE_FEATURE_GATE`（常量值 `mac_computer_use`），其余 `local_computer_use`；门初始为关时挂 `vscode.cursor.onDidChangeGates` 监听等刷新。
- 文件头注释（tools.ts:1-10）：`"Every tool executes by calling the computer-use sidecar ... over its local RPC; this layer never synthesizes input or captures the screen itself"`。

### 4.2 工具面（macOS companion 视角，src/mcp/tools.ts:1533-2093）

注册的 descriptor 名单：`computer_screenshot / computer_click / computer_move / computer_drag / computer_type / computer_key / computer_scroll / computer_wait / computer_check_permissions / computer_start_control / computer_release_control / computer_apps / computer_resolve_app / computer_app_state / computer_set_value / computer_app_action`；Windows 另有 `computer_zoom`、`computer_batch`。

平台条件编译（tools.ts:85-173）：

```ts
const APP_SCOPE  = process.platform === "darwin";   // app 级工具仅 macOS
const ZOOM_SCOPE = process.platform === "win32";    // zoom/zoom_id 仅 Windows
const BATCH_SCOPE= process.platform === "win32";    // computer_batch 仅 Windows
const LEASE_TOOLS    = process.platform !== "win32"; // start/release control 仅 macOS
const PERMISSION_TOOL= process.platform !== "win32"; // 权限探测仅 macOS
```

关键参数 schema（tools.ts 内 zod + JSON.stringify 双份）：click `{x,y,button:["left","right","middle"],count:1..3,modifier_keys,zoom_id}`；drag `path` 2–64 点；type `text` 1..4000；scroll `direction,amount 1..20`（macOS 默认 3 ticks）；wait `ms<=30000`；app 目标 `{pid,bundle_id,app_path,app_name}` 四选一。

### 4.3 macOS 双模式（src/mcp/mac-mode.ts，79 行全读）

```
Glass / local → companion；Private / cloud --computer-use → remote
```

- companion（本机 Glass 代理）：`"These tools drive one macOS app in the background. They do not take the display or move the real cursor."` 默认 app 目标（pid+target_id），`computer_start_control` 仅为升级路径；`computer_type` 走 AX 插入，屏幕级 typing 拒绝。
- remote（云端 worker）：全屏 scope，`computer_start_control` 先行、结束后 `computer_release_control`；`"Private-worker computer-use has no app pid or element_id."`

### 4.4 AX 树观察

`computer_app_state` 描述（tools.ts:2026）：`"[id] ROLE name=… value=… settable actions=…"` 逐行缩进树 + 尾行 `snapshot_id`；元素动作引用 `element_id + snapshot_id`，树变化时报 stale。

### 4.5 sidecar（原生 helper）

- 平台传输文档（src/backends/common/transport.ts:1-15）：macOS 经 `service.json` 会合文件发现 helper，`/usr/bin/open -n -g <app>` 启动，Unix socket + 换行分隔 JSON-RPC；Windows 用按用户 SID 派生的命名管道 + 每连接 launch token 握手。
- 会合文件路径（src/backends/mac/sidecar-client.ts:116,1160-1170）：`~/Library/Application Support/cursor-computer-use/service.json`（env `CUA_APP_SUPPORT_DIR` 可覆盖）。
- 下载与校验（dist/extension.js 偏移 ~133769, ~151087）：manifest 路径强制 `/computer-use-sidecar/releases/{lane}/{cursorVersion}/{40位sha}.json`；artifact `sha256` 校验；codesign 锚定 `"anchor apple generic ... subject.OU = \"DCNK4UB866\""`，`pinnedSignerSubjects:["Anysphere, Inc."]`；安装锁（`sidecar-install-lock.ts`）；失败码集合 `["offline","proxy_blocked","cdn_error","download_corrupt","signature_unverifiable","install_locked","install_failed"]`。
- 安装位置：`~/.cursor/computer-use-sidecar/`（dist/extension.js：`Bi=m.join(".cursor","computer-use-sidecar")`）。**本机该目录不存在 → CU 未安装/未启用**（`ls ~/.cursor/computer-use-sidecar/` 无结果）。
- Windows 侧常量（同文件）：`executableName:"cursor-cua-sidecar.exe"`, `pipeNamePrefix:"cursor-cua"`, `launchTokenDirectory:["Cursor","ComputerUse"]`, token 文件 mode 384(0600)。
- 协议常量：`defaultCallTimeoutMs=15e3, typingTimeoutPerCharMs=13, typingTimeoutBaseMs=8e3`。

### 4.6 错误处理契约

`refusalResult()`（tools.ts:2120-2138）：`isError:true` + `structuredContent {code,message,escalation:{recommended,reason}}`；escalation 枚举 `retry / ask_user / use_different_tool / stop`（tools.ts:192-200）；`user_aborted` 保留原始 code-only 形态。

### 4.7 云端/CLI 侧 CU（cursor-agent CLI）

`~/.local/share/cursor-agent/versions/2026.09.23-86fc751/index.js`：

- import `../proto/dist/generated/agent/v1/computer_use_tool_pb.js`（偏移 ~5618127）。
- Linux worker 执行器：`DISPLAY`（默认 `:1`）+ **xdotool**（`mousemove --sync`、`click --repeat`、`keydown/keyup`、`key --`、`getmouselocation --shell`）；动作 case：mouseMove/click/mouseDown/mouseUp/drag(path)/scroll/type/key/wait/screenshot/cursorPosition。
- 截图：`ffmpeg -f x11grab -video_size WxH -i :N -frames:v 1 -vf scale=... -c:v libwebp -preset text -lossless 1 -f webp pipe:1`，WEBP 魔数修补后 base64。
- 中止安全：abort 时自动 `keyup ctrl shift alt super` + `mouseup` 全键释放（`releaseHeldInput`）。
- 指标：`computer_use.session.duration_ms / action_count / result / action_kind`。

### 4.8 agent.v1 protobuf（workbench.desktop.main.js）

- `C.makeEnum("agent.v1.MouseButton",...)`：UNSPECIFIED/LEFT/RIGHT/MIDDLE/BACK/FORWARD。
- `ClientSideToolV2Call` oneof（CLI index.js 偏移 ~8299486）49 个客户端工具，其中 `computer_use_params #66`、`record_screen_params #69`、`write_shell_stdin_params #43`、`switch_mode_params #41`。
- 会话参数：`computer_use_coordinate_mode`、`computer_use_supported`（bootstrap 字段 no:19）。

## 5. 安全模型证据

### 5.1 YOLO / Run Everything（workbench.desktop.main.js）

默认状态对象（偏移 ~1590000 前后，`D2={...}`）：

```js
yoloCommandAllowlist:[], yoloCommandDenylist:[], smartAllowlistDenylist:[],
yoloMcpToolsDisabled:!1, yoloDeleteFileDisabled:!1,
yoloOutsideWorkspaceDisabled:!0,   // 默认禁止工作区外写入
yoloEnableRunEverything:!1, enableSmartAuto:!1,
webFetchDomainAllowlist:[], mcpAllowedTools:[]
```

- "Run Everything" 开启前有确认弹窗：`"Enable Run Everything?"` + 备选 `"Use Sandbox instead"` / `"Use Allowlist"`（沙盒不可用时文案变化）。
- MCP 工具审批原因枚举（偏移 ~18382650）：`notInAllowlist → mcp.tool_not_allowlisted`、`playwrightProtection → mcp.browser_protection`、`mcpToolsProtection → mcp.tools_protection`、`readonlyMode`、`hookBlocked`、`smartMode → mcp.needs_approval`；`playwrightProtection` 默认 `!0`（true）。

### 5.2 管理员策略（TeamSettings proto）

```
{no:7,name:"mcp_tool_allowlist",repeated}, {no:8,name:"sandboxing_controls"},
{no:9,name:"browser_protection"}, {no:11,name:"enable_allowlist_mode"},
{no:12,name:"admin_command_denylist"}
```

团队场景浏览器特性 `failClosed`（`isLoading:!1, failClosed:e.hasTeam&&e.cachedBrowserFeatures===void 0`）。

### 5.3 CLI 权限参数（`cursor-agent --help` 实测输出）

```
-p, --print          ... Has access to all tools, including write and shell.
--mode plan|ask      只读模式
-f, --force          Force allow commands unless explicitly denied
--yolo               Alias for --force (Run Everything)
--auto-review        服务器分类器自动放行安全调用（Smart Auto）
--sandbox <enabled|disabled>
--approve-mcps       自动批准所有 MCP server
--trust              信任当前工作区免提示
```

### 5.4 macOS TCC 权限

- `computer_check_permissions` 工具 + 指令第一 bullet："Call computer_check_permissions first and wait for its result before any other Computer Use tool"（tools.ts:10-13）。
- Glass 命令（workbench.glass.main.js）：`wr({id:"openComputerUsePermissions",title:"Manage Accessibility and Screen Recording",...})`，内部 gate `mac_computer_use`，打开 `"computer-use-permissions"` 模态。
- 扩展监听权限状态变化自动路由弹窗（src/extension.ts:394-407，`glass.openComputerUsePermissions`）。

### 5.5 沙盒 helper

`/Applications/Cursor.app/Contents/Resources/app/resources/helpers/cursorsandbox`（3.5 MB Mach-O）+ feature flags `cli_sandbox_default_enable`、`sand_*` 系列。

## 6. 传输与端点

| 端点 | 用途 | 来源 |
|---|---|---|
| `https://api2.cursor.sh` | agent CLI 默认 endpoint（`-e` 参数默认值）；product.json `updateUrl` | `cursor-agent --help`；product.json |
| `https://api3.cursor.sh/tev1/v1` | statsig 事件代理 | product.json `statsigLogEventProxyUrl` |
| `https://api4.cursor.sh` / `https://api5.cursor.sh`（含 `agent-gcpp-{uswest,eucentral,apsoutheast}` 区域变体） | agent API | workbench.desktop.main.js 字符串 |
| `https://repo42.cursor.sh` | 代码搜索/索引 | 同上 |
| `https://prod.authentication.cursor.sh` | 认证 | 同上 |
| sidecar CDN：`/computer-use-sidecar/releases/{lane}/{ver}/{sha}.json` 与 `/computer-use-sidecar/artifacts/sha256/{sha256}/` | CU helper 分发 | cursor-computer-use/dist/extension.js |
| Statsig client key `client-Bm4HJ0aDjXHQVsoACMREyLNxm5p6zzuzhO50MgtoT5D` | 特性门控 | product.json（公开嵌入的 client key） |

本机用户配置 `~/.cursor/mcp.json`：仅一个 `unity` MCP server，与 CU/BU 无关。未做真实抓包，端点均为静态字符串证据。

## 7. 特性开关（Statsig 默认值快照，CLI index.js 偏移 ~2659803 与 workbench.desktop.main.js 偏移 ~14957183）

```
local_computer_use:!1        mac_computer_use:!1          // CLI 侧默认关
windows_computer_use_batch:!1  sand_computer_use_unicode_typing:!1
browser_subagent:!0          browser_mcp_chip:!0           // 浏览器默认开
browser_subagent_gating:!1   browser_features_access_control:!1
sand_browser_use_model → fallback {modelId:"sand-cua",maxMode:!1}
sand_computer_use_playwright_config → fallback {modelId:"sand-cua"}
grok_bot_browser_use_playwright:!1
```

`sand-cua` 为服务端专用 CU/BU 模型 ID（推断：CUA = Computer Use Agent）。

## 8. 排除项（避免误判）

- `out/vs/workbench/workbench.anysphere-ui-automations.js`（8.8 MB）：内容为 Automations（cron 定时代理任务）功能 UI（文件内 `cron` x75、`schedule` x49），**与桌面 UI 自动化无关**，文件名易误导。
- main.js 中唯一 `Accessibility.getFullAXTree` CDP 调用（偏移 ~2560000）属 VSCode 上游链接检测（离屏隐藏 webContents 提取 URL，`javascript:!1,offscreen:!0,sandbox:!0`），与 agent 浏览器控制无关。
- `snapshot_id`/`snapshot_watchdog` 的大量命中分属两个无关机制：云端 Background Composer 环境快照（aiserver.v1 proto）与 MCP server 快照自愈；浏览器侧快照不叫 snapshot_id（browser 用 `data-cursor-ref`，CU 用 element_id+snapshot_id——后者确为 CU 所用）。
