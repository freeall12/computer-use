# ZCode 桌面 Agent · Computer Use 与 Browser Use 逆向总览

> 一句话结论：**两个能力共用一个 `mcp__node_repl__js` 工具；模型可见面不是工具列表，而是 skill + 按需文档 + JS SDK 对象——桌面走「Worker→宿主→Helper→AX」五层，浏览器走宿主 IAB；面对 Codex 逐字对齐，安全语义自研加固。**

| 项 | 值 |
|---|---|
| 载体 | computer-use 插件 0.6.3 · browser-use 插件 0.5.1 · node-repl-host 0.6.0 · CUA Helper 3.14.4（ZCode.app 2026-09-29 构建） |
| 形态 | 共享 MCP server（每 call 全新 Node Worker）+ Symbol 桥接器 + SDK 绑定对象 |
| CU 工具面 | 14 个 app/窗口级工具 · accessibility first |
| BU 工具面 | 命令袋约 25 + Playwright action 袋 · IAB / extension / cdp 三后端 |
| 安全模型 | TCC 只挂 Helper · 租约 + 防重放 · kill switch · 子代理禁用 · fail-closed |
| 本机可用 | ✅ CU/BU 均有运行实证（2026-10 基线） |

方法：只读静态分析（插件源码、app.asar 解包、原生二进制 nm/otool/strings）+ 本机运行日志实证。证据见 [evidence/inventory.md](evidence/inventory.md)。

## 架构一图

```
模型（GLM）── 读 skill/docs，写 JavaScript（每 call 全新 Worker）
 ▼ mcp__node_repl__js（node-repl-host 0.6.0，注入两个 Symbol.for 桥接器）
 ├─ CU：桥 → in-process broker（znrc-*.sock + token）
 │    → Helper「ZCode Computer Use.app」（Node SEA 111MB，懒启动，权限中介 broker.sock）
 │      → ax_native.node：AX 观察+语义动作 · CGEvent 事件兜底 · ScreenCaptureKit 窗口栅格
 └─ BU：桥 → 桌面宿主浏览器 broker（socket+token，NDJSON + zod）
      → executeBrowserCommandOnView → IAB（Electron BrowserView + Chromium）
        DOM 快照 · Playwright locator · cua 坐标 / dom_cua · WebM 录制（内置 MediaRecorder）
```

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | 桌面控制：14 工具面、观察双基线、动作双路径、五道安全闸、与 Codex 对齐 |
| [browser-use.md](browser-use.md) | 浏览器控制：对象模型、三交互路径、录屏、安全边界 |
| [evidence/inventory.md](evidence/inventory.md) | 载体清单、关键摘录、符号表、日志实证、置信度标注 |

## 能力矩阵：CU vs BU

| 维度 | Computer Use | Browser Use |
|---|---|---|
| 模型入口 | `agent.computerUse.*`（SDK） | `agent.browsers.*`（SDK） |
| 底层工具数 | 14（app/窗口级） | 命令袋约 25 + playwright action 袋 |
| 主观察 / 副观察 | AX 树 diff 台账 / 窗口栅格（ScreenCaptureKit） | DOM 快照（AI/ARIA）/ 截图、elementInfo |
| 主动作 / 兜底 | AX 语义动作 / CGEvent 坐标+键盘 | Playwright locator、dom_cua ref / tab.cua 坐标 |
| 目标寻址 | 元素 index（观察期重编号）/ 栅格像素 | snapshot `ref` / 视口像素 / CSS selector |
| 焦点策略 | 永不抢焦点（event 要求已在前台） | tab 激活仅限前台会话 |
| 多实例隔离 | 控制器租约（CONTROLLER_BUSY） | browserGeneration 陈旧防护 |
| 权限 | TCC Accessibility + Screen Recording | 无（自家 WebView） |
| 录制 | —（PiP 是 UX 展示，非数据交付） | `tab.recording` → WebM（90s 上限） |
| 子代理 / kill switch | 禁用 / `stop_computer_control` | 禁用 / —（tab.close / 进程退出） |
| 对齐来源 | Codex `@oai/cua@0.2.4`（[codex 分册](../codex/computer-use.md)） | Codex 浏览器对象模型（[codex 分册](../codex/browser-use.md)） |

## 安全模型：双轨同构

| 闸 | CU | BU |
|---|---|---|
| OS 权限 | TCC 双权限只挂 Helper | 无需（WebView 是自家进程） |
| 并发防护 | CONTROLLER_BUSY 租约（永不重试） | browserGeneration 陈旧路由防护 |
| 防重放 | possibly_sent → 只许先观察再决定 | —（查询类天然幂等） |
| 总闸 | `stop_computer_control` 闩锁（两豁免） | —（tab.close / 进程退出） |
| 子代理 | 禁用（桥接层抛错） | 同左 |
| 兜底 | 元素消失/帧过期/schema 违规/收据缺字段一律报错不猜 | 后端广告制；导航域限 http(s)/about:blank |

> 演进：`zcode-cua` 0.5.12（独立 MCP server，屏幕级 25 工具）→ 0.6.3（SDK + skill-only 插件，app 级 14 工具）；`browser-use` ≤0.4.2（自带 18.6MB dist server）→ 0.5.1（零 dist，宿主独立为 node-repl-host）。

## 复核指引（低置信度点，详见 evidence §4）

| 点 | 现状 |
|---|---|
| controller lease 桌面宿主实现 | SDK/工具层语义确凿；宿主授予/回收代码未解包到（可选注入） |
| PiP/Ghost 触发策略 | 符号+日志证明存在并按 session/turn 复位；何时显示/如何关闭未见源码 |
| `extension` 后端 | 仅类型枚举与 manifest 条目，本机无运行证据 |
| Codex 对齐逐字程度 | 依据 SDK 头注释自述，未对照 Codex 原始代码 |
| 浏览器 broker 监听位置 | 请求 schema/env 确凿；host 侧 server 代码因压缩未逐行核证（main 侧 `executeBrowserCommandOnView` 已核证） |
