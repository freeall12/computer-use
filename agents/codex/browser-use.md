# Codex Browser Use（浏览器控制）· 四后端，一套 Tab 面

> 证据见 [evidence/inventory.md](evidence/inventory.md)（§编号引用）。标注：【实证】/【推断】。

> 一句话结论：**一套 `Agent.browsers→Browser→Tab` 对象挂四种后端（iab / extension / cdp 云 / mcpapps）；Tab 上 ax/cua/dom_cua/playwright/clipboard/dev 多层交互，CDP 只是 origin 白名单内的 tab 级受限能力。**

| 项 | 值 |
|---|---|
| 载体 | browser 插件 26.930.31730（browser-client.mjs 169KB + browser-service.mjs 1.4MB + AX WASM 4MB） |
| 形态 | 两种编程入口：cua 面 browser 半边（同 REPL）+ 独立 browser 插件面（功能超集） |
| 后端 | iab（app 内置）/ extension（ChatGPT 扩展+Native Messaging）/ cdp（OpenAI 云端）/ mcpapps（侧边栏） |
| 观察 | 页内 WASM 构建 AX 快照（diff 默认开）；AX 文本总含 title & url；截图统一 JPEG |
| 动作 | ax 语义优先；cua/dom_cua 坐标兜底；Playwright 用于长任务/自研站 |
| 安全模型 | 网页内容不可信 · 域名/动作授权 · 拒绝目录硬编码反绕过 · origin 粒度策略 |
| 本机可用 | ⚙️ 已装扩展桥与配置（approval_mode 全 never_ask，full_cdp_access=true） |

## 架构一图（后端拓扑）

```
模型 ─ MCP js → cua_repl：cua.getTab/createBrowserTab/getBrowser/listTabs
                BROWSER_USE_AVAILABLE_BACKENDS=chrome,iab,mcpapps
 ┌──────────────┼──────────────────┬─────────────┐
 ▼              ▼                  ▼             ▼
iab            extension          mcpapps       cdp（云）
app 内 WebView  ChatGPT 扩展       侧边栏 DOM    OpenAI 托管
               └ Native Messaging → Chrome/Edge/Brave/Opera
独立 browser 插件面：agent.browsers→Tab（ax/cua/dom_cua/playwright/clipboard/dev/cdp 能力）
```

## 载体与配置

| 组件 | 说明 |
|---|---|
| browser-client.mjs / browser-service.mjs | JS API 实现 / "Production browser runtime for Codex Desktop"（@oai/browser-desktop@0.1.1，可跑 processShim 受限环境） |
| browser-accessibility.wasm.br / zxing_reader.wasm | 页内 AX 快照渲染（4MB brotli）/ 二维码识别 |
| chrome 插件 + 官方扩展 | extension-host（Mach-O arm64）；扩展 id `hehgg…`（Chrome/Brave/Opera）与 `odlom…`（Edge） |
| `~/.codex/browser/config.toml` | approval_mode / history / download / upload 全 `never_ask` + `full_cdp_access_enabled=true` |
| `sessions/*.toml` | 每会话 CDP origin 白名单（`[full_cdp] allowed=[…]`） |

> API 面与 cua/browser 半边的完整成员清单见 `source/codex/schemas/cua-surface.json`（browsers 键）。

## 统一 API 面（api.json 还原）

| 对象 | 关键成员 |
|---|---|
| `agent.browsers` | get(id) / getDefault(未文档化) / getForUrl(url) / list()——list 返回 {id, name, type, metadata} |
| `Browser` | browserId · capabilities · tabs · user（仅 extension）· history · nameSession · documentation() |
| `Tabs` | content / get / list / new / selected |
| `Tab` | ax · cua · dom_cua · playwright · clipboard · dev · capabilities · goto/close/screenshot/getJsDialog/requestManualHandoff/markDeliverable/markHandoff |
| `BrowserUser` | openTabs() / claimTab(info) / getTabContext——**用户 tab 与 agent tab 的权界原语**（listTabs 只列不占） |

