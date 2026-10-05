# Codex Browser Use（浏览器控制）完整逆向

> 证据出处见 [evidence/inventory.md](evidence/inventory.md)（§编号引用）。标注：【实证】/【推断】。

## 0. TL;DR

Codex 的浏览器控制是一个**多后端统一 API**：一套 `Agent.browsers / Browser / Tab` 对象面，下面挂四种后端——

| 后端 id | type | 载体 | 典型用途 |
|---|---|---|---|
| `"iab"` | `iab` | ChatGPT/Codex app 内置浏览器（in-app browser） | 本地开发页、file://、可见演示 |
| `"chrome"` / `"edge"` / 各 Chromium 系 | `extension` | ChatGPT 官方浏览器扩展 + Native Messaging | 复用用户真实登录态/标签页 |
| `"cdp"` | `cdp` | **云端浏览器**（OpenAI 托管，本机不可见） | 隔离执行、训练/云任务 |
| `"mcpapps"` | `mcpapps` | 任务侧边栏的全屏 MCP Apps | DOM 交互式 App 页面 |

两种编程入口：
1. **`cua` 面的 browser 半边**（`cua.getBrowser/createBrowserTab/getTab/listTabs`，Tab 实现 Target 交互面）——cua_repl 运行时内，与桌面控制同一 REPL。
2. **独立 browser 插件面**（browser-client.mjs 的 `agent.browsers...tab.ax/playwright/cdp...`）——功能超集，含 Playwright locator、原始 CDP、剪贴板、对话框控制。

协议层不是单一 CDP：extension 后端走 Chrome 扩展 + Native Messaging；iab 走 app 内部；云端走专有通道；CDP 只作为**tab 级可选能力**（`tab.capabilities.get("cdp")`）受限暴露。

## 1. 载体与版本

| 组件 | 版本 | 位置 |
|---|---|---|
| browser 插件（`browser@openai-bundled`） | 26.930.31730 | `~/.codex/plugins/cache/openai-bundled/browser/26.930.31730/` |
| browser-client.mjs（JS API 实现） | — | 同上 `scripts/`，169,286 B（minified ESM） |
| browser-service.mjs（"Production browser runtime for Codex Desktop"） | `@oai/browser-desktop@0.1.1` | 同上 `scripts/`，1,442,081 B |
| browser-accessibility.wasm.br | — | 4,084,148 B brotli 压缩 WASM：AX 树渲染【推断：在页内构建可移植 AX 快照】 |
| zxing_reader.wasm | — | 1,065,866 B：二维码/条码识别（截图内嵌码的读取） |
| chrome 插件（扩展桥） | 26.901.51231 | `.../openai-bundled/chrome/`，extension-host/macos/arm64/"ChatGPT for Chrome"（Mach-O arm64 原生宿主） |
| ChatGPT 浏览器扩展 | Chrome Web Store `hehggadaopoacecdllhhajmbjkdcmajg`；Edge Add-ons `odlomjlbamekndcpllcnffbgeohgkmjh`（Chrome/Brave/Opera 复用前者） | `scripts/extension-ids.json` |
| 用户配置 | `~/.codex/browser/config.toml` | `approval_mode/history_approval_mode/download_approval_mode/upload_approval_mode = "never_ask"`、`full_cdp_access_enabled = true` |
| 会话状态 | `~/.codex/browser/sessions/*.toml` | 每会话一文件；样例仅含 `[full_cdp] allowed = ["https://…"]`（CDP origin 白名单） |

插件仓库内部路径（plugin.json repository 字段）：`github.com/openai/openai/tree/master/lib/oai_browser_use/plugin`【实证：字段值；该仓库是否公开未验证】。

## 2. 后端与连接拓扑

