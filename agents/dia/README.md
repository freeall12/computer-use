# Dia（The Browser Company of New York）· AI 浏览器的"Claude Code 白盒"路线

> 逆向对象：Dia 1.51.1 (88214)，macOS arm64（Chromium 深度定制 + Swift 主 app）。
> 来源：官方直链 DMG（853MB，构建于 2026-10-07），hdiutil 只读挂载拷贝，**未安装、未启动**；纯静态分析，不碰凭据。
> 分析副本：`/Volumes/YANG/apps-re/dia/Dia.app`。全部证据见 [evidence/inventory.md](evidence/inventory.md)。

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | CU 判定书：无桌面控制——三重负证据 + Claude SDK computer-use MCP 预埋未接通 |
| [browser-use.md](browser-use.md) | BU 完整逆向：browser_use 单 REPL 工具、Playwright 子集 over CDP、SDK subagent 编排、三层安全闸门 |
| [evidence/inventory.md](evidence/inventory.md) | 证据清单：agent-server-resources 全景、双层 Seatbelt profile、80 工具 schema、45 个 agent 规格、模型路由 |

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 载体 | Dia.app 1.51.1 + 内嵌 agent-server 三件套（Bun 编译，共 ~350MB） |
| 形态 | **整包内嵌 Claude Code SDK 2.1.280**（`claudeCodeVersion: "2.1.280"`）+ dia-tools MCP |
| CU 工具面 | **0 个**——无 AX/CGEvent/截图，链路缺整个执行层 |
| BU 工具面 | 1 个 `browser_use` REPL + 6 个浏览器辅助工具（80 工具 MCP 之内） |
| 安全模型 | 双层 Seatbelt · 委派级授权门 · untrusted-data 免疫 |
| 本机可用 | ⚙️ 代码与配置完整（未启动验证；CU 恒 ❌） |

## 架构一图（本机可见层；云端网关不可见）

```
Dia 主 app（Swift，AgentServerManager.swift）
 └─ 每浏览器 profile 拉起 agent-server（sandbox-exec → agent.sb；本地 8765-8768 + Unix socket）
     ├─ 内嵌 AI 网关 ──→ 云端模型（opus / gpt-5.6-luna / gemini-3-flash；URL 运行时注入，未硬编码）
     ├─ handler = dia-tools MCP（Bun）：
     │    ├─ 80 工具：浏览器 7 件 + 记忆/工件 + 22 家 SaaS 连接器（tool-groups 读/写分级）
     │    └─ browser_use：@replayio/playwright 子集 REPL（30s/格、50 请求/格）
     │         └─ CDP（DevToolsActivePort）→ Dia 浏览器（用户登录态 profile）
     └─ 逐上下文 claude CLI（sandbox-exec → agent-claude-code.sb；出网仅 localhost 网关）
          ├─ spec.yaml 白名单（45 个命名 agent，harness 全部 claude-sdk）
          ├─ subagent browser-use（单工具、gpt-5.6-luna、禁问用户）
          └─ .claude/skills/（Claude Code 同格式；agent 只读）
```

## TL;DR（30 秒版）

1. **Dia 把整个 agent 运行时外包给了 Claude Code**：`agent-server-resources/dist/` 内嵌 Bun 编译的 agent-server + claude CLI（SDK 2.1.280）+ MCP handler，外加两份 Seatbelt profile 和 45 个 agent 规格——工程上是一个"披着浏览器的 Claude Code 发行版"，自研的是 Swift 侧编排与 UI。
2. **Computer Use = 0**：主二进制无 AXUIElement/CGEvent，80 工具无屏幕类，沙箱无屏幕权限面。但内嵌 claude CLI 自带完整 computer-use MCP（`computer-use-swift.js`），且 UI 有 `ComputerUseState` 渲染态——**SDK 预埋未接通**，是路线选择而非能力缺失。
3. **Browser Use 是唯一动作通道**：`browser_use` 是跑在 OS 沙箱 worker 里的 JS REPL（Playwright 子集 API、a11y 快照 diff 观察、ref 句柄、无截图、无 raw CDP/page.evaluate），驱动用户本人已登录的浏览器。
4. **多模型一底座**：主力 claude-opus-4-6[1m]，浏览器子代理 gpt-5.6-luna（effort low——快模型做手、强模型做脑），桌面小任务 gemini-3-flash；OpenAI/Google 模型经同一 Claude SDK harness 路由。
5. **安全三层闸门**：进程层（双层 Seatbelt，白名单 12 个 shell 工具、网络仅本地网关、skills 只读、屏蔽宿主 ClaudeCode 托管策略）；授权层（购买/发消息/删除需父级显式传授权，否则回传 `exact pending action`）；内容层（观察自带 `contentIsUntrusted:true`、`url://` 短链不可伪造）。**授权粒度是委派级，无逐动作弹窗。**
6. **登录态即能力面**：`fetch_web_content lets you browse the web as the user`——22 家 SaaS 连接器 + 用户身份浏览双轨；对比 Devin 的云隔离，Dia 反向把"用户真实会话"作为核心资产。
7. **Skills = Claude Code 格式**：用户自定义 `.claude/skills/SKILL.md`（app 管理、agent 只读），内置 8 个 first-party skills 带 feature flag 条件挂载。
8. **与 Arc 的关系**：同一 BoostBrowser 框架与 ArcCore（Chromium 底座）；AgentServer/SupertabEngine 是 Arc 之后新增的 Swift 模块。**browser-only 路线是产品判断**：把"computer"收窄为"已登录的浏览器会话"。

## 快速复核入口

```bash
A=/Volumes/YANG/apps-re/dia/Dia.app
cat "$A/Contents/Resources/agent-server-resources/dist/info.json"          # SDK 版本铁证
cat "$A/Contents/Resources/agent-server-resources/dist/agents/browser-use/spec.yaml"
strings -a "$A/Contents/MacOS/Dia" | grep -cE 'AXUIElement|CGEvent'        # 0 = 无 CU
find "$A/Contents/Resources/agent-server-resources/dist" -name "spec.yaml" | wc -l   # 43 agents
```

> 合规声明：只读静态分析；未运行安装器、未启动 app、未触碰凭据；专有代码仅 ≤5 行引用进 evidence。
