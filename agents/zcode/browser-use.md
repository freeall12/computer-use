# ZCode Browser Use（浏览器控制）· 一个 js 入口，宿主 IAB 执行

> 逆向对象：ZCode 桌面 Agent 的 browser use。基线：browser-use 插件 0.5.1 · node-repl-host 0.6.0 · ZCode.app（2026-09-29 构建）。证据见 [evidence/inventory.md](evidence/inventory.md)。

> 一句话结论：**与 CU 共用 `mcp__node_repl__js`，但走另一条链路：SDK 对象面 → 桌面宿主浏览器 broker → Electron IAB；观察靠 AI/ARIA 快照，动作 Playwright 优先、cua/dom_cua 兜底，录屏是 Chromium 原生 MediaRecorder。**

| 项 | 值 |
|---|---|
| 模型可见面 | control-browser skill + `agent.browsers.*` SDK（browser-client.mjs，2235 行）+ manifest v11 动态裁剪 |
| 后端 | iab（桌面内置）/ extension / cdp（CLI headless）；桌面正常只广告 iab |
| 命令面 | 导航/观察/交互/对话框/视口/可见性/录制/标签 约 25 命令 + playwright action 袋 |
| 对象模型 | `Browsers→Browser→Tabs→Tab`（Tab 20 成员），从 Codex 浏览器面移植 |
| 录屏 | `tab.recording` → WebM（90s 上限，单 tab 单录制），video2code 插件的上游 |
| 安全模型 | 后端广告制 · 用户 tab 隔离（claimTab）· 导航域白名单 · 子代理禁用 |
| 本机可用 | ✅（IAB 实证） |

## 架构一图

```
模型 ── control-browser SKILL，写 JS（每 call 全新 Worker）
 ▼ mcp__node_repl__js（Symbol.for("zcode.node-repl.browser-control-bridge")）
Worker：agent.browsers（Browser/Tabs/Tab/cua/dom_cua/playwright/recording）
 │ 本地 socket + token，NDJSON；op=list|execute；32MiB 响应上限
 ▼
桌面宿主浏览器 broker：后端注册表 iab/extension/cdp
  controlled tabs vs user tabs（claimTab 显式接管）；browserGeneration 防陈旧路由
 │ executeBrowserCommandOnView(view, command)
 ▼
IAB（Electron BrowserView + Chromium）：DOM 快照 · Playwright locator（selector 串行化）
  cua 坐标 / dom_cua node 路径 · 截图 · WebM 录制（内置 MediaRecorder，无 FFmpeg）
```

## 载体清单

