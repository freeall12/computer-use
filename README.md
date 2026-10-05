# CU/BU Reverse — 主流 Coding Agent 的 Computer Use 与 Browser Use 能力逆向

> 对 8 个主流 Coding Agent（ZCode / Codex / Claude / Cursor / MiniMax / Synara / Kimi / Qoder）在 **同一台 macOS 机器上** 的
> 桌面控制（Computer Use）与浏览器控制（Browser Use）能力做只读静态逆向：32 份文档、5600+ 行中文证据链，
> 回答三个问题——**它们怎么实现的？谁抄谁？我们能学到什么？**

![research](https://img.shields.io/badge/type-reverse_engineering-blue) ![platform](https://img.shields.io/badge/platform-macOS_arm64-black) ![docs](https://img.shields.io/badge/docs-32%20files%20%2F%205600%2B%20lines-green) ![status](https://img.shields.io/badge/baseline-2026--10--06-orange) ![agents](https://img.shields.io/badge/agents-8-8A2BE2)

---

## 目录

- [这是什么 / 不是什么](#这是什么--不是什么)
- [核心发现 TL;DR](#核心发现-tldr)
- [能力矩阵总表](#能力矩阵总表)
- [八个 Agent 分册](#八个-agent-分册)
- [横向对比](#横向对比)
- [可复用设计模式](#可复用设计模式)
- [逆向方法论](#逆向方法论)
- [仓库结构](#仓库结构)
- [免责声明](#免责声明)
- [License](#license)

---

## 这是什么 / 不是什么

**是**：

- 对本机已安装的 8 个 Coding Agent 的 CU/BU 能力栈做**只读静态分析**（打包 JS、原生二进制符号、随包文档、配置与日志）的完整记录；
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

1. **8/8 全部具备 CU+BU 能力，架构高度趋同**：本地 Helper/驱动持 TCC 权限 + 本地 IPC 鉴权 + 工具面隔离原生 API。6/8 采用独立 Helper 进程（ZCode cua-helper、Codex Sky 服务、Claude app-cu-helper、Cursor sidecar、Kimi KimiCU、Qoder Computer Use.app）；MiniMax 用 Electron utility process、Synara 由宿主直托管驱动。
2. **公共底座是开源 Cua AI（trycua）**：MiniMax 直接内嵌 `cua-driver 0.22.1`、Synara 内嵌 `0.28.2`（patched，带 provenance.json），Kimi 公开致谢其 SLS 签名键盘事件机制（`THIRD_PARTY_NOTICES.md` 原文）——一个 MIT 开源项目成了半条赛道的地基；Qoder 是唯一非 trycua 系的自研 Swift Runtime。
3. **第二条"公共底座"线索是 qwen-code（阿里系）**：Qoder 的 node_repl 内核由 `UPSTREAM.md` 原文确证直接迁自 qwen-code `packages/qwen_node_repl`（Apache-2.0，commit b1ac3e29），CU 信任链含通义灵码 `com.aliyun.lingma.ide`；ZCode 的 node_repl API 与之同构（`write/emitImage/wait/cancel/reset`）但上游待查——这是 Cua AI 之外第二条跨产品共享底座线索。
4. **ZCode 的 CU SDK 逐字对齐 Codex `@oai/cua`（0.2.4）**（SDK 头注释自述），但 `stateId/frameId/possibly_sent/controller lease/kill switch` 是 ZCode 事故驱动的自研加固——Codex 原始面对 stale 索引的对策只是「AX diff + 错误内嵌新鲜 diff + 流程纪律」。
5. **观察机制两大流派，CU 无人用 set-of-marks**：桌面侧全走「AX 树增量 diff」（8/8 家），浏览器侧全走「可交互元素快照 + 不透明 ref」；截图只是兜底与视觉凭据。防句柄漂移出现五个递强度方案：流程纪律 → 双基线台账 → snapshot_id 绑定 → 描述校验 → verify_after 三态。
6. **后台定向输入（不抢焦点）是投入最重、分化最大的能力**：四条路线并存——AX 写值、窗口相对事件路由、SLS 签名事件认证封包（Kimi：窗口全遮挡也能落键）、SkyLight/CGS 私有 API（Claude：跨 Space 拉窗、后台菜单点击）。
7. **BU 三架构各有实例**：内嵌 WebView（ZCode IAB、MiniMax WebContentsView、Synara 面板、Cursor browserView、Qoder in-app）、真浏览器扩展（Claude in Chrome、Kimi webbridge、Codex chrome 扩展、Qoder Browser Connector、Cursor 扩展常量）、云端浏览器（Codex cdp、Cursor remote worker 用 xdotool）。成熟产品全部走向「多后端 + 能力广告」的统一对象面。
8. **MCP 是万能挂载面，七种形态**：Claude 隐藏子命令入口、Cursor 一方 MCP provider、MiniMax 插件 + Host Binding 门控、Kimi CU 服务即 MCP server、Codex cua_repl 只露 3 个工具（面藏在 `cua` 全局）、ZCode 单一 `js` 工具 + Symbol 桥接 + skill 文档面、Qoder SKILL 注入 + 内置 MCP 双轨（mac CU 无 MCP 走 node_repl SDK，BU 是内置 16 工具 MCP）。共同点：**未启用 = 工具不存在**（fail-closed）。
9. **本机可用性差异巨大**：ZCode/Codex/Synara/MiniMax 全链可用；Cursor CU 被 Statsig 门控未启用（sidecar 从未安装，BU 有真实使用痕迹）；Claude 代码完整但链路断（扩展未装 + TCC 未授权）；Qoder CU 完整载体在位但从未激活（`ipc/` 空），BU in-app 有真实会话（42 次调用）；Kimi CU 服务常驻已授权，webbridge daemon 分析时未运行。

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

---

## 八个 Agent 分册

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

---

## 横向对比

**[comparison/capability-matrix.md](comparison/capability-matrix.md)** —— 12 维总矩阵 + 四个深度对比章节：

- 观察机制：AX diff vs ref 句柄 vs DOM 快照 vs set-of-marks（无一家用）+ **防漂移五方案光谱**
- 动作注入：AX 语义 vs CGEvent vs CDP vs 合成 DOM 事件 vs SLS 私有 API
- 安全模型：租约 / 审批 / kill switch / 防重放 / 验证回读的逐层对照 + 三个独有设计
- 谱系关系图（ASCII）：直接内嵌 / 公开致谢 / API 对齐 / 描述派生四种关系，没有谁整体 fork 谁
- 文档间矛盾的勘误注记（ZCode 14 vs 30 工具等 5 条）

## 可复用设计模式

**[reusable/patterns.md](reusable/patterns.md)** —— 本仓库核心价值：从 8 家实现提炼的 16 个设计模式，每条含问题定义、使用者（带分册链接）、实现要点、取舍：

P1 独立 Helper 进程（持 TCC + 权限中介） · P2 无障碍优先+视觉兜底双路径 · P3 元素句柄防漂移（五方案） · P4 后台定向输入（四路线） · P5 剪贴板 paste 与 setValue 分层 · P6 控制租约与 generation fencing · P7 防重放与 kill switch · P8 浏览器三架构选型 · P9 MCP 万能挂载 · P10 审批分级与域白名单 · P11 Fail-closed 工具注入 · P12 批量动作与坐标基准 · P13 可视化示能与人机共驾 · P14 注册表文件型传输（ipc/*.json + token + 懒拉起） · P15 钉死第三方工具基线 · P16 录制 → Skill 演示学习闭环 —— 附**最小可行架构组合图**。

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
│   └── patterns.md                  ← 16 个可复用设计模式（核心价值）
├── docs/
│   └── methodology.md               ← 可复现的逆向方法论
└── agents/                          ← 8 个 Agent 分册（32 份文档，5600+ 行）
    ├── zcode/                       ← README + computer-use + browser-use + evidence/inventory
    ├── codex/
    ├── claude-code/
    ├── cursor/
    ├── minimax-code/
    ├── synara/
    ├── kimi-code/
    └── qoder/
```

## 免责声明

- 本项目为**独立技术研究**，与文中所及任何厂商（ZCode/智谱、OpenAI、Anthropic、Anysphere/Cursor、MiniMax、Cua AI、Moonshot AI、Qoder/阿里巴巴 及个人开发者）均无关联，未获任何厂商授权或审阅；文中结论不代表官方立场，可能随版本更新失效（各分册头部均标注分析时点版本）。
- 各产品名称、商标权利归其各自所有者所有。文中提及仅作识别与学术比较之用。
- 仓库**不含任何专有源码、二进制或凭据**：仅对分析者本机合法安装的软件做静态分析，引用专有内容不超过 10 行/处且以说明为目的；未运行被分析对象、未抓包、未触碰凭据、无任何 DRM 规避或访问控制绕过。
- 安全相关内容（权限模型、审批机制等）仅作架构学习与防御性工程参考；请勿将任何模式用于未经授权操控他人设备或绕过产品安全策略。

## License

MIT © 2026 本仓库作者。分册文档中引用的第三方文字版权归原权利人，引用仅为研究说明。
