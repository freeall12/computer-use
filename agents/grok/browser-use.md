# Grok Bot / Grok CLI Browser Use（浏览器控制）完整逆向

> 分析对象：Grok Bot 桌面端 0.66.0 + Grok CLI 1.0.46。
> 分析方式：只读静态逆向。未运行、未抓包、未触碰凭据。证据行号见 [evidence/inventory.md](evidence/inventory.md)。

## 0. TL;DR

1. **桌面端没有本地浏览器控制工具面**（负证据判定，§6）：全 dist 检索无 `browser_*` 动词工具、无 CDP/`remote-debugging-port`/chrome-devtools-mcp 痕迹、`browserView` 仅是进程遥测枚举。这与 CU 形成鲜明对比——CU 的执行体在本机 Helper 里，BU 的执行体**不在本机**。
2. **BU 是云端架构四件套**：① `browser_subagent`（默认开，云端浏览器子代理，工具定义不下发到客户端包）；② 托管 MCP 目录（`browser_mcp_chip` 默认开；渲染端内嵌 Playwright/Slack/GitHub/Linear/Notion 等连接器品牌图标目录 + `hosted_mcp_*` OAuth 通道）；③ box 沙箱计算机（docker `cursor-box-computer` MCP，`SAND_BOX_COMPUTER_*` 环境族 + `CopyToBox/CopyFromBox` 工具对）；④ **Chrome cookie 导入**——Finder AppleScript 拷贝 Chrome Cookies 文件、逐 origin 审批 UI（默认 deny）、收集上传，把本机登录态喂给云端浏览器。
3. 观察与取证通道内置：`sand_web_bot_auth_signing`（默认开）对 XHR/fetch 做 web bot auth 签名；`sand_browser_fingerprint_spoof`（默认关）+ `sand_enable_spoof_gpu` 指纹伪装选项；`internal_browser_evaluate`（默认关）作为内部逃生口。
4. **Grok CLI：无原生 BU**，仅内置 `web_search` / `web_fetch`（后者默认禁用）两个网络观察工具，浏览器操作靠 MCP 挂载（随包文档以 `@modelcontextprotocol/server-puppeteer` 为示例）。
5. 云端 CU 与 BU 在"远程计算机"上合流：computer 控制台（noVNC）既能看 CU 动作，也是云端浏览器子代理运行的虚拟桌面。

## 1. 能力载体清单

