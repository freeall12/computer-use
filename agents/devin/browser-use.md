# Devin Browser Use（浏览器控制）逆向

> 分析对象与口径同 [computer-use.md](computer-use.md)。Devin 的 browser use 同样是**云端执行、本地投影**：真正的浏览器跑在会话 VM 里，本地侧只有"代理、预览、接管"三种投影形态。证据见 [evidence/inventory.md](evidence/inventory.md)。

## TL;DR

1. **云端 BU 载体**：会话 VM 内 Chromium（"Interactive Browser"），人与 Devin 共用同一浏览器实例——人可在 "Browser" 标签（CU 启用后叫 "Computer"）直接接管，完成 SSO/MFA/CAPTCHA。
2. **登录态是头等公民**：`save_browser_profile` 工具把浏览器数据目录（cookies、`localStorage` 等 Chrome profile 数据）打包挂到 **org blueprint**，后续会话自动恢复登录；≤200MB、跳过 Chrome 密码库与缓存、不恢复扩展、需 Manage Org Blueprints 权限。
3. **程序化浏览器**：会话内固定暴露 CDP 端点 `http://localhost:29229`（desktop mode 开关与否均开放），官方明确支持 Playwright `connect_over_cdp` 附着——Devin 跑的 Playwright 脚本与它自己的浏览器共享状态（cookies/localStorage/auth 在脚本退出后保留）。
4. **本地 CLI 无浏览器工具**（与 CU 同源的三重负证据）。CLI 侧 BU 投影 = ① ACP 扩展能力位 `browser_preview`/`browser_preview_open`（本机三份日志实测为 true，方法名未公开）；② `devin mcp add` 外挂任意浏览器 MCP（如 Playwright 系）；③ `--cloud` 代理到云会话看结果。
5. **Devin Desktop（Windsurf 更名）的本地浏览器面 = Previews**："element selection, error capture, and direct integration with the agent"；底层通道在 exa proto 家族中可证：`exa.browser_preview_pb.BrowserPreviewService{SendDOMElement, SendScreenshot, SendConsoleOutput}`——是 IDE 内嵌预览→模型上下文的回灌通道，不是通用浏览器自动化。

## 1. 载体与拓扑

```
┌──────────────────────────────────────────────────────────────────┐
│ 云会话 VM（Linux 默认）                                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Chromium（Devin 的浏览器）                                    │  │
│  │  · Devin 自主驱动（导航/点击/填表/验证）                       │  │
│  │  · CDP :29229 ← Playwright connect_over_cdp（同状态附着）     │  │
│  │  · /home/ubuntu/.browser_data_dir（profile 恢复点）           │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│  · save_browser_profile → zip → org blueprint initialize 步骤    │
│  · Progress 标签统一记录 browser 活动                              │
└──────────────┬───────────────────────────────────────────────────┘
               │ ① 会话 UI 实时画面（人接管）  ② v3 API/ssh/forward
┌──────────────▼───────────────────────────────────────────────────┐
│ 本地                                                              │
│  · Devin CLI：无 browser 工具；ACP browser_preview 能力位（实测）   │
│    devin mcp add（stdio|http，OAuth）；--cloud；ssh/forward        │
│  · Devin Desktop：Previews（元素选择/错误捕获）→ agent              │
│    底层 gRPC：exa.browser_preview_pb（DOM 元素/截图/console）       │
└──────────────────────────────────────────────────────────────────┘
```

## 2. 云端浏览器工具面（文档口径，静态记录）

