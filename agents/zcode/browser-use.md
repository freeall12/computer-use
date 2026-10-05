# ZCode Browser Use（浏览器控制）完整逆向

> 逆向对象：ZCode 桌面 Agent 的 browser use 能力。分析基线：browser-use 插件 0.5.1、
> node-repl-host 0.6.0、ZCode.app（Electron main/host，2026-09-29 构建）。
> 证据出处以「路径:行号」或命令输出标注，完整清单见 [evidence/inventory.md](evidence/inventory.md)。

## 0. TL;DR

Browser Use 与 Computer Use 共用同一个 MCP 工具入口 `mcp__node_repl__js`，但走的是**另一条链路**：
模型经 `scripts/browser-client.mjs` 引导出 `agent.browsers.*` 对象面 → 通过
`Symbol.for("zcode.node-repl.browser-control-bridge")` 桥接器把命令发给**桌面宿主的浏览器
broker**（Unix socket + token）→ 宿主（zcode-host-local）把命令落到 **IAB（内置应用浏览器，
Electron `BrowserView`）** 的具体 tab 上执行；截图/录屏由 Chromium 原生能力（`MediaRecorder`）
完成，不依赖外部浏览器。

对象模型从 **Codex 的浏览器面**移植：`Browser/Tabs/Tab/PlaywrightAPI/Locator/CUA/DomCUA`
七类对象、`domSnapshot → locator → act` 工作流、3000ms 例行超时预算、`internal:role=`
selector 串行化，全部对齐；后端类型 `iab` / `extension` / `cdp` 三分，
成员可见性由 manifest（`docs/api.json`，version 11）+ Proxy 按后端能力动态裁剪。

---

## 1. 能力载体清单

| 组件 | 路径 | 版本 | 角色 |
|---|---|---|---|
| Browser Use 插件 | `~/.zcode/cli/plugins/cache/zcode-plugins-official/browser-use/0.5.1/` | 0.5.1 | skill ×2 + docs + client bootstrap（**不再携带 MCP server**） |
| 浏览器 SDK | `.../browser-use/0.5.1/scripts/browser-client.mjs` | — | 2235 行；`setupBrowserRuntime` 装配 `agent.browsers` |
| control-browser skill | `.../browser-use/0.5.1/skills/control-browser/SKILL.md` | — | 浏览器操作主手册 |
| web-gui-tester skill | `.../browser-use/0.5.1/skills/web-gui-tester/SKILL.md` | — | 纯 GUI 黑盒测试方法论（叠加层） |
| API 清单 | `.../browser-use/0.5.1/docs/api.json` | manifest v11 | 对象模型 + 成员支持矩阵（Proxy 的事实来源） |
| lookup 文档 | `.../browser-use/0.5.1/docs/{overview,playwright,recording,screenshot,safety,tab-claiming-iab,viewport,visibility,workflow,browser-troubleshooting,all-tabs-cleanup}.md` + `documents.json` | — | `agent.documentation.get("<name>")` 按需拉取 |
| 共享宿主 | `~/.zcode/cli/plugins/cache/zcode-plugins-official/node-repl-host/0.6.0/dist/mcp/server.js` | 0.6.0 | `js` 工具 + browser-bridge + broker 客户端 |
| IAB 运行时 | `/Applications/ZCode.app/Contents/Resources/app.asar` 内 `out/main/*` | — | Electron main：`BrowserView`、`executeBrowserCommandOnView`、WebM 录制器 |
| 旧版自带 server | `.../browser-use/{0.3.0,0.3.1,0.4.0,0.4.1,0.4.2}/dist/mcp/server.js` | 0.3.0→0.4.2 | 7.2MB→18.6MB 的独立 node_repl server（0.5.x 起删除） |

插件 manifest（`browser-use/0.5.1/.zcode-plugin/plugin.json`）**只有 `skills` 键，没有 mcpServers**——
node_repl MCP server 的注册收在 CLI 核心（node-repl-host README：「bootstrap/src/app/built-in-node-repl.ts，
判据是 bua 或 cua 任一启用」）。

