# Kimi Code：Computer Use 与 Browser Use 逆向总览

> 对象：Moonshot AI（月之暗面）Kimi Code 编码 Agent 在本机（macOS arm64，2026-10-06）的全部桌面控制 / 浏览器控制痕迹。
> 方法：只读静态分析（otool/nm/strings、@electron/asar 解包、Node SEA 内嵌 JS 提取、Go 二进制 strings）+ 只读探针（`kimi-cu service-status`/`xpc-ping`）+ 官方 skill/插件明文直读 + 真实会话实录比对。
> 分文档：[computer-use.md](computer-use.md)（桌面控制）｜[browser-use.md](browser-use.md)（浏览器控制）｜[evidence/inventory.md](evidence/inventory.md)（证据底账）。

## TL;DR

1. Kimi Code 的 agent 内核**没有内置** CU/BU 工具——CLI 是 Node.js 单文件可执行（v0.39.1，内嵌 `agent-core-v2` 包树），CU/BU 全部以**官方插件（managed plugin，CDN 分发 zip）+ MCP** 形态挂载；桌面端再叠一条内嵌浏览器 MCP。
2. **Computer Use = KimiCU**：独立 Swift 原生 app（`/Applications/KimiCU.app` v0.6.6，bundle id `ai.kimi.cu`）以 launchd Mach service 常驻，独占 TCC「辅助功能+屏幕录制」；CLI 经 stdio MCP（18 工具 + `js`/`js_reset`）或 node-repl JS facade `@kimi/cu` 调用 UDS（token 认证、`KimiCU-UDS-1` 帧协议）。产品主打"**后台定向输入**"：不动真实光标、不抢前台、不用 HID；观察 = ScreenCaptureKit 截图 + 收敛 AX 树（会话 diff + snapshot_id 绑定），动作 = SkyLight 窗口路由 / postToPid 签名事件（后台 Chromium 键盘机制公开致谢 Cua AI）。
3. **Browser Use 有三条链路**：① `kimi-webbridge` Go 守护进程（127.0.0.1:10086）+ 用户浏览器扩展（WS 反连），复用真实登录态，AX 树快照 + `@e` refs + 合成 DOM 事件，`cdp`（chrome.debugger）逃生舱；② Kimi Code Desktop 内嵌浏览器，per-session HTTP MCP 暴露单一 `run` 工具（协议 `kimi.browser/1.0.0`，43 操作），带 agent 活动浮层、用户接管、30 天动作 receipts 审计、双隔离世界注入；③ 旧独立 skill 形态已迁移备份。
4. 谱系：与 Claude Code 无协议兼容；CU 架构与 ZCode cua-helper 同构（独立 Helper 持权限 + 本地 IPC 鉴权 + 工具面隔离原生 API）但实现独立；唯一官方声明的技术借鉴是 Cua AI 的签名键盘事件机制。

## 能力载体清单

| 载体 | 路径 / 标识 | 版本 | 角色 |
|---|---|---|---|
| CLI | `/Users/laplace/.kimi-code/bin/kimi` | 0.39.1（CDN latest 0.43.1） | 主 agent（Node SEA；包树 agent-core-v2/kap-server/pi-tui/acp-server…） |
| 桌面端 | `/Applications/Kimi Code.app`（`com.kimi.code.desktop`） | 1.0.4（Electron，asar） | GUI + 内嵌 agent 服务 + 内嵌浏览器 + Browser MCP |
| CU 服务 | `/Applications/KimiCU.app`（`ai.kimi.cu`）＋launchd `ai.kimi.cu.service` | 0.6.6 | 桌面控制：观察/输入/截图/浮层/权限 |
| CU UDS | `~/Library/Application Support/KimiCU/runtime.sock` + `runtime.token` | — | 服务唯一入口（本机实测 listening） |
| CU node-repl | `KimiCU.app/Contents/Resources/node-repl/` | — | `js` 工具沙箱（bin/node + kernel/trusted-worker + meriyah） |
| CU CLI 插件 | `~/.kimi-code/plugins/managed/kimi-cu` | 0.6.3 | MCP 挂载（`bin/kimi-cu-mcp` wrapper → `kimi-cu mcp`）+ 两个官方 skill（kimi-cu、cu-drawing） |
| 浏览器桥 | `~/.kimi-webbridge/bin/kimi-webbridge`（Go，`dev.msh.team/harness/agent-extension`） | v2.0.22 | daemon：HTTP /command ↔ WS 扩展 |
| 浏览器扩展 | Chrome `fldmhceldgbpfpkbgopacenieobmligc` / Edge `bnlffdbcfnanfbknnlaflhlhkocccckg` | 与 daemon 配对 | 页面观察/动作执行者 |
| BU CLI 插件 | `~/.kimi-code/plugins/managed/kimi-webbridge` | 1.11.3 | kimi-webbridge skill 分发 |
| 遗留注册 | `~/.kimi-code/mcp.json` → `kimi-cu mcp -s user` | — | capability 层自动迁移到插件 |

