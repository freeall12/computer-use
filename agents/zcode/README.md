# ZCode 桌面 Agent 的 Computer Use 与 Browser Use 能力逆向

> 本目录是对本机 ZCode 桌面 Agent 两大原生控制能力的完整逆向文档。
> 分析基线：computer-use 插件 0.6.3 / browser-use 插件 0.5.1 / node-repl-host 0.6.0 /
> CUA Helper 3.14.4（ZCode.app 2026-09-29 构建）。方法：只读静态分析（插件源码、app.asar 解包、
> 原生二进制 nm/otool/strings）+ 本机运行日志实证。所有结论的证据见
> [evidence/inventory.md](evidence/inventory.md)。

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | 原生桌面控制：五层架构、14 工具面、观察/动作机制、安全模型、与 Codex 的对齐 |
| [browser-use.md](browser-use.md) | 浏览器控制：IAB/CDP 双后端、对象模型、Playwright/CUA/DomCUA 三路径、录屏 |
| [evidence/inventory.md](evidence/inventory.md) | 载体清单、关键摘录、符号表、日志实证、复现命令 |

## TL;DR

1. **两个能力共用一个 MCP 工具**：`mcp__node_repl__js`（进程 `zcode-node-repl-mcp`，由共享插件
   `node-repl-host` 提供）。每次 `js` 调用 = 一个**全新 Node Worker**；跨调用连续性不靠 JS 全局，
   靠两条「Symbol 桥接器 + 宿主侧会话」：
   - Computer Use：`Symbol.for("zcode.node-repl.computer-use-bridge")`
   - Browser Use：`Symbol.for("zcode.node-repl.browser-control-bridge")`

2. **模型可见面是 skill + 按需文档 + JS SDK**，不是裸工具列表：
   - Computer Use：`SKILL.md` 教模型 `import` 插件里的 `computer-use-client.mjs` 并用
     `agent.computerUse.getApp(...) → App` 绑定对象（与 Codex `@oai/cua@0.2.4` 的 `cua` 面
     逐字同构、去掉 browser 半边）；底层是 `agent.computerUse.computer.*` 的 **14 个存活工具**。
   - Browser Use：`control-browser` SKILL 教模型引导 `browser-client.mjs` 得到
     `agent.browsers → Browser → Tabs/Tab → playwright/cua/dom_cua/recording`，
     对象成员由 `docs/api.json`（manifest v11）+ Proxy 按后端能力动态显隐。

3. **Computer Use 链路**：Worker → 宿主内 broker（`znrc-*.sock`+token）→ Helper 权限中介
   （`/tmp/zcode-cua-<uid>/broker.sock`，IPC v2）→ `ax_native.node` →
   **AX（观察+语义动作，主路径）/ CGEvent（键盘与指针事件，兜底）/ ScreenCaptureKit（窗口栅格）**。
   Helper 是 Node SEA（111MB 主二进制 + 986KB 原生模块），懒启动、LSUIElement、
   Hardened Runtime + TeamID 硬校验。

4. **Browser Use 链路**：Worker → 桌面宿主浏览器 broker（socket+token）→
   Electron main 的 `executeBrowserCommandOnView` → IAB（`BrowserView`）。
   后端类型 `iab`（桌面内置）/ `extension` / `cdp`（CLI 显式 headless）；录屏用 Chromium
   内置 MediaRecorder 出 WebM（video2code 插件的上游）。

5. **安全模型双轨但同构**：
   - TCC 权限（Accessibility/Screen Recording）只挂在 Helper；
     浏览器侧无需系统权限（WebView 是自家进程）。
   - 租约：CUA 有 `CONTROLLER_BUSY`（另一会话占用输入，永不重试）；Browser 靠
     `browserGeneration` 陈旧路由防护。
   - 防重放：CUA 收据 `dispatch_status=possibly_sent` → `actionSent=true` → 只许「先观察再决定」；
     broker 响应丢失被显式建模为 `broker_response_ambiguous`（不可自动重试）。
   - kill switch：`stop_computer_control` 闩锁后所有工具入口 fail-hard（两豁免）。
   - 子代理全部禁用（`runtime_scope=subagent` 在桥接层直接抛错）。
   - fail-closed 全链：元素消失、帧过期、窗口降级、schema 违规、收据缺字段一律报错不猜。

6. **工程演进的清晰脉络**（旧版本对比）：
   - `zcode-cua` 0.5.12：独立 MCP server、25 个屏幕级工具（screenshot/open_application/
     mouse_move/list_displays…）→ 0.6.3：SDK+skill-only 插件、14 个 app/窗口级工具；
     启动并入 `get_app_state` 透明拉起。
   - `browser-use` ≤0.4.2：自带 7–18MB 的 `dist/mcp/server.js` → 0.5.1：零 dist，
     宿主独立为 `node-repl-host` 包（注册收在 CLI 核心，bua/cua 任一启用即挂载）。

## 架构分层图