---

## 2. 架构分层与调用链

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 模型（GLM）                                                              │
│   读 control-browser SKILL → 写 JS（bootstrap + tabs 操作 + 观察）        │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ mcp__node_repl__js（与 CUA 共用同一 MCP server / 进程）
               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L2 共享宿主  zcode-node-repl-mcp（node-repl-host 0.6.0）                  │
│   • 全新 Worker/call；全局注入 browser bridge：                           │
│     Symbol.for("zcode.node-repl.browser-control-bridge")                 │
│     = { list, execute, documentationRoot, assertAvailable }              │
│   • bridge → sendBrokerRequest：本地 socket + token，NDJSON 协议          │
│     env: ZCODE_NODE_REPL_BROWSER_BROKER_SOCKET / _TOKEN                  │
│   • 响应 _meta 合并：codex/browserUse、browser_use.url、                  │
│     zcode/browserTurnScreenshot（宿主专用，模型不可见）                    │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ {"op":"list"|"execute", browserId, browserGeneration, command}
               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L3 桌面宿主浏览器 broker（zcode-host-local / Electron main 协作）          │
│   • 后端注册表：iab（桌面 IAB）| extension | cdp（CLI --browser-use=headless）│
│   • BrowserControl tab 注册表：controlled tabs / user tabs                │
│   • generation = 连接代际（stale-routing guard，list() 返回前剥离）        │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ executeBrowserCommandOnView(view, command)
               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L4 IAB 渲染面（Electron BrowserView + Chromium）                          │
│   • DOM snapshot（AI/ARIA 树）、Playwright 语义 locator（selector 串行化） │
│   • CUA 坐标路径 / DomCUA node 路径（canvas 兜底）                         │
│   • 截图（Chromium capture）、WebM 录制（内置 MediaRecorder，无需 FFmpeg） │
│   • JS 对话框（embeddedBrowserJavaScriptDialog.cjs preload）              │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.1 桥接器与传输

- 桥接符号（`browser-client.mjs:2212`）：`Symbol.for("zcode.node-repl.browser-control-bridge")`；
  读取失败抛 "Browser runtime bridge is unavailable. Use Browser from a ZCode desktop or
  shared-host session."
- socket 环境变量（`node-repl-host/.../server.js:116828-116829`）：
  `ZCODE_NODE_REPL_BROWSER_BROKER_SOCKET`、`ZCODE_NODE_REPL_BROWSER_BROKER_TOKEN`。
- 协议（`server.js:116840-116865` 的 zod schema + `sendBrokerRequest`）：
  - 请求：`{"id":<uuid>,"token":<hex>,"op":"list"}`
    或 `{"id","token","op":"execute","browserId":"...","browserGeneration":<int>,
    "command":{method,...}}` + 请求上下文（`runtimeScope/sessionId/turnId?/trace?`），换行定界。
  - 响应：`{id, ok:true, browsers?|result?}` / `{id, ok:false, error}`；
    zod 全量校验 + `id` 回对照 + **32 MiB 响应上限**（`MAX_RESPONSE_BYTES`）。
- `assertActive()`：请求进行中 generation 变化 → "Browser runtime binding is stale after
  kernel reset"。`assertAvailable()`：subagent scope → "Browser is not available in subagent"。

### 2.2 命令面（wire 层）

`browser-client.mjs:1551-1625`（RawTab）与高层命令（`:1395-1531`）：

```
导航/状态: navigate, back, forward, reload, getState
观察:      snapshot(DOM), screenshot, elementInfo, evaluate
交互:      click(ref|x,y), type, press, scroll, hover, select, check, drag, close
对话框:    getDialog, handleDialog
视口:      browserViewportSet
可见性:    browserVisibilityGet, browserVisibilitySet
录制:      recordingStart, recordingStatus, recordingCancel
标签页:    list(经 op=list), listUserTabs, nameSession, finalizeTabs, tabs.reuse
Playwright: {method:"playwright", action:{name, operation, ...}}  ← 单一封装入口
```

