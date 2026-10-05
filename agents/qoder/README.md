# Qoder 原生 Computer Use 与 Browser Use 逆向分析

> 逆向对象：本机安装的 Qoder 0.4.3（com.qoder.app，macOS arm64，Electron 自研 workbench，**非 VSCode fork**）。方法：只读静态分析（asar 解包至 /tmp、二进制 strings、用户数据目录勘查），不做抓包、不触碰凭据。全部证据见 [evidence/inventory.md](evidence/inventory.md)。

## 文档导航

| 文件 | 内容 |
|---|---|
| [browser-use.md](browser-use.md) | 浏览器控制完整逆向：内置 in-app 浏览器 + `browser-use` MCP server（16 工具，钉死对齐 chrome-devtools-mcp 基线）、Qoder Browser Connector（Chrome/Edge 扩展 + Native Messaging）、`@ali/qoder-browser-use-sdk` Browser Agent 对象面 |
| [computer-use.md](computer-use.md) | 桌面控制完整逆向：`qoder.computer-control` 内置插件、`Qoder Computer Use.app`（Swift Runtime + Bridge）、UDS + token 传输链、11 方法 SDK 面、Record & Replay、Windows MCP 16 工具 |
| [evidence/inventory.md](evidence/inventory.md) | 证据清单：路径、版本、字节偏移、二进制字符串证据、复现命令 |

## TL;DR（30 秒版）

- **产品形态**：`/Applications/Qoder.app` 本体即完整应用（app.asar 136MB），自研 Electron workbench（`@qoder-space/workbench`、`editor-core`，无 product.json）。entry 脚本提到的另一产品 "Qoder IDE"（com.qoder.ide，VSCode fork 形态）本机**未安装**；`qodercli` CLI 也未安装（本地 agent 由 app 内置的 agent-sdk worker 承担）。
- **CU/BU 同一总开关面板**：全部能力收在内置 app-plugin **`qoder.computer-control`**（"电脑操控" 设置组）下，三个子能力各有配置键，**默认全部关闭**：
  - Computer Use（`qoder.computer-control.computerUse.enabled`，macOS ≥14 / Windows ≥10）
  - Browser Use（`qoder.computer-control.browserUse.enabled`，外部 Chrome/Edge 连接）
  - Record & Replay（`qoder.computer-control.recordAndReplay.enabled`，macOS ≥14，录演示流程生成 Skill）
- **CU 架构**：agent 在 `node_repl`（JS 内核）里用内置 SDK `@qoder-space/computer-use-sdk` 的 `ComputerUse.create()` → Unix domain socket（注册表 `~/.qoder/ipc/computer-use-tools.json`，token 鉴权）→ 按需 `/usr/bin/open -g` 拉起独立原生应用 **`Qoder Computer Use.app` 1.0.12**（Swift：Runtime 做 AX 读写 + CGEvent 合成 + ScreenCaptureKit 截图；Bridge 作为 stdio MCP 入口）。观察 = AX 树文本（elementIndex + diff）+ 截图；动作后自动回传新状态。
- **BU 三条链路**：① 内置 in-app 浏览器（Electron WebContentsView）+ 主进程 `browser-use` MCP server，16 工具**钉死对齐 chrome-devtools-mcp 兼容基线**（注册时不匹配即抛错）——本机**已真实使用**（会话日志 8873 行中有 `mcp__browser-use__take_snapshot`×17 等痕迹）；② 外部浏览器经 **Qoder Browser Connector**（Native Messaging host `com.qoder.app.connector` 写入 Chrome/Edge/Brave/Opera/Vivaldi/Quark，5 个扩展 ID 白名单），工具在**扩展内执行**；③ 新版 Browser Agent API（`createBrowserAgent`）：AX 状态 + Playwright locator + 截图 + capabilities（受限 CDP/WebMCP/页面资源/二维码），走 `~/.qoder/ipc/browser-use.json` 注册表 + HTTP loopback + Bearer token 连回 Qoder 主进程。
- **node_repl 内核来自 qwen-code**：`node-repl/UPSTREAM.md` 明确记载源仓库 `qwen-code` `packages/qwen_node_repl`（Apache-2.0，commit b1ac3e29）；CU SDK 注释亦提及与 "qcum"（qwen computer use）的应用级快照契约一致。SDK 内嵌 `third_party/browser-use-sdk`（Qoder 自研，Apache-2.0）+ zxing（二维码识别）。
- **agent 编排**：本地 Runtime 为内置 qodercli（agent-sdk worker，WIRE_PROTOCOL_VERSION 1.5.0，能力含 resume/steer/fork/permissions/skills/mcp）；云端 `runtime:qoder-cloud:*`（Quest / Qoder Work，工具面含 `qw_mcp_call` 等）。CU/BU 属本地 Runtime 能力，云端 Quest 工具映射表中无桌面/浏览器控制工具（推断：云端沙箱无本地桌面控制路径）。
- **阿里系证据**：依赖命名空间 `@ali/*`（registry.anpm.alibaba-inc.com）、CU 信任链含 `com.aliyun.lingma.ide`（通义灵码）、遥测走阿里云 ARMS RUM、国区端点 `gateway.qoder.com.cn`。
- **明确排除**：`/Volumes/YANG/qoder/QoderGateway/`（含 `~/.qoder/qoder2api.db`）是分析者自建的第三方网关项目（qoder2api/launcher 脚本），不是 Qoder 产品组件，不作为能力证据。

