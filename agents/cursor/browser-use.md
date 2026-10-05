# Cursor Browser Use（浏览器控制）完整逆向

> 分析对象：Cursor 3.22.12（macOS arm64，VSCode 1.128.0 fork）。结论均有本机静态证据支撑，证据定位见 [evidence/inventory.md](evidence/inventory.md)；推断处明确标注。

## TL;DR

Cursor 的浏览器控制不是外接 Playwright，而是**内建一套 Electron 浏览器 + 一方 MCP server**：

1. 主进程 `browserViewMainService` 用 Electron `webview`/`WebContentsView` 宿主内嵌浏览器标签页（可见标签 + headless 标签）。
2. 内置扩展 `cursor-browser-automation` 通过 Cursor 私有扩展 API `vscode.cursor.registerMcpProvider` 注册名为 **`cursor-ide-browser`** 的一方 MCP server，向 agent 提供 15+1 个 `browser_*` 工具。
3. 观察 = 注入 JS 遍历 composed DOM 生成**可交互元素快照（YAML）**，为元素分配 `data-cursor-ref="eN"` 不透明句柄；动作 = 按 ref 重新定位元素、校验描述未漂移，然后**注入 JS 派发合成 DOM 事件**（不是 CDP Input）。
4. 原始 CDP 作为逃生舱开放（`browser_cdp`），但主进程层面硬拒绝 `Input.*`、`Target.*`、cookie/storage/导航等敏感域。
5. 模型侧由服务端专用模型驱动（Statsig 默认 `modelId: "sand-cua"`），浏览器代理以 subagent 形态运行（`browser_subagent` 默认开）。

## 1. 架构分层

```
┌────────────────────────────────────────────────────────────────────┐
│ 模型 (服务端; 默认 "sand-cua" 专用 CU/BU 模型, Statsig 配置)         │
│   agent 协议 (aiserver.v1 / agent.v1 protobuf over api2/api5)      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ MCP tools/call
┌──────────────────────────────▼─────────────────────────────────────┐
│ 渲染进程 (workbench.desktop.main.js / glass)                        │
│  · composer/agent 运行时: browser_subagent (默认 on)                │
│  · 一方 MCP provider 框架: identifier "cursor-ide-browser"          │
│  · cursor-browser-automation 扩展:                                  │
│     - 工具 schema + 系统提示词 (instructions)                       │
│     - 页面注入脚本 (快照/动作), browser-logs 落盘                    │
│     - browserSnapshotWatchdogService (快照保活)                     │
└──────────────┬─────────────────────────────────┬───────────────────┘
               │ IPC channel "browserViewService"│ executeCommand()
┌──────────────▼─────────────────────────────────▼───────────────────┐
│ 主进程 main.js                                                      │
│  · browserViewMainService: Electron webview 宿主                    │
│    - 标签管理 / 可见 + headless                                     │
│    - webRequest 网络追踪, console 捕获, 证书/外跳确认                │
│  · sendCDPCommand → webContents.debugger.attach("1.3") + 拒绝列表   │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ Chromium
                    ┌──────────▼──────────┐
                    │ 目标网页 (webview)   │
                    └─────────────────────┘
```

另有第二.provider `cursor-browser-extension`（`mcpConstants.js` 中与 `cursor-ide-browser` 并列），推断用于把用户本机 Chrome 以扩展形态接入 agent（本机未做验证，见"低置信度"）。

## 2. 能力载体与版本

| 载体 | 路径 | 说明 |
|---|---|---|
| 内置扩展 | `/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-browser-automation/` | v1.0.0，publisher `cursor`，`enabledApiProposals:["control","cursor","cursorTracing"]`，`onStartupFinished` 激活 |
| 主进程服务 | `/Applications/Cursor.app/Contents/Resources/app/out/main.js` 内模块 `browserViewMainService.js` | Electron `WebContentsView` |
| 渲染层服务 | `out/vs/workbench/workbench.desktop.main.js` 内 `browserViewService`/`browserAutomationService`/`browserScreenshotService`/`browserSnapshotWatchdogService`/`openBrowserUrlsService` | |
| 运行痕迹 | `~/.cursor/browser-logs/`、`~/Library/Application Support/Cursor/logs/<ts>/window1/mcp-server-cursor-ide-browser.workbench.log` | 每会话注册 |