## 三层交互模型

| 层 | 成员与语义 |
|---|---|
| `tab.ax`（默认首选） | click/drag/get/paste/pressKey/scroll/selectText/setValue/typeText/write；默认 diff、`disableDiffing` 取全树、每动作后必须重取；`write()` 自动回显（`get()` 只取数据） |
| `tab.cua` / `tab.dom_cua` | 坐标类兜底 ×8；dom_cua 多 get_visible_dom；与桌面动作语义对齐 |
| `tab.playwright` | locator/getBy*/frameLocator/evaluate/expectNavigation/waitFor* + FileChooser/Download；官方定位：AX 短任务首选，Playwright 用于「长而重复、索引不稳定」或测自研站 |
| `tab.capabilities.get("cdp")` | 作用域锁当前 web origin；readEvents 游标分页（limit≤1000）；开关链 = Rust feature + 用户开关 + 会话白名单 |

能力系统（capabilities）：browser 级 management（Chrome 兼容 tabs/bookmarks 整理）/ viewport / visibility；tab 级 cdp / browserAuth（凭据在 ChatGPT 安全表单收集，**值不回传模型**）/ botDetection / pageAssets / webmcp（页面自定义 MCP 工具，须过确认策略）。发现协议：`capabilities.list() → get(id) → documentation()`。

## 安全模型

| 层 | 机制 |
|---|---|
| 内容不可信 | 网页/邮件/截图一律不可信；区分「读」与「传」（表单提交/上传即传输）；不得绕过 HTTPS 警示页与付费墙 |
| 确认策略 | 与 CU 同构四档；[14] 敏感数据传输**不接受初始预批准**（动作时再确认具体数据+目的地） |
| 拒绝目录 | 错误带 decisionSource（approval/browser/enterprise）；browser_navigation_blocked 等不可重试；文案硬编码反绕过：「must not attempt … via workaround, indirect execution, raw CDP …」 |
| 用户可调 | config.toml 四审批开关 + Rust origin policy（access/downloads/uploads/full_cdp/persistent_approval/allow_webmcp…） |
| 生命周期 | 插件 hooks 在 Stop/SubagentStop 调 `node_repl.turn_ended` 清理受控 tab |

## cua 面 browser 半边（与桌面合流）

同一 REPL 内：`getTab({mention|url|tabId}, {browser})` 要求唯一精确匹配、**绝不自动开替代 tab**；`createBrowserTab(id, url, {visible|sessionName})` 不支持的设置抛错；首次调用自动吐出该浏览器文档——**文档即能力协商**。云浏览器 id 固定 `"cdp"`（`CUA_REPL_BROWSER_ENV=cloud|orbit` 切换其指令）。

```js
let tab = await cua.getTab({ mention: tabMentionUrl });      // tab @-mention
let tab = await cua.createBrowserTab("iab", url, { visible: true });
let tab = await cua.createBrowserTab("chrome", url, { sessionName: "🔎 Task" });
```

## 传输通道与对照

| 通道 | 用途 |
|---|---|
| stdio MCP（cua_repl） | 模型 ↔ REPL |
| Native Messaging | Chrome 扩展 ↔ extension-host 宿主 |
| nodeRepl.nativePipe（信任服务） | JS ↔ browser-service / sky |
| 受限 CDP | tab.capabilities.cdp（origin 白名单 + 事件游标） |

与 ZCode 内置 browser use 的五维对照（后端数/CDP/凭据/反绕过/审计）见 [zcode 分册 browser-use.md](../zcode/browser-use.md)（ZCode 侧事实以该分册为准）。

本机不可见：云端 cdp 服务端（协议/实例生命周期）；browser-service 与宿主之间的管道帧格式（1.4MB minified 未逐段解包）【推断：与 sky 的 nativePipe 同族】；IAB 的 DOM/网络栈内部。
