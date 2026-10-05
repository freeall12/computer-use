# OpenAI Codex：Computer Use 与 Browser Use 逆向总览

> 结论均出自对本机安装（macOS arm64）的只读静态分析：npm 包 `@openai/codex@0.155.1`（Rust 二进制）、
> 桌面宿主 `ChatGPT.app`（Codex Desktop 形态，构建 26.930.31730，内含 codex-cli 0.160.0）、
> `~/.codex/` 配置与插件缓存、以及安装在 `~/.codex/computer-use/` 的 Sky CUA 服务。
> 分篇：[computer-use.md](computer-use.md)（桌面控制）｜[browser-use.md](browser-use.md)（浏览器控制）｜[evidence/inventory.md](evidence/inventory.md)（全部证据）。
> 标注约定：**实证** = 文件/二进制/文档直接可见；**推断** = 旁证推导，需复核。

## TL;DR

1. **Codex 的"computer use"与"browser use"不是两个工具，而是一个运行时的两个表面。** 桌面端由 `unified-computer-use` 插件把 `cua_repl`（一个持久 Node REPL 的 MCP server）暴露给模型，工具只有 `js / js_reset / turn_ended`；REPL 启动即执行 `await import("@oai/cua/tinyskyAlt")`，得到一个统一的 `cua` 全局对象，其上 `getApp/listApps/...` 是桌面半边、`browsers/getBrowser/createBrowserTab/getTab/...` 是浏览器半边，共享同一套 `Target` 交互接口（AX 观察 + 元素/坐标动作）。
2. **桌面控制的底层是 "Sky"**：`@oai/sky` JS 客户端通过 Unix domain socket（`~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`）向 Swift 原生服务 `SkyComputerUseService` 发 JSON-RPC 2.0（4 字节长度前缀帧，ping 带 API 版本强校验，request 携带 codexTurnMetadata + deadline）。服务端用 AX API 观察树（自动 diff、行数预算）、ScreenCaptureKit 截屏、CGEvent 注入输入，并有锁屏守护、审批存储、URL 禁区、MCP elicitation 审批。
3. **浏览器控制是多后端统一 API**：`iab`（app 内置浏览器）/ `extension`（ChatGPT 官方 Chrome/Edge/Brave/Opera 扩展 + Native Messaging）/ `cdp`（OpenAI 云端浏览器）/ `mcpapps`（侧边栏 MCP App）四种后端，向上呈现同一套 `Agent.browsers → Browser → Tab` 面；Tab 上 `ax / cua / dom_cua / playwright / clipboard / dev` 多层交互，CDP 只作为 tab 级受限能力（origin 白名单 + 事件游标分页）。
4. **安全模型是四层**：OS 权限（辅助功能+屏幕录制）→ 服务端目标策略（`getAppPolicy`、`AppApprovalStore`、持久化粒度 ALWAYS/ONCE/SESSION/TURN、forbidden targets、锁屏守护）→ 模型策略 prompt（确认政策四档、`node_repl_policy` 风险分级、auto-review 拒绝话术）→ 运行时熔断（用户本轮停止、URL 禁区自动终止会话）。所有用户审批都可以被 `approval_policy = "never"` 类配置调低——策略层是弹性的，权限层与禁区是硬的。
5. **CLI 与桌面的分工**：npm CLI 是纯 Rust 编码代理，本身不内嵌桌面控制二进制，但二进制内嵌了 `computer_use/browser_use` 确认策略、`node_repl_policy`、`BrowserUseConfigToml/ComputerUseConfigToml` 配置面与插件 ID 表（`cua_repl`、`chrome@openai-bundled` 等），可挂同一批插件；桌面宿主通过 `CODEX_CLI_PATH` 指向 app 内置 codex（0.160.0）作为 agent 后端。`/Applications/CodexBar.app` 是第三方（steipete）菜单栏工具，与本能力栈无关。
6. **ZCode 的 CUA SDK（`@oai/cua@0.2.4` 逆向基线）与 Codex 原始面的关系**：方法名/签名同构属实；但 ZCode 的 `stateId/frameId/possibly_sent/controller lease` 安全语义是自研加固（其注释亦承认 "Codex 的动作全是 Promise<void>"）。Codex 对 stale 索引的对策是"AX diff + 错误内嵌新鲜 diff + 流程纪律"。