| 载体 | 路径 / 证据 | 角色 |
|---|---|---|
| 浏览器子代理门 | main-app.cjs flags：`browser_subagent` default **true**、`browser_subagent_gating` false、`browser_cpp_telemetry` true | 云端浏览器子代理开关（实现体在服务端） |
| 托管 MCP 目录 | 渲染端 index-*.js 连接器 brand 图标表（slack/github/gitlab/linear/notion/sentry/stripe/huggingface/upstash/**playwright**/atlassian/todoist/google/gmail/1password…）；`hosted_mcp_routing_enabled`、`mcp_oauth_hosted_loopback_callback`、`hosted_mcp_oauth_callback_min_version` | 第三方浏览器/站点自动化经托管 MCP 接入 |
| box 沙箱 | daemon：`boxComputer:{runtime:{shared,containerName:"cursor-box-shared",dockerHost,dockerPath}, entry:SAND_BOX_COMPUTER_ENTRY ?? …/cursor-box-computer/dist/mcp.js}` | docker 容器化"计算机"（含浏览器）+ 独立 MCP server |
| cookie 导入 | main-app.cjs：`ChromeCookieImportPermissionError`、`probeHostChrome`、`listCookieAllowItems`、`listProfiles`、`collectProfileCookies`、`importChromeCookies({cookies})`、gate `sand_import_chrome_cookies`；设置分区 `chrome-cookie-import` | 登录态供给线 |
| 审批通道 | node-agent-coordinator/main.cjs：`/cookie-origin-approval/requests|responses`、决策 `approve-once/always-allow/deny`（默认 deny）、5 分钟请求超时（`WH=300*1e3`）、Malformed 帧校验 | 人审每个 origin |
| 网络观察 | proto ToolCall：`web_search_tool_call`(#13)、`fetch_tool_call`(#19)、`web_fetch_tool_call`(#30)、`x_search_tool_call`(#67)；flags `sand_web_bot_auth_signing/sign_xhr_fetch/sign_iframes` | 抓取+签名+搜索 |
| 远程计算机控制台 | `preload-vnc.cjs`（noVNC 注入/剪贴板/QEMU 键/帧节流）、`vncProxy{primaryUrl,forkBaseUrl,networkToken}`、`novnc_port_token_min_version`、`sand_mobile_agent_computer_console` default true | 观看/介入云端浏览器与桌面 |
| Grok CLI 网络面 | `~/.grok/README.md` 内置工具表：`web_search`（内置开）、`web_fetch`（`GROK_WEB_FETCH=1` 才开，默认域名白名单+审批）、`search_tool/use_tool`（MCP 动态发现/调用） | CLI 侧仅有观察级 |

## 2. 架构分层与调用链（云端 BU）

```
┌───────────────────────────────────────────────────────────────────┐
│ 对话/编排（云端 agent harness；ToolCall 68 工具位协议）                │
│   browser_subagent（默认开）→ 服务端拉起浏览器子代理                  │
├───────────────────────────────────────────────────────────────────┤
│ 云端浏览器运行体（本机不可见）                                       │
│   · 远程计算机/VM（proto: setup_vm_environment_tool_call #26 预置）  │
│   · box：docker cursor-box-computer MCP（本机亦可为容器宿主）         │
│   · 动作词汇复用 CU proto（click/type/scroll/screenshot…）           │
├───────────────────────────────────────────────────────────────────┤
│ 宿主侧支撑面（Grok Bot 桌面端）                                      │
│   · cookie 导入：probeHostChrome →（Finder 拷贝 Cookies）→           │
│     presentCookieOriginApproval（逐 origin，默认 deny）→             │
│     importChromeCookies 上传（collect→profiles→去重计数遥测）        │
│   · web bot auth 签名（XHR/fetch 默认签，iframe 可选）               │
│   · 指纹伪装（默认关）· egressTunnel 出口隧道                        │
│   · 托管 MCP：浏览器类 MCP（如 Playwright）经 OAuth 接入             │
├───────────────────────────────────────────────────────────────────┤
│ 人的观察/介入                                                       │
│   · noVNC computer 控制台（桌面+手机）：帧流+黑帧探针+剪贴板同步      │
│     +键鼠介入+主机输入回环抑制；vncProxy 网络令牌                     │
│   · GrokBotTranscriptWatchFrame.computer_actions 实时动作帧          │
└───────────────────────────────────────────────────────────────────┘
```

## 3. 对象模型与 API 面

**没有本地公开的对象面**。静态可见的"接口形状"有三层：

1. **云端工具位**（proto）：浏览器任务不设独立 `browser_*` 工具位，而是拆成 `web_search / fetch / web_fetch / x_search`（观察）+ 云端子代理内部持有浏览器动作（走 CU 动作词汇 / 服务端内部面）。工具来源注册表（daemon）保留 `cursor-browser-extension` / `cursor-ide-browser` 两个**来源标签**与 `execBrowserOperationSource` 符号——说明协议为浏览器操作预留了来源标注位（扩展/IDE 浏览器执行体），但对应工具定义不在本机包内，属"协议位在、实现云下"。
2. **box MCP**：`cursor-box-computer/dist/mcp.js` 作为独立 MCP server（entry 可被 `SAND_BOX_COMPUTER_ENTRY` 覆盖；容器名 `cursor-box-shared` 可共享复用），本机包未携带该 entry——运行时随 box 镜像分发。
3. **托管 MCP**：第三方浏览器自动化（Playwright 等）走标准 MCP + OAuth（`cloud_agent_interactive_mcp_auth` 默认开、`mcp_multi_account` 默认开、`proper_well_known_for_mcp_scopes` 默认开）。

## 4. 观察机制（浏览器侧）

- 云端浏览器页面观察由服务端完成（截图/状态回传走 ToolCall result）；本机可见的是**元观察**：`browser_cpp_telemetry`（浏览器子代理遥测，默认开）。
- 抓取观察 `fetch/web_fetch` 配 `sand_web_bot_auth_signing`：对出站 XHR/fetch 附加 web bot auth 签名（默认含 XHR+fetch，iframe 默认不签）——面向"bot 可验证身份"的抓取路线，与指纹伪装（`sand_browser_fingerprint_spoof`+`sand_enable_spoof_gpu`，默认关）构成**明暗两条抓取路线**。
- noVNC 控制台的观察质量工程：黑帧五点采样探针（判定画面真正在更新）、帧捕获 JPEG(0.7) 节流、`__sandVncFrameHold` 对 noVNC fbUpdateRequest 的 minInterval 步进限速、liveness 心跳 10s×3。

## 5. 动作机制（浏览器侧）

- 云端子代理内部动作（本机不可见）+ **人的介入动作**：noVNC 通道把 pointer/key 事件发往远程计算机（QEMU extended key events；剪贴板 `box-vnc{readClipboard,writeClipboard}` 带回环检测，主机复制的文本与 VM 内文本互斥抑制，防粘贴回声）。
- cookie 导入的"动作"是审批 UI：`presentCookieOriginApproval` 弹窗列出 origins 与 Chrome profile，决策三值（approve-once/always-allow/deny，默认 deny），请求 5 分钟超时、malformed 帧拒绝、结果经 `/cookie-origin-approval/responses` 回传 coordinator——安全模型是**逐 origin 人审**而非整 profile 静默导入。
- 本地执行体不存在：无 CDP 连接管理、无合成 DOM 事件注入代码、无浏览器扩展 native messaging 宿主。

## 6. 负证据判定书（桌面端无本地 BU 工具面）

| 检索项 | 命中 | 结论 |
|---|---|---|
| `browser_click / browser_navigate / browser_snapshot` 等 `browser_*` 动词 | 0 | 无本地浏览器动词工具 |
| `chrome-devtools` / `remote-debugging-port` / `devtools://` | 0 | 无 CDP 附加/内嵌 devtools 痕迹 |
| `computer_browser / open_browser`（cua-driver 风格家族名） | 0 | 无 trycua CDP 浏览器家族 |
| `browserView` 构造调用 | 0（仅遥测枚举 `["background_page","browser_view","remote","webview","offscreen","unknown"]`） | 无内嵌浏览器面板 |
| `playwright` | 3（MCP 品牌图标 / `PLAYWRIGHT_BROWSERS_PATH` 缓存变量 / `playwright_autorun` flag） | Playwright 是连接器与构建期痕迹，非本地驱动 |
| 工具来源注册表 | `cursor-browser-extension`、`cursor-ide-browser` 标签 + `execBrowserOperationSource` 符号 | 协议为扩展执行体预留，实现不在本机 |

**判定**：桌面端 BU = 云端执行 + 本机支撑（登录态供给 / 签名抓取 / noVNC 介入）。置信度高（多重独立负证据 + 正向的云端协议证据互证）。保留项：`cursor-browser-extension` 来源标签暗示未来/他端存在扩展执行体，本机未随包（与 Claude in Chrome、Kimi webbridge 同型的路线占位）。

## 7. 安全模型（浏览器侧）

1. **登录态供给最小心智**：cookie 按 origin 审批、默认 deny、五分钟时效、请求可取消；不经对话模型之手（审批通道是 daemon↔桌面 UI 的专用帧协议，模型只看到结果错误码，如 "Chrome cookie approval could not be completed on this computer."）。
2. **默认关的高权能力**：`internal_browser_evaluate`、`sand_browser_fingerprint_spoof`、`hosted_mcp_routing_enabled` 均默认关；web bot auth 签名默认开——默认姿态是"自报家门的礼貌抓取"。
3. **本地工具权限伞复用**：本地工具三档设置（"Never / 每次问 / Always allow"，Settings → Bot → Execution on Local Computer）罩住 Shell/Read/AwaitShell/CopyToBox/CopyFromBox；关闭时的模型提示文案明示"改用自己的计算机（省略 machineId）"——box/云端路径即兜底执行体。
4. **noVNC 令牌化**：`novnc_port_token_min_version` 版本协商 + `networkToken` 网络令牌 + forkBaseUrl 主备链路，控制台不裸暴露 VNC 端口。
5. **CLI 侧**：`web_fetch` 域名白名单 + 逐域审批 + `--always-approve` 逃生口；权限模式 `always-approve` 仅是本机用户自选配置。

## 8. 与已测 8 家对照

- **与 Cursor**：BU 同门同构（同一 asar 基座；`browser_subagent`、托管 MCP、box 沙箱即 Cursor 云浏览器栈的换牌；`cursor-browser-extension` 标签对应 Cursor 的浏览器扩展路线）。
- **与 Codex cdp / Cursor remote worker**：同属"云端浏览器"三架构之一（仓库模式 P8 第三型）；差异是 Grok Bot 的云端浏览器没有向本机暴露任何控制 API——面收得比 Codex iab/cdp 四后端更紧。
- **与 Synara cookie 导入 / Kimi webbridge 复用登录态**：同一问题（云端浏览器如何带上用户会话）的第三种解法——Synara 用 rookie-cookies 本地导入自有面板，Kimi 用扩展+WS 复用真实浏览器，Grok Bot 用"Finder 拷贝 Cookies 文件 + 逐 origin 云端上传"，代价是 macOS 自动化权限 + 每次审批。
- **与 Qoder in-app 16 工具 MCP**：Qoder 把浏览器工具面完整钉死在客户端注册表；Grok Bot 相反，客户端只留来源标签与开关——两种"面管理"哲学的极端对照。

## 9. Grok CLI 判定书

**无原生 BU（也无 CU）**，置信度高：内置工具表 16 件无浏览器控制；二进制 93 处 `browser` 全部为 OAuth 登录文案；唯一浏览器自动化路径 = MCP（文档示例 puppeteer server）+ `web_fetch`（默认禁用、白名单+审批）。CLI 与桌面端是两套独立产品（不同二进制、不同工具协议、不同会话存储），不存在"CLI 借用桌面端浏览器能力"的代码路径证据。
