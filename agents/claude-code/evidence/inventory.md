# 证据清单（Evidence Inventory）

> 逆向对象：本机 Claude Code CLI 与 Claude 桌面端的 computer use / browser use 能力。
> 侦查日期：2026-10-06。所有分析均为只读；解包产物放 `/tmp`。
> 本文所有"偏移量"均指 `grep -a -b -o` 或 python `mmap.find()` 输出的文件字节偏移。

---

## 1. 能力载体清单

| 载体 | 绝对路径 | 版本 | 说明 |
|---|---|---|---|
| CLI（运行中） | `/Users/laplace/.local/bin/claude` → `/Users/laplace/.local/share/claude/versions/2.1.212` | 2.1.212 | Mach-O arm64 原生二进制（Bun 打包，244,530,512 字节，内嵌完整 JS） |
| npm 包（wrapper） | `/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/` | 2.1.220 | 仅安装器（`install.cjs` + `cli-wrapper.cjs`），`optionalDependencies` 拉平台二进制 `@anthropic-ai/claude-code-darwin-arm64@2.1.220` |
| SDK 工具 schema | `/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/sdk-tools.d.ts` | 2.1.220 | 149,125 字节；内置工具输入 schema（无 CU/BU 工具，见 §2） |
| 桌面端 | `/Applications/Claude.app`（`com.anthropic.claudefordesktop`） | 1.44121.4 | Electron；主包 `Contents/Resources/app.asar`（40,164,875 字节），解包到 `/tmp/claude-asar` |
| CU 原生助手 | `/Applications/Claude.app/Contents/Helpers/app-cu-helper` | — | 1,919,216 字节 Mach-O universal（x86_64+arm64），Rust 编写 |
| Chrome native host | `/Applications/Claude.app/Contents/Helpers/chrome-native-host` | 0.1.0 | 2,145,072 字节 Mach-O universal，Rust 编写（内嵌版本字符串 `chrome_native_host 0.1.0`） |
| 其他 Helper | `.../Helpers/permission-fixer`、`.../Helpers/disclaimer`、`.../Helpers/Claude iOS Sim.app` | — | 权限修复/免责声明/iOS 模拟器 |
| Swift 原生绑定 | `/tmp/claude-asar/node_modules/@ant/claude-swift/build/Release/computer_use.node`（asar 内） | — | `@ant/claude-swift`，NAPI 绑定，源语言 Swift |
| 通用原生绑定 | `/tmp/claude-asar/node_modules/@ant/claude-native/claude-native-binding.node`（asar 内） | — | 5,681,968 字节 |

用户配置状态（负证据）：
- `~/.claude/settings.json`：无 chrome/CU 相关键（走阿里云 MaaS 代理，模型为 qwen 系列）。
- Chrome `NativeMessagingHosts/` 只有 `com.quark.hostclient.json` 与 `com.xiaomi.mimo.browser.json`，**无** `com.anthropic.claude_code_browser_extension.json`（CLI 的 native host 未注册）。
- Chrome `Default/Extensions/` 下**无** `fcoeoabgfenejglbffodgkkbkcdhcgfn`（Claude in Chrome 扩展未安装）。
- `~/.claude/chrome/`（wrapper 脚本目录）不存在。
- `~/.claude/plugins/known_marketplaces.json` 仅有官方市场 `anthropics/claude-plugins-official`（内含 `chrome-devtools-mcp`、`playwright`、`browser-use` 等第三方浏览器插件，非原生能力）。

## 2. 判定：CU/BU 如何提供（证据链）

**结论：都不是 API 侧内置工具，而是宿主进程内嵌的本地 MCP 服务器 + 平台原生执行层。**

1. `sdk-tools.d.ts:11-54` 的 `ToolInputSchemas` 联合类型只含 `Agent/Bash/FileEdit/FileRead/...`，无 Computer/Browser 工具 → CU/BU 不在 API `tools` 数组里。
2. CLI 二进制入口分发（偏移 234711800 附近，UTF-8 JS 明文）：
   ```
   process.argv[2]=="--claude-in-chrome-mcp" → runClaudeInChromeMcpServer()
   process.argv[2]=="--chrome-native-host"   → runChromeNativeHost()
   process.argv[2]=="--computer-use-mcp"     → runComputerUseMcpServer()
   ```
3. 服务器注册（UTF-8 JS 明文）：
   - `JE="claude-in-chrome"`；`MNt()` 返回 `{type:"stdio", command:process.execPath, args:["--claude-in-chrome-mcp"], scope:"dynamic"}`（源码路径注释 `src/utils/claudeInChrome/setup.ts`）。
   - `wte="computer-use"`；`setupComputerUseMCP/HcT()` 返回 `{mcpConfig:{[wte]:{type:"stdio",command:process.execPath,args:["--computer-use-mcp"],scope:"dynamic"}}}`（源码路径 `src/utils/computerUse/setup.ts`）。