内置浏览器面板本身受设置 `cursor.browserTabEnabled`（**默认 false**）控制是否显示为编辑器标签；agent 的 headless 自动化不受此开关限制（两条路径并存，开关语义见 workbench.desktop.main.js 模块 `browserAutomationService.js` 开头 `Nco=new Ct("cursor.browserTabEnabled",!1,...)`）。

## 3. 工具面完整清单

Provider id：`cursor-ide-browser`（extension.js：`this.id="cursor-ide-browser"`）。工具 schema 全部来自扩展 `dist/extension.js` 中的 `parameters: JSON.stringify(...)`，以下为逐工具整理（省略各工具共有的 `viewId` 与 `take_screenshot_afterwards`）：

### 3.1 导航与标签

| 工具 | 参数 | 语义 |
|---|---|---|
| `browser_navigate` | `url`*；`newTab`；`position:["active","side"]` | 默认复用现有标签导航；`position` 仅在用户明确要求展示浏览器时设置（"active"=可见 UI，"side"=侧边面板），后台自动化应省略以免抢焦点。导航前强制走 origin allowlist（见 §7） |
| `browser_tabs` | `action:["list","new","close","select"]`；`index`；`position` | 标签 CRUD；headless 标签由内部命令 `newHeadlessTab` 支撑 |
| `browser_lock` | `action:["lock","unlock"]` | 锁定/解锁浏览器防用户并发操作；**用户始终可点 "Take Control" 夺回**；提示词规定必须先 navigate 后 lock，结束必须 unlock |

### 3.2 观察

| 工具 | 参数 | 语义 |
|---|---|---|
| `browser_snapshot` | `interactive`（仅可交互元素）；`maxDepth`（默认 20）；`compact`；`selector`（限定子树）；`includeDiff`（与上次快照 diff） | **"the main source of truth for page structure"**；返回 a11y 快照 YAML |
| `browser_take_screenshot` | `type`(png/jpeg)；`filename`；`element`+`ref`(元素截图)；`fullPage` | 视觉验证；提示词明确"不能基于截图定位动作，动作一律用 snapshot 的 ref" |
| `browser_highlight` | element/ref | 页面内高亮目标元素（视觉 grounding） |
| `browser_get_bounding_box` | element/ref | 元素包围盒（坐标诊断） |

### 3.3 交互

| 工具 | 参数 | 语义 |
|---|---|---|
| `browser_click` | `ref`*；`element`（人类可读描述，用于防错位校验）；`offsetX/offsetY`；`doubleClick`；`button`；`modifiers:["Control","Shift","Alt","Meta","ControlOrMeta"]`；`holdDurationMs` | 按 ref 点击；描述明示"Use this instead of CDP Input.* methods" |
| `browser_mouse_click_xy` | `x,y`；`button` | 视口坐标点击（兜底，"Prefer browser_click with refs"） |
| `browser_type` | `ref`*；`text` | 聚焦后输入 |
| `browser_fill` | `ref`*；`value` | 填充字段 |
| `browser_select_option` | `ref`*；`values` | 下拉选择 |
| `browser_press_key` | `key` | 键盘按键 |
| `browser_scroll` | `direction/amount/ref` | 滚动（可滚动某元素进入视图） |
| `browser_drag` | `startElement/sourceRef`；`endElement/targetRef`（或坐标） | HTML5 拖拽（合成完整 DragEvent 链） |

### 3.4 逃生舱

| 工具 | 参数 | 语义 |
|---|---|---|
| `browser_cdp` | `method`*；`params`； | 原始 CDP 命令。示例建议：`Runtime.evaluate`、`DOM.getDocument`、`CSS.getComputedStyleForNode`、`Profiler.start/stop`（profile 存文件返回 log_file）、`Performance.getMetrics`、`Log.enable`、`Network.enable`。大响应落盘为文件而非内联。**Input.*/cookie/storage/permission/download/target/system 类一律被拒** |

注：聊天 UI 侧还渲染了 `wait/wait_for/handle_dialog/switch_tab/close_tab/close/install/profile_start/profile_stop/trace_start/trace_stop/navigate...` 等动作文案（workbench.desktop.main.js 的动作渲染 switch），这些属于 provider 家族其他形态（Playwright MCP 接入、`cursor-browser-extension`）的动作词汇，本扩展直接注册的是上表 16 个。两侧词汇高度同源（Playwright MCP 风格）。