宿主侧命令枚举（`/tmp/zcode-asar/out/host/chunk-AIU63WBB.js`）：
`"navigate","back","forward","reload","snapshot","click","fill","type","press","cuaKeypress",
"scroll","cuaScroll","domCuaScroll","hover","select","check","drag","cuaDrag","screenshot",
"getState","elementInfo","evaluate","getDialog","handleDialog",...` —— 与客户端两两对应，
CUA/DomCUA 的 scroll/drag/keypress 在 wire 上是独立方法名。

### 2.3 Playwright 面的实现方式

`tab.playwright` 不是 Playwright 库本身，而是**语义命令封装**：
locator 构造器（`getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/locator`）把条件
串行化为 Playwright selector 字符串（`internal:role=button[name="...i"]` 等，
`browser-client.mjs:975-1003`），由宿主在页面内求值。`evaluate` 把函数 `(fn)=>fn.toString()`。
等待类（`waitForURL/waitForLoadState/expectNavigation/waitForTimeout`）例行上限 **3000ms**
（对齐 Codex）。成员白名单：`publicMembers.PlaywrightAPI(16)/FrameLocator(7)/Locator(32)/
Download(1)/FileChooser(2)`——白名单外成员经 Proxy 隐藏（返回 undefined、`has` 为 false、
`ownKeys` 过滤）。

---

## 3. 对象模型与完整 API 面（manifest v11）

`docs/api.json` 定义 28 个对象类型；运行时由 `BrowserApiPolicy` + `createBrowserApiProxy`
按**后端能力**裁剪成员：`unsupportedByDefaultIn:["iab"]` 或 `requiresCapabilities`
（`"browser:<id>"`/`"tab:<id>"`）不满足 → 成员被隐藏（不是报错，是**从对象上消失**，
`browser-client.mjs:450-548`）。宿主也可以用 `apiSupportOverrides` 逐键覆写。

### 3.1 核心对象

```
Agent       → browsers, documentation
Browsers    → list(), get(idOrType), getDefault(), getForUrl(url), open(url, {reuseTab}?):
              Promise<Tab>
Browser     → browserId, capabilities, tabs, nameSession, user, documentation()
BrowserUser → openTabs(), claimTab(info), history(options)[iab 不支持]
Tabs        → list(): TabInfo[], selected(), get(id): Tab, new(): Tab,
              finalize({keep})[iab/cdp 不支持]
Tab         → id, capabilities, goto(url), back(), forward(), reload(), close(),
              url(), title(), screenshot(opts?): Uint8Array, getJsDialog(),
              setViewportSize({width,height}), viewportSize(), recording,
              markDeliverable(), markHandoff(), finalize,
              cua: CUAAPI, dom_cua: DomCUAAPI, playwright: PlaywrightAPI
```

- `TabInfo = {id, active?, title?, url?, viewport:{width,height}}`。
- `list()` 返回**受控 tab** 元数据（非对象）；`tabs.get(id)` 校验+绑定+激活；
  `user.openTabs()` 列用户 tab 但不给控制权，须显式 `claimTab`。
- `viewport` 限制：宽 320–3840、高 320–2160，非法输入**报错不 clamp**
  （`BROWSER_VIEWPORT_LIMITS`，`browser-client.mjs:4-11`）。
- `browser.tabs.new()` 自动打开右侧 IAB 面板并激活，用户可见；隐藏/恢复走
  `capabilities.get("visibility").set(false|true)`。

### 3.2 观察面

- **`playwright.domSnapshot()`** 是默认观察与 locator 事实来源：紧凑 AI/ARIA 树（含计算 role、
  accessible name、状态、开放 shadow DOM、可用时的 iframe body），**不是** outerHTML。
- `elementInfo(x,y)`、`elementScreenshot(opts)`、locator 查询（`count/textContent/innerText/
  getAttribute/isVisible/isEnabled/all/allTextContents`）。
