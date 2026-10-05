# Block Goose：Browser Use（浏览器控制）完整逆向

> 分析基线：上游 `block/goose` v1.53.0（commit `5bd5e548`，2026-10-05，Apache-2.0）；本机无有效安装（见 [evidence/inventory.md §A](evidence/inventory.md)）。
> 本分册回答：Goose 有没有内置浏览器控制？官方推荐什么？挂载与管控机制是什么？

## 1. 结论先行

1. **判定：零内置，纯 MCP 外挂**。Goose 内核（`crates/`）不含任何 CDP/WebDriver/浏览器自动化代码；桌面端 Electron 的 webview 导航（`browser-backward` 等，`ui/desktop/src/main.ts:1488`）是 UI 壳，不暴露给 agent。唯一看似相关的 `goose-providers/src/browser_live_transport.rs` 是 **Live 语音 API 的 WebRTC 数据通道桥**（音频走媒体轨，此模块只搬协议消息），与浏览器自动化无关——已排除。
2. **官方姿态：文档收录 + deeplink 一键安装**。官方文档 MCP 目录收录 5 个浏览器控制扩展（全部第三方 MCP server）+ `fetch`（网页抓取）。安装即写 config.yaml，模型自动获得该 server 的全部工具——Goose 不改写、不包装、不重命名工具。
3. **浏览器控制走 CU 兜底**：Computer Controller 的 instructions 明示 `open https://example.com --app Safari`（打开 URL）、配合 `see --app Safari --annotate` + `click` 可驱动真实浏览器——官方教程示例即用此流程做"浏览器研究任务"。这是"CU 兜底 BU"的教科书形状（9 家分册中 MiniMax/Cursor 亦有此兜底）。
4. **无浏览器专用权限面**：浏览器扩展的工具与普通工具一样只受通用三层权限（GooseMode × permission.yaml × LLM 审查）约束；没有域名白名单、没有 `chromePermissionMode` 之类的浏览器权限语义（对比 Claude in Chrome 的按域授权）。

## 2. 官方收录的浏览器控制扩展（工具面归第三方所有）

以下均出自上游文档目录 `documentation/docs/mcp/`，Goose 侧只记录安装命令；**工具 schema 归各 MCP server 上游**，本仓库不再复刻：

| 扩展 | 安装命令（文档原文） | 能力定位 | 许可证/上游 |
|---|---|---|---|
| Playwright MCP | `npx -y @playwright/mcp@latest` | 跨 Chromium/WebKit 自动化，现代 web 测试（官方主推） | Microsoft，github.com/microsoft/playwright-mcp |
| Chrome DevTools MCP | `npx -y chrome-devtools-mcp@latest` | Chrome 自动化 + 性能测试 + web 调试 | Google，github.com/ChromeDevTools/chrome-devtools-mcp |
| Selenium MCP | `npx -y @angiejones/mcp-selenium` | 网页导航、表单填写（WebDriver 系） | 社区，github.com/angiejones/mcp-selenium |
| Puppeteer MCP | `npx -y @modelcontextprotocol/server-puppeteer` | 无头浏览器自动化（文档标注 unlisted，server 已 archived） | MCP 官方旧仓库 |
| Browserbase MCP | `npx -y @browserbasehq/mcp`（需 `BROWSERBASE_API_KEY` 等 env） | **云端**浏览器：导航、交互、抓取（本地无浏览器） | Browserbase 商业云 |
| （辅助）Fetch MCP | `uvx mcp-server-fetch` | 网页→markdown 抓取，非交互控制 | MCP 官方 servers 仓库 |

（`documentation/docs/mcp/` 另收 agentql/apify/firecrawl/exa/tavily 等抓取/搜索类扩展，属数据获取而非浏览器控制，不列入。）

**对照分册口径**：Goose 属于"BU 三架构"分类中的**外部浏览器 + 第三方 MCP** 路线（同路线实例：MiniMax 的 chrome-devtools-mcp 插件）；与"内嵌 WebView"（ZCode IAB/MiniMax 面板/Synara 面板）和"真浏览器扩展"（Claude in Chrome/Codex chrome 扩展）并列。Goose 是唯一**完全不做自研 BU 载体**的。

## 3. 挂载机制：扩展如何进入会话