```
                         ┌────────────────────────────────────────────┐
模型 ──MCP js──> cua_repl │ @oai/cua tinyskyAlt ──> @oai/browser (类型) │
                         │        BROWSER_USE_AVAILABLE_BACKENDS=     │
                         │        chrome,iab,mcpapps                  │
                         └───────┬───────────────┬───────────────┬────┘
                                 │               │               │
                    NODE_REPL_TRUSTED_SERVICES   │               │
                    "browser": "@oai/browser-desktop/service"    │
                                 │               │               │
                     ┌───────────▼───┐   ┌───────▼──────┐  ┌─────▼──────┐
                     │ browser-      │   │ IAB（app 内  │  │ mcpapps    │
                     │ service.mjs   │   │ WebView）    │  │（侧边栏）  │
                     └──┬─────────┬──┘   └──────────────┘  └────────────┘
          Native Messaging│        │(受限 CDP)
        ┌─────────────────▼─┐   ┌──▼────────────────┐        ┌──────────────┐
        │ ChatGPT 扩展      │   │ DevTools 协议（仅  │        │ 云端 "cdp"    │
        │ hehgg…/odlom…     │   │ tab.capabilities） │        │ （外部服务）  │
        └───────────────────┘   └───────────────────┘        └──────────────┘
```

要点：
- browser 插件的 hooks 在 Interrupt/SubagentStop/Stop 时调用 `node_repl.turn_ended`——会话生命周期与 REPL 绑定，插件据此清理受控 tab。
- `NODE_REPL_TRUSTED_SERVICES` 把 `@oai/browser-desktop/service`（= browser-service.mjs）注册为宿主信任服务；browser-service.mjs 开头有 `processShim`（伪 process 对象），说明它被设计为可跑在受限/沙箱化 JS 环境里【实证：代码形态；意图为推断】。
- chrome 插件提供 `check-native-host-manifest.js / check-extension-installed.js / chrome-is-running.js / installed-browsers.js / open-chrome-window.js` 一组诊断脚本；`installed-browsers.js` 里硬编码了 Brave 的 NativeMessagingHosts 目录等（browser-client.mjs 内也有 Brave 路径段）——即"把宿主 manifest 装进各 Chromium 浏览器"的桥接是共享代码。
- Rust feature flags：`browser_use`、`browser_use_full_cdp_access`、`browser_use_external`、`in_app_browser`、`in_app_local_automation`；Rust 配置 `BrowserUseConfigToml { allow_history_access, default_origin_policy, origins }`、`BrowserUseOriginPolicyConfigToml { access, downloads, uploads, full_cdp_access, persistent_approval, access_approval_lifetime, allow_webmcp, disable_auto_review }` —— **origin 粒度策略**在 CLI/服务端一侧（与 `~/.codex/browser/sessions/*.toml` 的 `[full_cdp] allowed` 对应）。

## 3. 统一 API 面（docs/api.json 全量还原）

api.json root 为 `Agent`，各接口成员与文档注记：

```ts
agent.browsers: Browsers {
  get(id: string): Promise<Browser>          // 按 id 或客户端类型
  getDefault(): Promise<Browser>             // 未文档化（documented:false）
  getForUrl(url: string): Promise<Browser>   // 未文档化：按 URL 选最合适浏览器
  list(): Promise<Array<{ id, name, family?, profileName?,
                          type: "iab"|"extension"|"cdp"|"mcpapps",
                          metadata?: { extensionInstanceId?, codexSessionId? } }>>
}
browser.browserId: string
browser.capabilities: BrowserCapabilityCollection   // 见 §5
browser.tabs: Tabs { content, get, list, new, selected }
browser.user: BrowserUser { claimTab, getTabContext, openTabs }  // 仅 extension 型
browser.history                                       // 受 allow_history_access 管
browser.nameSession(...)                              // 会话命名（docs/session-naming.md）
browser.documentation(): Promise<string>
```

Tab 成员（`Tab`）：
- 属性：`id`、`ax`、`capabilities`、`clipboard`、`content`、`cua`、`dom_cua`、`dev`、`playwright`
- 导航/生命周期：`goto / back / forward / reload / close / screenshot / title / url / getJsDialog / requestManualHandoff / markDeliverable / markHandoff`