## 架构分层图

```
┌────────────────────────  用户界面层  ────────────────────────┐
│  pi-tui 终端 TUI            Kimi Code Desktop (Electron 1.0.4)│
│                             ├─ 渲染器/会话面板/内嵌浏览器面板   │
│                             │    · agent 活动浮层(14 类活动)   │
│                             │    · 指针/键入可视化 + 用户接管   │
│                             │    · 动作 receipts 审计(30 天)   │
├────────────────────────────  Agent 内核层  ─────────────────┤
│  kimi CLI (Node SEA 0.39.1)      桌面内嵌同一 agent-core-v2   │
│   ├ agent/tools/*(bash/edit/read/write/web-search/task…)     │
│   ├ capability 层: entries/kimiCu.ts · kimiWebbridge.ts      │
│   │   (detect / install / 健康探测 / legacy 迁移)             │
│   ├ 插件管理(managed plugins, CDN zip) + MCP 客户端          │
│   └ providers: type=kimi(api.kimi.com) / type=openai(自建网关)│
├────────────────────────────  工具面层  ─────────────────────┤
│ CU: kimi-cu MCP(stdio) 18 工具 + js/js_reset                 │
│ BU-A: kimi-webbridge skill → HTTP POST /command(14+ 命令)     │
│ BU-B: desktop_browser MCP(HTTP, per-session) 单 run 工具×43  │
├────────────────────────────  桥接/Helper 层  ────────────────┤
│ kimi-cu: stdio→进程内 MCPServer ─ UDS runtime.sock(token,     │
│          KimiCU-UDS-1 帧, observation_context, 版本门,        │
│          approval_token) ─► launchd service(ai.kimi.cu.service)│
│ webbridge: 127.0.0.1:10086 HTTP ─ WS ◄─ MV3 扩展反连          │
│ desktop browser: HTTP MCP(X-Kimi-Session-Id) → Electron 主进程│
├────────────────────────────  OS 能力层  ────────────────────┤
│ CU: AXRuntime(AXTree/AXAction) · ScreenCaptureKit(截图+diff)  │
│     SkyLight(窗口路由事件) · SLSEventAuthenticationMessage+    │
│     SLEventPostToPid(后台签名键盘) · CGEventPostToPid(回退)    │
│     Pasteboard(paste) · Overlay(NSWindow 浮层) · TCC          │
│ BU-A: chrome.debugger · chrome.scripting · DOM 合成事件        │
│ BU-B: Electron WebContents(隔离世界 1001/1002 注入) · 原生截图 │
└──────────────────────────────────────────────────────────────┘
```

## 能力矩阵