4. 工具以 `mcp__claude-in-chrome__*` / `mcp__computer-use__*` 前缀注入，系统提示中的 ToolSearch 批量加载文案佐证（UTF-16LE 区域，偏移 ~67550000）。

## 3. 关键摘录（不超过 10 行/处）

### 3.1 CLI 内嵌系统提示 — computer-use 分层（UTF-16LE，偏移 67550720 起）

```
You have a computer-use MCP available (tools named `mcp__computer-use__*`).
- Browsers (Safari, Chrome, ...) → tier "read": clicks and typing are blocked.
- Terminals and IDEs (...) → tier "click": typing, key presses, right-click ... blocked.
- Everything else → tier "full": no restrictions.
The tier is enforced by the frontmost-app check ...
```

### 3.2 CLI 内嵌系统提示 — Chrome MCP 引导（同区域）

```
ToolSearch with query "select:mcp__claude-in-chrome__tabs_context_mcp,
mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,
mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp"
```

### 3.3 CLI native host manifest 写入器（UTF-8 JS，偏移 ~229166800）

```js
n = { name: TXs, description: "Claude Code Browser Extension Native Host",
      path: e, type: "stdio",
      allowed_origins: ["chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/"] }
TXs = "com.anthropic.claude_code_browser_extension"
// macOS 写各浏览器的 NativeMessagingHosts 目录；Windows 写注册表 reg add <key>\<TXs>
// wrapper: ~/.claude/chrome/chrome-native-host  →  exec <claude 二进制>
```

### 3.4 桌面端 `computer` 工具（浏览器版）action 枚举（asar `index.chunk-Bam8dXW9.js` 偏移 2901876）

```
enum:["left_click","right_click","type","screenshot","wait","scroll","key",
"left_click_drag","double_click","triple_click","zoom","scroll_to","hover"]
required:["action","tabId"]
```

### 3.5 桌面端整屏 CU 工具注册（asar `index.chunk-Btw0RfUS.js`，beautify 后 L3159-3990）

`request_access / screenshot / zoom / left_click / double_click / triple_click /
right_click / middle_click / type / key / scroll / left_click_drag / mouse_move /
open_application / switch_display / list_granted_applications / list_apps(darwin) /
read_clipboard / write_clipboard / wait / cursor_position / hold_key /
left_mouse_down / left_mouse_up / computer_batch / request_teach_access /
teach_step / teach_batch` + appScoped 组：`release_full_control /
request_full_control / app_list_windows / app_ax_find / app_screenshot /
app_click / app_type / app_key / app_scroll / app_drag / app_menu / app_batch /
app_release / app_bring_to_current_space`

### 3.6 权限分级（asar `index.chunk-Btw0RfUS.js`）

```js
r = { clipboardRead: false, clipboardWrite: false, systemKeyCombos: false },
i = { read: 0, click: 1, full: 2 }   // 应用权限 tier
```

### 3.7 chrome-native-host 协议（`strings chrome-native-host`）

```
claude-mcp-browser-bridge-   （unix socket 名前缀 + PID；win32 用 \\.\pipe\）
mcp_connected / mcp_disconnected / tool_request / permission_request
"Socket directory has insecure permissions" / "Removing stale socket for dead PID"
"Forwarding tool request from ... to Chrome" / logger 输出目录 "Claude Nest/Library/Logs"
```

### 3.8 app-cu-helper 能力（`strings app-cu-helper`）

```
方法：dispatch / dispatchRaw / probe / bringWindowToActiveSpace / wakeChromiumCompositor
守护理由码：secure_input_active / context_menu_rclick_refused / popup_menu_click_refused /
focused_pid_drift_mid_string / off_space_would_front_refused / window_gone / foreign_pid
私有框架：SkyLight.framework（SLSGetActiveSpace / SLPSPostEventRecordTo / CGSCopySpacesForWindows ...）
AX：AXUIElementGetWindow；事件：CGEventSource / CGEventSetWindowLocation / HIDSystemState
```

### 3.9 桌面端 app-cu-helper 客户端（asar `index.chunk-Bam8dXW9.js` 偏移 ~3355000）

```js
// JSON-RPC 2.0 over stdin/stdout（spawn 子进程，按行分隔）
Fwn = 8e3               // 默认超时 8s
Iwn = 50                // dispatchRaw text 每字符 +50ms
zwn = [0, 1e3, 5e3]     // 崩溃重启退避 0/1s/5s，之后 60s 冷却
this.call("probe")      // 探针返回 skylight/authEnvelope/axTrusted 等
```

### 3.10 ComputerUseSwift 静态链接（CLI 二进制，偏移 ~240922129）