## 4. 观察机制：快照 + ref

### 4.1 流程

1. 扩展经 `executeCommand("cursor.browserView.executeJavaScript", viewId, script)` 把**快照脚本**注入页面主世界。
2. 脚本遍历 composed DOM（`querySelectorAllIncludingOpenShadowRoots` —— 显式覆盖开放 shadow root），筛出可交互元素（button/link/input/select/textarea/[role]/contenteditable 等）。
3. 每个可交互元素得到稳定句柄：已有合法 `data-cursor-ref` 则复用，否则分配 `e<N>` 并 `setAttribute`；本次未引用到的旧 ref 会被清除。
4. 生成 YAML（与 `~/.cursor/browser-logs/snapshot-*.log` 落盘同构）：

```yaml
- role: button
  name: 新建项目
  ref: e2
- role: textbox
  name: 请输入标题
  ref: e18
  value: 故事脚本生成
  placeholder: 请输入标题
- role: button
  name: 标题
  ref: e20
  nth: 1            # 同 role+name 的第 N 个
  states: [current] # 部分元素带状态
```

5. 快照与防漂移：动作时可传 `element`（人类可读描述），执行前 `assertDescriptionMatches` 比对当前元素的 tag/role/aria-label/text 与描述是否一致，不一致报错提示重新 snapshot —— ref 过期保护。
6. 页面里还有一段常驻**隔离世界脚本**（`executeJavaScriptInIsolatedWorld` 注入，命令 `cursor.browserAutomation.reinjectUIScript` 可重注入），负责元素选择事件（`browser.elementSelected`/`browser.selectElementClick` 通道）等 UI 联动。

### 4.2 已知边界（来自官方提示词原文）

- **Iframe 内容不可访问**（"Iframe content is not accessible - only elements outside iframes can be interacted with."）。
- ref 是"不透明句柄，绑定到该标签最近一次 browser_snapshot"。
- 设备仿真（`Emulation.setDeviceMetricsOverride` 等）只在当前 agent turn 内有效，turn 结束自动清除（`cursor.browserView.clearAgentDeviceEmulation`）。

### 4.3 快照保活

`browserSnapshotWatchdogService`（workbench.desktop.main.js）：常量 `15s` watchdog / `3s` 恢复检查 / `5min` 冷却（`M$v=15e3,P$v=3e3,L$v=5*6e4`）；为 `cursor-ide-browser` 的 MCP snapshot 做自愈（对齐 MCP server "durable snapshot" 机制），触发源包括 `provider_change`/`startup`/`watchdog_backfill`（命令 `cursor.browserAutomation.requestSnapshotBackfill`）。

## 5. 动作机制：注入 JS 合成事件（非 CDP Input）

所有交互动作的实现形态：扩展拼装一段模板字符串 JS（内联 `findElementByRef` 等运行时），经 `executeJavaScript` 注入目标页执行，返回结构化结果。

- **click**：定位 → `scrollIntoView`（需要时）→ 修饰键处理 → 合成 `PointerEvent`/`MouseEvent` 序列；带 dropdown 智能关闭逻辑（点 body / Esc 先收起下拉再点目标）。
- **type/fill**：`blur` 旧焦点 → `element.focus()` → 失败则 `element.click()` 再 focus → 设值（含 contenteditable 分支、`document.execCommand('selectAll')` 分支）。
- **drag**：`new DataTransfer()` → `pointerover/pointerenter/mousedown/pointerdown` → `dragstart`（被 preventDefault 则报错并建议改用 `browser_evaluate`）→ `drag` → 对 drop 目标派发 `dragenter/dragover/drop`，坐标取元素几何中心。
- 为什么不用 CDP Input：主进程拒绝信息给出官方理由——"CDP Input.* methods are **focus-sensitive in Electron webviews**"（Electron webview 嵌在编辑器里，真实输入事件可能被路由到 Cursor UI 而非页面）。合成 DOM 事件绕开了焦点路由问题，代价是事件 `isTrusted=false`（对检测合成事件的站点无效，这是推断的局限）。

