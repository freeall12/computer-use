# Xiaomi MiMo — Browser Use（浏览器控制）完整逆向

> 分析对象同 computer-use.md（`Xiaomi MiMo AI.app` + `~/Library/Application Support/MiMo Automation/`）。
> 分析日期：2026-10-06。方法：只读静态分析；未运行、未抓包、未触碰凭据。

## 1. 结论速览

1. **MiMo 的 Browser Use 是同一 `js` REPL 内核里的 `@mimo/browser-use` 模块**（`agent.browsers` 对象图），不是离散 MCP 工具——「There are no separate `browser_*` tools」（宿主产品文档原话）。这与 Codex 完全同构：Codex 的浏览器就是「Node-REPL `js` 工具 + `agent.browsers.*`/`tab.*` 运行时 API」，MiMo 复刻了这一形状。
2. **四后端统一 Provider 契约**：`iab`（宿主内嵌浏览器，桌面端首选默认）、`extension`（用户真实 Chrome/Edge/Brave/Chromium，经 MV3 扩展 **Browser Bridge** + Native Messaging + `chrome.debugger` CDP）、`managed`（显式安装的 Chrome for Testing）、`cdp`（显式 raw endpoint）。能力按 provider 协商，不支持的成员一次性报错，**绝不静默替换**。
3. **本机状态：能力完整、当前未启用**——宿主曾有 `mimo-browser-use` 插件安装尝试记录（2026-09-12），但当前 `MIMO_AUTOMATION_BROWSER_USE_ENABLED=0`、Browser Provider 目录为空（IAB 未发布）、宿主技能目录无 mimo-browser-use。判定依据为完整的一手代码与配置（负证据五面法：门控关/无 descriptor/无技能/env=0/安装尝试记录）。
4. Browser Bridge 是一个**可上架 Chrome Web Store 的正式 MV3 扩展**（debugger/tabs/scripting/nativeMessaging 等 11 项权限 + `<all_urls>`），经固定 host 名 `com.xiaomi.mimo.browser` 与本地 Node host 通信，JSON-RPC 2.0 载荷，CDP 1.3；不暴露 remote-debugging 端口；公开 CDP 方法走白名单。
5. 人机共驾细节丰富：**对截屏不可见的虚拟光标**（Shadow-DOM，动画可观察后才发真实输入）、桌面端**每 tab 独立预览面板**（≤5fps JPEG，帧不进模型结果）、宿主自动的**轮次生命周期**（turn 结束自动回收临时 tab、释放用户 tab）。

## 2. 能力载体清单