```
claude-swift/Sources/ComputerUseSwift/{Screenshot,ProcessTree,Module,InstalledApps,
EscHotkey,Bindings,AppBundleResolver}.swift.o
_$s16ComputerUseSwift013ScreenshotForaB0O21systemChromeBundleIdsShySSGvpZ
```

桌面端对应 NAPI 绑定（`computer_use.node` strings）：`@ComputerUseBindings`、
`SCScreenshotManager`/`SCContentFilter`（ScreenCaptureKit）、`WindowCover`、
`PhantomCursor`、`CollisionWatch`、`"Claude needs Screen Capture access so you can share screenshots"`。

### 3.11 Framebuffer（VNC 客机控制，asar `index.chunk-DKLskb6i.js`）

```
launch.json 配置：{"name","type":"framebuffer","vncUrl":"vnc://[:pw@]host:port","serverFlavor":"standard"|"vz"}
工具：framebuffer_list/attach/screenshot/zoom/cursor_position/click/type/key/scroll/
      drag/move/hold_key/batch
守卫："[framebuffer:pixelGuard] refusing click (compare failed)"
     "The user is controlling the screen — wait, then take a fresh framebuffer_screenshot"
```

### 3.12 桌面端会话权限状态（asar `index.chunk-Bam8dXW9.js` 偏移 ~4781719）

```js
chromePermissionMode / chromeAllowedDomains / cuAllowedApps / cuGrantFlags / approvedToolNames
evr = { ask: 0, follow_a_plan: 1, skip_all_permission_checks: 2 }
// 系统提示分区注册表：
cu_safety_cuonly / cu_optout_a / computerUseMain:"computer_use" /
inAppBrowser:"in_app_browser" / browserSurfaces:"browser_surfaces"
// 内部 surface UUID 表：claude-in-chrome / computer-use / "Claude Browser" /
// "Claude Preview" / Framebuffer / "Window Halo" / remote-devices ...
```

### 3.13 桌面端多设备配对（同 chunk）

```
switch_browser: "Send a connection request to every Chrome browser with the extension
installed and wait (up to 2 minutes) for the user to click 'Connect'"
list_connected_browsers / select_browser(deviceId)
"claude-in-chrome-local-pairing"（登录态切换时 resetLocalPairingIdentity/syncProactivePairing）
```

### 3.14 Teach/Watch 模式 UI 桥（asar `.vite/build/computerUseTeach.js`）

```
window["claude.internal.computerUse"].CuTeach: next/exit/mouseEnter/mouseLeave/
  onShow/onWorking/onHide/onReassertHover
CuWatchRecordPill: done/discard/toggleMic/onStepCount/onMicState/onProcessing
（用户示范录制 + 语音讲解 → 生成自动化步骤）
```

## 4. 复现命令

```bash
# 版本与载体
claude --version                          # → 2.1.212 (Claude Code)
file /Users/laplace/.local/share/claude/versions/2.1.212
cat /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/package.json | head -5
plutil -p /Applications/Claude.app/Contents/Info.plist | grep -E "ShortVersion|Identifier"

# 二进制字符串扫描
grep -a -c -o 'computer-use' /Users/laplace/.local/share/claude/versions/2.1.212   # 78
grep -a -o -- '--computer-use-mcp|--claude-in-chrome-mcp|--chrome-native-host' \
  /Users/laplace/.local/share/claude/versions/2.1.212 | sort | uniq -c
strings -n 6 /Applications/Claude.app/Contents/Helpers/app-cu-helper | head -100
strings -n 6 /Applications/Claude.app/Contents/Helpers/chrome-native-host | grep -i mcp

# UTF-16LE 系统提示提取（python mmap）
probe = "computer-use MCP available".encode("utf-16-le")   # → offset 67550742

# asar 解包
npx @electron/asar extract /Applications/Claude.app/Contents/Resources/app.asar /tmp/claude-asar
grep -ob 'name:"computer"' /tmp/claude-asar/.vite/build/index.chunk-Bam8dXW9.js
npx js-beautify -f /tmp/claude-asar/.vite/build/index.chunk-Btw0RfUS.js   # 整屏 CU 工具注册
```

## 5. 置信度标注

| 结论 | 置信度 | 依据 |
|---|---|---|
| CLI/桌面端以本地 stdio MCP 提供 CU/BU | 高 | 入口分发代码 + mcpConfig 字面量 + 系统提示 |
| 工具 schema 全文 | 高 | 打包 JS 中的 inputSchema 字面量逐字提取 |
| 权限 tier read/click/full | 高 | 字面量 `{read:0,click:1,full:2}` + 系统提示 |
| native messaging 链路细节 | 高 | manifest 写入器源码 + host 二进制 strings |
| 扩展内部实现（content script vs chrome.debugger） | 低 | 扩展本体未安装，无法解包；仅有宿主侧转发证据 |
| 云端 computer use API 参与本机路径 | 无证据 | 未发现；本机路径全部本地执行 |
