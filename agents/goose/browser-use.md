# Goose 的 Browser Use：零内置，纯 MCP 外挂生态

> 分析基线同 [computer-use.md](computer-use.md)（上游 v1.53.0；本机无有效安装）。证据见 [evidence/inventory.md §D](evidence/inventory.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 判定 | **零内置，纯 MCP 外挂**——Rust 内核无任何 CDP/WebDriver/浏览器自动化代码 |
| 官方姿态 | 文档收录 5 个浏览器控制扩展 + `goose://extension` deeplink 一键安装 |
| 兜底路线 | CU 驱动真实浏览器（`app launch Safari --open` + `see --annotate` + `click`） |
| 权限 | 无浏览器专属语义——只受通用三层权限约束 |
| 安全归属 | 完全依赖所挂 MCP server 自身的安全实现（cookie/凭据隔离皆无） |
| 本机 | 无任何浏览器扩展安装痕迹（无 config.yaml） |

## 架构一图：扩展如何进入会话

```
安装：config.yaml extensions 段 ／ goose://extension?cmd=…&id=… deeplink（桌面弹确认）
        │
        ▼
ExtensionConfig::Stdio{cmd,args,envs,env_keys,timeout,…} 或 StreamableHttp{uri}
        │  MCP client 连接 → list_tools
        ▼
工具以 <extension_name>__<tool> 注入模型（available_tools 可过滤）
        │  ——Goose 不改写、不包装、不重命名任何工具
        ▼
第三方 MCP server 自持执行层：
 Playwright MCP ／ Chrome DevTools MCP ／ Selenium MCP ／ Browserbase（云端）／ fetch
```

## 1. 判定：零内置的三条证据

1. **内核零自动化代码**：crates/ 全树 grep `playwright|puppeteer|chrome-devtools|cdp` 无实现命中；桌面端 webview 导航（`browser-backward`）是 UI 壳，不暴露给 agent。
2. **唯一疑似项已排除**：`goose-providers/src/browser_live_transport.rs` 是 **Live 语音 API 的 WebRTC 数据通道桥**（模块注释明言 "browser-owned WebRTC data channels" 指网页端语音客户端）——防止后来者误判的负证据。
3. **无 Browser pane**：桌面端无 in-app browser / framebuffer 式远程屏幕（对比 Claude 桌面端 `preview_*`）。

## 2. 官方收录的浏览器控制扩展（工具面归第三方所有）

| 扩展 | 安装命令 | 能力定位 | 上游 |
|---|---|---|---|
| Playwright MCP | `npx -y @playwright/mcp@latest` | 跨 Chromium/WebKit 自动化（官方主推） | Microsoft |
| Chrome DevTools MCP | `npx -y chrome-devtools-mcp@latest` | Chrome 自动化 + 性能 + 调试 | Google |
| Selenium MCP | `npx -y @angiejones/mcp-selenium` | 导航、表单填写（WebDriver 系） | 社区 |
| Puppeteer MCP | `npx -y @modelcontextprotocol/server-puppeteer` | 无头浏览器（unlisted，server 已 archived） | MCP 官方旧仓库 |
| Browserbase MCP | `npx -y @browserbasehq/mcp`（需 `BROWSERBASE_API_KEY`） | **云端**浏览器：导航/交互/抓取 | Browserbase 商业云 |
| （辅助）Fetch MCP | `uvx mcp-server-fetch` | 网页→markdown 抓取，非交互控制 | MCP 官方 |

> 架构定位：BU 三架构中的**外部浏览器 + 第三方 MCP** 路线（同路线：MiniMax 的 chrome-devtools-mcp 插件）；Goose 是唯一**完全不做自研 BU 载体**的。文档目录另收 agentql/apify/firecrawl/exa/tavily 等抓取/搜索类扩展，属数据获取而非浏览器控制，不列入。

## 3. 挂载机制

| 环节 | 机制 | 证据 |
|---|---|---|
| 安装（CLI） | `goose configure → Add Extension`，或直接编辑 config.yaml | using-extensions.md |
| 安装（桌面） | `goose://extension?cmd=…&arg=…&id=…&name=…&env=…` deeplink 一键确认 | deeplink.test.ts |
| 配置形状 | `ExtensionConfig::{Stdio, Builtin, Platform, StreamableHttp}`；SSE 已禁用（迁移 streamable_http） | `agents/extension.rs:156-216` |
| builtin 同形状 | builtin extension 同样走 MCP 协议（in-process duplex），模型侧无差别 | `extension.rs:179-192` |
| 平台级特例 | `ExtensionConfig::Platform`：agent 进程内直连（developer 等），不经 MCP 序列化 | `extension.rs:194-206` |

## 4. 权限与管控：企业白名单是唯一硬闸

- **通用三层**（详见 [computer-use.md §6](computer-use.md)）：GooseMode 四档 → permission.yaml 三级 → LLM 审查。"导航/截图"会被 smart_approve 判只读放行，"表单提交/点击下单"不会。
- **企业白名单 `GOOSE_ALLOWLIST`**：指向 YAML（`extensions: [{id, command}]`）的 URL，启用后只许安装白名单内 MCP server（按安装命令匹配）——管控**能装什么**，非运行时行为。
- **凭据红线外包**：如 Browserbase 的 `BROWSERBASE_API_KEY` 经 `env_keys` 声明后由 goose 安全注入（keyring），模型不可见——goose 侧唯一参与的浏览器安全机制。
- **无浏览器专属语义**：没有域名授权、没有 cookie/凭据隔离、没有 per-tab 审批（对比 Claude in Chrome 按域授权）。

## 5. CU 兜底 BU 的形状（官方教程即此形态）

```
computer_control: app launch Safari --open https://www.youtube.com/…search_query=…
…（shell 工具做网络检索与 CSV 写盘）
computer_control: open ~/Desktop/ai-models-comparison.csv --app Numbers
```

- 页内交互退化为屏幕控制：`see --app Safari --annotate` 拿元素 ID → `click --on B3` → `type`。
- 无 DOM 语义层（不读 HTML、无 selector），页面复杂时可靠性低于 CDP 系扩展——这正是官方同时收录 Playwright/DevTools 扩展的原因：**屏幕兜底 + CDP 主力的双轨**（与 MiniMax 同构，只是 Goose 连主力也是外挂的）。

## 6. 本机未发现 / 不可用项（负结论）

- 本机无 goose 安装，**没有任何浏览器扩展安装痕迹**（无 config.yaml、无 deeplink 安装记录）。
- 上游全仓 grep 浏览器自动化关键词：Rust crates 零命中；ui/desktop 的 `playwright.config.ts` 是 E2E 测试配置，与 agent 能力无关。
- `browser_live_transport.rs` 为 Live 语音 WebRTC 桥（见 §1 证据二）——已排除的负证据。