## 架构分层

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 模型层                                                                       │
│   确认策略 prompt（Rust 内嵌 computer_use/browser_use/node_repl_policy）      │
│   auto-review（high/critical/medium/low 风险分级 + 拒绝话术）                 │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ MCP stdio：工具仅 js / js_reset /（隐藏）turn_ended
┌──────────────▼──────────────────────────────────────────────────────────────┐
│ REPL 层（持久）：cua_repl = node + @oai/cua-repl/bin/cua-repl.mjs             │
│   banner: await import("@oai/cua/tinyskyAlt")  → 全局 cua                    │
│   CUA_REPL_ENABLED_SURFACES = browser, computer                              │
│   ┌────────────────────── cua（统一面）────────────────────┐                  │
│   │ 桌面半边: getApp/listApps/listWindows(/computer)       │                  │
│   │ 浏览器半边: browsers/getBrowser/createBrowserTab/getTab│                  │
│   │ 共享 Target: getAXState/getScreenshot/click/drag/...   │                  │
│   └──────────┬───────────────────────────┬─────────────────┘                  │
└──────────────┼───────────────────────────┼────────────────────────────────────┘
               │ @oai/sky                  │ @oai/browser-desktop (browser-service.mjs)
┌──────────────▼──────────────┐  ┌─────────▼──────────────────────────────────┐
│ 服务层：SkyComputerUseService │  │ 浏览器后端 ×4                                │
│ (Swift, com.openai.sky.     │  │  iab（app WebView）                          │
│  CUAService)                │  │  extension（ChatGPT 扩展+Native Messaging    │
│  · AX 树 diff（行数预算）     │  │    → Chrome/Edge/Brave/Opera）               │
│  · Skyshot=AX+截图+分类器    │  │  cdp（OpenAI 云端浏览器，id="cdp"）           │
│  · ScreenCaptureKit 截屏     │  │  mcpapps（侧边栏 DOM-only App）               │
│  · CGEvent 注入 + EventTap  │  │  Tab 面: ax/cua/dom_cua/playwright/          │
│  · AppApprovalStore/审批     │  │         clipboard/dev/cdp 能力/webmcp        │
│  · 锁屏守护 (Guardian XPC)   │  └──────────────────────────────────────────────┘
│  · URL 禁区/turn 停止熔断     │
└──────────────┬──────────────┘
               │ AX API / CGEvent / SCStream / 授权插件