## 架构分层图

```
                        ┌────────────────────────────────────────────────┐
                        │ Qoder 云端（api2/api3/center/openapi.qoder.sh； │
                        │  国区 gateway.qoder.com.cn）                    │
                        │  · agent 会话编排（agent-sdk wire 1.5.0）        │
                        │  · 云端 Runtime: Quest / Qoder Work（qw_mcp_*） │
                        │  · worker runtime 下发（download.qoder.com）    │
                        └───────────────┬────────────────────────────────┘
                                        │ HTTPS（内置 qodercli worker 上行）
┌───────────────────────────────────────▼──────────────────────────────────────────┐
│ Qoder.app 0.4.3（Electron，自研 workbench；app.asar 136MB）                        │
│                                                                                  │
│  agent 内核（内置 qodercli，"Built-in local CLI"）                                 │
│  基础工具: Read/Write/Edit/Glob/Grep/Bash/WebSearch/WebFetch/ImageGen/Task*/       │
│            AskUserQuestion/Skill/Agent + 内置 MCP: node-repl / browser-use /      │
│            chrome-devtools / computer-use / genui / schedule                      │
│      │                                                                           │
│      ├─► node_repl（JS 内核，源自 qwen-code qwen_node_repl，ELECTRON_RUN_AS_NODE） │
│      │    └─ @qoder-space/computer-use-sdk（内置）                                │
│      │         ├─ ComputerUse.create() ── UDS ──► [A] Qoder Computer Use.app      │
│      │         └─ createBrowserAgent() ── HTTP loopback ──► 主进程 browser-use 桥 │
│      │                                                                           │
│      ├─► [browser-use] 内置 MCP server（16 工具 = chrome-devtools-mcp 基线）        │
│      │     ├─ in-app 浏览器：WebContentsView，会话 chat:<sid>:browser:，           │
│      │     │   分区 Partitions/qoder-browser，internet policy 门                  │
│      │     └─ 外部浏览器：经 Browser Connector 中继到 Chrome/Edge 扩展内执行        │
│      │                                                                           │
│      └─► qoder.computer-control 插件（开关默认 false）                             │
│           ├─ computerUse（mac）：SKILL.md 注入 → node_repl SDK → [A]              │
│           ├─ computerUseWindows：MCP stdio → launcher execve → Bridge/EXE         │
│           ├─ recordAndReplay：MCP "event-stream" → Runtime 事件流录制              │
│           └─ browserUse：SKILL.md 注入 → createBrowserAgent（需 Connector）        │
│                                                                                  │
│  Native Messaging host（com.qoder.app.connector）                                 │
│    manifest 写入 Chrome/Edge/Brave/Opera/Vivaldi/Quark；扩展经 4 字节长度前缀      │
│    JSON 读 ~/.qoder/browser-connector/clients/*.json（port+pid 心跳）→ 连回主进程  │
└──────────────┬───────────────────────────────────────────────┬───────────────────┘
               │                                               │
┌──────────────▼───────────────────────┐        ┌──────────────▼──────────────────┐
│ [A] Qoder Computer Use.app 1.0.12    │        │ 用户 Chrome/Edge                 │
│ （~/.qoder/bin/qoder-computer-use/） │        │  Qoder Browser Connector 扩展    │
│  Runtime（Swift，com.qoder.computeruse）│      │   · AX 快照/截图/上传确认在扩展侧 │
│   AX 树 + CGEvent 合成 + ScreenCaptureKit│     │   · CDP 允许列表 / WebMCP        │
│   PiP(XPC ViewBridge) + appshot 流    │        │   · 合成 DOM 事件/CDP 限定调用    │
│  Bridge（com.qoder.computeruse.bridge）│       └─────────────────────────────────┘
│   stdio MCP 入口（Win CU / 录制事件流） │
│  TCC：Accessibility + Screen Recording│
│  per-app 审批（ComputerUseAppApprovals.json）│
└───────────────────────────────────────┘
```

