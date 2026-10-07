# Grok 浏览器控制：本机零工具面，云端四件套

> 对象与方法同 [computer-use.md](computer-use.md)（Grok Bot 桌面端 0.66.0 + Grok CLI 1.0.46，只读静态逆向）。
> 证据行号：[evidence/inventory.md](evidence/inventory.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 桌面端本地 BU | **无工具面**（负证据判定，见 §6）——CU 执行体在本机 Helper，BU 执行体不在本机 |
| 云端 BU 四件套 | browser_subagent（默认开）+ 托管 MCP 目录 + box 沙箱 + Chrome cookie 逐 origin 导入 |
| 网络观察 | proto `web_search / fetch / web_fetch / x_search` + web bot auth 签名（默认开） |
| 人的介入 | noVNC computer 控制台：观看 + 键鼠介入 + 剪贴板同步（带回环抑制） |
| Grok CLI | 无原生 BU：仅 `web_search` / `web_fetch`（默认禁用），浏览器自动化靠 MCP 挂载 |
| 判定置信 | 高（多重独立负证据 + 云端协议证据互证） |

## 架构一图

```
对话/编排：云端 agent harness（ToolCall 68 工具位协议）
 │ browser_subagent（默认开）→ 服务端拉起浏览器子代理
 ▼
云端浏览器运行体（本机不可见）
 ├─ 远程计算机/VM（setup_vm_environment_tool_call #26 预置）
 ├─ box：docker cursor-box-computer MCP（SAND_BOX_COMPUTER_* 环境族）
 └─ 动作词汇复用 CU proto（click/type/scroll/screenshot…）
 ▼
宿主侧支撑面（Grok Bot 桌面端）
 ├─ cookie 导入：Finder 拷贝 Cookies → 逐 origin 审批（默认 deny）→ 上传
 ├─ web bot auth 签名（XHR/fetch 默认签）· 指纹伪装（默认关）· egressTunnel
 └─ 托管 MCP：浏览器类（如 Playwright）经 OAuth 接入
 ▼
人的观察/介入：noVNC 控制台（帧流 + 黑帧探针 + 剪贴板同步 + 键鼠）
```

## 1. 能力载体清单

| 载体 | 证据 / 路径 | 角色 |
|---|---|---|
| 浏览器子代理门 | flags：`browser_subagent` default **true**、`browser_subagent_gating` false、`browser_cpp_telemetry` true | 云端子代理开关（实现体在服务端） |
| 托管 MCP 目录 | 渲染端连接器 brand 图标表（slack/github/…/**playwright** 等 16+）+ `hosted_mcp_*` OAuth 通道；gate `browser_mcp_chip` default **true** | 第三方浏览器/站点自动化接入 |
| box 沙箱 | `boxComputer:{runtime:{containerName:"cursor-box-shared",…}, entry:…cursor-box-computer/dist/mcp.js}` | 容器化"计算机"（含浏览器）+ 独立 MCP server |
| cookie 导入 | `ChromeCookieImportPermissionError`、`probeHostChrome`、`importChromeCookies`；gate `sand_import_chrome_cookies` | 登录态供给线 |
| 审批通道 | coordinator：`/cookie-origin-approval/requests|responses`、决策 `approve-once/always-allow/deny`（默认 deny）、5 分钟超时 | 人审每个 origin |
| 网络观察 | proto #13/#19/#30/#67 + `sand_web_bot_auth_signing`（sign_xhr_fetch true / sign_iframes false） | 抓取 + 签名 + 搜索 |
| 远程计算机控制台 | `preload-vnc.cjs`（noVNC 注入/剪贴板/QEMU 键/帧节流）+ `vncProxy{primaryUrl,forkBaseUrl,networkToken}` | 观看/介入云端浏览器与桌面 |
| Grok CLI 网络面 | `~/.grok/README.md` 内置工具表：`web_search`（开）、`web_fetch`（`GROK_WEB_FETCH=1` 才开） | CLI 侧仅观察级 |

## 2. 对象模型：本地无公开面，接口形状三层

| 层 | 形状 | 本机可见性 |
|---|---|---|
| 云端工具位 | 浏览器任务不设独立 `browser_*` 位：观察拆 `web_search/fetch/web_fetch/x_search`，浏览器动作由云端子代理内部持有（走 CU 动作词汇/服务端内部面） | 仅存来源标签 `cursor-browser-extension` / `cursor-ide-browser` + `execBrowserOperationSource` 符号——"协议位在、实现云下" |
| box MCP | `cursor-box-computer/dist/mcp.js` 独立 MCP server（entry 可被 `SAND_BOX_COMPUTER_ENTRY` 覆盖） | 本机包未携带该 entry，运行时随 box 镜像分发 |
| 托管 MCP | 第三方浏览器自动化（Playwright 等）走标准 MCP + OAuth（`cloud_agent_interactive_mcp_auth` 等默认开） | 仅连接器目录与开关 |

## 3. 观察机制（浏览器侧）

- **页面观察在服务端**：截图/状态回传走 ToolCall result；本机可见的只有元观察 `browser_cpp_telemetry`（默认开）。
- **明暗两条抓取路线**：web bot auth 签名（默认开，自报家门）vs 指纹伪装 `sand_browser_fingerprint_spoof` + `sand_enable_spoof_gpu`（默认关）。
- **noVNC 观察质量工程**：黑帧五点采样探针、帧捕获 JPEG(0.7) 节流、`__sandVncFrameHold` minInterval 限速、liveness 心跳 10s×3。

## 4. 动作机制（浏览器侧）

- **人的介入动作**：noVNC 通道把 pointer/key 事件发往远程计算机（QEMU extended key events）；剪贴板 `box-vnc{readClipboard,writeClipboard}` 带回环检测防粘贴回声。
- **cookie 导入的"动作"是审批 UI**：`presentCookieOriginApproval` 列 origins 与 Chrome profile，三值决策（默认 deny）、5 分钟超时、malformed 帧拒绝——逐 origin 人审，非整 profile 静默导入。
- **本地执行体不存在**：无 CDP 连接管理、无合成 DOM 事件注入、无浏览器扩展 native messaging 宿主。

## 5. 安全模型（浏览器侧）

| 层 | 机制 |
|---|---|
| 登录态供给 | cookie 按 origin 审批、默认 deny、5 分钟时效；不经对话模型之手（审批是 daemon↔UI 专用帧协议，模型只见结果错误码） |
| 默认姿态 | `internal_browser_evaluate`、指纹伪装、`hosted_mcp_routing_enabled` 均默认关；签名默认开——"自报家门的礼貌抓取" |
| 本地工具权限伞 | 三档设置（Never / 每次问 / Always allow）罩住 Shell/Read/CopyToBox/CopyFromBox；关闭时提示模型"改用自己的计算机"——box/云端即兜底执行体 |
| noVNC | `novnc_port_token_min_version` 版本协商 + `networkToken` 网络令牌 + forkBaseUrl 主备链路 |
| CLI 侧 | `web_fetch` 域名白名单 + 逐域审批 + `--always-approve` 逃生口（仅本机用户自选） |

## 6. 负证据判定书（桌面端无本地 BU 工具面）

| 检索项 | 命中 | 结论 |
|---|---|---|
| `browser_click / browser_navigate / browser_snapshot` 等动词 | 0 | 无本地浏览器动词工具 |
| `chrome-devtools` / `remote-debugging-port` / `devtools://` | 0 | 无 CDP 附加/内嵌 devtools 痕迹 |
| `computer_browser / open_browser`（cua-driver 风格） | 0 | 无 trycua CDP 浏览器家族 |
| `browserView` 构造调用 | 0（仅遥测枚举） | 无内嵌浏览器面板 |
| `playwright` | 3（MCP 品牌图标 / `PLAYWRIGHT_BROWSERS_PATH` 缓存变量 / `playwright_autorun` flag） | 构建期与连接器痕迹，非本地驱动 |
| 工具来源注册表 | `cursor-browser-extension`、`cursor-ide-browser` 标签 + `execBrowserOperationSource` | 协议为扩展执行体预留，实现不在本机 |

**判定：桌面端 BU = 云端执行 + 本机支撑（登录态供给 / 签名抓取 / noVNC 介入）。**保留项：`cursor-browser-extension` 标签暗示未来/他端存在扩展执行体，本机未随包（与 Claude in Chrome、Kimi webbridge 同型的路线占位）。

## 7. 与已测 8 家对照

| 对照 | 结论 |
|---|---|
| Cursor | BU 同门同构：同一 asar 基座，browser_subagent/托管 MCP/box 即 Cursor 云浏览器栈的换牌 |
| Codex cdp / Cursor remote worker | 同属"云端浏览器"三架构之一（P8 第三型）；Grok 的云端浏览器对本机零控制 API——面收得更紧 |
| Synara / Kimi 登录态复用 | 同一问题的第三种解法：Synara 本地导入自有面板，Kimi 扩展+WS 复用真实浏览器，Grok "Finder 拷 Cookies + 逐 origin 云端上传"，代价是自动化权限 + 每次审批 |
| Qoder in-app 16 工具 MCP | 两种"面管理"哲学的极端对照：Qoder 把工具面钉死在客户端注册表，Grok 客户端只留来源标签与开关 |

## 8. Grok CLI 判定书

**无原生 BU（也无 CU），置信度高。**内置工具表 16 件无浏览器控制；二进制 93 处 `browser` 全部为 OAuth 登录文案；唯一浏览器自动化路径 = MCP（文档示例 puppeteer server）+ `web_fetch`（默认禁用、白名单+审批）。CLI 与桌面端是两套独立产品，不存在"CLI 借用桌面端浏览器能力"的代码路径证据。
