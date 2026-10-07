# Devin 的 Browser Use：云 VM 内 Chromium + CDP :29229，本地只有能力位

> 对象与口径同 [computer-use.md](computer-use.md)（只读静态取证 + 官方文档静态抓取）。证据见 [evidence/inventory.md](evidence/inventory.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 核心判定 | 真正的浏览器跑在会话 VM 里；本地侧只有"代理、预览、接管"三种投影 |
| 云端载体 | 会话 VM 内 Chromium（Interactive Browser），人与 Devin 共用同一实例 |
| 登录态 | `save_browser_profile` → org blueprint（≤200MB，密码库排除） |
| 程序化入口 | CDP `http://localhost:29229`（desktop mode 开关与否均开放，Playwright 可附着） |
| 本地 CLI | 零 browser 工具；投影 = ACP `browser_preview` 能力位 + MCP 外挂 + `--cloud` |
| 人接管 | "Browser" 标签（CU 启用后叫 "Computer"）直接上手 MFA/CAPTCHA |

## 架构一图

```
云会话 VM（Linux 默认）
 └─ Chromium：Devin 自主驱动 + CDP :29229 ← Playwright connect_over_cdp（同状态附着）
     /home/ubuntu/.browser_data_dir（profile 恢复点）
     save_browser_profile → zip → org blueprint initialize 步骤
 │ ①会话 UI 实时画面（人接管） ②v3 API / devin ssh / forward
 ▼
本地：CLI 无 browser 工具；ACP browser_preview / browser_preview_open 能力位（实测 true）
      devin mcp add（stdio|http，OAuth）；Desktop Previews 回灌（exa.browser_preview_pb）
```

## 1. 云端浏览器工具面（文档口径）

| 能力 | 内容 | 来源 |
|---|---|---|
| Interactive Browser | "Browser" 标签，"directly view and interact with Devin's browser and desktop environment"；用途：测试本地应用、视觉验证、auth/MFA、CAPTCHA、复杂导航 | devin-session-tools |
| 状态持久化 | "cookies/session data persist within a session"；可存 org blueprint 使未来会话带登录启动（blueprint 更新需批准） | devin-session-tools |
| `save_browser_profile` | "zips the browser data directory (cookies, `localStorage`, and other Chrome profile data)"；恢复经 `$FILE_BROWSER_PROFILE` 解压到 `/home/ubuntu/.browser_data_dir` | browser-auth |
| 红线 | Chrome 密码库与缓存被跳过；不恢复扩展；profile ≤200MB；org 级共享（推荐服务账号）；密码类凭据走 Secrets | browser-auth |
| CDP | 端口固定 29229；"all state changes — cookies, localStorage, auth tokens — persist after the script exits" | computer-use |
| 替代路径 | Playwright 登录脚本放 `.agents/skills/`（入 git）作为可脚本化登录 | browser-auth |

> 官方**未披露**：云 VM 内驱动浏览器的内部实现（无 Playwright MCP、无 VNC 字样）；浏览器属 computer 工具域还是独立工具族。

## 2. 本地 CLI 的 BU 投影（本机实测）

### 2.1 ACP 扩展能力位

```
browser_preview=true, browser_preview_open=true, clipboard_write=false,
mcp=true, subagent_control=true, …   （共 25 项，三份日志 09-11/16/18 一致）
```

- 两个能力位 = 宿主能为 agent 提供"网页预览"与"在浏览器中打开"。标准 ACP 只有 `extMethod`/`extNotification` 扩展机制——这是 **Cognition 私有扩展**，方法名未公开（推断在 `cognition.ai/*` 命名空间下，未证实）。
- 本机日志实测了 7 个 `cognition.ai/*` 方法（`document/didOpen`、`skills/list`、`revert/listSteps` 等），证明该私有命名空间真实在用。

### 2.2 MCP 外挂与云代理

| 通道 | 机制 | 本机证据 |
|---|---|---|
| `devin mcp add` | `--transport stdio\|http`、`--scope local\|project\|user`、OAuth（token 存 `~/.local/share/devin/mcp/oauth/`，本机该目录空） | 实连 3 个用户自配 streamable HTTP server |
| 权限匹配器 | `mcp__server__tool` / `mcp__server__*` / `mcp__*` 粒度控制；`Fetch(domain:)` 约束 URL 访问 | 权限文档 |
| `--cloud [prompt]` / `-r <session-url>` | 任务转交云会话（BU/CU 在那边执行） | commands 文档 |
| `devin ssh` / `forward <session> 8080:3000` | 本地直连云机器——人观测/干预浏览器（如会话内 localhost 服务）的通道 | commands 文档 |

## 3. Devin Desktop（Cascade）的本地浏览器面：Previews

**定位是"预览回灌"，不是浏览器自动化**——只有"看"，没有"驱动"。

官方口径（desktop 文档索引）："element selection, error capture, and direct integration with the agent"。底层通道在 exa proto 家族可证（证据 D5，本机第三方参考实现转录）：

| RPC（`exa.browser_preview_pb.BrowserPreviewService`） | 载荷 | 语义 |
|---|---|---|
| `SendDOMElement` | `exa.codeium_common_pb.DOMElementScopeItem` | 预览页选中的 DOM 元素 |
| `SendScreenshot` | `exa.codeium_common_pb.ImageData` | 截图 |
| `SendConsoleOutput` | `exa.codeium_common_pb.ConsoleLogScopeItem` | console 输出 |

三类信号 = "元素选择 + 错误捕获"两个卖点的 proto 对应物，全部回灌 agent 上下文。

> 相关 flags（563 个缓存 flag 中筛选）：`cascade-windsurf-browser-control`、`windsurf-browser-remote-debugging-port`、`windsurf-browser-screenshot-tracking`、`implicit-uses-open-browser-url` 等——命名暗示 Cascade 有浏览器控制/隐式打开 URL 能力，但执行体在 IDE 内嵌预览/语言服务器一侧（本机无二进制可验，**推断**）。另有 `@web`/`@docs` 作为网页上下文获取的轻量形态。

## 4. 安全模型（BU 侧）

| 层 | 机制 |
|---|---|
| 凭据 | 浏览器密码库永不入 blueprint；密码走 Secrets；profile org 级共享需谨慎（"anyone in the org gets the logins, cookies, and session tokens in it"） |
| 接管 | 人随时在 Browser/Computer 标签接管（MFA/CAPTCHA 天然是人的活） |
| 网络（CLI） | `--sandbox` 时本地子进程流量强制过 loopback 代理；`allowed_domains`/`denied_domains`/`network_mode` 三参可控；deny 恒胜 allow |
| MCP | `mcp__server__*` 匹配器 + OAuth token 本地存储；org deny 规则不可被项目/用户配置覆盖 |
| 扩展 | blueprint 不恢复浏览器扩展（供应链风险隔离） |

## 5. 横向对照

| 对照 | 差异一句话 |
|---|---|
| zcode | ZCode 浏览器是本地一等公民（IAB/extension/CDP 三后端）；Devin 相反——浏览器全在云里，本地只有能力位 |
| Cursor | Cursor 内置 Electron 浏览器 + 16 工具 + 合成 DOM 事件；Devin Desktop 的 Previews 只有"回灌"没有"驱动" |
| Synara | Synara policy-guarded Playwright + CDP 黑名单；Devin 的 CDP :29229"同状态附着"与其 existing_profile 思路同源 |
| claude-code / codex | 两家本地浏览器能力（Claude in Chrome、@oai/browser-desktop）均强于 Devin CLI 的"零浏览器工具" |

## 6. 快速复核入口

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