## 能力矩阵

| 维度 | Computer Use（静态还原，本机未启用） | Browser Use（in-app 本机已用；connector 未启用） |
|---|---|---|
| 提供形态 | app-plugin `qoder.computer-control` 子插件 `computerUse` v1.0.1（SKILL 注入 + node_repl SDK；无独立 MCP） | ① 主进程内置 MCP server `browser-use`（16 工具）；② 插件子项 `browserUse` v1.0.0（SKILL 注入 Browser Agent API） |
| 目标域 | 单个 macOS app（app 级快照与动作）；Windows 走独立 MCP 工具面 | ① Qoder 内嵌浏览器标签（会话私有，`chat:<sid>:browser:*`）；② 用户已连接的 Chrome/Edge（新标签或 claim 已开标签） |
| 承载进程 | `Qoder Computer Use.app` 1.0.12（Runtime + Bridge，Swift，com.qoder.computeruse[.bridge]） | ① 主进程 WebContentsView；② 浏览器扩展（执行体）+ Native Messaging host（发现体） |
| 观察机制 | AX 树文本（elementIndex 行，含 Description/Value/settable/actions；diff）+ ScreenCaptureKit 截图（按 capture policy 附带）；动作后自动回传 post-action 状态 | AX 树文本快照 + uid/ref 句柄（take_snapshot / tab.ax.get，diff 默认开）；截图（png/jpeg/webp）为辅助证据；网络/控制台摘要 |
| 动作机制 | AX 语义动作优先（elementIndex），CGEvent 合成兜底（坐标点击/键入/滚动/拖拽）；`set_value` 走 AXValue | in-app：webContents 合成输入 + 脚本；外部：扩展内 Playwright 语义动作；CUA/坐标动作为第三层降级 |
| 引用稳定性 | elementIndex 只对最近一次快照有效；坐标要求"截图未过期 + 窗口几何未变"，否则拒绝 | ref/uid 只对最近一次快照有效；claim 标签一次性 opaque id、标题/URL 变化即 fail-closed |
| 工具数 | SDK 11 方法（click/drag/getAppState/listApps/paste/performSecondaryAction/pressKey/scroll/selectText/setValue/typeText）；Windows MCP 16 工具；Record&Replay 3 工具 | 16 工具（两后端同面：list_pages/select_page/navigate_page/click/hover/fill/drag/upload_file/press_key/handle_dialog/take_snapshot/wait_for/take_screenshot/evaluate_script/list_network_requests/list_console_messages）；Browser Agent API 为对象方法面 |
| 权限门 | TCC 双权限（Accessibility + Screen Recording）+ 自有授权窗口 + permission-pending 工具语义 + per-app 审批 + URL 禁区 + 对端签名信任链 + 请求准入限制 | in-app：internet policy（断网撤销/导航拦截）；外部：扩展执行时逐动作确认、上传路径工作区校验、凭据字段硬禁、CDP 允许列表、CAPTCHA 强制人工接管 |
| 默认状态 | 关（`computerUse.enabled=false`；本机 `~/.qoder/ipc/` 为空，无运行痕迹） | in-app server 随主进程提供（本机已用）；connector 相关开关默认关（`browser-connector/` 目录不存在） |
| 本机痕迹 | 无启用痕迹（Runtime app 已由 bundled-resources 校验安装到 `~/.qoder/bin/qoder-computer-use/`） | `~/.qoder/logs/sessions/-Volumes-YANG-flova/.../2026-10-05T03-55-31-*.jsonl`（8873 行，browser-use 工具调用 42 次） |
| 错误处理 | `ComputerUseError` 携带完整 result（text+images）；错误文案强约束"先观察再重试，不盲目重放" | 结构化错误码（`BROWSER_CONNECTOR_*`/`BROWSER_HOST_STALE`/`TURN_CONTEXT_REQUIRED` 等）+ 动态文档系统（`agent.documentation.get()`） |

