# Atlas Computer Use（agent mode 本地执行）逆向与 Codex 对照

> 分析对象：ChatGPT Atlas.app 1.2026.189.1（arm64，2026-07-27 签名构建）。
> 证据见 [evidence/inventory.md](evidence/inventory.md)；【实证】= strings/Swift 符号直接可见，【推断】= 旁证推导。

## 0. TL;DR

**Atlas 的 computer use 不是"模型发坐标"，而是 Operator 协议的本地 DOM 化**：模型在 ChatGPT 后端发 `computer.*` 命令，Atlas 本地把命令翻译成页面内 JS 合成事件，观察走页内 Playwright 移植的 ARIA 快照。全程不出浏览器进程。

```
模型（ChatGPT 后端，工具注册表含 computer.*，GizmoAPI 同源）
 │ WebSocket 命令：{type:"computer.click", node_id/selector, ...}
 ▼
RemoteBrowserCommandHandler（Swift，AuraAgents；"Dragonfruit" 运行时）
 │  审批 / Safe Mode / 黑名单 / turn 熔断
 ▼
注入层 window.__pwInjected（Playwright 移植：aria 快照 + locator helpers）
 │  WebView_EvaluateJavaScript（owl.mojom）
 ▼
页面 DOM：合成 pointerover→…→click 事件序列 / scrollBy / select 值写入
```

## 1. 命令面（模型可见，实证）

工具名与 `web.run / python / container.exec` 并列出现在 `Conversations/GizmoAPI.swift` 旁的注册表字符串里——即 ChatGPT 后端工具协议，Atlas 客户端实现其执行端。

| 命令 | 参数（strings 实证词表） | 语义 |
|---|---|---|
| `computer.initialize` / `computer.get` | — | 建立会话 / 取当前状态 |
| `computer.get_dom` | `dom_snapshot`、`include_non_interactable`、`display_truncate_max_chars` | 取 DOM 快照 |
| `computer.click` / `double_click` | `node_id` 或 `selector`、`modifiers`（Control/Meta/Shift/ControlOrMeta）、`force` | 元素定位点击 |
| `computer.type` / `typing` | `node_id`、`replace`、`selections`、`checked` | 输入/勾选；复合输入带 wait 间隔 |
| `computer.keypress` | `left/middle`（按钮）、Control/Meta/Shift | 按键 |
| `computer.move` / `drag` | `AgentInputCoordinateSpace` | 移动/拖拽 |
| `computer.scroll` | `scroll_x`、`scroll_y` | 滚动 |
| `computer.wait` | `timeout_ms` | 等待（`wait_until: load/networkidle/commit/domcontentloaded`） |
| `computer.list_tabs` / `create_tabs` | `tab_id`、`urls`、`tabGroup` | 标签页管理 |
| `computer.do` / `computer.dom_do` | 复合动作 | 【推断】do=带截图验证的动作管线，dom_do=直连 DOM |
| `browser.search` / `browser.run` | `urls`、`results` | 后端检索工具（云端执行） |

配套原语：文件上传 `file_chooser_id + files`；下载 `download_id + source_path/destination_path`（落 `MoveDragonfruitDownloads` 隔离目录）；JS REPL 工具 `AgentLib.js_repl / atlas_repl`（页内任意 JS）。

## 2. 观察：Playwright 移植 + tab 截图

**页面结构观察是页内注入的 Playwright 引擎，不是 AX 树。**

- `window.__pwInjected.incrementalAriaSnapshot(root, {mode:'ai', track:'superassistant-dom-snapshot'})`——Playwright 的增量 ARIA 快照（AI 模式带 `ref=` 元素编号）。
- `PlaywrightActionHandler.swift` 用正则从快照 YAML 解析 `[ref=…]` / `[cursor=…]` 定位元素；`PlaywrightLocatorRead/Count/Focus`、`WaitForElementAndMakeVisible/Actionable` 是随包 locator helpers。
- 元素元数据：`tagName / role / visibleText / ariaName / testId / boundingBox`。
- 截图走 `captureCurrentTabScreenshot(cursorScaleFactor:cursorLocationOverride:)`——**把虚拟光标画进截图**（`AgentCursorWithLabel`，Operator 同款视觉）；尺寸/压缩由 statsig 门控 `computer_use:dragonfruit_screenshot_*` 远程调节。
- 富内容抽取：`content_type = domSnapshot / xlsx / pptx`，带超时与截断预算。

## 3. 动作：JS 合成事件，零 OS 注入

