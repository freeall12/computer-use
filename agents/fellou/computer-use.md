# Fellou 的 Computer Use：判定书 —— 宣称"系统级 agent"，开源实证为零，云端委派（中置信）

> 结论先行：**Fellou 宣称的桌面控制找不到任何本地执行实证；开源框架的聊天层把它显式委派给云端 "Javis AI assistant with full computer control"。**
> 三条证据：产品宣称（官网/官方博客）→ 开源框架 0 OS 原语 → deepAction 云端委派描述。
> 无二进制可验（[未拿到包判定](evidence/inventory.md#1-未拿到包判定书)），故"云端执行"判为**中置信**而非实锤。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 产品宣称 | "Computer Use transforms Fellou into a true **system-level agent**"（官网 2025-11 存档）；agent 家族含 **Computer-use Agent**（官方博客 2025-06） |
| 开源实证 | eko v4.1.3 全仓库 `AXUIElement|CGEvent|SendInput|xdotool|ComputerAgent` **0 命中** |
| 归属证据 | `deepAction`："delegate to **Javis AI assistant**... full control over both **networked computers**"（eko chat 层） |
| 本地授权面 | 官网："**Grant this AI Browser permission** to operate local apps and manage files"（授权在本地，执行待验） |
| 判定 | 浏览器内 agent 为体，跨桌面动作为云端委派之实（中置信） |

## 证据链（判定主体）

**证据一：产品宣称桌面控制。** 官网 2025-11 存档页专设 Computer Use 板块（"operate local apps and manage files"、FAQ"complex **web and desktop based tasks**"）；官方博客（2025-06）列 agent 家族 "Browser Agent, Coding Agent, File Agent, **Shell Agent, Computer-use Agent**, etc."。早期口径更猛：2025-09 首页对比 Dia 一栏写 "Shadow everything: **Window, OS, Application**"。

**证据二：开源侧零 OS 原语。** Eko 是官方自认的 Fellou Browser-use 基础设施，其全部执行原语止步 `chrome.scripting` / Playwright / 页内 DOM；五个 agent 抽象方法（screenshot/navigate/switch_tab/execute_script）无一是 OS 面。若桌面控制在本地客户端，开源仓库应至少残留工具名或权限清单——没有。

**证据三：云端委派自述。** `deepAction` 工具描述（eko `chat/tools/deep-action.ts` L19-20）原文："Delegate tasks to a **Javis AI assistant** for completion... has full control over both **networked computers**, browser agent, and multiple specialized agents"。"networked computers"（联网的计算机）+ Javis（Jarvis 谐音，官方博客以 Jarvis 自比）指向服务端执行体。

| 反向考虑 | 事实 | 影响 |
|---|---|---|
| 本地授权面存在 | 官网明说用户要给浏览器本地权限 | 执行体也可能在本机（产品闭源层可含 AX/CGEvent） |
| macOS TCC 无从验证 | 包未获得，无 Info.plist/entitlement 可查 | 无法排除本地实现 |
| Windows 版先停 | /api/download Windows `isEnabled:false` | 末期收缩，本地双平台维护成本高的旁证 |

> 判读：**授权/编排/观察在本地，重活（尤其是跨站工作流的"深度动作"执行）在云端 Javis**。置信为中：无二进制可做符号级复核。

## 形态判定：浏览器内 agent，还是跨桌面 agent？

| 判据 | Fellou 事实 | 指向 |
|---|---|---|
| 执行原语 | 开源侧全部在浏览器 DOM 层 | 浏览器内 |
| 文件能力 | eko FileAgent（example，Node fs 五工具：list/read/write/str_replace/find_by_name） | Node 宿主内，非 GUI 桌面 |
| 桌面 GUI 控制 | 产品宣称；零开源实证；云端委派描述 | 宣称跨桌面，实证浏览器内 |
| Shadow 隔离 | "shadow window 不干扰用户工作流"（2025-09）→"back-end workspace 并行任务墙"（2025-11） | 并行编排有源码（dependsOn 图 + agentParallel）；**窗口级隔离实现无证据** |
| 求助移交 | `request_help` 枚举 login/CAPTCHA/SMS/QR/支付 | 人机边界清晰 |

**判定：本体是浏览器内操作员（与 Dia 同类），"跨桌面"是云端增值服务的主张**——与 Devin（全云端 VM）方向一致，但 Fellou 未公开云端沙箱细节。

## 与已测 12 家 + comet/dia/atlas 对照（一行一家）

| 产品 | CU 形态（本仓库口径） | 与 Fellou 差异 |
|---|---|---|
| ZCode | 本机 helper（AX+CGEvent），app/窗口中心 | Fellou 无本地执行层 |
| Codex | Swift Sky 服务 + cua REPL | 同有云端组件，Codex 本地面完整 |
| Claude | 三控制域静态链接 helper | 同"宣称-实现"强绑定；Fellou 断 |
| Cursor | Swift sidecar（门控未启用） | 至少 sidecar 二进制存在；Fellou 连包都没了 |
| MiniMax / Synara | trycua cua-driver（内嵌/patched） | 开源上游可查；Fellou 闭源零实证 |
| Kimi | KimiCU 常驻 + SignedKeyboard | 后台投递纵深远超 Fellou 宣称 |
| Qoder / MiMo | 自研 Swift Runtime / Codex 清洁室复刻 | 均有完整本地载体 |
| Grok | Anysphere 代工 sidecar | 换牌链清晰；Fellou 供应链不明 |
| Devin | **全云端 VM**（本地零 CU） | **最接近 Fellou 的实际形态**；Devin 有 Interactive Browser 投影，Fellou 投影面不明 |
| Goose | 透传 Peekaboo CLI | 执行层外包给开源 CLI；Fellou 外包给自家云 |
| dia | 零 CU + SDK 预埋未接通 | 同为"浏览器即计算机"派；Dia 连预埋都没有，Fellou 连包都没有 |
| atlas（OpenAI）* | 浏览器内操作（公开信息） | 同类浏览器内助手 |
| comet（Perplexity）* | 侧栏助手在浏览器内代办（公开信息） | Fellou 相同底座形态 + 更激进的云端宣称 |
| **Fellou** | **浏览器内（开源实证）+ 云端 Javis 委派（宣称，中置信）** | 唯一"包已死亡"的分析对象 |

\* atlas/comet 为公开渠道信息，非本仓库静态基线。

## 安全与确认门（CU 视角）

| 层 | 机制 | 默认 |
|---|---|---|
| 计划级 | `workflow_confirm`：工作流生成后回调用户 confirm/cancel | **关**（`config.workflowConfirm:false`，产品层可能打开） |
| 动作级 | `human_interact confirm`："dangerous actions such as deleting system files" | 模型自行判断调用 |
| 求助移交 | `request_help`：login/CAPTCHA/SMS/QR/支付交还人 | 枚举固定 |
| 越权面 | 官网宣称 AI 可"高准确率解 CAPTCHA（模拟人类行为）" | **与本仓库 12 家人机边界纪律相悖，最激进** |

> 演进：2025-04 tag-group 异步协作（影子空间前身）→ 2025-06 v2 多 agent + 并行 Alpha → 2025-11 Computer Use/Agentic Memory 板块上线 → 2026 分发链死亡。

## 快速复核入口

```bash
R=/Volumes/YANG/apps-re/fellou/eko
grep -rn "AXUIElement\|CGEvent\|SendInput" $R/packages/*/src | wc -l        # 0
grep -n "Javis" $R/packages/eko-core/src/prompt/chat.ts                     # L22
grep -n "networked computers" $R/packages/eko-core/src/chat/tools/deep-action.ts
grep -n "workflowConfirm" $R/packages/eko-core/src/config/index.ts          # 默认 false
curl -s "http://web.archive.org/web/20251103113233/https://fellou.ai/" | grep -c "system-level agent"
```