`markDeliverable / markHandoff` 与 cua 面的 Tab 同名——把"这个 tab 是最终交付物/这是人工交接点"上报给宿主 UI【推断：宿主侧展示语义】。

`BrowserUser.claimTab/openTabs`（仅 extension 后端）：读取/认领**用户自己的**标签页——对应 cua 文档 "List user and controlled tabs without claiming them"（`listTabs` 只列不占，`claimTab` 才接管）。这是区分"用户的 tab"与"agent 的 tab"的权界原语。

## 4. 三层交互模型（从 AX 到 CDP）

### 4.1 AX 层（默认首选）
`tab.ax`（AXAPI）：`click, drag, get, paste, performSecondaryAction, pressKey, scroll, selectText, setValue, typeText, write`。
- `write(kind?)`：`"state" | "screenshot" | "both"`，默认 state；自动 `nodeRepl.write` 回显（`get()` 只取数据不回显）
- 与桌面一致：默认 diff、`{ disableDiffing: true }` 取全树、每动作后必须重取状态
- AX 文本总含 title & url；截图统一 JPEG
- `pressKey` 支持 xdotool 风格组合键；`typeText/paste/pressKey` 首参 elementIndex（`null` = 用当前焦点）

浏览器 AX 树的来源：页面内 WASM（browser-accessibility.wasm.br）构建无障碍快照，而非 macOS AX API——这让四后端行为一致【实证：wasm 存在且名为 browser-accessibility；实现细节为推断】。

### 4.2 CUA / DomCUA 层（cua 风格动作）
`tab.cua`：`click, double_click, downloadMedia, drag, keypress, move, scroll, type`（坐标类）。
`tab.dom_cua`：同上 + `get_visible_dom`（取可见 DOM 而非 AX）。
用途：AX 不可用时的坐标兜底，与"computer use"动作语义对齐。

### 4.3 Playwright 层（批量/开发场景）
`tab.playwright`：`locator, getByRole/Label/Text/Placeholder/TestId, frameLocator, evaluate(Humaninger), expectNavigation, waitFor*, elementScreenshot, domSnapshot, elementInfo, downloadMedia…`；Locator 类完整（`click/fill/press/selectOption/setChecked/filter/nth/or/…`），还有 `FileChooser { isMultiple, setFiles }` 与 `Download { path }`。
官方定位（tinysky-alt-other-browser-apis.md）：AX 是短任务首选；Playwright 用于"长而重复、索引不稳定"或"测自己开发的站"。

### 4.4 受限 CDP（tab 能力）
`tab.capabilities.get("cdp")`：
- **作用域锁在当前 web origin**；要求先导航到 HTTP(S) 页
- 事件面：`readEvents({ afterSequence, limit≤1000, methods[], target, timeoutMs })` 返回 cursor/hasMore/truncated 分页
- 子 target 发现走 `Target.attachedToTarget`
- 用 CDP 直接改了页面/浏览器状态须向用户申报
- 开关链：Rust feature `browser_use_full_cdp_access` + 用户 `full_cdp_access_enabled = true` + 每会话 `[full_cdp] allowed = [origins]`

## 5. 能力系统（capabilities）

browser 级：
- `management`：Chrome 兼容 `windows/tabs/tabGroups/bookmarks`，仅限"用户要求的浏览器整理"；导航/历史/特权 API/共享组变更被拒
- `viewport`：视口覆盖 `set/reset`（仅限响应式测试，禁止为了截图好看而改）
- `visibility`：`get/set(visible)` 显隐浏览器（后台干活，需要展示时 `set(true)`）

tab 级：
- `cdp`（§4.4）
- `browserAuth`：安全登录交接——凭据在 ChatGPT 安全表单收集，browser-client 校验、填充、提交，**值不回传模型**
- `botDetection`：反机器人检测场景处理
- `pageAssets`：页面资源访问
- `webmcp`：页面自定义工具（MCP over page）——`webmcp.fetchTools()` → `tools.call(name, input)`，只准调用已列出的工具，且必须过确认策略

