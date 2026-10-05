# Block Goose：Computer Use 与 Browser Use 能力逆向总览

> 对象：Block（现 AAIF）开源 AI agent **Goose**。本机（macOS arm64，2026-10-06）**无有效安装**——仅存残留配置 `~/.config/goose/skills/`（99 个断链符号链接）；因此本分册以**上游开源仓库源码**为分析基线：`github.com/block/goose`（现 mirror `aaif-goose/goose`），workspace 版本 **1.53.0**，commit `5bd5e548e2930ad155cb95877f62f7c7a65bec33`（2026-10-05），**Apache-2.0**。
> 方法：只读分析本机残留配置 + 克隆上游源码静态分析（Rust crates、桌面端 Electron UI、官方文档目录）。上游 clone 位于 `/tmp/goose-src`，未修改本机任何文件。
> 详细证据见 [evidence/inventory.md](evidence/inventory.md)；桌面控制见 [computer-use.md](computer-use.md)；浏览器控制见 [browser-use.md](browser-use.md)。

## TL;DR

1. **Goose 是"能力全部外挂"的架构极值**：Rust 内核（`crates/goose`）本身**没有任何 CU/BU 原生原语**——没有截图引擎、没有输入注入、没有 CDP 客户端。一切能力（包括文件、shell）都以 extension 形式挂载，extension 分三类：**builtin**（编译进 `goose-mcp` crate，in-process duplex stream 走 MCP 协议）、**platform**（agent 进程内直连，如 developer/shell）、**stdio/HTTP 外部 MCP server**（config.yaml 声明，`goose://extension` deeplink 一键安装）。
2. **Computer Use = 官方内置 extension "Computer Controller"**（`crates/goose-mcp/src/computercontroller/`），默认**关闭**（桌面端 `built-in-extensions.json` 中 `enabled:false`）。它对模型只暴露**一个**工具 `computer_control(command, capture_screenshot)`，macOS 上把 `command` 字符串原样透传给 **Peekaboo CLI**（`steipete/peekaboo`，MIT，Swift），并在首次调用时自动 `brew install steipete/tap/peekaboo`。**执行层完全是第三方开源 CLI，Goose 自己不写一行 AX/CGEvent 代码**——这是 9 个被逆向 agent 中唯一的"纯 CLI 透传"实现。
3. **Browser Use = 纯 MCP 外挂生态，零内置**。官方文档目录收录的浏览器控制扩展全是第三方 MCP server：Playwright MCP、Chrome DevTools MCP、Puppeteer MCP（已归档）、Selenium MCP、Browserbase MCP（云端）；goose 桌面端自身的 webview 前进/后退与 agent 能力无关。`browser_live_transport.rs` 是 Live 语音 API 的 WebRTC 桥，与浏览器自动化无关（已排除的负证据）。
4. **观察/动作机制**：`see --annotate` 产出「AX 元素 ID 标注截图」（B1/T2 式编号，et 类似 set-of-marks 但标注来自 AX 树而非视觉检测）；动作 = click/type/press/hotkey/scroll/drag 等子命令字符串；结果信封 = 文本（>12000 字符截断，标注 `audience: assistant`）+ base64 PNG image 块；`capture_screenshot:true` 时动作后自动补拍前台截图。
5. **权限模型是"模式 × 工具 × 独立审查"三层**：全局 `GooseMode` 四档（auto / approve / smart_approve / chat）× 每工具 `PermissionLevel` 三级（always_allow / ask_before / never_allow，持久化 `~/.config/goose/permission.yaml`）× LLM 独立审查层（smart_approve 只读判定 + adversary mode 对抗审查，均 fail-open/fail-closed 语义明确）。**没有 CU 专用的应用分级授权**（对比 Claude Code 的 read/click/full tier）——CU 动作只享受通用工具权限门，屏幕录制/辅助功能 TCC 授权由 Peekaboo 自行负责。
6. **与 trycua/Cua AI 生态无关**：Goose 的 GUI 自动化选型是 Peekaboo（steipete），非 cua-driver；与 MiniMax（cua-driver 0.22.1）、Synara（0.28.2 patched）形成"同一问题域、另一条开源底座"的对照。Peekaboo 与 trycua 同为开源 macOS 自动化项目，但互相独立（Peekaboo MIT、Swift 单二进制、brew 分发；cua-driver MIT、Rust、常被宿主进程内嵌）。
7. **本机可用性：不可用**。无 goose 二进制、无 Goose.app、无 `~/.config/goose/config.yaml`（extensions 配置不存在）；唯一残留 `~/.config/goose/skills/` 的 99 个符号链接全部断链（指向 `~/.agents/skills/*` 中已不存在的同名技能，创建于 2025-07-07）。据此判定：本机曾安装过 Goose（且做过 skills 链接定制），分析时点前已卸载。
8. **对逆向/复刻最有价值的三点**：① "一个工具吃下整个 CLI 命令空间"的透传模式（工具面永不膨胀，能力随外部 CLI 升级）；② builtin extension 用 in-process duplex stream 跑 MCP 协议（`BUILTIN_EXTENSIONS` 注册表 + feature gate 编译裁剪）；③ smart_approve/adversary 双 LLM 审查与通用工具权限门的正交叠加。