| 能力 | KimiCU（CU） | webbridge（BU-A） | 桌面内嵌浏览器（BU-B） |
|---|---|---|---|
| 观察原语 | AX 树（index）+ 截图（像素）+ 会话 diff + rect 局部 | AX 语义树快照（`@e` refs）+ 截图写盘 + iframe 句柄读取 | TOON 文本/元素/视觉三模快照 + crop + wait_for 条件 |
| 目标绑定 | window/app/pid + `snapshot_id`（跨上下文拒绝）+ `screenshot_id` | tab（session 组、借用 `borrowed:true`） | tabId + snapshotId/ref（回合过期） |
| 点击 | 后台定向（SkyLight 路由/public postToPid 双通道）、右/中键、双击、长按 | 合成 `el.click()` | element.click / visual.click(+click_if_interactive) |
| 文本 | type_text（clear/submit/回读验证）、paste(text/md/html)、set_value（AXValue/后台替换）、select_text | fill（value/contenteditable 双模式） | element.fill/type_text/select_option/set_checked、visual.type_text/press_key |
| 按键 | press_key xdotool DSL、批量、完全遮挡可落地 | 无独立按键（evaluate 派发 KeyboardEvent） | press_key（焦点元素） |
| 滚动 | page/dx/dy、元素级 AX 滚动、移动检测 ok:false | evaluate 滚动 | visual.scroll(delta) / element.scroll_into_view |
| 拖拽 | drag（hold/step 插值）+ drag_paths 批量笔画（≤500×1024 点）+ 用户光标守卫 | — | visual.drag |
| 代码模式 | `js`/`js_reset`（node-repl 持久 cell + `@kimi/cu` facade） | `evaluate`（页面 realm） | — |
| 网络/文件 | — | network 抓包（含响应体）、upload、save_as_pdf（≤100MB） | 下载管理、打印 |
| 验证 | verify_after 后验证、verified/verification_required/effect 三态 | 调用返回值 + 重观察纪律 | wait_for 条件 + lastObserved 证据 |
| 用户共存 | 不动真实光标/不抢前台/never-front、abort_if_cursor_in_window | 只动自己 session 组的 tab、借用即还 | 控制权回合过期、BROWSER_USER_TAKEOVER 即停、活动全程可视 |
| 权限 | TCC 辅助功能+屏幕录制（服务持有） | 用户装扩展 + 连本地 daemon | 站点权限走桌面审批（browser-permission-requests） |
| 审计 | debug_tap 事件日志（/tmp）、Telemetry 模块 | daemon.log + 遥测（DataRangers） | receipts 30 天 + 84 通道状态 |

## 与同类 Agent 的架构对照

| 维度 | Kimi Code | ZCode（本机逆向笔记） | Codex（本机痕迹） | Claude Code |
|---|---|---|---|---|
| CU Helper | Swift .app + launchd 按需常驻，服务持 TCC | JS broker helper + ax_native.node，host 每次拉起+一次性 token | ——（未发现桌面 CU） | ——（官方无） |
| CU IPC | UDS + token + 长度帧（8MiB） | NDJSON/UDS（随机 sock）/ Win 命名管道 | —— | —— |
| CU 工具面 | 18 + js/js_reset | 30（63 broker 方法） | —— | —— |
| 特色 | 后台输入不抢电脑、代码模式批量、观察上下文隔离 | controllerLease、PiP、Ghost 光标、证据链截图 | chrome-native-hosts（native messaging 方向） | —— |
| BU 形态 | daemon+扩展（WS）与内嵌浏览器（MCP）双轨 | IAB/CDP 单链路 | 扩展 + native messaging 痕迹 | 官方无（社区 MCP） |
| 内核谱系 | 自研 agent-core-v2；多 provider（kimi/openai 兼容端） | 自研 | 自研 | 自研（ANTHROPIC 协议） |
| 官方致谢借鉴 | Cua AI（trycua/cua）签名键盘机制 | —— | —— | —— |

同构结论：KimiCU 与 ZCode cua-helper 属**同一设计范式**（独立 Helper + 权限中介 + AX/合成事件 + 工具面隔离原生 API），实现零共享、工具名趋同；Kimi 的 BU 则是市场上少见的「双轨」：真实浏览器（登录态复用）与内嵌浏览器（可控可审计）分治。

## 快速复现实测

```bash
# CU 服务状态与权限（只读）
/Applications/KimiCU.app/Contents/MacOS/kimi-cu service-status
/Applications/KimiCU.app/Contents/MacOS/kimi-cu xpc-ping

# CU MCP server 手动起（stdio JSON-RPC）
/Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp

# webbridge daemon 状态
~/.kimi-webbridge/bin/kimi-webbridge status

# 官方 skill 取证（公开 CDN）
curl -sO https://cdn.kimi.com/webbridge/v2.0.22/skills/kimi-webbridge.tar.gz
```

## 阅读顺序建议

1. [evidence/inventory.md](evidence/inventory.md) —— 所有路径、版本、命令输出的原始底账
2. [computer-use.md](computer-use.md) —— 18+2 工具逐一参数级还原、SkyLight/SignedKeyboard 动作机制、安全模型
3. [browser-use.md](browser-use.md) —— 三链路、命令协议、`run` 工具 43 操作、接管/收据设计
