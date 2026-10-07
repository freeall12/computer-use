# ChatGPT Atlas（OpenAI）· AI 原生浏览器逆向总览

> 一句话结论：**浏览器即电脑——Atlas 把 Operator 的 `computer.*` 工具协议从云端浏览器搬到本地 Chromium，用 Playwright 式 ARIA 快照观察、JS 合成事件动手，全程不复用 ChatGPT.app 的 Sky 桌面栈。**

| 项 | 值 |
|---|---|
| 载体 | ChatGPT Atlas.app 1.2026.189.1（外层 Swift 壳）＋内层 Chromium 150.0.7871.115 fork（`com.openai.atlas.web`） |
| 形态 | Swift 壳 + fork Chromium（Mojo 桥 `owl.mojom.*`）+ 远程 chatgpt.com 前端；agent 逻辑全在 Swift `AuraAgents` 模块 |
| CU 工具面 | 16 条 `computer.*` 命令 · 动手靠 DOM（非 OS 注入） |
| BU 工具面 | Chromium 全量（扩展/DevTools/AppleScript）+ browser memories + side chat |
| 安全模型 | 登录态二态 + 全局/用户站点黑名单 + 自动审批分级 + Safe Mode |
| 本机可用 | ✅ 静态逆向完成；未安装未启动（2026-10 基线） |

## 架构一图

```
ChatGPT 后端（模型 + Operator 式 agent worker）
 │ WebSocket：RemoteBrowserCommand（type=computer.*）＋ 结果回传
 ▼
Swift 层 AuraAgents（"Dragonfruit" 运行时，本册代号原词）
 │  ConversationController / LocalToolManager / BrowserAuth / 审批
 │  chrome://agentviewer 围观接管；AgentCursor 虚拟光标
 ▼
owl.mojom.*（Swift ↔ fork Chromium 全量浏览器 API）
 │  WebView_EvaluateJavaScript / ExtractSerializedDom / TakeSnapshotWithOptions
 ▼
页面内注入：window.__pwInjected（Playwright 移植）
 │  incrementalAriaSnapshot(mode:'ai')、selector helpers、JS 合成 pointer 事件
 ▼
Chromium 150 fork（扩展 / DevTools / AppleScript / Native Messaging 目录）
```

## 与 ChatGPT.app（Codex 分册）栈同源性对照——本册最大价值

| 维度 | ChatGPT.app（Codex Desktop） | Atlas |
|---|---|---|
| 底层浏览器 | WKWebView/系统栈，桌面控制走 Sky 服务 | **fork Chromium 150**，页面即执行场 |
| 桌面 CUA | SkyComputerUseService（Swift，AX+CGEvent） | **无**——sky/tinysky/CUAService 字符串零命中 |
| 动作注入 | OS 级 CGEvent | 页面内 JS 合成 pointer/mouse 事件 |
| 观察 | AX 树 diff + ScreenCaptureKit 截屏 | Playwright ARIA 快照 + tab 截图 |
| 工具协议 | `cua` JS 对象（tinyskyAlt） | `computer.*` Operator 协议（GizmoAPI 注册） |
| 同源部分 | Team 2DC432GLL2；ChatGPT 扩展 id `hehgg…`；guardian/审批话术；通知回调 | 相同 |

> 结论：**同一账号体系与安全话术，两条完全独立的执行栈**。Atlas 是 Operator 血统，Codex 是 Sky 血统。

## 阅读路线

- 想看 agent 怎么动手：[computer-use.md](computer-use.md)（命令面 → 观察 → 动作 → 安全 → 对照表）
- 想看浏览器本体能力：[browser-use.md](browser-use.md)（Mojo 面 → memories → 扩展 → 端点）
- 想核对每条证据：[evidence/inventory.md](evidence/inventory.md)（全部路径、strings 原文、负证据）

## 载体清单

| # | 载体 | 路径 / 版本 | 角色 |
|---|---|---|---|
| 1 | 外层 Swift 壳 | `Contents/MacOS/ChatGPT Atlas`（165KB 启动器） | UI + AuraAgents |
| 2 | Aura.framework | 143MB Swift 主二进制（agent/settings/对话全在这） | 宿主逻辑 |
| 3 | 内层浏览器 app | `Contents/Support/ChatGPT Atlas.app`（`com.openai.atlas.web` 150.0.7871.115） | Chromium fork |
| 4 | ChatGPT Atlas Framework | 222MB Chromium 主二进制 + Renderer/GPU/Service/Alerts Helper | 浏览器引擎 |
| 5 | OwlBridge.dylib | 8.4MB | Owl/Chromium 桥接 |
| 6 | Aura_AuraAgents 等 138 个 bundle | `Contents/Resources/` | Swift 模块（代码静态链入 Aura，bundle 仅资源） |

> 演进：OpenAI Operator（2025-01 云端 CUA）→ ChatGPT agent mode（云端浏览器）→ Atlas（2025-10 起 agent mode 本地化，浏览器自己当"remote browser"）。