## 架构分层图

```
                    ┌──────────────────────────────────────────────┐
                    │              LLM Provider (云端)              │
                    │     模型只看到 MCP 工具 schema（含注解）          │
                    └──────────────────▲───────────────────────────┘
                                       │ tool_request / tool_response
        ┌──────────────────────────────┴───────────────────────────────┐
        │                    Goose 核心（Rust，crates/goose）            │
        │                                                              │
        │  ┌─ platform extensions（agent 进程内直连，无 MCP 序列化）──┐    │
        │  │ developer(shell/write/edit/tree/read_image) analyze    │    │
        │  │ todo apps chatrecall extensionmanager scheduler        │    │
        │  │ summon summarize code_execution orchestrator           │    │
        │  └────────────────────────────────────────────────────────┘    │
        │  ┌─ builtin extensions（goose-mcp crate，in-process MCP）───┐   │
        │  │ computercontroller(Computer Controller)★CU             │    │
        │  │ autovisualiser  memory  tutorial                       │    │
        │  └───────────────┬────────────────────────────────────────┘    │
        │  ┌─ 外部 MCP extensions（config.yaml / deeplink 安装）──────┐    │
        │  │ playwright / chrome-devtools / selenium /              │    │
        │  │ browserbase / fetch / github / … （stdio 或 HTTP）      │    │
        │  └───────────────┬────────────────────────────────────────┘    │
        └──────────────────│──────────────────│──────────────────────────┘
                           │                  │
            ┌──────────────▼───────┐   ┌──────▼──────────────────────┐
            │ Peekaboo CLI (Swift, │   │ 第三方浏览器 MCP server       │
            │ MIT, brew 自动安装)    │   │ （Playwright/Chrome DevTools │
            │  see/image/click/    │   │  /Selenium/Browserbase…）    │
            │  type/hotkey/scroll… │   │  AX/CDP/WebDriver 由各方实现  │
            │  AX 树 + 截图 + 元素ID │   └─────────────────────────────┘
            └──────────┬───────────┘
                       ▼
                 macOS 桌面（需 TCC：Screen Recording + Accessibility）
```

## 能力矩阵

