# Claude Code / Claude 桌面端 Computer Use 与 Browser Use 逆向总览

> 对象：Claude Code CLI 2.1.212（本机实际运行版）/ npm wrapper 2.1.220，Claude 桌面端 1.44121.4（macOS，Electron）。
> 方法：只读逆向打包产物（原生二进制字符串与内嵌 JS、app.asar 解包、Helper 二进制 strings、SDK 类型定义）。
> 详细证据见 [evidence/inventory.md](evidence/inventory.md)；桌面控制见 [computer-use.md](computer-use.md)；浏览器控制见 [browser-use.md](browser-use.md)。

## TL;DR

1. **Claude Code / Claude 桌面端的 computer use 与 browser use 都不是 API 侧内置工具，而是宿主进程内嵌的本地 MCP 服务器**：
   - CLI 隐藏入口：`claude --computer-use-mcp`、`claude --claude-in-chrome-mcp`、`claude --chrome-native-host`（三者都是同一二进制的子命令式入口，stdio 传输）。
   - 桌面端：monorepo 包 `@ant/computer-use-mcp`、`@ant/claude-for-chrome-mcp`、`@ant/browser-tool-schemas`（asar `package.json` dependencies/devDependencies 可见），进程内直连。
2. **工具以 `mcp__computer-use__*`、`mcp__claude-in-chrome__*` 命名空间注入对话**，通过 ToolSearch 延迟加载（`ENABLE_TOOL_SEARCH` 开启时），系统提示指导模型一次性批量加载整套工具。
3. **桌面控制的执行层是平台原生代码**：Swift 库 `ComputerUseSwift`（CLI 静态链接 `.swift.o`；桌面端为 NAPI 绑定 `computer_use.node`，走 ScreenCaptureKit/AX/CGEvent）+ Rust 助手 `app-cu-helper`（JSON-RPC over stdio，封装 SkyLight/CGS 私有框架操作窗口与空间）。
4. **浏览器控制的执行层是 Chrome 官方扩展（Claude in Chrome，ID `fcoeoabgfenejglbffodgkkbkcdhcgfn`）**，经 native messaging 连到 `chrome-native-host`，宿主开 unix socket `/tmp/claude-mcp-browser-bridge-<pid>`，MCP 客户端连 socket 转发 `tool_request`/`permission_request`。
5. **安全模型分层**：CU 按应用授权（`request_access` 弹窗）+ 应用 tier（read/click/full）+ 独占锁 + 全屏接管二次确认；BU 按域名/动作授权（`permission_request`，`chromePermissionMode`: ask/follow_a_plan/skip_all_permission_checks）。敏感类应用（浏览器→read，终端/IDE→click）被硬编码限权。
6. **本机状态**：CLI 与桌面端的 CU/BU 代码完整存在；但 Claude in Chrome 扩展与 CLI native host manifest **均未安装**（Chrome `NativeMessagingHosts/` 无 Anthropic 条目、无扩展目录），因此浏览器控制当前不可用；桌面 CU（Screen Recording/Accessibility 权限）同样未授予。
7. 与 Anthropic 官方 `computer-use-demo`（Docker+X11 单 `computer` 工具）相比：本地栈把动作拆成独立命名工具、增加应用白名单/分级/批量/teach 模式/前台焦点门控，且截图过滤在合成器层完成——详见 [computer-use.md §7](computer-use.md)。

## 架构分层图

