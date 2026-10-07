# Dia 的 Computer Use：判定书 —— 无桌面控制，SDK 预埋未接通

> 结论先行：**Dia 没有可用的 Computer Use。** 它是浏览器内操作员，不是桌面操作员。
> 证据 = 三重负证据（无 AX / 无屏幕工具 / 无沙箱屏幕权限）+ 一处未启用预埋（Claude Code SDK 的 computer-use MCP 随包携带但无任何 spec 引用）。
> 全部路径与命令见 [evidence/inventory.md](evidence/inventory.md) §10。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| CU 工具面 | **0 个**（dia-tools MCP 80 工具无一涉屏） |
| 观察原语 | 无 AXUIElement（主二进制 0 命中）、无 ScreenCapture 权限面 |
| 动作原语 | 无 CGEvent（主二进制 0 命中）、无 HID 注入 |
| 沙箱屏幕权限 | agent-claude-code.sb 无任何 TCC/屏幕面（deny default） |
| 预埋未启用 | 内嵌 claude CLI 自带 `setupComputerUseMCP` + `computer-use-swift.js`；UI 有 `ComputerUseState` 渲染态 |
| 本机可用 | ❌ 链路缺整个执行层（2026-10-07 静态基线） |

## 三重负证据（判定主体）

**证据一：二进制层无 OS 原语。** 主二进制 `Dia`（132MB Swift）`strings` 搜索 `AXUIElement` 与 `CGEvent` 均 0 命中；对比本仓库已测 12 家，CU 产品至少在 helper 侧持有这两类符号。Dia 的全部 UI 自动化符号止步于 AppleScript 词典（Dia.sdef：window/tab/profile 常规控制，是给用户和外部脚本的，非 agent 面）。

**证据二：工具面无屏幕类工具。** `resources/tool-schemas/dia.json`（2026-10-02，80 工具）里与"看/操作"相关的只有 7 个浏览器工具；无 screenshot、无 app_state、无 screen 系。45 个 spec.yaml 的 `allowed` 白名单同样为空。

**证据三：沙箱无屏幕权限面。** 两层 Seatbelt profile（agent.sb / agent-claude-code.sb）均为 deny default，允许的 mach-lookup/process-exec 清单里没有任何屏幕捕获或 AX 服务；`security`（keychain 查询用）在列，但 sandbox-constraints mixin 同时向模型明示"不得访问 Keychain"。

## 未启用的预埋（判定附注）

| 预埋 | 位置 | 状态 |
|---|---|---|
| Claude Code computer-use MCP | 内嵌 `claude` CLI：`setupComputerUseMCP`、`/$bunfs/root/computer-use-swift.js`、`computer-use-input.js`、env `ALLOW_ANT_COMPUTER_USE_MCP` | 随 SDK 打包，**无任何 Dia spec 引用** |
| UI 渲染态 | 主二进制：`ComputerUseState`、`ITEM_TYPE_COMPUTER_USE_PROPOSAL`、`Title for an in-progress computer-use tool call` | 聊天 UI 能渲染 computer-use 工具卡片——低置信：为 SDK 工具事件通用渲染层或未发布功能预埋 |
| Windows 沙箱 | agent-server 内 `DIA_AGENTSERVER_APPCONTAINER*` env 族 | AppContainer 化的同款 agent-server，仍无屏幕面 |

> 演进推断：Dia 选择了"浏览器即计算机"路线——把"computer"收窄为"已登录的浏览器会话"，用 browser_use 单工具替代屏幕级工具（见 [browser-use.md](browser-use.md)）。

## 能力判定：浏览器内助手，还是跨站操作员？

**是操作员，但域被钉死在浏览器内。** 判据：

| 判据 | Dia 事实 | 指向 |
|---|---|---|
| 多步跨站任务 | browser_use 支持跨导航、多页面持久会话（`browser.pages.*`） | 操作员 |
| 语义决策权 | 子代理 prompt：`return to the model whenever the next action depends on interpreting new content` | 人审/主 agent 审 |
| 观察带宽 | a11y 快照（diff 增量、≤16000 字符预算）+ 无视觉通道（无截图工具） | 低带宽操作员 |
| 授权模型 | 后果性动作（购买/发消息/删除）需父级显式传授权，否则返回 `exact pending action` | 确认门在编排层 |
| 逃逸能力 | 禁 raw CDP / page.evaluate / import / shell / 网络监听；沙箱网络仅 localhost | 无逃逸面 |

## 与已测 12 家 + comet 对照（一行一家）

| 产品 | CU 形态分类（本仓库口径） |
|---|---|
| ZCode | 本机 helper（Node SEA + AX/SCK），app/窗口中心 |
| Codex | Swift Sky 服务 + cua REPL，三控制域 |
| Claude | 三控制域（静态链接 helper），应用分级授权 |
| Cursor | Swift sidecar（CDN 分发），Statsig 门默认关 |
| MiniMax | trycua cua-driver 内嵌 utility process |
| Synara | cua-driver patched 独立进程 |
| Kimi | KimiCU.app launchd 常驻，never-front |
| Qoder | 自研 Swift Runtime + SKILL 注入面 |
| Grok | Anysphere 代工 sidecar（换牌 Cursor） |
| Devin | 全云 VM（本地零 CU） |
| Goose | 纯透传 Peekaboo CLI（零自研） |
| MiMo | Codex sky 清洁室复刻（Swift） |
| comet（Perplexity）* | 公开信息：Chromium AI 浏览器，侧栏助手在浏览器内代办——形态与 Dia 同类（浏览器内操作员），未解包验证 |
| **Dia** | **零 CU；browser-only 操作员 + Claude SDK 预埋未接通** |

\* comet 行为公开渠道信息，非本仓库静态基线。

## 快速复核入口

```bash
A=/Volumes/YANG/apps-re/dia/Dia.app
strings -a "$A/Contents/MacOS/Dia" | grep -cE 'AXUIElement|CGEvent'          # 0
jq -r '.tools[].name' "$A/Contents/Resources/agent-server-resources/dist/resources/tool-schemas/dia.json" | wc -l   # 80
jq -r '.tools[].name' ... | grep -iE 'computer|screen|screenshot|capture'    # 空
strings -a "$A/Contents/Resources/agent-server-resources/dist/claude" | grep setupComputerUseMCP   # 预埋存在
grep -rl computer "$A/Contents/Resources/agent-server-resources/dist/agents" # 空（无 spec 启用）
```