| 环节 | 机制 | 证据 |
|---|---|---|
| 安装（CLI） | `goose configure → Add Extension`，或直接编辑 `~/.config/goose/config.yaml` `extensions:` 段 | `documentation/docs/getting-started/using-extensions.md` |
| 安装（桌面） | `goose://extension?cmd=…&arg=…&id=…&name=…&description=…&env=…` deeplink，一键弹安装确认 | 文档各 mcp 页 Quick Install；`ui/desktop/src/components/settings/extensions/deeplink.test.ts` |
| 配置形状 | `ExtensionConfig::Stdio { name, cmd, args, envs, env_keys, timeout, cwd, bundled, available_tools }` / `StreamableHttp { uri, … }`；SSE 已禁用（提示迁移 streamable_http） | `crates/goose/src/agents/extension.rs:156-216`、`config/extensions.rs:291-293` |
| 工具注入 | MCP client 连接后 list_tools，工具以 `<extension_name>__<tool>`（或平台约定前缀）注入模型；`available_tools` 可过滤 | `crates/goose/src/agents/extension.rs` |
| builtin 同形状 | builtin extension 同样走 MCP 协议（in-process duplex），模型侧无差别——`ExtensionConfig::Builtin` 变体 | `agents/extension.rs:179-192` |
| 平台级特例 | `ExtensionConfig::Platform`：agent 进程内直连（developer 等），不经 MCP 序列化 | `agents/extension.rs:194-206` |

## 4. 权限与管控（浏览器侧）

1. **通用三层**（详见 [computer-use.md §6](computer-use.md)）：GooseMode 四档 → 每工具 permission.yaml 三级 → LLM 审查（smart_approve 只读判定 / adversary mode ALLOW|BLOCK 复核）。浏览器工具的"导航/截图"会被 smart_approve 判为只读自动放行，"表单提交/点击下单"类不会。
2. **企业白名单 `GOOSE_ALLOWLIST`**：指向 YAML（`extensions: [{id, command}]`）的 URL，启用后只允许安装白名单内的 MCP server（按安装命令匹配）——管控的是**能装什么**，不是运行时行为。对浏览器场景即"只许装公司认可的 Playwright MCP、禁 Browserbase 云端出网"这类策略。
3. **无浏览器专属语义**：没有域名授权、没有 cookie/凭据隔离、没有 per-tab 审批——这些在 Claude in Chrome、Synara betterwright、MiniMax browser-core 里各有一整套，Goose 完全依赖所挂 MCP server 自身的安全实现。
4. **凭据红线外包**：例如 Browserbase 需要 `BROWSERBASE_API_KEY`，通过 `env_keys` 声明后由 goose 安全注入（keyring），模型不可见——这是 goose 侧唯一参与的浏览器相关安全机制。

## 5. CU 兜底 BU 的形状（Computer Controller 驱动浏览器）

官方教程（`documentation/docs/mcp/computer-controller-mcp.md`）的示例任务即此形态：

```
computer_control: app launch Safari --open https://www.youtube.com/results?search_query=classical+music
…（shell 工具做网络检索与 CSV 写盘）
computer_control: open ~/Desktop/ai-models-comparison.csv --app Numbers
```

要点：

- 打开 URL/站点用 `app launch --open` / `open --app <浏览器>`；
- 页内交互退化为屏幕控制：`see --app Safari --annotate` 拿元素 ID → `click --on B3` → `type`；
- 无 DOM 语义层（不读 HTML/无 selector），页面结构复杂时可靠性低于 CDP 系扩展——这正是 goose 官方同时收录 Playwright/Chrome DevTools 扩展的原因：**屏幕兜底 + CDP 主力的双轨**，与 MiniMax"嵌入式浏览器为主、chrome-devtools-mcp 插件为辅"同构，只是 Goose 连主力也是外挂的。

## 6. 本机未发现 / 不可用项（负结论）

- 本机无 goose 安装，因此**没有任何浏览器扩展的安装痕迹**（无 config.yaml、无 deeplink 安装记录）。
- 上游全仓（crates/ + ui/）grep `playwright|puppeteer|chrome-devtools|selenium`：Rust crates **零命中**；ui/desktop 的 `playwright.config.ts` 是 E2E 测试配置，与 agent 能力无关。
- `browser_live_transport.rs`（`crates/goose-providers/src/`）：Live 语音 WebRTC 桥，模块注释明言"browser-owned WebRTC data channels"指**网页端语音客户端**，非浏览器自动化——负证据，防止后来者误判。
- 桌面端无 Browser pane / in-app browser / framebuffer 式远程屏幕（对比 Claude 桌面端 `preview_*`/`framebuffer_*`）。
