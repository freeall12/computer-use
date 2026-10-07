# Codex（OpenAI）· Computer Use 与 Browser Use 逆向总览

> 一句话结论：**「一个 REPL、一个全局对象」——桌面端由 unified-computer-use 插件暴露持久 Node REPL（工具仅 js/js_reset），`cua` 全局同时承载桌面半边与浏览器半边；桌面底层是 Swift 服务 Sky，浏览器是 iab/extension/cdp/mcpapps 四后端统一 API。**

| 项 | 值 |
|---|---|
| 载体 | CLI `@openai/codex@0.155.1`（Rust 228MB）· ChatGPT.app 26.930.31730（内含 codex-cli 0.160.0）· Sky CUA 服务 |
| 形态 | cua_repl 持久 Node REPL（MCP stdio，工具仅 js / js_reset / turn_ended）+ `cua` 全局对象 |
| CU 工具面 | `cua.getApp/listApps/…` + `cua.computer` 逃逸口 · Sky 服务执行 |
| BU 工具面 | `cua.browsers/…` + browser 插件 `agent.browsers→Tab`（ax/cua/dom_cua/playwright/clipboard/dev） |
| 安全模型 | 四层：OS 权限 → 服务端审批 → 模型策略 prompt → 运行时熔断（+独有锁屏守护） |
| 本机可用 | ✅ 已安装；用户策略 approval_policy=never 调低（2026-10 基线） |

方法：本机（macOS arm64）只读静态分析。标注约定：**实证** = 文件/二进制/文档直接可见；**推断** = 旁证推导。证据见 [evidence/inventory.md](evidence/inventory.md)。

## 架构一图

```
模型 ── 确认策略 prompt（Rust 内嵌 computer_use/browser_use/node_repl_policy + auto-review）
 ▼ MCP stdio：工具仅 js / js_reset /（隐藏）turn_ended
cua_repl（持久 REPL）：import("@oai/cua/tinyskyAlt") → 全局 cua
 ├─ 桌面半边 getApp/listApps/… + Target 交互面（AX 观察 + 元素/坐标动作）
 │    → @oai/sky → computeruse.sock（JSON-RPC 2.0，4B 长度前缀帧）
 │    → SkyComputerUseService（Swift）：AX diff · Skyshot · CGEvent · 审批 · 锁屏守护
 └─ 浏览器半边 browsers/getBrowser/createBrowserTab/getTab
      → @oai/browser-desktop → iab / extension(Native Messaging) / cdp(云) / mcpapps
```

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | 桌面控制：cua 编程面还原、观察/动作机制、四层安全、与 ZCode 对照 |
| [browser-use.md](browser-use.md) | 浏览器控制：四后端拓扑、统一 API、三层交互、能力系统 |
| [evidence/inventory.md](evidence/inventory.md) | 全部路径、版本、strings 摘录、命令输出、不可见边界 |

## 能力载体

| 载体 | 版本 | 角色 |
|---|---|---|
| Codex CLI | 0.155.1（Rust 228MB） | headless/TUI 编码代理；内嵌策略与配置 schema |
| ChatGPT.app | 26.930.31730 | 桌面宿主；内置 codex-cli 0.160.0 作 agent 后端 |
| cua_node | 定制 Node 运行时 | `@oai/cua@0.2.5` · `@oai/cua-repl@0.1.0` · `@oai/sky@0.7.5` · `@oai/browser-desktop@0.1.1` |
| Sky CUA 服务 | `~/.codex/computer-use/Codex Computer Use.app` | Service（AX/截屏/注入）+ Client（通知/computer-history MCP）+ 锁屏守护 + Installer |
| browser / chrome 插件 | 26.930.31730 / 26.901.51231 | browser-client.mjs + AX WASM；Chrome 扩展桥（extension-host） |

> 演进脚注：「Sky」是 OpenAI 桌面自动化运行时内部代号（socket/env/包名一致）；ZCode 逆向基线为 `@oai/cua@0.2.4`，本机实装 0.2.5，文档面一致。`/Applications/CodexBar.app` 是第三方（steipete）菜单栏工具，与本栈无关。

## 能力矩阵（后端 × 能力）

| 能力 | iab | extension | cdp（云） | mcpapps | 原生 mac | 原生 linux/win |
|---|---|---|---|---|---|---|
| AX 状态（diff） | ✅ | ✅ | ✅ | DOM 快照（无索引） | ✅ AX 树 diff | ✅（at_spi；x11 仅坐标） |
| 截图 | ✅ JPEG | ✅ | ✅ | ✅ tab 截图 | ✅ Skyshot | ✅ |
| 元素索引动作 | ✅ | ✅ | ✅ | ❌（用 Playwright） | ✅ | ✅（win 先校准坐标映射） |
| 坐标动作 / 键盘粘贴 | ✅ | ✅ | ✅ | ❌ | ✅ paste 还原剪贴板 | ✅（仅 text） |
| Playwright locator | ✅ | ✅ | ✅ | ✅（唯一途径） | — | — |
| 受限 CDP / webmcp | — | ✅（origin 白名单） | ✅ | ✅ webmcp | — | — |
| 拉起应用 | — | — | — | — | ✅ startApp 隐式 | ✅ 仅 launch_app（linux） |
| 音频录制 | — | — | — | — | ✅（单独审批） | ✅（可选） |

（逐条依 tinysky-alt 官方文档与 `@oai/sky` 类型核对，出处见分篇。）

## 阅读路线与复用注意

- 复刻桌面控制：[computer-use.md](computer-use.md)（装配 → API 面 → 观察 → 动作 → 安全）；管道协议细节 evidence §3.3。
- 复刻浏览器控制：[browser-use.md](browser-use.md)（拓扑 → API → 交互层 → 能力系统）。
- 复用基线：`tinyskyAlt` 随包文档与 `.d.ts` 是**随包分发的官方规范**，先于反编译；JS 客户端硬依赖 `globalThis.nodeRepl`（宿主原生管道），脱离宿主跑不了。