| 能力 | Goose v1.53.0（CLI/桌面同核） | 对照：MiniMax | 对照：Claude Code |
|---|---|---|---|
| 桌面屏幕控制 | ✅ builtin extension `computercontroller` → `computer_control` 单工具（macOS 透传 Peekaboo CLI） | ✅ `computer_*` 17+ 工具（cua-driver） | ✅ `mcp__computer-use__*` 命名工具族（ComputerUseSwift） |
| 观察机制 | `see --annotate`（AX 元素 ID + 截图）`image` `capture live`；snapshot 复用 | AX `get_desktop_state` + 指针动画 | AX 树增量 diff + 截图 + app snapshot |
| 动作注入 | Peekaboo（CGEvent/AX，Swift 实现） | cua-driver（CGEvent 系） | CGEvent + PhantomCursor |
| 执行层归属 | **第三方独立 CLI**（brew 外部进程），Goose 零原生代码 | 宿主内嵌 driver + utility process | 宿主静态链接 Swift + Rust helper |
| 自动安装执行层 | ✅ 首次调用自动 `brew install steipete/tap/peekaboo` | ❌ 随包分发 | ❌ 随包分发 |
| 后台单应用控制 | ❌ 工具面无 app-scoped 交付模式（Peekaboo 有 `--no-auto-focus` 等参数但无后台会话语义） | ✅ background/foreground 双交付 + lease | ✅ `app_*` 工具族 |
| 急停/人接管 | ❌ 无 CU 专用急停（仅会话级中断） | ✅ 遮罩条 STOP 按钮 | ✅ EscHotkey 急停 |
| CU 专用权限分级 | ❌ 无（仅通用 GooseMode × 工具级权限） | ✅ hostCapabilities + 会话级选择 + TCC 引导 | ✅ 应用 tier（read/click/full）+ 按应用授权 |
| 浏览器控制（内置） | ❌ 无 | ✅ WebContentsView 嵌入式浏览器 24 action | ✅ Claude in Chrome 扩展 |
| 浏览器控制（外挂） | ✅ 官方收录 Playwright/Chrome DevTools/Puppeteer/Selenium/Browserbase 五个 MCP 扩展 | ✅ chrome-devtools-mcp 插件 | ❌（自研扩展，不挂第三方） |
| 办公文档工具（同 extension 附带） | ✅ `xlsx_tool`/`docx_tool`/`pdf_tool`（与 computer_control 同属 Computer Controller） | 部分在云端工具面 | ❌ |
| Skills 生态 | ✅ `~/.agents/skills`（canonical）+ `~/.config/goose/skills`（兼容）+ 项目级 `.agents/skills`（本机唯一残留即此） | ✅ `.builtin-skills` + 插件 skills | ✅ skills 目录 |
| 本机当前可用性 | **不可用**（无二进制、无 app、无 extensions 配置；仅断链 skills 残留） | 全链可用 | 扩展未装、TCC 未授权 → 未激活 |

## 快速验证

```bash
# 本机痕迹（残留 skills，全部断链）
ls ~/.config/goose/skills/ | wc -l          # 99
file ~/.config/goose/skills/code-review      # broken symbolic link to ../../../.agents/skills/code-review
command -v goose                              # （空，无 CLI）
ls /Applications | grep -i goose              # （空，无桌面端）

# 上游基线（分析用 clone）
git clone --depth 1 https://github.com/block/goose /tmp/goose-src
cd /tmp/goose-src && git log -1 --format='%H %ci'   # 5bd5e548… 2026-10-05
grep version Cargo.toml | head -2                   # 1.53.0，Apache-2.0
ls crates/goose-mcp/src/                            # computercontroller peekaboo autovisualiser memory tutorial …
grep -n '"id": "computercontroller"' -A 5 ui/desktop/src/built-in-extensions.json  # enabled:false
```

## 文档结构

- [computer-use.md](computer-use.md) — 桌面控制：Computer Controller extension 全解、Peekaboo 透传链路、工具面与命令空间、观察/动作机制、自动安装、权限模型、与 trycua 生态对照
- [browser-use.md](browser-use.md) — 浏览器控制：零内置判定、五个官方收录 MCP 扩展、deeplink 安装与企业白名单、CU 兜底 BU 的形状
- [evidence/inventory.md](evidence/inventory.md) — 本机痕迹（负证据）、上游源码证据映射（文件:行号）、方法与合规说明