| 能力 | 内容 | 来源 |
|---|---|---|
| Interactive Browser | 会话 UI "Browser" 标签，"directly view and interact with Devin's browser and desktop environment"；用途列举：测试本地应用、视觉验证、auth/MFA、CAPTCHA、复杂导航 | devin-session-tools |
| 浏览器状态持久化 | "cookies/session data persist within a session"；可保存到 org blueprint 使未来会话带登录启动（blueprint 更新需批准） | devin-session-tools |
| `save_browser_profile` | "zips the browser data directory (cookies, `localStorage`, and other Chrome profile data)"；替换式更新 blueprint 的 initialize 步骤；恢复经 `$FILE_BROWSER_PROFILE` 解压到 `/home/ubuntu/.browser_data_dir` | browser-auth |
| 红线 | "Chrome's password store is skipped, along with caches"；不恢复扩展；profile ≤200MB；org 级共享（推荐服务账号）；密码类凭据应走 Secrets | browser-auth |
| CDP | "Chrome DevTools Protocol (CDP) endpoint on port **29229** (`http://localhost:29229`)"；"all state changes — cookies, localStorage, auth tokens — persist after the script exits" | computer-use |
| 替代路径 | Playwright 登录脚本放 `.agents/skills/`（入 git 版本管理）作为可脚本化登录 | browser-auth |

官方文档**未披露**：云 VM 内 Devrin 驱动浏览器的内部实现（无 Playwright MCP、无 VNC 字样）；浏览器属于 computer 工具域还是独立工具族（会话工具文档只以"标签"口径描述）。

## 3. 本地 CLI 的 BU 投影（实测）

### 3.1 ACP 扩展能力位（本机直接证据）

三份日志（09-11/16/18）的 ACP `initialize` 一致记录宿主（Devin Desktop/Windsurf）声明的能力：

```
ACP: client capabilities — terminal=false, terminal_auth=false, fs.read=true,
fs.write=true, subagents=true, elicitation=true, partial_content=true,
multi_root=true, grouped_options=true, windsurf_config=true, message_grouping=true,
raw_ref_tags=true, revert=true, wiki=false, request_diagnostics=true,
editor_context=true, terminal_context=false, mcp=true, plugins=true,
fast_context=true, subagent_control=true, workspace_dir_commands=false,
chains=false, browser_preview=true, browser_preview_open=true, clipboard_write=false
```

- `browser_preview=true, browser_preview_open=true`：宿主能为 agent 提供"网页预览"与"在浏览器中打开"两个扩展能力。标准 ACP 只有 `extMethod`/`extNotification` 扩展机制（agentclientprotocol.com），这两个能力对应的 Cognition 私有方法名未公开（推断存在 `cognition.ai/*` 命名空间下的方法，未证实）。
- 本机日志（含 gz 解包）实测了 7 个 `cognition.ai/*` 扩展方法：`document/didOpen`、`document/didFocus`、`workspace/didChangeFiles`、`skills/list`、`mcp/listServers`、`rules/list`、`revert/listSteps`——证明 `cognition.ai/` 扩展命名空间真实在用，browser preview 方法大概率同命名空间。

### 3.2 MCP 外挂（官方口径）

`devin mcp add <name>` 支持 `--transport stdio|http`、`--scope local|project|user`、OAuth（`devin mcp login/logout <name>`，token 存 `~/.local/share/devin/mcp/oauth/`——本机该目录存在且为空）。权限匹配器 `mcp__server__tool`/`mcp__server__*`/`mcp__*` 可对浏览器 MCP 做粒度控制；`Fetch(domain:)` 规则约束 agent 自带的 URL 访问。本机实测日志中 CLI 成功连接了 3 个用户自配的 streamable HTTP MCP server（主机名脱敏）。

### 3.3 云代理与直连

- `devin --cloud [prompt]`、`devin --cloud -r https://app.devin.ai/sessions/<id>`：把任务发到云会话（BU/CU 在那边执行）。
- `devin ssh <session>`、`devin forward <session> 8080:3000 [--gateway host[:port]]`：本地直连云机器，是人观测/干预浏览器（如访问会话内 localhost 服务）的通道。
- flags：`follower-mode-cloud-sessions`、`desktop-session-subscribers`、`enable-handoff`、`cascade-devin-local-send-as-fork`、`block-devin-local-from-cli`（本地/云会话互通有一整套门控）。

## 4. Devin Desktop（Cascade）的本地浏览器面

- 官方定位（desktop 文档索引）："**Devin Desktop Previews** — Preview your web app locally in Devin Desktop IDE or browser with **element selection, error capture, and direct integration with the agent**."
- 底层通道（本机第三方开源参考实现中转录的 exa proto，证据 D5）：

