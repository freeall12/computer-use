# Goose（Block，开源）· 能力全部外挂的架构极值：CU 透传 Peekaboo，BU 纯 MCP 外挂

> 一句话结论：**Rust 内核零 CU/BU 原语——CU 是官方 builtin extension 暴露的单工具 `computer_control`，把命令字符串原样透传给第三方 Peekaboo CLI（唯一"纯 CLI 透传"实现）；BU 零内置，全是第三方 MCP server。**

| 项 | 值 |
|---|---|
| 载体 | 上游源码基线 `block/goose` v1.53.0（commit `5bd5e548`，2026-10-05，Apache-2.0）；本机无有效安装 |
| 形态 | Rust 内核 + extension 挂载：builtin（in-process MCP）/ platform（进程内直连）/ 外部 MCP server |
| CU 工具面 | 1 个 `computer_control` · CLI 透传（Peekaboo，brew 自动安装） |
| BU 工具面 | 0 内置 · 官方收录 5 个浏览器 MCP（Playwright/DevTools/Puppeteer/Selenium/Browserbase） |
| 安全模型 | GooseMode 四档 × 工具三级 × LLM 审查——**无 CU 专用门** |
| 本机可用 | ❌ 已卸载，仅 99 个断链 skills 残留（2026-10 基线） |

## 架构一图

```
LLM Provider：模型只看到 MCP 工具 schema（含注解）
 │ tool_request / tool_response
 ▼
Goose 核心（Rust，crates/goose）
 ├─ platform extensions：developer(shell/write/edit/tree/read_image) 等（进程内直连）
 ├─ builtin extensions：computercontroller ★CU / autovisualiser / memory / tutorial
 │   （goose-mcp crate，feature gate，in-process duplex stream 跑 MCP 协议）
 └─ 外部 MCP extensions：config.yaml / goose:// deeplink 安装（stdio 或 HTTP）
        │                      │
        ▼                      ▼
 Peekaboo CLI（Swift，MIT）    第三方浏览器 MCP server
 see/click/type/hotkey/scroll  （Playwright / Chrome DevTools / Selenium / Browserbase）
 AX 树 + 截图 + 元素 ID          AX/CDP/WebDriver 由各方实现
        ▼
 macOS 桌面（TCC：Screen Recording + Accessibility，由 Peekaboo 触发授权）
```

## "执行层完全外包"对照表

**Goose 自身不写一行 AX/CGEvent 代码——执行层外包是 9 家分册中的唯一极值。**

| 维度 | Goose + Peekaboo | MiniMax/Synara + cua-driver（trycua） |
|---|---|---|
| 语言/形态 | Swift 单二进制 CLI，brew 分发，stdin/stdout 文本协议 | Rust 库（UniFFI），宿主进程内嵌，JSON 消息协议 |
| 集成深度 | 零集成：子进程 + 命令字符串透传 | 深度集成：进程内嵌 + 会话/租约/generation |
| 观察输出 | 截图 + AX 标注叠加（SoM 变体）+ JSON stdout | AX 结构化状态 + 分级截图（≤7MB fail-closed） |
| 权限 | TCC 系统授权，agent 不管理 | hostCapabilities + 前台授权引擎 + overlay 示能 |
| 升级方式 | `brew upgrade peekaboo`，goose 不改代码 | 随宿主发版 |
| 急停/后台控制 | 无（仅会话级中断） | 遮罩条 STOP / lease 双交付 |

## 能力矩阵（要点）

| 能力 | Goose v1.53.0 | 对照：MiniMax | 对照：Claude Code |
|---|---|---|---|
| 桌面控制 | ✅ `computer_control` 单工具（透传） | ✅ `computer_*` 17+ 工具 | ✅ `mcp__computer-use__*` 工具族 |
| 自动安装执行层 | ✅ 首次调用自动 `brew install` | ❌ 随包分发 | ❌ 随包分发 |
| 后台单应用控制 | ❌ 无 app-scoped 交付模式 | ✅ background/foreground + lease | ✅ `app_*` 工具族 |
| CU 专用权限分级 | ❌ 仅通用三层权限 | ✅ hostCapabilities + TCC 引导 | ✅ 应用 tier + 按应用授权 |
| 浏览器（内置/外挂） | ❌ / ✅ 5 个 MCP 扩展 | ✅ 嵌入式 24 action / ✅ 插件 | ✅ Claude in Chrome / ❌ 不挂第三方 |
| 办公文档工具 | ✅ `xlsx_tool`/`docx_tool`/`pdf_tool`（同 extension） | 部分在云端工具面 | ❌ |
| 本机可用性 | **不可用** | 全链可用 | 未激活 |

## 本机负证据（已卸载判定）

- 无 goose CLI、无 Goose 桌面端、无 `config.yaml`、无 `~/.cache/goose/`——运行数据全负。
- `~/.config/goose/skills/` 下 99 个符号链接**全部断链**（→ `~/.agents/skills/<name>` 已不存在，创建于 2025-07-07）。
- 判定：曾安装并做过 skills 定制，分析时点前已卸载；本分册判定基于上游源码 + 官方文档，非本机运行时状态。

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | Computer Controller extension 全解、Peekaboo 透传链路、命令空间、权限模型 |
| [browser-use.md](browser-use.md) | 零内置判定、五个官方收录 MCP、deeplink 安装与企业白名单、CU 兜底 BU |
| [evidence/inventory.md](evidence/inventory.md) | 本机痕迹负证据、上游源码证据映射（文件:行号）、方法与合规 |

## 快速验证

```bash
ls ~/.config/goose/skills/ | wc -l          # 99（全部断链 symlink）
command -v goose                             # （空）
git clone --depth 1 https://github.com/block/goose /tmp/goose-src
grep -n '"id": "computercontroller"' -A 5 /tmp/goose-src/ui/desktop/src/built-in-extensions.json  # enabled:false
```

> 演进：1.0.x 时代 Computer Controller 曾是外部 MCP server（`uvx mcp-server-computer-controller`，多细粒度工具）→ 现行版本内置化并改为 Peekaboo 单工具透传（对齐时勿混用两代工具面）。
