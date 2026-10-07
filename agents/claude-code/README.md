# Claude（Anthropic）· Claude Code / 桌面端 Computer Use 与 Browser Use 逆向总览

> 一句话结论：**CU/BU 都不是 API 内置工具，而是宿主内嵌的本地 stdio MCP 服务器；执行层是平台原生代码（ComputerUseSwift + SkyLight/CGS 私有 API），浏览器走 Claude in Chrome 扩展 + native messaging——本机扩展与授权均缺，「负证据判定」典型案例。**

| 项 | 值 |
|---|---|
| 载体 | Claude Code CLI 2.1.212（Bun 原生二进制）· Claude 桌面端 1.44121.4（Electron） |
| 形态 | 内嵌 MCP server：CLI 隐藏入口 `--computer-use-mcp` / `--claude-in-chrome-mcp` / `--chrome-native-host`；桌面端 `@ant/*` 包进程内直连 |
| CU 工具面 | 约 40 工具 · 三控制域（display-scope / app-scoped / teach） |
| BU 工具面 | `mcp__claude-in-chrome__*` 约 30 工具 · Chrome 扩展执行（非 CDP） |
| 安全模型 | 应用白名单 + tier 限权（read/click/full）+ 独占锁 + 全屏接管二次确认；BU 按域名/动作授权 |
| 本机可用 | ❌ 链路断：扩展未装、native host 未注册、TCC 未授权（2026-10 基线） |

方法：只读逆向打包产物（原生二进制字符串与内嵌 JS、app.asar 解包、Helper 二进制 strings、SDK 类型定义）。证据见 [evidence/inventory.md](evidence/inventory.md)。

## 架构一图

```
Anthropic API ── 模型只看到 mcp__<server>__<tool> schema（ToolSearch 延迟批量加载）
 ▼ tool_use / tool_result
宿主进程：Claude Code CLI（stdio 隐藏入口）｜ Claude 桌面端（@ant/* 包 + Cowork VM）
 ├─ CU：runComputerUseMcpServer → ComputerUseSwift（SCK/AX/CGEvent，PhantomCursor，EscHotkey）
 │      + app-cu-helper（Rust，JSON-RPC over stdio，SkyLight/CGS 私有框架）
 └─ BU：runClaudeInChromeMcpServer → unix socket /tmp/claude-mcp-browser-bridge-<pid>
        → chrome-native-host（Rust）→ Chrome 扩展 fcoeo…（DOM/AX 树/截图/点击）
```

## 能力矩阵：CLI vs 桌面端 vs 官方 demo

| 能力 | CLI 2.1.212 | 桌面端 1.44121.4 | 官方 computer-use-demo |
|---|---|---|---|
| 桌面屏幕控制 | ✅ display-scope + teach | ✅ 同左 | ✅ 单 `computer` 工具（Docker+X11） |
| 后台单应用（app_*） | ❌（该版本无，二进制计数 0） | ✅ 9 个 app 工具 | ❌ |
| 应用白名单 + tier 限权 | ✅ read/click/full | ✅ + 剪贴板/系统键独立授权 | ❌（仅容器隔离） |
| 浏览器控制（Chrome 扩展） | ✅ `--claude-in-chrome-mcp` | ✅ 同一 schema | ❌ |
| 应用内浏览器面板 | ❌ | ✅ Browser pane（第二注册表）+ preview_* | ❌ |
| VNC framebuffer | ❌ | ✅ 13 个 framebuffer_* 工具 | ❌ |
| Cowork Linux VM | ❌ | ✅ Ubuntu 22 VM（Bash/Edit/Write/Read） | ✅（demo 即容器） |
| 本机当前 | 扩展/授权均缺 → 均未激活 | 同左 | 需手动部署 |

## 文档导航与快速验证

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | 三控制域约 40 工具、观察/动作机制、安全模型、与 demo 对照 |
| [browser-use.md](browser-use.md) | 扩展/native host/socket 链路、工具面、权限模型、桌面专属变体 |
| [evidence/inventory.md](evidence/inventory.md) | 全部路径/版本/偏移/摘录/复现命令 |

```bash
claude --version                                  # 2.1.212
ls /Applications/Claude.app/Contents/Helpers/     # app-cu-helper chrome-native-host …
npx @electron/asar extract /Applications/Claude.app/Contents/Resources/app.asar /tmp/claude-asar
grep -o '"@ant/[a-z-]*"' /tmp/claude-asar/package.json | sort -u
```

> 结论先行：本机「链路断」是**负证据**判定——代码完整存在，但三处前置（扩展安装、native host manifest、TCC 授权）全缺。与官方 demo 的关键分叉：动作拆独立命名工具、应用白名单/tier/批量/teach 模式、截图过滤在合成器层完成。