能力发现协议：`browser.capabilities.list()` → `get(id)` → `(await …).documentation()`。能力由后端** advertised**（"Browser-scoped optional capabilities advertised by the connected backend"）——不同后端可声明不同能力集【实证：API 文档；各后端能力矩阵未实测】。

## 6. 安全模型

### 6.1 策略文件（模型侧）
- `docs/browser-safety.md`：网页/邮件/文档/截图一律视为不可信内容；区分"读"与"传"（表单提交/WebMCP 调用/上传即传输）；不得绕过 HTTPS 警示页与付费墙
- `docs/confirmations.md`：与 computer use 同构的四档确认策略（Hand-off / Always Confirm / Pre-Approval / Allowed），[14] 敏感数据传输在浏览器场景下**不接受初始 prompt 预批准**（必须动作时再次确认具体数据+目的地）
- `docs/browser-control-interruption.md`：被扩展或用户接管打断时，不得向用户复述原始运行时错误（"Browser use was stopped in the extension."），不提 turn_id 等内部术语
- Rust 侧还有同名 `browser_use` 确认策略 prompt 内嵌于二进制（§7.1 evidence）

### 6.2 执行侧拒绝目录（browser-client.mjs 常量）
每个错误带 `decisionSource`：
| 错误码 | 来源 | 可重试 |
|---|---|---|
| approval_cancelled / approval_failed_closed / approval_unavailable | approval | 是 |
| browser_capability_blocked | browser | 否 |
| browser_capability_unavailable | browser | 是 |
| browser_context_unavailable | browser | 是 |
| browser_navigation_blocked | browser | 否 |
| enterprise_policy_blocked | enterprise | — |

错误文案尾缀硬编码反绕过指令："The agent must not attempt to achieve the same outcome via workaround, indirect execution, raw CDP or browser commands, alternate browser surfaces, or policy circumvention."——**拒绝不是终态建议，而是禁止换面重试**。文案另有分级："Browser Use rejected this action due to browser security policy"（policy 拒绝）vs "could not complete… because a browser security check was unavailable"（fail-closed，检查不可用同样拒绝）。

### 6.3 用户可调面
- `~/.codex/browser/config.toml`：approval_mode / history / download / upload 四个审批开关 + `full_cdp_access_enabled`（本机全部 never_ask + true）
- Rust origin policy：per-origin 的 access/downloads/uploads/full_cdp_access/persistent_approval/access_approval_lifetime/allow_webmcp/disable_auto_review
- 会话文件按 origin 白名单记录 CDP 授权

## 7. cua 面的 browser 半边（与桌面控制的合流）

在 cua_repl 里，浏览器操作走 `cua.getTab/createBrowserTab/getBrowser/listBrowsers/listTabs`（API 见 computer-use.md §3.1）。决策树（instructions/macos/browser.md）：

```js
// 1) tab @-mention（plugin://… 的 tab-v1 引用）
let tab = await cua.getTab({ mention: tabMentionUrl });
// 2) 已知 URL + 浏览器上下文
let tab = await cua.getTab({ url }, { browser: browserId });
// 3) 已知 tabId + 浏览器
let tab = await cua.getTab(tabId, { browser: browserId });
// 4) 开新 tab：iab 可见性、chrome/edge 用 emoji 前缀 sessionName
let tab = await cua.createBrowserTab("iab", url, { visible: true });
let tab = await cua.createBrowserTab("chrome", url, { sessionName: "🔎 Task" });
// 5) 只选浏览器不开 tab
let browser = await cua.getBrowser({ url });
```