- 截图纪律：`tab.screenshot()` 返回 PNG 字节，**必须**同一 cell 内
  `nodeRepl.emitImage(await tab.screenshot())`；不允许把 `Uint8Array` 当最终表达式
  （否则模型根本收不到图）。默认禁止 snapshot+screenshot 同 cell。
- 截图选项：`{fullPage:true}`、`{clip:{x,y,width,height}}`；超时不立刻重试。

### 3.3 交互与逃逸口

| 路径 | 成员 | 语义 |
|---|---|---|
| Playwright（首选） | `locator().click/fill/type/press/check/uncheck/selectOption/setChecked/dblclick/waitFor/evaluate/downloadMedia` | 语义、strict、可等待 |
| `tab.cua`（坐标） | `click({x,y})`, `double_click`, `move`(hover), `scroll({x,y,scrollX,scrollY})`, `drag({path,keys?})`(全路径), `keypress({keys})`, `type` | canvas/自绘控件兜底；按键按**组合**处理（不是序列） |
| `tab.dom_cua`（node 路径） | `click({node_id})`, `double_click`, `get_visible_dom()`, `keypress`, `scroll({node_id?,x,y})`, `type({text})` | `node_id` 即 snapshot 的 `ref`；scroll 的 x/y 是增量，从节点中心或视口中心滚 |
| 对话框 | `tab.getJsDialog()` → `AlertDialog/ConfirmDialog/PromptDialog/BeforeUnloadDialog`（`accept(text)?/dismiss()`） | 独立于 Playwright filechooser |

**能力边界**（对齐 Codex IAB）：
- `waitForEvent("filechooser")` / `fileChooser.setFiles(...)` → `capability_unsupported`（无假成功）；
  下载媒体改用 snapshot 证实的 locator `downloadMedia()`。
- `goto()` 只接受 `http:`/`https:`/精确 `about:blank`；`file:`/`about:*`/`data:`/`javascript:` 不可导航
  （`file:` 仅可作 `getForUrl()` 的后端选择提示）。
- `networkidle` 在类型里存在但被当前后端拒绝。
- `downloadMedia` 在 cua/dom_cua 上 IAB 不支持（manifest `unsupportedByDefaultIn:["iab"]` 且
  `documented:false`）。

### 3.4 录屏（tab.recording）

`docs/recording.md` + `browser-client.mjs:1508-1532`：

```js
const job = await tab.recording.start({
  viewport:{width:1280,height:720}, fps:25, maxDurationMs:20000, settleMs:800,
  showCursor:true,
  actions:[{type:"move",x:300,y:240,durationMs:500},{type:"click",selector:"#start",delayAfterMs:1000},
           {type:"scroll",deltaY:600,durationMs:800}] });
// 后续 cell：tab.recording.status(recordingId)  → preparing→capturing→finalizing→completed
// 最终取件：await tab.recording.status(id, {outputPath:"recordings/demo.webm"})
// 取消：    await tab.recording.cancel(id)
```

- 异步 job 可跨 cell 存活（recordingId 是连续性凭据）。
- actions 是**纯数据 DSL**：`wait/click/type/hover/move/scroll/scrollTo/wheel/drag/waitFor`，
  禁止页面代码；selector 必须来自最新 DOM snapshot。
- 单 tab 同时只允许一个录制；硬上限 90 秒。
- 实现：录制期间保持一个隐藏 IAB 渲染面，用 **Electron 内置 Chromium `MediaRecorder`** 出 WebM，
  不需要 FFmpeg（main 侧 `browserWebmRecorder.js` + preload `browserVideoRecorder.cjs`）。
  这条 API 正是 video2code 插件「录制→转 MP4」流水线的上游。

### 3.5 错误模型

`BrowserCommandError{code, command, result}`；高层方法返回 payload、动作成功返回 `undefined`。
wire 层错误码示例：`backend_unavailable`（选了未广告的后端，消息列出可用项）、
`execution_error`、`cancelled`、`timeout`、`capability_unsupported`。
定位器超时/strict 冲突 → 重新 `domSnapshot()` 重建 locator，**禁止原样重试**。