┌──────────────▼──────────────┐
│ macOS 应用窗口与 Chrome       │
└─────────────────────────────┘
```

## 能力载体清单

| # | 载体 | 路径 / 版本 | 角色 |
|---|---|---|---|
| 1 | Codex CLI | `@openai/codex@0.155.1`，原生二进制 228MB（aarch64） | headless/TUI 编码代理；内嵌策略与配置 schema |
| 2 | Codex Desktop 宿主 | `ChatGPT.app` 构建 26.930.31730 | Electron 壳；装载插件、提供 cua_node |
| 3 | 桌面内置 codex | `ChatGPT.app/Contents/Resources/codex-cli/`（0.160.0） | 桌面的 agent/app-server 后端 |
| 4 | cua_node | `ChatGPT.app/Contents/Resources/cua_node/` | 定制 Node 运行时：`@oai/cua@0.2.5`、`@oai/cua-repl@0.1.0`、`@oai/sky@0.7.5`、`@oai/browser-desktop@0.1.1`、playwright、sharp 等 |
| 5 | Sky CUA 服务 | `~/.codex/computer-use/Codex Computer Use.app`（`com.openai.sky.CUAService`） | Service（AX/截屏/注入）+ Client（通知/computer-history MCP/录制）+ LockScreenGuardian + Installer/授权插件 |
| 6 | browser 插件 | `~/.codex/plugins/cache/openai-bundled/browser/26.930.31730` | browser-client.mjs + browser-service.mjs + AX WASM + zxing WASM + 官方文档目录 |
| 7 | chrome 插件 | `.../openai-bundled/chrome/26.901.51231` | 扩展桥（extension-host "ChatGPT for Chrome"），扩展 id `hehgg…`/`odlom…` |
| 8 | 其余 bundled 插件 | unified-computer-use / computer-use / computer-history / record-and-replay / codex-app-tools 等 | manifest/技能声明壳 |
| 9 | CodexBar.app | `com.steipete.codexbar` 0.71.0 | **第三方**菜单栏监控工具，与本栈无关 |

## 能力矩阵

| 能力 | iab | extension (Chrome/Edge/…) | cdp（云） | mcpapps | 原生 app（mac） | 原生 app（linux/win） |
|---|---|---|---|---|---|---|
| AX 状态（diff） | ✅ | ✅ | ✅ | DOM 快照（无索引） | ✅ AX 树 diff | ✅（全量；linux 报树源 at_spi/x11） |
| 截图 | ✅（JPEG） | ✅ | ✅ | ✅ tab 截图 API | ✅ Skyshot | ✅ |
| 元素索引动作 | ✅ | ✅ | ✅ | ❌（用 Playwright） | ✅ | ✅（at_spi）；x11 仅坐标 |
| 坐标动作 | ✅ | ✅ | ✅ | ❌ | ✅ | ✅（win 先截图校准坐标映射） |
| 键盘/粘贴 | ✅（不还原剪贴板） | ✅ | ✅ | ❌ 原生输入包装抛错 | ✅ paste 还原用户剪贴板 | ✅（仅 text） |
| selectText / setValue | ✅ | ✅ | ✅ | — | ✅ / ✅ | ❌ / ❌（linux） |
| Playwright locator | ✅ | ✅ | ✅ | ✅（唯一交互途径） | — | — |
| 受限 CDP | — | ✅（origin 白名单） | — | — | — | — |
| WebMCP / browserAuth / botDetection 等能力 | 按后端 advertised | ✅ | ✅ | ✅（webmcp） | — | — |
| 拉起应用 | — | — | — | — | ✅（getApp/startApp 隐式，无独立原语） | ✅ 仅 launch_app，getApp 不拉起 |
| 激活窗口原语 | — | — | — | — | ❌（startApp 一次完成） | linux ✅ activate_window（输入不激活）；win 输入即激活 |
| 剪贴板快照句柄 | — | — | — | — | ❌ | linux ✅ clipboard_read/write/release |
| 音频录制 | — | — | — | — | ✅（可选，单独审批） | ✅（full-desktop 可选） |

（"✅/❌/—" 依 `tinysky-alt-core-*.md` 官方文档与 `@oai/sky` 类型定义逐条核对，出处见分篇。）

## 阅读路线

- 想复刻**桌面控制**：读 [computer-use.md](computer-use.md) §2–§5（装配 → API 面 → 观察 → 动作），§6 安全模型；原生管道协议细节在 evidence §3.3。
- 想复刻**浏览器控制**：读 [browser-use.md](browser-use.md) §2–§5（拓扑 → API → 交互层 → 能力系统）。
- 想核对**每条结论的证据**：[evidence/inventory.md](evidence/inventory.md)（含全部路径、版本、strings 摘录、命令输出、不可见边界）。

## 复用注意（给后续逆向/移植者）

1. `tinyskyAlt` 的文档（`@oai/cua/docs/`）与类型（`tinysky_alt/types.d.ts`、`@oai/sky` 全套 `.d.ts`）是**随包分发的官方规范**，比反编译更可靠，应以其为基线再 diff 二进制行为。
2. 桌面控制的 JS 客户端硬依赖 `globalThis.nodeRepl`（nativePipe/launchServices 宿主能力），脱离宿主运行时无法直接复用；自建实现可参考其 JSON-RPC 帧协议与自愈链（evidence §3.3）。
3. 本仓库其它 agent 目录（agents/zcode 等）如引用 `@oai/cua@0.2.4`，注意本机实装为 0.2.5；两版文档结构一致，未见 API 面差异【推断：未逐字节 diff】。