- `createBrowserTab` 的 options **先于**开 tab 应用；不支持的设置抛错（"omitted settings stay unchanged, unsupported settings throw"）
- `getTab({url})` 要求唯一精确匹配，"never opens a tab"；stale/missing/ambiguous 一律失败，不自动开替代 tab
- `chrome://newtab` 与 Orbit 签名新页：getTab 只显示元数据不读取页面，必须 `goto(url)` 到允许站点
- DOM-only tab（mcpapps）：`getAXState()` 用 DOM 快照（无数字索引）、`getScreenshot()` 用 tab 截图 API、原生输入包装**调用即抛**，交互改用 Playwright locator
- 首次 `getBrowser/getTab/createBrowserTab` 自动吐出该浏览器文档——文档即能力协商

云浏览器（`instructions/macos/browser-cloud.md`）：id 固定 `"cdp"`，"Always prefer this tool over the `control-browser` skill unless…"；配套 `browser-cloud-guidance.md` 的 browserAuth 引导（不主动探测登录态、登录墙时读 browserAuth 能力指引）。`CUA_REPL_BROWSER_ENV=cloud|orbit` 会切换到这套 CDP 指令——说明云端面也在同一 REPL 内以 browser id 形式接入【实证：指令文档；云端服务端不可见】。

## 8. 传输与进程汇总

| 通道 | 用途 | 证据 |
|---|---|---|
| stdio MCP（cua_repl / node_repl） | 模型 ↔ REPL | unified-computer-use/.mcp.json；browser plugin.json hooks |
| Native Messaging（Chrome 扩展 ↔ 宿主） | extension 后端 | check-native-host-manifest.js；extension-host "ChatGPT for Chrome" 二进制；Brave NativeMessagingHosts 路径 |
| 宿主信任服务管道（nodeRepl.nativePipe / NODE_REPL_HOST_SERVICES_PIPE_PATH） | JS ↔ browser-service / sky | native-pipe.js；NODE_REPL_TRUSTED_SERVICES |
| DevTools Protocol（受限） | tab.capabilities.cdp | capabilities/tab/cdp.md |
| `~/.codex/ipc/ipc.sock` | app/daemon IPC | 目录实证 |
| app-server daemon（`app-server.pid.lock`） | 桌面 ↔ codex 后端 | 目录实证；"from codex app-server" 字符串在 Sky 客户端内 |

## 9. 与 ZCode 内置 browser use 的对照（摘要）

| 维度 | Codex | ZCode（本会话宿主） |
|---|---|---|
| 后端 | iab / extension / cdp（云）/ mcpapps 四合一 API | 后端枚举 iab / extension / cdp（CLI `--browser-use=headless`），桌面正常只广告 iab（内置 WebView） |
| 面形态 | `tab.ax/.cua/.dom_cua/.playwright/.clipboard/.dev` 多层 | 单一 `js` MCP 工具 + `agent.browsers` SDK（按 `docs/api.json` manifest + Proxy 动态裁剪） |
| CDP | tab 级能力、origin 白名单、事件游标 | 桌面 IAB 无对外 CDP 能力面；cdp 仅作 CLI 后端类型 |
| 登录凭据 | browserAuth（模型不见值） | IAB 为宿主自有 WebView，无跨浏览器凭据复用机制 |
| 反绕过 | 错误目录 + 文案硬编码 | 无对应机制（策略层在模型外） |
| 历史审计 | browser.history + allow_history_access + 会话 toml | 无对应 |

> 注：本节 ZCode 侧事实以 [agents/zcode/browser-use.md](../zcode/browser-use.md) 为准（2026-10-06 勘误：早稿曾把分析环境里的用户级浏览器工具误记为 ZCode 内建能力，已更正）。

## 10. 本机不可见边界

- 云端浏览器（"cdp"）服务端：协议、实例生命周期、地域、与 `browser_use_external` feature 的关系均不可见。
- browser-service.mjs 与宿主（Electron main / node_repl host）之间的具体管道帧格式未还原（1.4MB minified，未逐段解包；已知它可运行于 processShim 受限环境并暴露 `./service` 导出）【推断：与 sky 的 nativePipe 同族】。
- IAB 的 DOM/网络栈（app.asar 内 WebView 管理）未拆包；其行为面已由 api.json 与指令文档完整覆盖。