```
模型（GLM）
  │ 读 skill/docs，写 JavaScript
  ▼
mcp__node_repl__js  ────────────── 共享 MCP server（node-repl-host 0.6.0，进程 zcode-node-repl-mcp）
  │ 每 call 全新 Worker；注入两个桥接器（Symbol.for）
  │
  ├─[Computer Use]──────────────────────────────────────────────────────────
  │  Worker: import <plugin>/scripts/computer-use-client.mjs
  │          setupComputerUseRuntime → agent.computerUse（App/Target/computer.*）
  │             │ bridge.call(method, args)      ← 严格 schema、动作收据解析、
  │             │                                   CUA_NOT_READY 重试、防重放
  │             ▼
  │  宿主工具层：AccessibilitySession（state/frame/模型可见树台账）、
  │             FrameRegistry(16帧)、ActionSettler(300ms~5s 稳定等待)、
  │             KillSwitch、控制器租约、tier 分层（READ_ONLY/T1_INPUT/SAFETY）
  │             │ in-process broker（/tmp/.../znrc-*.sock + token，1MiB/32MiB 帧）
  │             ▼
  │  Helper（ZCode Computer Use.app，Node SEA，懒启动，LSUIElement）
  │    · 权限中介 /tmp/zcode-cua-<uid>/broker.sock（IPC v2，对端校验）
  │    · snapshotCache(pid,window)、diff 基线、索引→native token 冻结映射
  │    · 合成焦点会话（后台键盘 *_to_app）、剪贴板借还、PiP/Ghost 反馈层
  │             │ ax_native.node（NAPI）
  │             ▼
  │  macOS：AXUIElement*（树/语义动作）· CGEvent（键盘/指针，窗口相对派发）
  │         ScreenCaptureKit(weak)+CoreMedia（窗口栅格 + surface 指纹）
  │
  └─[Browser Use]───────────────────────────────────────────────────────────
     Worker: import <plugin>/scripts/browser-client.mjs
             setupBrowserRuntime → agent.browsers（Browser/Tabs/Tab/…）
                │ bridge.execute(browserId, generation, command)
                ▼
     桌面宿主浏览器 broker（socket+token，NDJSON，zod 校验，32MiB 上限）
       · 后端注册表：iab / extension / cdp；BrowserControl tab 注册表
       · controlled tabs vs user tabs（claimTab 显式接管）
                │ executeBrowserCommandOnView(view, command)
                ▼
     Electron main + IAB（BrowserView + Chromium）
       · domSnapshot（AI/ARIA 树）· Playwright 语义命令（selector 串行化）
       · cua 坐标 / dom_cua node 路径 · Chromium 截图
       · WebM 录制（内置 MediaRecorder，无 FFmpeg 依赖）
```

## 能力矩阵

| 维度 | Computer Use | Browser Use |
|---|---|---|
| MCP 工具 | `mcp__node_repl__js`（共用） | 同左 |
| 模型入口 | `agent.computerUse.*`（SDK） | `agent.browsers.*`（SDK） |
| 底层工具数 | 14（app/窗口级） | 命令袋约 25 + playwright action 袋 |
| 主观察 | AX 树（delta diff + 台账） | DOM 快照（AI/ARIA） |
| 副观察 | 窗口栅格（ScreenCaptureKit） | 截图（Chromium）/ elementInfo |
| 主动作 | AX 语义动作（AXPress/AXValue…） | Playwright locator / dom_cua ref |
| 兜底动作 | CGEvent 坐标点击（窗口相对）+ 键盘 | `tab.cua` 坐标 / keypress |
| 目标寻址 | 元素 index（观察期重编号） / 栅格像素 | snapshot `ref` / viewport 像素 / CSS selector |
| 焦点策略 | 永不抢焦点（event 策略要求已在前台） | tab 激活仅限前台会话 |
| 多实例隔离 | 控制器租约（CONTROLLER_BUSY） | browserGeneration 陈旧防护 |
| 权限 | TCC Accessibility + Screen Recording | 无（自家 WebView） |
| 录制 | —（PiP 是 UX 展示，非数据交付） | `tab.recording` → WebM（90s 上限） |
| 子代理 | 禁用 | 禁用 |
| kill switch | `stop_computer_control` | —（tab.close / 进程退出） |
| 对齐来源 | Codex `@oai/cua@0.2.4` tinysky_alt | Codex 浏览器对象模型 |
| 剪贴板 | paste 借还系统剪贴板 | `downloadMedia` / filechooser 边界对齐 Codex |

## 复核指引

置信度较低、建议进一步核实的点（详见 evidence/inventory.md §4）：

1. **controller lease 的桌面宿主实现**：SDK/工具层语义确凿（错误码、不可重试、owner 报告），
   但桌面宿主（zcode-host-local）里租约的授予/回收代码未在解包产物中定位
   （`deps.controllerLease` 在 node-repl-host 是可选注入）。
2. **PiP/Ghost 的触发策略**：符号表与日志证明存在且按 session/turn 复位，
   但「何时显示、用户如何关闭」未见源码。
3. **`extension` 后端**：仅有类型枚举与 manifest 条目，本机无运行证据。
4. **Codex 对齐的逐字程度**：依据为 SDK 头注释自述与注释中引用的 codex 行为，
   未对照 Codex 原始代码。
5. **宿主浏览器 broker 的监听位置**：请求 schema 与 env 名在 node-repl-host 中确凿；
   zcode-host-local 侧的 server 代码因 host 产物高度压缩未能逐行核证（main 侧
   `executeBrowserCommandOnView` 已核证）。
