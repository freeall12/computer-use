# Dia 的 Browser Use：真实登录态浏览器内的单工具操作员

> 结论先行：**Dia 的全部 agent 能力都长在一个工具上** —— `mcp__dia-tools__browser_use`，一个跑在 OS 沙箱 worker 里的 JavaScript REPL，用 Playwright 子集 API 驱动**用户本人已登录的 Dia 浏览器**。
> agent 骨架不是自研编排器，而是**整包内嵌 Claude Code SDK 2.1.280**（Bun 编译 claude CLI，217MB），browser-use 只是其中一个 SDK subagent。
> 全部证据见 [evidence/inventory.md](evidence/inventory.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| BU 工具面 | **1 个 REPL 工具**（browser_use）+ 6 个浏览器辅助工具（tabs/focus/fetch/search） |
| 架构 | 内嵌 Claude Agent SDK + dia-tools MCP（80 工具）+ Playwright-over-CDP |
| 目标域 | Dia 自己的浏览器、用户登录态（`websites in Dia's signed-in browser`） |
| 观察机制 | a11y 快照 diff（snapshotID 句柄、增量基线、100ms settled） |
| 动作机制 | Playwright 语义 DOM 动作（click/fill/selectOption/press…） |
| 安全模型 | 双层 Seatbelt + 授权随委派传递 + untrusted-data 注入防御 |
| 本机可用 | ⚙️ 静态还原（未启动验证运行链；代码与配置完整） |

## 架构一图

```
Dia 主 app（Swift，AgentServerManager）
 └─ 每浏览器 profile 拉起一个 agent-server（sandbox-exec → agent.sb，端口 8765-8768 + Unix socket）
     ├─ 内嵌 AI 网关（模型流量唯一出口，多供应商：opus / gpt-5.6-luna / gemini-3-flash）
     ├─ handler = dia-tools MCP server（Bun；80 工具 schema 在 tool-schemas/dia.json）
     │    └─ browser_use：@replayio/playwright 子集 REPL（30s/格、50 请求/格、32KiB 代码）
     │         └─ CDP（DevToolsActivePort 自动发现）→ Dia 浏览器（用户登录态 profile）
     └─ 逐上下文 spawn claude CLI（sandbox-exec → agent-claude-code.sb，出网仅 localhost:GATEWAY_PORT）
          ├─ spec.yaml 白名单（tool:dia:* + tool_groups 读/写分级）
          ├─ subagent: browser-use（gpt-5.6-luna, effort low, 仅 1 工具, 禁 AskUserQuestion）
          └─ skills = .claude/skills/SKILL.md（用户资产，agent 只读）
```

## 工具面：80 个工具里的浏览器七件

| 工具 | 参数要点 | 一句话语义 |
|---|---|---|
| browser_use | `code`（≤32KiB JS） | 沙箱 REPL 驱动浏览器，唯一动作通道 |
| read_tabs | metadata-only 优先 | 列出/读取已开标签页内容 |
| open_tabs | 支持 `url://n` 短链 | 开新页（短链由浏览器解析，禁止猜测） |
| close_tabs | 需先 read_tabs 取 ID | 关页（破坏性，仅精确匹配） |
| get_current_focus | — | 当前焦点页（Chat Context 的钩子） |
| fetch_web_content | url 或 url:// | **以用户登录态**抓取页面内容 |
| search_web | — | 联网搜索（无 URL 时先走这） |

剩余 70+ 工具是 SaaS 连接器（Slack/Notion/Figma/GDrive 等 22 家）与记忆/工件/人脉，按 spec 白名单 + `tool-groups.yaml` 读/写分组下发。

## 观察：带基线的 a11y 快照，无视觉通道

**观察中心是文本快照，不是截图。** 与 ZCode/Codex 同派（AX 树 + diff），与 Claude/Cursor（截图为主）相反。

- `snapshot()` 增量返回 `format: full|diff|unchanged`，diff 挂在 `baseSnapshotID` 上；预算 depth 1–30、字符 1000–16000，"keep budget stable so the runtime can reuse the baseline"。
- 元素句柄 `ref(ref, snapshotID)`：绑定当次交付快照，文档/元素替换即过期——**禁止凭空造 ref**。
- `settled=true` 只代表 100ms DOM 静默，明确不等于应用就绪；截断 `truncated=true` 时"unchanged 不代表整页没变"。
- `locator.find()` 一次观察 ≤20 个匹配并回报总数——为多候选消歧设计。
- 每格结束自动附末帧观察：显式 `snapshot()/find()` 会替换自动捕获。

## 动作：Playwright 语义层，无 OS 输入

- 动作集：click/dblclick/hover/check/uncheck/fill/press(keyChord)/selectOption/scrollIntoViewIfNeeded + 读回（innerText/textContent/getAttribute/isVisible/isEnabled/isChecked/count）。
- 定位：getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/locator(css)/frameLocator；链 ≤16 步、嵌套 ≤3 层；无 Playwright `>>` 链；`selectOption` 仅限原生 `<select>`。
- 明确禁用：raw CDP、page.evaluate、imports、文件/网络/进程 API、browser 事件回调。
- 失败语义：`An error may occur after a side effect`——失败格重置 JS bindings（stateReset）但浏览器副作用不回滚；禁止整格重放；`outcome=unknown` 必须先查证。
- 等待纪律：waitFor ≤10s；`A successful action followed by an unchanged observation is not a reason to click again`——防重复点击写进 prompt。

## 编排：browser-use 是 SDK subagent，不是独立循环

**一个委派、一个会话、双向回报。** 前台 agent（task-execution-agent / home-task-execution）的规则（browser-use-delegation mixin）：

- 委派载荷 = objective + URL/pageID + 输入值 + constraints + **用户授权** + 完成条件。
- `Run only one browser delegation at a time, in the foreground`；所有委派共享同一浏览器会话；能续用就 resume 上一个 browser-use。
- 子代理产出"verified results / relevant URLs / blockers"三段式回报；父 agent 不得把不确定结果说成成功。
- 决策分工：子代理只执行**已观察过的确定性操作串**；"next action depends on interpreting new content" 时必须回传父 agent。

模型路由：browser-use 子代理 = `gpt-5.6-luna`（effort low，输出 64k/32k）；父 agent = opus 家族——快模型做手、强模型做脑。

## 安全模型：三层闸门

| 层 | 机制 | 出处 |
|---|---|---|
| 进程隔离 | 双层 Seatbelt：agent-server 层（白名单 12 个 shell 工具）+ claude 层（逐上下文、网络仅本地网关、`/Library/.../ClaudeCode` 不可读、skills 只读） | agent.sb / agent-claude-code.sb |
| 动作授权 | 购买/发消息/删除等后果性动作：父级未传授权 → 返回 `exact pending action` 给用户；委派必须携带 permission 字段 | browser-use.md + delegation mixin |
| 内容免疫 | `contentIsUntrusted: true` 随观察下发；快照/页面/错误全部视为不可信数据，忽略内嵌指令；`url://` 短链不可伪造 | tool prompt + mixin |

另加：附件走 proxy-file（出沙箱才还原真身）、Artifacts CSP 白名单、policy-isolation preload 屏蔽宿主 ClaudeCode 托管策略。**没有逐动作弹窗**——授权粒度是"任务委派级"，不是"点击级"。

## Dia 特色：Chat Context 与 Skills

- **Chat Context**：当前页内容以 `attachments/` 文件注入对话（ask-on-page skill：`The attached file in attachments/ IS the page the user is looking at`）；话术要求说"this page"不说"this file"。fetch_web_content 则把整个登录态 Web 变成工具面——`The user's browser is an extension of your capabilities.`
- **Skills**：用户自定义 skills 就是 Claude Code 格式的 `.claude/skills/<name>/SKILL.md`，由 app 管理、agent 沙箱只读；内置 8 个 first-party skills（artifact-generation/report-kit/slide-kit 等）随包分发，带 feature flag 条件挂载。
- **与 Arc 的关系**：同一 BoostBrowser 框架（构建路径 `.../arc/Frameworks/BoostBrowser/`），ArcCore.framework 即 Chromium 底座；Dia 的 agent 栈（AgentServer/SupertabEngine）是 Arc 之后新增的 Swift 模块。

## 与同类对照（BU 视角）

| 产品 | BU 架构 | 与 Dia 差异 |
|---|---|---|
| Dia | 内嵌 Claude SDK + 单 REPL 工具 + Playwright/CDP | 观察无截图；授权在委派层 |
| ZCode | 内嵌 WebView + `js` REPL 工具 | 同构（REPL 思想），但后端私有 broker 而非 CDP |
| Codex | `cua` REPL 半边是浏览器 | 同"一个 REPL"派；CU/BU 共用全局对象 |
| Cursor | 注入 JS 合成 DOM 事件 + ref 快照 | 工具离散（16 个），无沙箱 worker |
| Kimi | 扩展 + WS daemon 复用真实登录态 | 同"真登录态"目标，走扩展而非 CDP |
| Devin | 云 VM Chromium | Dia 反其道：用户本机会话，不隔离 |
| comet* | 侧栏助手（公开信息） | 同为浏览器内操作员；实现未解包 |

\* 公开渠道信息，非静态基线。

## 快速复核入口

```bash
D=/Volumes/YANG/apps-re/dia/Dia.app/Contents/Resources/agent-server-resources/dist
cat "$D/agents/browser-use/spec.yaml"          # 单工具 + gpt-5.6-luna + harness: claude-sdk
cat "$D/prompts/tool-prompts/browser_use.md"   # REPL 完整 API 契约
jq -r '.tools[].name' "$D/resources/tool-schemas/dia.json" | sort   # 80 工具
grep -c 'sandbox-exec' "$D/agent.sb"           # 沙箱入口
strings -a "$D/handler" | grep replayio        # @replayio/playwright 执行层
```