---

## 4. 观察机制（浏览器侧）

- **DOM 快照**：`snapshot` 命令返回 AI/ARIA 树；`ref` 即 `dom_cua` 的 `node_id`。
  页面内容（role/name/text/url）按 **UNTRUSTED** 处理：只能用于定位元素，绝不能当指令执行
  （SKILL「Rules」+ docs/safety.md）。
- **截图**：Chromium 原生 capture；截图进入宿主会话记录（`session.recordBrowserScreenshot`）；
  自动截图触发器：非查询类命令（除 `capabilities/list/listUserTabs/browserVisibilityGet` 与
  会话管理命令外）都会设置 `zcode/browserTurnScreenshot` meta（`server.js:117186-117200`）——
  宿主可为每个「turn」留一张界面凭据。
- **响应元数据**：`mergeBrowserResponseMeta` 把 `codex/browserUse:true`、
  `codex/toolSurface{kind:"browserUse", backendType, browserId, openTabIds?, sessionEnded?}`、
  `browser_use:{currentUrl}` 写入 MCP `_meta`——设计上是宿主专用（模型不可见），
  用于 UI 展示与审计。
- **generation 陈旧路由**：`browserGeneration` 随每个 execute 命令上送；后端连接代际不匹配时
  `assertActive` 抛 stale——防止新 cell 的绑定打到已重建的连接。

## 5. 动作机制（浏览器侧）

- 语义动作（Playwright locator / dom_cua node）优先；坐标（cua）只给 canvas/自绘兜底，
  且要求配截图瞄准。
- `click` 双形态：`{ref}`（snapshot ref）或 `{x,y}`（视口像素，可带 `frame_id` 语义的字段由
  宿主绑定）；`validateCoordinates` 做整数/负值校验。
- tab 激活语义：`tabs.get(id)` 只在**当前前台会话**里让 renderer 显示该 tab；
  后台会话永远不会抢用户当前 UI（overview.md）。
- 弹窗/new tab 判定协议：动作后源 tab 没出现预期效果时，**同一 cell 无条件**读
  `browser.tabs.list()` + `browser.user.openTabs()`，以 `{controlledTabs, userTabs}` 作为 cell
  最终结果，一次决策（SKILL step 7）。

---

## 6. 安全模型

- **后端广告制**：`agent.browsers.list()` 是唯一可用性来源；「Never treat an unadvertised
  backend as available」。显式选择不可用后端 → `backend_unavailable` 失败，**绝不静默换后端**。
- **用户 tab 双向隔离**：`tabs.list()` 只见受控 tab；控制用户 tab 必须显式 `claimTab(info)`；
  `tabs.get()` 不接受 `openTabs()` 返回的 id。
- **tab 生命周期**：tab 存活到 ZCode 进程退出；`finalize({keep})` 只打 `handoff/deliverable`
  标记，不关闭任何 tab；只有 `tab.close()`/用户关闭/窗口关闭/进程退出会移除。
- **页面内容不可信**：快照文本只用于定位；`evaluate` 里的页面内容不得变指令；GUI 测试 skill
  进一步禁止一切带副作用的 JS 注入（web-gui-tester「Prohibited」）。
- **子代理禁用**：与 CUA 相同的 `runtime_scope` 检查。
- **导航域约束**：只许 http/https/about:blank——堵死 `file:` 读盘与 `javascript:` 注入。
- **transport 校验**：token、id 回对、zod schema、32MiB 上限、generation 一致性。

---

## 7. IAB 宿主实现（Electron 侧）

- 后端描述符类型：`"iab","extension","cdp"`（host chunk-AIU63WBB.js 枚举）；桌面正常只广告
  `iab`；`cdp` 仅当 CLI 显式 `--browser-use=headless`（headless 是 CDP 的启动/显示模式，
  不是第四种后端）。