## 6. 模型侧系统提示词（原文结构，中文归纳）

扩展内置 instructions（节选自 dist/extension.js，全文见 evidence/inventory.md §3.2 提取方法）：

- **核心工作流**：先 browser_tabs list → navigate → 长自动化前 lock → snapshot(结构) + screenshot(视觉) → 交互八件套 → cdp 做检查/性能分析。
- **反兔子洞**：同一失败动作不重复超过一次除非有新证据；**4 次失败或停滞即停**，报告"当前页面/目标/观察到的阻塞/建议下一步"；遇登录、passkey、验证码、破坏性确认等必须交还用户。
- **等待策略**：优先 CDP 短轮询（Runtime.evaluate/DOM/Page 生命周期）而非一次长等。
- **CDP 纪律**：禁 Input.*；敏感命令被服务端拒绝；大响应用文件路径；Page.captureScreenshot 不替代 browser_take_screenshot。

## 7. 安全模型

| 层 | 机制 | 证据 |
|---|---|---|
| 导航白名单 | `browser_navigate` 拒绝 `file://`（强制 http/https）；管理员 origin allowlist，命中失败抛 "blocked by administrator settings"；扩展调用 `cursor.browserOriginAllowlist.ensurePageOriginAllowed/ensureNavigationAllowed` 前置校验 | workbench.desktop.main.js 偏移 ~29842015 |
| CDP 拒绝列表 | 域级：`Browser/Input/Storage/SystemInfo/Target/Tethering`；方法级：cookie 四件套 + cache + `DOM.setFileInputFiles` + `Page.navigate/navigateToHistoryEntry/getNavigationHistory` | main.js 偏移 ~250543 |
| 用户夺回 | `browser_lock` 锁定期间用户可点 "Take Control"；`cursor.browserView.setLocked/isLocked` | 工具描述 |
| 团队策略 | proto 字段 `browser_protection`、`mcp_tool_allowlist`、`admin_command_denylist`；团队场景浏览器特性 `failClosed`（缓存缺失即拒绝）；MCP 审批原因 `playwrightProtection → mcp.browser_protection` 默认开 | workbench.desktop.main.js |
| 外跳确认 | 非 web 协议跳转（`will-redirect`/`will-frame-navigate` 守卫）弹系统对话框确认后才 `shell.openExternal` | main.js browserViewMainService |
| 焦点保护 | headless 标签 + `position` 参数语义（后台自动化不抢焦点） | 工具 schema |
| 遥测 | `cursor.internal.recordBrowserTelemEvent`（toolName/argsJson/snapshotYaml/url） | extension.js |

## 8. 与 VSCode fork 底座的关系

- 浏览器作为**编辑器维度的一等公民**：`workbench.action.openBrowserEditor`（"New Browser Tab" 命令）、`browser.splitEditorWithNewBrowserTab`、上下文菜单（`browser.contextMenu.back/forward/reload/inspectElement/...`）、心跳/导航事件通道（`browser.heartbeat/browser.navigation/browser.request/browser.response`）——这些都建立在 fork 的 editor/editorGroupService、AuxiliaryWindow 体系上。
- `browserViewMainService` 复用 VSCode 的 window/auxiliary window 生命周期（窗口关闭时清理孤儿 view）。
- MCP provider 框架（`registerMcpProvider`、durable snapshot、watchdog）是 Cursor 在 fork 上自建的私有扩展 API（`enabledApiProposals`），上游 VSCode 无此能力。
- 历史包袱：VSCode 自带 `simple-browser` 扩展仍在内置扩展列表中，与 Cursor 自有浏览器并存。

## 9. 复现实操（只读）

```bash
# 工具清单与 schema
python3 - <<'EOF'
import re
p='/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-browser-automation/dist/extension.js'
d=open(p,encoding='utf-8',errors='replace').read()
for m in re.finditer(r'\{name:"(browser_[a-z_]+)"',d): print(m.group(1))
EOF

# CDP 拒绝列表
grep -o 't5=new Set(\[[^]]*\])' /Applications/Cursor.app/Contents/Resources/app/out/main.js

# 本机真实使用痕迹
ls ~/.cursor/browser-logs/
head -40 ~/.cursor/browser-logs/snapshot-*.log
```
