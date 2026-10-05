# CU/BU Reverse — 主流 Coding Agent 的 Computer Use 与 Browser Use 能力逆向

> 🖥️ **在线主站**：<https://freeall12.github.io/computer-use/> —— 12 个 Agent 光标同台执行桌面自动化的可交互动画图谱
>
> 对 12 个主流 Coding Agent（ZCode / Codex / Claude / Cursor / MiniMax / Synara / Kimi / Qoder / Grok / Devin / Goose / MiMo）在 **同一台 macOS 机器上** 的
> 桌面控制（Computer Use）与浏览器控制（Browser Use）能力做只读静态逆向：48 份分册文档（7400+ 行中文证据链）+ 12 目录源码层，
> 回答三个问题——**它们怎么实现的？谁抄谁？我们能学到什么？**

![research](https://img.shields.io/badge/type-reverse_engineering-blue) ![platform](https://img.shields.io/badge/platform-macOS_arm64-black) ![docs](https://img.shields.io/badge/docs-48%20files%20%2F%207400%2B%20lines-green) ![status](https://img.shields.io/badge/baseline-2026--10--06-orange) ![agents](https://img.shields.io/badge/agents-12-8A2BE2)

---

## 目录

- [这是什么 / 不是什么](#这是什么--不是什么)
- [核心发现 TL;DR](#核心发现-tldr)
- [能力矩阵总表](#能力矩阵总表)
- [十二个 Agent 分册](#十二个-agent-分册)
- [横向对比](#横向对比)
- [可复用设计模式](#可复用设计模式)
- [逆向方法论](#逆向方法论)
- [仓库结构](#仓库结构)
- [免责声明](#免责声明)
- [License](#license)

---

## 这是什么 / 不是什么

**是**：

- 对本机安装/留存的 12 个 Coding Agent 的 CU/BU 能力栈做**只读静态分析**（打包 JS、原生二进制符号、随包文档、配置与日志；Goose 本机已卸载，改用上游源码基线）的完整记录；
- 一份**横向对比研究**：观察机制、动作注入、安全模型、谱系关系；
- 一份**工程设计模式库**：自己做 CU/BU Agent 需要的 13 个可复用模式；
- 一套**可复现的逆向方法论**。

**不是**：

- 不是各厂商的官方文档，也与各厂商无关（独立研究）；
- 不含任何专有源码、二进制、凭据；不含 DRM 规避；
- 不是运行时行为测试（未运行被分析对象、未抓包）——所有「本机可用性」结论均标注分析时点。

分析基线：2026-10-06，macOS arm64，各产品当日本机安装版本。

---

## 核心发现 TL;DR

1. **12 家分化成四种执行基线**：① 本地 Helper/驱动执行（9 家——Helper 持 TCC + 本地 IPC 鉴权 + 工具面隔离原生 API，其中 7 家独立 Helper 进程）；② **全云端执行、本地投影**（Devin：工具在云 VM，本地 CLI 只留 read/edit/grep/glob/exec 与能力位）；③ **执行层外包透传**（Goose：单工具透传第三方 Peekaboo CLI，自身零 AX/CGEvent 代码）；④ **完全无原生能力**（Grok CLI——16 工具纯 coding，完整 Agent 无原生 CU/BU 首例）。
2. **白牌供应链出现了**：Grok Bot 桌面端由 **Anysphere（Cursor 母公司）整体代工换牌**——签名团队 TeamID `DCNK4UB866` 与 Cursor 完全一致、asar 包名 sand、homepage cursor.com、sidecar CDN downloads.cursor.com、`sand-cua` 模型同名、JS 残留 `CUCursorService`——CU/BU 赛道开始有代工分工，安全模型随代工继承。
3. **四条"公开底座"被复用线索**：① Cua AI（trycua）：MiniMax/Synara 内嵌 cua-driver、Kimi 公开致谢其 SLS 签名键盘机制；② qwen-code（阿里）：Qoder node_repl 内核 `UPSTREAM.md` 确证迁自其 `packages/qwen_node_repl`（Apache-2.0），ZCode node_repl API 与之同构但上游待查；③ Peekaboo（steipete，MIT）：Goose 的全部桌面执行层；④ Codex sky：MiMo `@mi/mimo-computer-use` 自述 "inspired by Codex Desktop's sky executor"，包内 1638 行 README 自带 vs Codex 逐项比较——**明示清洁室复刻**。
4. **ZCode 的 CU SDK 逐字对齐 Codex `@oai/cua`（0.2.4）**（SDK 头注释自述），但 `stateId/frameId/possibly_sent/controller lease/kill switch` 是 ZCode 事故驱动的自研加固——Codex 原始面对 stale 索引的对策只是「AX diff + 错误内嵌新鲜 diff + 流程纪律」。
5. **观察以 AX diff 为主 + BU 侧不透明 ref 共识；SoM 结论要加限定语**：Goose（经 Peekaboo `see --annotate`）是 12 家中唯一在 CU 观察主路径上使用「截图叠元素编号」的——但标注来自 **AX 树**而非视觉模型检测，是 SoM 变体而非经典 set-of-marks；其余 11 家未用。防句柄漂移五级方案光谱不变：流程纪律 → 双基线台账 → snapshot_id 绑定 → 描述校验 → verify_after 三态。
6. **后台定向输入（不抢焦点）四路线**：AX 写值、窗口相对事件路由、SLS 签名事件认证封包（Kimi：窗口全遮挡也能落键）、SkyLight/CGS 私有 API（Claude 跨 Space 拉窗；MiMo `SLEventPostToPid` 点击不抬窗；Grok `skylight-no-raise` 遮挡窗口坐标可命中）。
7. **BU 三架构 + 两种极值**：内嵌 WebView（ZCode/MiniMax/Synara/Cursor/Qoder）、真浏览器扩展（Claude/Kimi/Codex/Qoder Browser Bridge/MiMo）、云端（Codex cdp、Cursor remote、Grok Bot 四件套、Devin 云 VM）各有实例；极值两端是 Grok Bot（本机零浏览器 API，面比 Codex 收得更紧）与 Goose（零内置，五个第三方浏览器 MCP 外挂）。成熟产品走向「多后端 + 能力广告」统一对象面。
8. **MCP 是万能挂载面，八种形态**：Claude 隐藏子命令、Cursor 一方 provider、MiniMax Host Binding、Kimi CU 服务即 server、Codex `cua` 全局折叠、ZCode Symbol 桥接、Qoder SKILL+内置 MCP 双轨、**Grok Bot 编排下沉**（16 工具 catalog 嵌进 Swift sidecar，`--mcp-stdio` 直挂模型侧）。共同点：**未启用 = 工具不存在**（fail-closed）。
9. **安全模型四层共性 + 三个新变体**：「错误即指令」协议（Grok 16 错误码→retry/ask_user/use_different_tool/stop 四档行为建议，编译期静态映射）；通用权限伞罩住 CU（Goose GooseMode×工具级×LLM 审查 fail-open、Devin 组织开关+同屏接管，与 Claude/Cursor 的 CU 专用授权成两极）；锁屏子系统两条相反路线（Codex 守护暂停 vs MiMo SecurityAgentPlugins 授权插件+1–20s 一次性租约让 agent 解锁操作）。防重放与「投递≠生效」验证回读仍是最高共识。
10. **本机可用性四档**：全链可用（ZCode/Codex/Synara/MiniMax/Kimi-CU/MiMo-CU）；载体在位门控未启用（Cursor-CU/Qoder-CU/Grok-CU）；断链或已卸载（Claude 链路断、Devin CLI+Desktop 已卸载、Goose 已卸载改源码基线）；云端专属（Devin/Grok-BU 无法静态验证）。

---

## 能力矩阵总表

精简版；完整 12 维矩阵与深度对比见 [comparison/capability-matrix.md](comparison/capability-matrix.md)。

| | CU 载体 | CU 工具数 | BU 架构 | 安全模型要点 | 本机可用 |
|---|---|---|---|---|---|
| **ZCode** | Node SEA Helper + ax_native.node（AX/CGEvent/SCK） | 14 | 内嵌 WebView（IAB） | 租约 + possibly_sent 防重放 + kill switch + fail-closed | ✅ |
| **Codex** | Swift Sky 服务（AX diff/Skyshot/CGEvent） | 3（面在 `cua` 全局） | iab + 扩展 + 云 + mcpapps 四后端 | 四层：OS→服务端审批→策略 prompt→熔断 + 锁屏守护 | ✅ |
| **Claude** | ComputerUseSwift + Rust app-cu-helper（SkyLight/CGS） | ~40 | 真浏览器扩展 + native messaging | 应用 tier（read/click/full）+ 独占锁 + Esc 急停 + teach mode | ❌ 链路断 |
| **Cursor** | Swift/Rust sidecar（CDN 签名分发）；云 worker xdotool | 16（+2 Win） | 内嵌 Electron webview + 合成 DOM 事件 | TCC + 输入租约 + Statsig 门控 + CDP 拒绝列表 | CU 关 / BU ✅ |
| **MiniMax** | trycua cua-driver 0.22.1（utility process） | 17 | 内嵌 WebContentsView + CDP（24 action） | 插件 Host Binding 门控 + lease + generation fencing + 遮罩/停止按钮 | ✅ |
| **Synara** | trycua cua-driver 0.28.2 patched（宿主托管） | 33 | 内嵌面板（BetterWright/CDP）+ CDP 家族 + cookie 导入 | `computer:control` 能力域 + 前台可见使用正则授权 + 物理 Escape | ✅ |
| **Kimi** | KimiCU.app（Swift，launchd 常驻；SkyLight 签名事件） | 18 + js | 扩展（WS daemon）+ 桌面内嵌（43 操作 MCP） | TCC 归服务 + UDS token + observation_context 隔离 + takeover | CU ✅ / BU 部分 |
| **Qoder** | 自研 Swift Runtime 1.0.12（AX/CGEvent/SCK + Bridge；非 trycua 系） | 11 SDK 方法（+Win 16 MCP + 录制 3） | 内嵌 + 扩展执行 + Browser Agent API 三链路（16 工具钉死 chrome-devtools-mcp 基线） | per-app 审批 + URL 禁区 + CUA 风格四档确认 + 扩展侧校验（无逐动作弹窗） | CU 关 / BU in-app ✅（42 次调用实证） |
| **Grok** | Swift Helper（**Anysphere 代工换牌**，TeamID 同 Cursor）；CLI 无原生能力 | 16（catalog 内嵌 sidecar，`--mcp-stdio` 直挂） | 本地零（负证据）；云端 browser_subagent + box + cookie 逐 origin 审批导入 | 「错误即指令」（16 码→四档建议）+ 租约/Esc/USER_ABORTED | CU 关 / BU 云端 |
| **Devin** | 云 VM `computer` 工具（本地 CLI 零 CU，三重负证据） | 1（云） | 云 VM Interactive Browser（CDP :29229）+ ACP `browser_preview` 投影 | 组织开关（admin）+ 同屏接管 + blueprint 登录态 | 全云端（本机已卸载） |
| **Goose** | 内置 extension → **纯透传 Peekaboo CLI**（brew 自动安装） | 1（`computer_control`） | 零内置；5 个第三方浏览器 MCP 扩展 | GooseMode×工具级×LLM 审查（fail-open）；无 CU 专用门 | 本机已卸载（源码基线 v1.53.0） |
| **MiMo** | 自研 Swift sky-mac（**Codex sky 明示清洁室复刻**）+ 签名伴生 app | 唯一 `js`（`@mimo/sky` 10 方法） | Browser Bridge MV3 扩展 + CDP 白名单（iab/extension/managed/raw cdp 四后端） | SAFETY_MODE 四档 elicitation + **独家锁屏操作**（授权插件 + 1–20s 一次性租约） | CU ✅ 已启用 / BU 未启用 |

---

## 十二个 Agent 分册

每册含 README 总览 + computer-use.md + browser-use.md + evidence/inventory.md（路径:行号级证据）。

### [ZCode](agents/zcode/README.md)
本机能力最完整的一家。五层架构（模型 SDK → 共享宿主 → Helper 权限中介 → ax_native.node → macOS API），14 个 app 级工具，CU/BU 共用一个 `js` MCP 工具与两条 Symbol 桥接；对 Codex API 逐字对齐 + 自研安全加固（possibly_sent 防重放、controller lease、PiP/Ghost 可视化）。*（基线：插件 0.6.3 / Helper 3.14.4）*

### [Codex（OpenAI）](agents/codex/README.md)
「一个 REPL、一个全局对象」的极简面：MCP 只露 `js/js_reset`，`@oai/cua/tinyskyAlt` 的 `cua` 全局承载桌面+浏览器两半边。底层是 Swift Sky 服务（AX diff + Skyshot + CGEvent），安全模型四层且独有锁屏守护；浏览器侧 iab/extension/cdp/mcpapps 四后端统一 API。*（基线：CLI 0.155.1 / ChatGPT.app 26.930.31730）*

### [Claude（Anthropic）](agents/claude-code/README.md)
工具面拆得最细（桌面 ~40 个命名工具，三控制域：display/app-scoped/teach mode）。执行层 ComputerUseSwift + Rust app-cu-helper（私有 SkyLight/CGS 后台操作）；浏览器走 Claude in Chrome 扩展 + native messaging。本机代码完整但链路断（扩展未装、TCC 未授权）——「负证据判定」的典型案例。*（基线：CLI 2.1.212 / 桌面端 1.44121.4）*

### [Cursor](agents/cursor/README.md)
一方 MCP provider 形态（`vscode.cursor.registerMcpProvider`）。浏览器控制本机可用有真实痕迹（注入 JS 合成 DOM 事件 + `data-cursor-ref` 句柄 + CDP 拒绝列表）；桌面控制被 Statsig 门控未启用，但 `cursor-computer-use` 扩展**自带 TS 源码**，静态还原出 16 工具 + Swift sidecar + companion/remote 双模式。*（基线：3.22.12 / CLI 2026.09.23）*

### [MiniMax Code](agents/minimax-code/README.md)
「Claude Code 工具协议兼容端」：Anthropic Messages 协议 + pi 框架内核（自研运行时，非 fork）。CU = 内嵌开源 trycua `cua-driver 0.22.1`（17 工具，background/foreground 双交付，background 拒绝不升级）；BU = WebContentsView + CDP 的 24-action `browser` 工具（无任意 JS、Skill 强制前置、requiredNextTool 硬门）。*（基线：3.1.0）*

### [Synara](agents/synara/README.md)
独立开发者的多 Agent 编排产品（内嵌 claude-agent-sdk/pi/opencode 十种 provider）。CU = patched `cua-driver 0.28.2`；安全模型最「社会工程」：前台操作需从用户消息正则判定「可见使用」意图（多语言、防注入剥离、2 秒安静期），物理 Escape 专职进程急停。BU 三路径：自带面板 / cua-driver CDP 家族 / cookie 导入。*（基线：0.9.2）*

### [Kimi Code（Moonshot）](agents/kimi-code/README.md)
产品主打「后台操作不抢电脑」：KimiCU.app（Swift）经 launchd 常驻持 TCC，SkyLight 路由 + SLS 签名事件（公开致谢 Cua AI）实现 never-front 后台定向输入，`verify_after` 三态投递验证；BU 双轨——webbridge daemon+扩展复用真实登录态、桌面内嵌浏览器 43 操作带 takeover 与 30 天 receipts 审计。*（基线：CLI 0.39.1 / KimiCU 0.6.6）*

### [Qoder（阿里巴巴系）](agents/qoder/README.md)
自研 Electron workbench（非 VSCode fork），node_repl 内核经 UPSTREAM.md 确证迁自 qwen-code。CU = 自研 Swift Runtime（11 SDK 方法，per-app 审批 + CUA 风格四档确认分类；另有 Windows 16 工具 MCP 与 Record&Replay「录用户演示 → 生成 Skill」）；BU 三链路 = in-app 浏览器（16 工具 MCP，注册时钉死校验 chrome-devtools-mcp 基线，本机已真实使用）+ Browser Connector 扩展执行 + Browser Agent API。*（基线：0.4.3 / CU Runtime 1.0.12）*

### [Grok（xAI）](agents/grok/README.md)
两个产品两个结论：Grok CLI **无任何原生 CU/BU**（16 工具纯 coding，负证据判定）；Grok Bot 桌面端是 **Anysphere（Cursor 母公司）代工换牌**（TeamID/CDN/残留字符串三路实证），CU 16 工具 catalog 内嵌 Swift sidecar（`--mcp-stdio`「编排下沉」）+ 16 错误码四档「错误即指令」协议；BU 本机零面、全云端（browser_subagent + box 沙箱 + cookie 逐 origin 审批导入）。*（基线：CLI 1.0.46 / Grok Bot 0.66.0）*

### [Devin（Cognition）](agents/devin/README.md)
**全云端执行、本地只做投影**：`computer` 工具与 Interactive Browser 都在云会话 VM（1024×768 截图-动作循环、CDP :29229 同状态附着、blueprint 登录态）；本地 CLI "chisel" 工具面仅 read/edit/grep/glob/exec（三重负证据），BU 投影 = ACP `browser_preview` 能力位 + `cognition.ai/*` 扩展方法族；Devin Desktop = Windsurf 更名（本机已卸载，悬挂 symlink 取证）。*（基线：CLI 3000.6.19）*

### [Goose（Block，开源）](agents/goose/README.md)
**执行层完全外包**的架构极值：本机已卸载（99 个断链 skills 为痕），按上游源码 v1.53.0 分析。CU = 内置 Computer Controller extension 单工具 `computer_control` 纯透传 Peekaboo CLI（MIT，首次调用自动 brew 安装），Goose 自身零 AX/CGEvent 代码；`see --annotate` 的 AX 标注叠加截图是 SoM 变体；BU 零内置纯 MCP 外挂（Playwright/Chrome DevTools/Puppeteer/Selenium/Browserbase 五扩展）。*（基线：v1.53.0，commit 5bd5e548，Apache-2.0）*

### [MiMo（小米）](agents/mimo/README.md)
**Codex sky 的明示清洁室复刻**：`@mi/mimo-computer-use` 0.7.11 自述 "inspired by Codex Desktop's sky executor"，产品面唯一 `js` REPL 工具（`@mimo/sky` 10 方法，与 Codex/ZCode 形态同构）；CU = 自研 Swift sky-mac（SkyLight 私有 SPI 点击不抬窗 + 对截屏不可见的虚拟光标 + **独家锁屏操作** = SecurityAgentPlugins 授权插件 + 审计 token + 1–20s 一次性租约，本机已启用）；BU = MV3 扩展 Browser Bridge + Native Messaging + chrome.debugger CDP（未启用）；宿主 MiMoCode 是 Claude Code 工具协议同构端（LICENSE 致谢 opencode）。*（基线：应用 26.914.142245 / 运行时 0.7.11）*

---

## 横向对比

**[comparison/capability-matrix.md](comparison/capability-matrix.md)** —— 12 维总矩阵 + 四个深度对比章节：

- 观察机制：AX diff vs ref 句柄 vs DOM 快照 vs set-of-marks（无一家用）+ **防漂移五方案光谱**
- 动作注入：AX 语义 vs CGEvent vs CDP vs 合成 DOM 事件 vs SLS 私有 API
- 安全模型：租约 / 审批 / kill switch / 防重放 / 验证回读的逐层对照 + 三个独有设计
- 谱系关系图（ASCII）：直接内嵌 / 公开致谢 / API 对齐 / 描述派生四种关系，没有谁整体 fork 谁
- 文档间矛盾的勘误注记（ZCode 14 vs 30 工具等 5 条）

## 可复用设计模式

**[reusable/patterns.md](reusable/patterns.md)** —— 本仓库核心价值：从 12 家实现提炼的 20 个设计模式，每条含问题定义、使用者（带分册链接）、实现要点、取舍：

P1 独立 Helper 进程（持 TCC + 权限中介） · P2 无障碍优先+视觉兜底双路径 · P3 元素句柄防漂移（五方案） · P4 后台定向输入（四路线） · P5 剪贴板 paste 与 setValue 分层 · P6 控制租约与 generation fencing · P7 防重放与 kill switch · P8 浏览器三架构选型 · P9 MCP 万能挂载 · P10 审批分级与域白名单 · P11 Fail-closed 工具注入 · P12 批量动作与坐标基准 · P13 可视化示能与人机共驾 · P14 注册表文件型传输（ipc/*.json + token + 懒拉起） · P15 钉死第三方工具基线 · P16 录制 → Skill 演示学习闭环 · P17 错误即指令协议（结构化拒绝 + 四档升级建议） · P18 执行层外包与 CLI 透传 · P19 云端执行本地投影 · P20 代工换牌与白牌供应链识别 —— 附**最小可行架构组合图**。

## 逆向方法论

**[docs/methodology.md](docs/methodology.md)** —— 全程不运行、不抓包的静态还原流程，可复现：

安装面侦察 → 身份/签名/provenance 判定 → asar 解包与打包 JS grep 定位 → 原生二进制四件套（file/otool/nm/strings，符号聚类出架构）→ 随包官方文档与类型定义优先 → MCP/IPC 协议还原（帧格式/握手/元数据意图）→ 运行痕迹与会话数据 → **负证据判定五面法**（门控/安装/进程/配置/权限）→ 对照样本反推 → 置信度标注体系 → 合规边界 → 局限与失效模式。

---

## 仓库结构

```
computer-use/
├── README.md                        ← 本文
├── comparison/
│   └── capability-matrix.md         ← 12 维横向矩阵 + 深度对比 + 谱系图
├── reusable/
│   └── patterns.md                  ← 20 个可复用设计模式（核心价值）
├── docs/
│   └── methodology.md               ← 可复现的逆向方法论
├── source/                          ← 源码层（schemas / reference / vendor 三层，见 source/README.md）
│   ├── zcode|codex|claude-code|cursor/   ← schema + cleanroom 重构参考实现（附自测脚本）
│   ├── minimax-code|synara/              ← MIT cua-driver 两版本 vendor（28 文件 blob-SHA 一致）
│   ├── qoder/                            ← Apache-2.0 qwen-node-repl vendor（40 文件）
│   ├── goose/                            ← Apache-2.0 goose-mcp 子集 vendor（7 文件 sha256 校验）
│   ├── mimo/                             ← MIT 插件 SDK vendor
│   └── grok|devin/…                      ← 专有件不出 vendor，仅 schemas + reference
├── site/                            ← GitHub Pages 主站源码（在线版见下方链接）
└── agents/                          ← 12 个 Agent 分册（48 份文档，7400+ 行）
    ├── zcode/                       ← 各目录统一结构：README + computer-use
    ├── codex|claude-code|cursor|      + browser-use + evidence/inventory
    │   minimax-code|synara|
    │   kimi-code|qoder/
    ├── grok/                        ← 双产品分册（CLI 无能力 / Grok Bot 代工换牌）
    ├── devin/                       ← 全云端执行分册
    ├── goose/                       ← 上游源码基线分册（本机已卸载）
    └── mimo/                        ← 清洁室复刻分册
```

## 免责声明

- 本项目为**独立技术研究**，与文中所及任何厂商（ZCode/智谱、OpenAI、Anthropic、Anysphere/Cursor、MiniMax、Cua AI、Moonshot AI、Qoder/阿里巴巴、xAI/Grok、Cognition/Devin、Block/Goose、小米 MiMo、Peekaboo（steipete）及个人开发者）均无关联，未获任何厂商授权或审阅；文中结论不代表官方立场，可能随版本更新失效（各分册头部均标注分析时点版本）。
- 各产品名称、商标权利归其各自所有者所有。文中提及仅作识别与学术比较之用。
- 仓库**不含任何专有源码、二进制或凭据**：仅对分析者本机合法安装的软件做静态分析，引用专有内容不超过 10 行/处且以说明为目的；未运行被分析对象、未抓包、未触碰凭据、无任何 DRM 规避或访问控制绕过。
- 安全相关内容（权限模型、审批机制等）仅作架构学习与防御性工程参考；请勿将任何模式用于未经授权操控他人设备或绕过产品安全策略。

## License

MIT © 2026 本仓库作者。分册文档中引用的第三方文字版权归原权利人，引用仅为研究说明。