- 命令落点：`executeBrowserCommandOnView`（`/tmp/zcode-asar/out/main/index.js`）——
  取消/超时归类 `cancelled`/`timeout`，其余 `execution_error`。
- IAB 窗口/视图：`BrowserView`（main/index.js 30 处引用）；JS 对话框经 preload
  `embeddedBrowserJavaScriptDialog.cjs`；CUA 权限面板经 `cuaPermissionPanel.cjs`。
- 录制：`browserWebmRecorder.js`（main）+ `browserVideoRecorder.cjs`（preload）；
  docs 声明用 Chromium 内置 MediaRecorder（chunk-SPTKPKUJ.js 有 8 处 `webm` 字符串）。
- 视口自由模式：IAB 自动以 free-size 打开目标 tab（`setViewportSize` 可控）。

## 8. 与 video2code 插件的关系

video2code/0.6.0 的 env-setup skill 明说：「Browser interaction and recording use ZCode's
built-in Browser Use WebView, so Playwright and external Chromium are intentionally not
installed」「ZCode IAB + Browser Use recording API | URL 浏览、截图、交互和录制」。
即：video2code 的「录制网站→复刻」流水线 = **Browser Use 的 `tab.recording`**（WebM 采集）
+ 自带 FFmpeg（WebM→MP4）+ 页面观察用 `domSnapshot/screenshot`。
ZCode 内置浏览器的 agent 侧控制器只有 `js` 一个入口（「Only the `js` tool drives this browser」）。

## 9. 与 Codex 浏览器面的对齐

- 对象模型（`Browsers/Browser/Tabs/Tab/user/capabilities`）、`domSnapshot → locator → act`
  工作流、`internal:*` selector 串行化、3000ms 例行超时、`tab.playwright.waitForTimeout`
  属于 Playwright 面而非 Tab 根成员、filechooser 不支持——全部是 docs 里逐条标注
  「Codex-compatible / matching Codex」的行为。
- 有意的本地化差异：后端类型枚举多出 `iab`（桌面内嵌 WebView；Codex 是云端容器浏览器）、
  `agent.browsers.open(url)` 的同站复用入口（`tabs.reuse` + same-hostname 匹配）、
  录屏 API（`tab.recording`）、用户 tab claiming、`finalize` 交接标记。
- 过程纪律（每 cell 重建 wrapper、先 list 后 get、一次逻辑批次前把完整 tab 列表作为独立 cell
  返回给模型）也逐条对齐 Codex 的「fresh kernel + BrowserControl 持久」模型。

## 10. 实操样例（依据 SKILL 的完整用法）

```js
// cell 1：bootstrap + 选后端 + 一次性读完整文档
const root = process.env.ZCODE_PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT;
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupBrowserRuntime } = await import(
  pathToFileURL(join(root, "scripts", "browser-client.mjs")).href);
await setupBrowserRuntime({ globals: globalThis });

const browser = await agent.browsers.get("iab");       // 或 getDefault()/getForUrl(url)
nodeRepl.write(await browser.documentation());          // 首次完整读，之后不再读

// cell 2：独立的「列 tab」cell，完整列表作为最终结果
const browser = await agent.browsers.get("iab");
await browser.tabs.list();                              // → 模型检视 id/url/title/active

// cell 3：按已验证 id 绑定 + 导航 + 显式 load-state 确认 + DOM 观察
const browser = await agent.browsers.get("iab");
const tab = await browser.tabs.get("tab_id_from_list");
await tab.goto("https://example.com");
await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
await tab.playwright.domSnapshot();                     // 最终表达式 → 模型看到树

// cell 4：从 snapshot 事实建 locator，动作后最省观察
const el = tab.playwright.getByRole("button", { name: /sign in/i });
if ((await el.count()) === 1) await el.click();
await tab.playwright.getByRole("heading").first().textContent();

// 截图（仅视觉需要时）：必须同 cell emit
nodeRepl.emitImage(await tab.screenshot());
```