```
                        ┌─────────────────────────────────────────────────┐
                        │                Anthropic API (云端)               │
                        │   模型只看到 mcp__<server>__<tool> 工具 schema     │
                        └───────────────▲─────────────────────────────────┘
                                        │ tool_use / tool_result
        ┌───────────────────────────────┴────────────────────────────────┐
        │                     宿主进程（本机）                              │
        │                                                                │
        │  Claude Code CLI (Bun 原生二进制)      Claude 桌面端 (Electron)    │
        │  ┌──────────────────────────┐      ┌───────────────────────────┐│
        │  │ --computer-use-mcp       │      │ @ant/computer-use-mcp     ││
        │  │   → runComputerUseMcp-   │      │ @ant/claude-for-chrome-mcp││
        │  │      Server()  (stdio)   │      │ Cowork: Linux VM 沙箱      ││
        │  │ --claude-in-chrome-mcp   │      │   (Bash/Edit/Write/Read)  ││
        │  │   → runClaudeInChrome-   │      │ Browser pane / preview_*  ││
        │  │      McpServer() (stdio) │      │ framebuffer_* (VNC 客机)   ││
        │  │ --chrome-native-host     │      └──────┬────────────┬───────┘│
        │  │   → runChromeNativeHost()│             │            │        │
        │  └────┬──────────────┬──────┘             │            │        │
        └───────│──────────────│────────────────────│            │        │
                │              │                    │            │        │
   ┌────────────▼───┐   ┌──────▼────────────────────▼─┐   ┌──────▼──────┐ │
   │ ComputerUseSwift│  │ unix socket                  │   │ app-cu-     │ │
   │ (Swift, 静态链接/ │  │ /tmp/claude-mcp-browser-     │   │ helper      │ │
   │  computer_use.  │  │      bridge-<pid>            │   │ (Rust,      │ │
   │  node)          │  └──────▲───────────────────────┘   │  JSON-RPC   │ │
   │  ScreenCaptureKit│        │ native messaging (stdio)  │  over stdio)│ │
   │  AX / CGEvent    │ ┌──────┴─────────────┐             │  SkyLight/  │ │
   │  PhantomCursor   │ │ chrome-native-host │◄────────────│  CGS/AX     │ │
   │  EscHotkey 急停   │ │ (Rust; 桌面 Helper │  socket     └─────────────┘ │
   └────────┬────────┘ │  或 claude 子命令)  │                             │
            │          └──────▲─────────────┘                             │
            ▼                 │ Chrome Native Messaging                   │
      macOS 桌面        ┌─────┴───────────────────────────┐                 │
      (屏幕/窗口/输入)    │ Claude in Chrome 扩展            │                 │
                       │ fcoeoabgfenejglbffodgkkbkcdhcgfn │                 │
                       │  DOM/AX 树·截图·点击·表单·JS·标签页 │                 │
                       └─────────────────────────────────┘                 │
```

## 能力矩阵

| 能力 | Claude Code CLI 2.1.212 | Claude 桌面端 1.44121.4 | 官方 computer-use-demo |
|---|---|---|---|
| 桌面屏幕控制（截图+鼠标键盘） | ✅ `mcp__computer-use__*`（`--computer-use-mcp`） | ✅ 同名服务器（`@ant/computer-use-mcp`） | ✅ 单一 `computer` 工具（Docker+X11） |
| 后台单应用控制（不打扰用户） | ❌ 工具面中无 `app_*`（该版本） | ✅ `app_screenshot/app_click/app_type/app_key/app_scroll/app_drag/app_menu/app_batch/app_ax_find` | ❌ |
| 教学模式（tooltip 引导用户） | ✅ `request_teach_access/teach_step/teach_batch` | ✅ 另有 Teach/Watch 录制 UI（`claude.internal.computerUse`） | ❌ |
| 应用白名单 + tier 限权 | ✅ read/click/full | ✅ 同左 + 读写剪贴板/系统快捷键独立授权 | ❌（仅容器隔离） |
| 浏览器控制（Chrome 扩展） | ✅ `mcp__claude-in-chrome__*`（`--claude-in-chrome-mcp`） | ✅ `@ant/claude-for-chrome-mcp` | ❌ |
| 浏览器版像素级 `computer` 工具 | ✅（含 zoom/scroll_to/hover/ref 元素引用） | ✅ 同一 schema（两处注册表） | ❌（demo 的 computer 控整机） |
| 应用内浏览器面板 | ❌ | ✅ Browser pane（同一套工具第二注册表）+ `preview_*` | ❌ |
| VM/远端屏幕（VNC framebuffer） | ❌（CLI 二进制无 `framebuffer_*`） | ✅ `framebuffer_*` 13 个工具（Cowork/VM） | ❌ |
| Cowork Linux VM 沙箱（文件/代码） | ❌（CLI 直接跑在宿主） | ✅ Ubuntu 22 VM，Bash/Edit/Write/Read | ✅（demo 即 Docker 容器） |
| Windows 支持 | ✅（`createWin32Executor`，UIPI 限制提示） | ✅（Win32 executor +cowork-win32-service） | ❌（仅 Linux 容器） |
| 本机当前可用性 | 扩展未装、无 native host manifest、无屏幕录制授权 → 均未激活 | 同左 | 需手动部署 |

## 快速验证

```bash
claude --version                                     # 2.1.212 (Claude Code)
grep -a -c -o 'computer-use' ~/.local/share/claude/versions/2.1.212   # 78
ls /Applications/Claude.app/Contents/Helpers/        # app-cu-helper chrome-native-host ...
npx @electron/asar extract /Applications/Claude.app/Contents/Resources/app.asar /tmp/claude-asar
grep -o '"@ant/[a-z-]*"' /tmp/claude-asar/package.json | sort -u
```

## 文档结构

- [computer-use.md](computer-use.md) — 桌面控制：载体判定、进程/传输、完整工具面、观察与动作机制、安全模型、与 computer-use-demo 对照
- [browser-use.md](browser-use.md) — 浏览器控制：扩展/native host/socket 链路、完整工具面、权限模型、应用内浏览器与 framebuffer、对照
- [evidence/inventory.md](evidence/inventory.md) — 全部路径/版本/偏移/摘录/复现命令