## 与被测 7 家的谱系对照

- **qwen/通义系血缘（确证）**：node_repl 内核直接迁自阿里 qwen-code 仓库 `packages/qwen_node_repl`（UPSTREAM.md 原文，Apache-2.0）；CU SDK 注释自述与 "qcum 的应用级快照契约一致，不伪造 qwen 的窗口 ID 或元素 token"。CU 信任 bundle 列表含 `com.aliyun.lingma.ide`。这与 ZCode 分册观察到的 `node_repl` 工具面（`nodeRepl.write/emitImage/signal`、`node_repl_wait/cancel/reset`）**API 同构**——ZCode 分册未记载其内核上游，此处仅标注"API 同构、疑同源"（推断）。
- **非 Claude Code 协议兼容端**：自研 wire 协议（`WIRE_PROTOCOL_VERSION 1.5.0`，`@ali/qoder-agent-sdk-next`），但 agent 工具命名（Read/Write/Edit/Glob/Grep/Bash/Task*/AskUserQuestion）与 Claude Code 习惯同构；SKILL.md 格式（frontmatter name/description + `~/.qoder/skills/`）与 Claude Code skills 兼容，且 `~/.qoder/skills/` 下存在大量指向 `~/.agents/skills` 的用户符号链接。
- **MCP 生态**：一等公民。依赖 `@modelcontextprotocol/client|node|server`；内置 server 前缀 `browser-use/chrome-devtools/computer-use/genui/schedule/node-repl`；市场插件可装 `chrome-devtools-mcp` 等（本机 settings.json 已启用 13 个市场插件）；`mcp_connection_profiles`/`mcp_oauth_credentials` 落 SQLite。
- **非 trycua 系**：CU Runtime/Bridge 为 Qoder 自研 Swift 模块（`ComputerUseMCP`/`ComputerUsePlatform`/`AccessibilitySupport`），与 trycua/cua 无符号交集（对比 MiniMax/Synara 分册的 `@trycua/cua-driver`）。
- **BU SDK 命名撞车**：`third_party/browser-use-sdk` 是 Qoder 自研 SDK（README 自述，Apache-2.0，Copyright 2026 Qoder），并非开源项目 browser-use 的代码；其设计（AX 优先 + Playwright locator + 受限 CDP）与 browser-use 社区版同思路但独立实现。

## 快速复核入口

```bash
# 载体与版本
plutil -p /Applications/Qoder.app/Contents/Info.plist | grep -E "Version|Identifier"
cat /Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/.qoder-app-plugin/plugin.json | head -30
plutil -p ~/.qoder/bin/qoder-computer-use/Qoder\ Computer\ Use.app/Contents/Info.plist | grep -E "Version|Identifier|Trusted"

# 能力面
ls /Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/dist/cli/
cat /Applications/Qoder.app/Contents/Resources/node-repl/UPSTREAM.md
ls /Applications/Qoder.app/Contents/Resources/node-repl/node_modules/@qoder-space/computer-use-sdk/source/

# 传输与注册表（未启用时应为空）
ls -la ~/.qoder/ipc/
strings -a ~/.qoder/bin/qoder-computer-use/Qoder\ Computer\ Use.app/Contents/MacOS/QoderComputerUseRuntime | grep -m3 ComputerUseIPC

# 本机 BU 使用痕迹
grep -o "mcp__browser-use__[a-z_]*" ~/.qoder/logs/sessions/-Volumes-YANG-flova/*/segments/*.jsonl | sort | uniq -c
```