| 组件 | 版本 | 角色 |
|---|---|---|
| browser-use 插件 | 0.5.1 | skill ×2 + docs + client bootstrap（**不再携带 MCP server**，manifest 只有 skills 键） |
| 浏览器 SDK | browser-client.mjs，2235 行 | `setupBrowserRuntime` 装配 `agent.browsers` |
| API 清单 | docs/api.json，manifest v11 | 28 个对象类型 + 成员支持矩阵（Proxy 裁剪的事实来源） |
| lookup 文档 | docs/*.md ×15 | `agent.documentation.get("<name>")` 按需拉取 |
| 共享宿主 | node-repl-host 0.6.0 | `js` 工具 + browser 桥 + broker 客户端 |
| IAB 运行时 | ZCode.app app.asar out/main | BrowserView、executeBrowserCommandOnView、WebM 录制器 |

> 演进：≤0.4.2 自带 7→18.6MB 独立 MCP server → 0.5.1 零 dist，注册收在 CLI 核心（bua/cua 任一启用即挂载）。命令/对象 schema 全文见 `source/zcode/schemas/browser-api.json`。

## 对象模型：manifest 定成员，Proxy 按后端裁剪

**成员不可用不是报错，是从对象上消失**（`unsupportedByDefaultIn` / `requiresCapabilities` 不满足即隐藏；宿主可 `apiSupportOverrides` 逐键覆写）。

```
agent.browsers: list()/get(idOrType)/getDefault()/getForUrl(url)/open(url,{reuseTab})
Browser:  browserId · capabilities · tabs · nameSession · user · documentation()
Tabs:     list()/selected()/get(id)/new()/finalize({keep})
Tab(20):  goto/back/forward/reload/close/url/title/screenshot/getJsDialog
          setViewportSize/recording/markDeliverable/markHandoff/finalize
          cua · dom_cua · playwright · capabilities
BrowserUser: openTabs()/claimTab(info)/history(iab 不支持)
```

- `tabs.list()` 只返回**受控 tab** 元数据；用户 tab 须显式 `claimTab`。`tabs.new()` 自动打开右侧 IAB 面板并激活。
- 视口限宽 320–3840、高 320–2160，非法**报错不 clamp**。

## 三条交互路径

| 路径 | 成员 | 语义 |
|---|---|---|
| Playwright（首选） | `domSnapshot/locator/getBy*` ×16 + Locator ×32 | 语义命令封装（非 Playwright 库）：条件串行化为 `internal:role=…` selector，宿主页内求值；等待类例行上限 3000ms |
| `tab.cua`（坐标兜底） | click/double_click/move/scroll/drag/keypress/type 等 ×8 | canvas/自绘控件兜底；按键按**组合**处理（不是序列） |
| `tab.dom_cua`（node 路径） | click/get_visible_dom/scroll/type 等 ×7 | `node_id` 即 snapshot 的 `ref`；scroll 的 x/y 是增量 |
| 对话框 | `tab.getJsDialog()` → alert/confirm/prompt/beforeunload | `accept(text)?/dismiss()` |

能力边界：`filechooser`/`setFiles` 不支持（capability_unsupported，无假成功）；`goto` 只许 http/https/精确 about:blank；`networkidle` 被后端拒绝；`downloadMedia` 在 cua/dom_cua 上 IAB 不支持。

## 观察与动作

**`playwright.domSnapshot()` 是默认观察与 locator 事实来源**：紧凑 AI/ARIA 树（计算 role、accessible name、状态、开放 shadow DOM），不是 outerHTML。

- 截图：`tab.screenshot()` 返回 PNG 字节，**必须同 cell `nodeRepl.emitImage`**（否则模型收不到图）；默认禁止 snapshot+screenshot 同 cell。
- 页面内容按 **UNTRUSTED** 处理：只能用于定位元素，绝不能当指令执行。
- 非查询类命令自动设置 `zcode/browserTurnScreenshot` meta——宿主每 turn 留一张界面凭据（模型不可见）。
- `click` 双形态：`{ref}` 或 `{x,y}`；tab 激活仅限前台会话，后台会话永不抢用户 UI。
- 弹窗/new tab 判定：动作后无预期效果时，同一 cell 无条件读 `tabs.list()` + `user.openTabs()`，一次决策。

## 录屏：tab.recording

```js
const job = await tab.recording.start({ viewport:{width:1280,height:720}, fps:25,
  maxDurationMs:20000, showCursor:true,
  actions:[{type:"click",selector:"#start",delayAfterMs:1000}] });
await tab.recording.status(id, { outputPath:"recordings/demo.webm" }); // preparing→…→completed
```

- actions 是**纯数据 DSL**（wait/click/type/hover/move/scroll…），禁止页面代码；selector 须来自最新快照。
- 单 tab 单录制，硬上限 90s；实现是隐藏 IAB 渲染面 + Electron 内置 Chromium MediaRecorder（无 FFmpeg）。
- video2code 插件的「录制→转 MP4」流水线即以这条 API 为上游。

## 安全模型

| 层 | 机制 |
|---|---|
| 后端广告制 | `agent.browsers.list()` 是唯一可用性来源；显式选不可用后端 → `backend_unavailable`，绝不静默换 |
| 用户 tab 隔离 | list 只见受控 tab；`tabs.get()` 不接受 openTabs 的 id |
| tab 生命周期 | 存活到进程退出；`finalize({keep})` 只打交接标记不关闭 |
| 页面内容 | 快照文本只用于定位；GUI 测试 skill 进一步禁止带副作用的 JS 注入 |
| 导航域 | 只许 http/https/about:blank——堵死 file: 读盘与 javascript: 注入 |
| 传输 | token + id 回对 + zod 校验 + 32MiB 上限 + generation 一致性 |
| 子代理 | 与 CU 相同的 runtime_scope 检查 |

错误模型：`BrowserCommandError{code, command, result}`；定位器超时/strict 冲突 → 重新 domSnapshot 重建 locator，**禁止原样重试**。

## 与 Codex 浏览器面的对齐

对象模型、`domSnapshot→locator→act` 工作流、selector 串行化、3000ms 超时、filechooser 不支持均标注「Codex-compatible」；本地化差异：后端多 `iab`、`open(url)` 同站复用、录屏 API、用户 tab claiming、`finalize` 交接标记。原始面见 [codex 分册 browser-use.md](../codex/browser-use.md)。

## 实操样例

```js
const { setupBrowserRuntime } = await import(pathToFileURL(
  join(process.env.ZCODE_PLUGIN_ROOT, "scripts", "browser-client.mjs")).href);
await setupBrowserRuntime({ globals: globalThis });

const browser = await agent.browsers.get("iab");
await browser.tabs.list();                       // 独立「列 tab」cell，完整列表作结果
const tab = await browser.tabs.get("tab_id_from_list");
await tab.goto("https://example.com");
await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
await tab.playwright.domSnapshot();              // 最终表达式 → 模型看到树
const el = tab.playwright.getByRole("button", { name: /sign in/i });
if ((await el.count()) === 1) await el.click();
nodeRepl.emitImage(await tab.screenshot());      // 截图必须同 cell emit
```