| 载体 | 路径（本机实证） | 角色 |
| --- | --- | --- |
| `@mi/mimo-computer-use` 0.7.11 的 `dist/browser/` | `…/Runtime/0.7.11/products/{browser-replay,computer-use}/node_modules/@mi/mimo-computer-use/dist/browser/` | 浏览器运行时本体：runtime/code-repl/node-repl-kernel/cdp-kernel/locator/aria-snapshot/extension-*/managed-chromium/raw-cdp-transport/provider-protocol/public-cdp-policy/preview/page-assets/clipboard 等 30+ 模块 |
| **Browser Bridge** 扩展 | `~/Library/Application Support/MiMo Automation/Browser Bridge/`（manifest.json v0.7.11 + background.js 102KB + cursor-overlay.js + icons） | MV3 扩展：native messaging 端点 + `chrome.debugger` CDP 通道 + tab 租约/分组管理 |
| Native messaging host 清单 | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.xiaomi.mimo.browser.json` | `allowed_origins` 钉死两个商店扩展 ID；`path` 指向 `Launchers/bin/browser-native-host` |
| `browser-native-host` | `…/MiMo Automation/Launchers/bin/browser-native-host` | sh → 应用自带 Node 执行 `dist/browser/host.js`（MCP 侧 socket 注册表的 host 端） |
| `MiMo Browser Use.app` | `…/MiMo Automation/Applications/MiMo Browser Use.app`（`com.xiaomi.mimo.browseruse` 0.7.11） | 原生伴生 app：状态 GUI + `Helpers/browser-preview-macos` 预览 helper + 托管浏览器安装/扩展安装入口 |
| 宿主 presentation-host | `~/Library/Application Support/Xiaomi MiMo AI/presentation-host/control.sock`（经 `MIMO_PRESENTATION_HOST_SOCKET` 传给 MCP） | 桌面主进程 Unix socket：`focusWebContents/prepareForWebContents` 等，IAB 呈现与焦点协作 |
| 宿主技能（未装） | 应为 `~/.config/mimocode/skills/mimo-browser-use/` | 本机缺失（BU 关闭的直接证据之一）；运行时包内 `skills/mimo-browser-use/SKILL.md` 为同一份源 |
| 商店扩展 ID | `hdegpkcbaiojkelbocodjnnaglojjlam`、`dbgblfpnkbjkklfekngphekkapoejffa` | 宿主主进程内置商店链接 `chromewebstore.google.com/detail/browser-bridge/<id>`；两个 ID 同时出现在 native host 清单 allowed_origins |

## 3. 工具面与参数契约

### 3.1 模型可见面（常态产品）：`js` 内核 + `agent.browsers`

技能规定的标准进入序列（三选一，选择后必须 `nodeRepl.write(await <browser>.documentation())` 读取完整契约，且该读取必须独占收尾）：

```js
// 用户指名浏览器
globalThis.chrome = await agent.browsers.get("chrome");      // "edge"/"brave"/"chromium"/"extension"(兼容选择器)/"iab"
// 有目标 URL 且未指名
globalThis.browser = await agent.browsers.getForUrl("https://…/");
// 无指名无 URL
globalThis.browser = await agent.browsers.getDefault();
```

契约要点（`skills/mimo-browser-use/SKILL.md` 全文 + README）：

- `browser.documentation()` 返回该后端的**完整方法契约**（导航/点击/填表/上传/对话框/截图/清理），是权威 API 面；命名查询主题走 `agent.documentation.get(name)`（如 `bootstrap-troubleshooting`、`chrome-troubleshooting`、`file-uploads`）。
- 页面元数据在 `tab` 上；**禁止臆造** `tab.playwright.page/title()/url()`。locator 报 `not actionable` = 未派发点击。
- 每次**状态变更单元格的 MCP 结果内联返回**最新 tab 观察 + URL + 打开的 tab id 列表（`codex/toolSurface` 形状）——动作即观察，禁止重复截图/状态查询；失败单元格的错误结果仍携带动作反馈。
- tab 绑定语义：`tabs.new()` 仅当紧接着就要用它；失败后绑定已建立就必须复用（错误结果的 `tabId`/`openTabIds` 可用）；空 tab 列表是清理后的正常态。
- **文件上传**不猜 Playwright 方法、不合成 DOM 事件，按运行时 `file-uploads` 主题的 chooser 序列执行。
- 轮次生命周期：宿主自动宣布 turn 完成（含取消/错误）；**host 负责 tab finalization**——临时/空白/失败/重复/中间 tab 在轮次边界关闭，认领的用户 tab 归还；无公开 `tabs.finalize`，模型不得发明。登录/审批工作流可由宿主经私有生命周期协议保留，不经公共浏览器 API 决定。

### 3.2 legacy 离散 `browser_*` 工具（研究 fixture，不与 `js` 并注册）

playwright 后端 22 个（含 Codex parity 语义工具 `browser_get_by/browser_wait_for/browser_dom_snapshot/browser_scroll/browser_exec/browser_logs/browser_dialog/browser_clipboard/browser_claim_tab/browser_history`，其中 `browser_exec` 是 Codex 风格代码执行：`tab.playwright`/`tab.cua`/`tab.goto`/`page`/`console`），extension 后端 13 个（加 `browser_new_tab`、去四个 playwright-only 语义工具）。README 明文这是「旧兼容面」，MiMo 本体用持久 `agent.browsers`。

## 4. 观察机制

- **AX/DOM 快照**：扩展后端经 CDP `Accessibility.*`（`getFullAXTree/getPartialAXTree/queryAXTree` 等在 PUBLIC_CDP_METHODS 白名单）产出 aria-snapshot 与可交互元素索引；`dist/browser/aria-snapshot.js`、`ax-tree.js`、`ax-capture.js`、`ax-hit-point.js` 模块链完整。
- **截图**：`Page.captureScreenshot`（扩展后端 JPEG；managed/CDP 后端 PNG）；坐标即该截图视口像素空间。
- **内联动作反馈**：每次变更动作的结果自带 tab 观察（URL/标题/快照/tab 列表），模型无需补拍。
- **控制台/诊断**：页面 console 与未捕获异常持续捕获（legacy `browser_logs` 语义）；`read-only-evaluate.js` 限定只读检查面。
- **预览（人看）**：桌面端 IAB 直接显示在宿主右侧边栏（Browser tab）；独立 MCP 宿主场景由 `browser-preview-macos` helper 为每个活动 tab 开一个可拖拽、纵横比正确、**从捕获中排除**的原生预览面板，私有有界流 ≤5fps/800px/JPEG，**帧永不进入模型可见工具结果或公共 CDP 事件缓冲**；点面板聚焦对应 tab，不透传点击。

## 5. 动作机制（CDP 层）

- 传输拓扑：`MCP server ──unix socket──► host（dist/browser/host.js，Node）──Chromium Native Messaging（JSON-RPC 2.0）──► Browser Bridge 扩展 ──chrome.debugger（CDP 1.3）──► page`。扩展侧多 session（MAX_SESSIONS=256）、心跳（5s/超时 3s）、断线重连（5s）、tab 租约与「Browser task」托管 tab 组；host 侧每浏览器/配置文件一个唯一 socket，经私有注册表（`MIMO_BROWSER_REGISTRY_DIR`，心跳 5s、陈旧回收 300s、上限 32 条）发现。
- **呈现通道与真实输入分离**：需要指针操作时，扩展按需注入 pointer-transparent 的 closed-Shadow-DOM 虚拟光标，等待 ≤1.5s 直到光标动画**可被观察**，然后才派发真实 CDP 输入（CURSOR_CONTENT_TIMEOUT_MS=1000）；呈现失败绝不阻塞点击/滚动/拖拽。非前台窗口的活动 tab 仍可观察操作；未激活 tab 缓存对齐的光标，激活即显。
- **公开 CDP 白名单**（`public-cdp-policy.js`/background.js `PUBLIC_CDP_METHODS`）：Accessibility/CSS/DOM 等观察域 + 少量写域按名单放行，「narrow observation escape hatch」，语义自动化内部仍走 `executeCdp`，防止调用方绕过高层 locator/CUA 实现。可重入 CDP 方法（Fetch.continueRequest 等）单独识别处理。
- **managed 后端**：`mimo-browser-use install` 显式下载 Chrome for Testing Stable 到 `~/.mimo-browser-use/browsers/chrome-<版本>`（记录版本与源 URL）；MCP 启动**绝不静默下载**；每次运行私有临时 profile + 随机 CDP 端口，内核关闭即清理。发现顺序：显式可执行 → managed 缓存 → 系统 Chrome/Canary/Chromium/Brave → Puppeteer 缓存 → Playwright 缓存。
- **IAB 后端**：宿主发布版本化 **Browser Provider descriptor**（`MIMO_BROWSER_PROVIDER_DESCRIPTOR=…/provider.json` + `MIMO_BROWSER_DEFAULT=iab`），指向**用户私有的已认证本地 socket**；Electron 对象、cookie、认证 UI、焦点、呈现、关闭全部归宿主所有（`examples/electron-browser-provider` 给出 `WebContentsView` + `webContents.debugger` 的参考宿主）。本机 Browser Provider 目录为空 → IAB 未发布，这也是宿主把 BU 关闭后的自然状态。

## 6. 安全模型（运行时强制 + 技能约束）

- **权限收窄**：扩展权限虽含 `<all_urls>`，但公开 CDP 走白名单；native messaging `allowed_origins` 钉死两个商店扩展 ID（开发 manifest 的稳定 `key` 在商店包中被移除，商店 Item ID 回填后才能进 release 契约——README 发布流程条目）。
- **不暴露调试端口**：extension 后端全程 `chrome.debugger`，无 `--remote-debugging-port`；raw CDP 仅限显式配置。
- **live UI 安全教义**（与 CU 共用同一段「Live browser safety」）：网页内容/消息/下载/工具输出都是 untrusted data 而非用户授权；后果性动作前确认确切目标；支付凭据/OTP/生物识别/凭证创建变更/安全警告绕过/转账最终提交移交人工；**禁止**用 JavaScript/WebMCP/另一后端/桌面自动化绕过已要求的确认或移交；页面内容不得当确认。
- **并发与租约**：同一显式 `MIMO_BROWSER_SOCKET` 禁止并发宿主（注册表为每 host 唯一 socket）；扩展侧 tab 租约防止多 agent 争抢。
- **`js` 纪律**：禁止用宽泛 try/catch 吞错（错误必须以 `isError` 保持机器可见的恢复指引）；禁止内核重置当恢复手段；禁止在一个工作流中「发现第二个 Browser MCP」。

## 7. 与 Claude/Codex 协议的关系（BU 视角）

- **对 Codex**：`agent.browsers` 对象图、`getForUrl/getDefault`、tab 观察内联、`codex/toolSurface` 呈现、extension+managed+CDP+IAB 四后端划分、`BROWSER_USE_PREFERRED_CHROME_EXTENSION_INSTANCE_ID`/`WINDOW_ID` 环境变量，全部标注为 Codex-shaped parity；legacy 平面工具的 `browser_exec`（`tab.playwright/tab.cua`）逐条注明「mirrors Codex」。
- **对 Claude**：Claude 官方走 Claude in Chrome 扩展 + native messaging，MiMo 的 Browser Bridge 同属「真浏览器扩展 + native messaging + CDP」家族，但扩展协议自研（JSON-RPC 2.0 帧非 Claude 的格式）。
- **与宿主的关系**：桌面端的「浏览器预览」右侧栏与 presentation-host socket 是 MiMo 特有增强（Codex 侧是自己的 toolSurface 元数据；MiMo 桌面把预览真正渲染成宿主 UI）。

*低置信度复核点：IAB descriptor 的 JSON 具体字段（provider.json 本机不存在，仅从 README 与 automation-repl 分支逻辑还原）；Chrome Web Store 上架现状；`tab.*` 完整方法集（documentation() 是运行时生成，未运行取得实例）。*