**所有输入都在页面里合成，Atlas 无键盘/鼠标 OS 级注入通道。**

| 动作 | 实现方式（strings 中的内嵌 JS） |
|---|---|
| 点击 | `elementFromPoint` 求中心 → 完整序列 pointerover→mouseover→pointermove→pointerdown→focus→pointerup→mouseup→click（PointerEvent 可用时带 isPrimary/pressure） |
| select/option | 直接写 `value` + 派发 `input`/`change`；点击前 `scrollIntoView` 保可见 |
| 滚动 | 取视口中心元素的第一个可滚祖先 `scrollBy(0.9×innerHeight, smooth)` |
| 打字 | 复合动作：输入 + 回车之间插 `waitBetweenCompoundTypingActions` |
| 剪贴板 | Mojo `TabClipboardRead/Write*` |

无 CGEvent 管线（`CGEvent` 仅 2 处偶发命中，属 AppKit 类目名）；无 ScreenCaptureKit；无 Sky socket。负证据清单见 evidence §4。

## 4. 安全模型

**分层：登录态二态 → 站点黑名单 → 审批分级 → Safe Mode 熔断。**

| 层 | 机制（实证） |
|---|---|
| 登录态 | logged-in / logged-out 二态；logged-in 下"ChatGPT 用你已登录的账号操作"，风险话术明示提示注入风险；可按单站点给 agent 单独登录 |
| 站点 | `AuraContextBlocklist`：全局站点黑名单（服务端下发 `API+GlobalSiteSettings`）+ 用户黑名单；启动前 `ensureNonBlocklistSiteIsOpen` |
| 审批 | 自动批准低风险、敏感信息拒绝（"automatically approve low-risk actions but may deny actions involving sensitive information"）；"Approve for me" 委托；未成年账号 guardian 审批 |
| 凭据 | `BrowserAuth` 工具：agent 遇登录页时在聊天 UI 渲染表单（`BrowserAuthFieldRow`），用户手动填值提交（`submitBrowserAuthAndDismiss`），agent 拿到后填页 |
| 隔离 | agent 工作在专用 AgentTabGroup；`AgentNavigationPolicy/Gates` 控导航；localhost 交互默认关（`aura_agent_mode_settings_allow_localhost`）；下载隔离目录 |
| 熔断 | 用户停止后内嵌指令生效："The user has stopped the agent and all tool calls will be ignored. End the agent turn."；`AgentWebContentWatchdog` + websocket 心跳守护；Safe Mode（地址栏指示器 + NUX）逐轮确认 |

## 5. 与 Codex Sky 栈对照（详细版）

| 维度 | Codex（agents/codex 分册） | Atlas（本册） |
|---|---|---|
| 执行场 | 任意 macOS app 窗口 | 仅浏览器页面 |
| 观察原语 | AX 树 diff（行数预算）+ Skyshot 截图 | Playwright ARIA 快照（ref 编号）+ tab 截图 |
| 元素寻址 | AX 元素索引（每动作后强制重取） | ARIA `ref=` / `node_id` / `selector` |
| 输入注入 | CGEvent（OS 级，含 EventTap） | 页内合成 DOM 事件 |
| 拉起/激活 | startApp 隐式拉起 | 不适用（浏览器自持） |
| 工具暴露 | MCP `js` 单工具 + `cua` 对象 | 后端工具协议 `computer.*`，客户端无 MCP |
| 审批存储 | 服务端 AppApprovalStore 持久化 | 客户端自动分级 + 聊天内审批卡 |
| 权限 | 辅助功能 + 屏幕录制（OS 弹窗） | 无需 OS 自动化权限（截图除外） |
| 凭据 | 无专门机制 | BrowserAuth 聊天表单 |
| 同源 | Team 2DC432GLL2、ChatGPT 扩展 `hehgg…`、guardian 话术 | 同左 |

## 6. 本机不可见边界

- 模型侧系统提示词与 `computer.*` 完整 JSON schema 在服务端，本地只有参数词表【推断：字段→命令的映射为对应关系，未逐字段验证】。
- WebSocket 命令通道的确切 URL 未以字面量出现【推断：chatgpt.com 域下运行时拼装】。
- 云端 agent（ChatGPT agent mode）的远端浏览器不可见；Atlas 仅提供围观接管面（`OperatorAgentOverlay`、`chrome://agentviewer`、`WebsocketRemoteAgentEventQueue`）【推断：OperatorAgent 命名指向云端 Operator 会话】。