```proto
service BrowserPreviewService {
  rpc SendDOMElement   (.exa.browser_preview_pb.SendDOMElementRequest)   returns (…);
  rpc SendScreenshot   (.exa.browser_preview_pb.SendScreenshotRequest)   returns (…);
  rpc SendConsoleOutput(.exa.browser_preview_pb.SendConsoleOutputRequest) returns (…);
}
// SendDOMElementRequest{ dom_element: exa.codeium_common_pb.DOMElementScopeItem }
// SendScreenshotRequest{ image: exa.codeium_common_pb.ImageData }
// SendConsoleOutputRequest{ console_log: exa.codeium_common_pb.ConsoleLogScopeItem }
```

  即：预览页面的**选中 DOM 元素、截图、console 输出**三类信号回灌 agent 上下文——"元素选择 + 错误捕获"两个卖点与 proto 一一对应。
- 相关 feature flags（563 个缓存 flag 中筛选）：`cascade-windsurf-browser-control`、`CASCADE_WINDSURF_BROWSER_TOOLS_ENABLED`、`windsurf-browser-remote-debugging-port`、`windsurf-browser-screenshot-tracking`、`windsurf-browser-webdev-tracking`、`browser-interactions-num-implicit-steps`、`implicit-uses-open-browser-url`。命名暗示 Cascade 有"浏览器控制/隐式打开 URL"能力，但其执行体在 IDE 内嵌预览/语言服务器一侧（本机无二进制可进一步验证，标记为推断）。
- 另有 `@web`/`@docs`（Cascade Web and Docs Search）作为网页上下文获取的轻量形态。

## 5. 安全模型（BU 侧）

| 层 | 机制 |
|---|---|
| 凭据 | 浏览器密码库永不入 blueprint；密码走 Secrets；profile org 级共享需谨慎（"anyone in the org gets the logins, cookies, and session tokens in it"） |
| 接管 | 人随时在 Browser/Computer 标签接管（MFA/CAPTCHA 天然是人的活） |
| 网络（CLI） | `--sandbox` 时本地子进程流量强制过 loopback 代理，`allowed_domains`/`denied_domains`/`network_mode` 三参可控；deny 恒胜 allow |
| MCP | `mcp__server__*` 匹配器 + OAuth token 本地存储；org deny 规则不可被项目/用户配置覆盖 |
| 扩展 | blueprint 不恢复浏览器扩展（供应链风险隔离） |

## 6. 横向对照

- **zcode**：本地一等公民（IAB/extension/CDP 三后端、21+ Playwright 成员面）；Devin 相反——浏览器全在云里，本地只有能力位。
- **Cursor**：内置 Electron 浏览器 + 16 工具 + 合成 DOM 事件；Devin Desktop 的 Previews 只有"回灌"没有"驱动"。
- **Synara**：policy-guarded Playwright + CDP 黑名单；Devin 的对应物（若有）在云 VM 内不可考，但 CDP :29229 的"同状态附着"设计与 Synara 的 existing_profile 附件思路同源。
- **claude-code/codex**：两者本地浏览器能力（Claude in Chrome、@oai/browser-desktop）均强于 Devin CLI 的"零浏览器工具"形态。

## 7. 快速复核入口

```bash
# 1) ACP 能力位（找 browser_preview）
gunzip -c ~/.local/share/devin/cli/logs/devin_20260911-125208_13731.log.gz | grep -m1 browser_preview
# 2) cognition.ai 扩展方法实测
grep -hoE 'cognition\.ai/[a-zA-Z/]+' ~/.local/share/devin/cli/logs/*.log | sort -u
# 3) browser_preview_pb proto（本机第三方参考实现转录）
sed -n '1,30p' ~/Desktop/oh-my-pi/packages/ai/src/providers/devin/proto/exa/browser_preview_pb/browser_preview.proto
# 4) MCP OAuth 存储位（本机为空目录）
ls -la ~/.local/share/devin/mcp/oauth/
# 5) 官方文档
open https://docs.devin.ai/work-with-devin/devin-session-tools
open https://docs.devin.ai/work-with-devin/browser-auth
```
