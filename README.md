# CU/BU Reverse — 主流 Coding Agent 的 Computer Use 与 Browser Use 能力逆向

> **把它们一个个拆开看。** 12 个主流 Coding Agent 怎么操控你的电脑——谁自研、谁代工、谁整层外包——
> 在同一台 macOS 上做只读静态逆向：48 份分册文档（7400+ 行路径:行号级中文证据链）+ 12 目录源码层，
> 回答三个问题：**它们怎么实现的？谁抄谁？我们能学到什么？**

[![在线主站](https://img.shields.io/website?url=https%3A%2F%2Ffreeall12.github.io%2Fcomputer-use%2F&label=%E5%9C%A8%E7%BA%BF%E4%B8%BB%E7%AB%99)](https://freeall12.github.io/computer-use/)
[![License](https://img.shields.io/github/license/freeall12/computer-use)](LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/freeall12/computer-use)](https://github.com/freeall12/computer-use/commits)
[![Repo Size](https://img.shields.io/github/repo-size/freeall12/computer-use)](https://github.com/freeall12/computer-use)

**English**: A read-only, static reverse-engineering study of how 12 mainstream coding agents (ZCode, Codex, Claude Code, Cursor, MiniMax, Synara, Kimi, Qoder, Grok, Devin, Goose, MiMo) implement **computer use** (desktop control) and **browser use** on one shared macOS machine — 48 booklets with path:line evidence, a 12-dimension capability matrix, 20 reusable design patterns, and a cleanroom reference-source layer. No proprietary code shipped; nothing was run or packet-captured. Baseline: 2026-10-06. → **[Interactive site](https://freeall12.github.io/computer-use/)**

[![主站预览：12 个 Agent 光标同台执行桌面自动化的可交互动画图谱](docs/assets/site-preview.png)](https://freeall12.github.io/computer-use/)

---

## 目录

- [为什么值得看](#为什么值得看)
- [核心发现 TL;DR](#核心发现-tldr)
- [能力矩阵总表](#能力矩阵总表)
- [十二个 Agent 分册](#十二个-agent-分册)
- [Quick Start](#quick-start)
- [深入阅读](#深入阅读)
- [仓库结构](#仓库结构)
- [Changelog](#changelog)
- [参与贡献](#参与贡献)
- [引用](#引用)
- [Star History](#star-history)
- [免责声明](#免责声明)
- [License](#license)

---

## 为什么值得看

没有哪家的官方文档会讲清它自己的桌面/浏览器控制是怎么实现的——本仓库把这 12 家拆到了符号与协议层。
分析基线：**2026-10-06，macOS arm64，各产品当日本机安装版本**。按你的身份选路线：

| 你是 | 5 分钟路线 |
|---|---|
| **想给团队选型的开发者** | 先看下方[能力矩阵总表](#能力矩阵总表)（CU 载体 / 工具数 / BU 架构 / 安全模型 / 本机可用性一表定乾坤），再进 [comparison/capability-matrix.md](comparison/capability-matrix.md) 看逐层深度对照 |
| **想自己做 CU Agent 的工程师** | 直接翻 [reusable/patterns.md](reusable/patterns.md)（20 个可复用设计模式），再挑诉求最近的两家分册抄作业——后台不抢焦点看 Kimi、极简工具面看 Codex、执行层外包看 Goose |
| **想研究竞品架构/谱系的人** | 看 [comparison/capability-matrix.md](comparison/capability-matrix.md) 的谱系关系图（谁内嵌 / 谁致谢 / 谁对齐 / 谁派生），再用 [docs/methodology.md](docs/methodology.md) 复现整套可复现的静态逆向流程 |

---

## 核心发现 TL;DR

1. **12 家分化成四种执行基线**：① 本地 Helper/驱动执行（9 家——Helper 持 TCC + 本地 IPC 鉴权 + 工具面隔离原生 API，其中 7 家独立 Helper 进程）；② **全云端执行、本地投影**（Devin：工具在云 VM，本地 CLI 只留 read/edit/grep/glob/exec）；③ **执行层外包透传**（Goose：单工具透传第三方 Peekaboo CLI，自身零 AX/CGEvent 代码）；④ **完全无原生能力**（Grok CLI，16 工具纯 coding）。
2. **白牌供应链出现了**：Grok Bot 桌面端由 **Anysphere（Cursor 母公司）整体代工换牌**——签名 TeamID `DCNK4UB866` 与 Cursor 完全一致、sidecar CDN 用 downloads.cursor.com、`sand-cua` 模型同名、JS 残留 `CUCursorService` 多路实证；**安全模型随代工继承**。
3. **四条「公开底座」被复用**：① Cua AI（trycua）：MiniMax/Synara 内嵌 cua-driver，Kimi 公开致谢其签名键盘机制；② qwen-code（阿里）：Qoder node_repl 内核经 `UPSTREAM.md` 确证迁自其 `packages/qwen_node_repl`（Apache-2.0）；③ Peekaboo（steipete，MIT）：Goose 的全部桌面执行层；④ Codex sky：MiMo 自述 "inspired by Codex Desktop's sky executor"——**明示清洁室复刻**。
4. **ZCode 的 CU SDK 逐字对齐 Codex `@oai/cua`**（SDK 头注释自述），但 `stateId/frameId/possibly_sent/controller lease/kill switch` 是事故驱动的自研加固——Codex 原始面对 stale 索引的对策只是「AX diff + 错误内嵌新鲜 diff + 流程纪律」。
5. **观察以 AX diff 为主 + 后台定向输入四路线**：AX 写值、窗口相对事件路由、SLS 签名事件封包（Kimi：窗口全遮挡也能落键）、SkyLight/CGS 私有 API（Claude/MiMo/Grok 点击不抬窗）。12 家中仅 Goose（经 Peekaboo）用「AX 标注叠截图」——那是 SoM **变体**而非经典 set-of-marks；防句柄漂移五级方案光谱：流程纪律 → 双基线台账 → snapshot_id 绑定 → 描述校验 → verify_after 三态。
6. **BU 三架构 + 两种极值**：内嵌 WebView（ZCode/MiniMax/Synara/Cursor/Qoder）、真浏览器扩展（Claude/Kimi/Codex/MiMo 等）、云端（Codex/Cursor/Grok Bot/Devin）各有实例；极值两端是 Grok Bot（本机零浏览器 API）与 Goose（零内置、5 个第三方浏览器 MCP 外挂）；成熟产品走向「多后端 + 能力广告」统一对象面。
7. **MCP 是万能挂载面，八种形态**（Claude 隐藏子命令、Cursor 一方 provider、Grok Bot 编排下沉……），共同点：**未启用 = 工具不存在**（fail-closed）。
8. **安全模型四层共性 + 三个新变体**：「错误即指令」协议（Grok 16 错误码→retry/ask_user/use_different_tool/stop 四档建议）；通用权限伞罩住 CU（Goose fail-open 与 Claude/Cursor 的 CU 专用授权成两极）；锁屏子系统两条相反路线（Codex 守护暂停 vs MiMo 授权插件 + 1–20s 一次性租约）。防重放与「投递≠生效」验证回读是最高共识；本机可用性四档见[矩阵末行](#能力矩阵总表)。

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

每册统一四件套：README 总览 · computer-use.md · browser-use.md · evidence/inventory.md（路径:行号级证据）。

| Agent | 一句话口径 |
|---|---|
| [<img src="site/assets/logos/zcode.png" width="22" valign="middle">&nbsp;**ZCode**](agents/zcode/README.md) | 本机能力最完整：五层架构 + 14 个 app 级工具；对 Codex 逐字对齐再自研加固（possibly_sent 防重放、controller lease、PiP/Ghost 可视化）*（插件 0.6.3 / Helper 3.14.4）* |
| [<img src="site/assets/logos/codex.png" width="22" valign="middle">&nbsp;**Codex**（OpenAI）](agents/codex/README.md) | 「一个 REPL、一个全局对象」极简面：MCP 只露 `js/js_reset`，`cua` 全局承载桌面+浏览器；Swift Sky 服务 + 四层安全 + 独有锁屏守护 *（CLI 0.155.1）* |
| [<img src="site/assets/logos/claude-code.png" width="22" valign="middle">&nbsp;**Claude**（Anthropic）](agents/claude-code/README.md) | 工具面拆得最细（桌面 ~40 工具、三控制域）；SkyLight/CGS 私有 API 后台操作；本机链路断——「负证据判定」典型案例 *（CLI 2.1.212）* |
| [<img src="site/assets/logos/cursor.png" width="22" valign="middle">&nbsp;**Cursor**](agents/cursor/README.md) | 一方 MCP provider；BU 本机可用（合成 DOM 事件 + ref 句柄 + CDP 拒绝列表）；CU 被 Statsig 门控，但随包 TS 源码静态还原出 16 工具 + Swift sidecar *（3.22.12）* |
| [<img src="site/assets/logos/minimax-code.png" width="22" valign="middle">&nbsp;**MiniMax Code**](agents/minimax-code/README.md) | Claude Code 工具协议兼容端（pi 内核）；CU 内嵌 trycua cua-driver（17 工具）；BU = CDP 24-action `browser` 工具，requiredNextTool 硬门 *（3.1.0）* |
| [<img src="site/assets/logos/synara.png" width="22" valign="middle">&nbsp;**Synara**](agents/synara/README.md) | 多 Agent 编排产品；CU = patched cua-driver 0.28.2；安全模型最「社会工程」：正则判定「可见使用」意图 + 物理 Escape 急停；BU 三路径 *（0.9.2）* |
| [<img src="site/assets/logos/kimi-code.png" width="22" valign="middle">&nbsp;**Kimi Code**（Moonshot）](agents/kimi-code/README.md) | 主打「后台操作不抢电脑」：KimiCU.app launchd 常驻持 TCC + SkyLight/SLS 签名事件 never-front；BU 双轨 = 扩展复用真实登录态 + 内嵌 43 操作 *（CLI 0.39.1 / KimiCU 0.6.6）* |
| [<img src="site/assets/logos/qoder.png" width="22" valign="middle">&nbsp;**Qoder**（阿里系）](agents/qoder/README.md) | 自研 Electron workbench（非 VSCode fork），node_repl 迁自 qwen-code；CU 自研 Swift Runtime（四档确认 + 录制转 Skill）；BU in-app 16 工具钉死 chrome-devtools-mcp 基线，42 次调用实证 *（0.4.3 / Runtime 1.0.12）* |
| [<img src="site/assets/logos/grok.png" width="22" valign="middle">&nbsp;**Grok**（xAI）](agents/grok/README.md) | 两个产品两个结论：CLI 零原生 CU/BU；Grok Bot 桌面端 = Anysphere 代工换牌（三路实证）+「错误即指令」16 错误码协议；BU 全云端 *（CLI 1.0.46 / Bot 0.66.0）* |
| [<img src="site/assets/logos/devin.png" width="22" valign="middle">&nbsp;**Devin**（Cognition）](agents/devin/README.md) | 全云端执行、本地只做投影：`computer` 与 Interactive Browser 都在云 VM（CDP :29229）；本地 CLI 仅 read/edit/grep/glob/exec（三重负证据） *（CLI 3000.6.19）* |
| [<img src="site/assets/logos/goose.png" width="22" valign="middle">&nbsp;**Goose**（Block，开源）](agents/goose/README.md) | 执行层完全外包的极值：单工具 `computer_control` 纯透传 Peekaboo CLI（brew 自动装），自身零 AX/CGEvent；BU 零内置纯 MCP 外挂；SoM 变体唯一例 *（源码基线 v1.53.0）* |
| [<img src="site/assets/logos/mimo.png" width="22" valign="middle">&nbsp;**MiMo**（小米）](agents/mimo/README.md) | Codex sky 明示清洁室复刻；唯一 `js` REPL 工具 + 自研 Swift sky-mac（点击不抬窗 + 虚拟光标）；**独家锁屏操作**（SecurityAgentPlugins + 1–20s 一次性租约），本机已启用 *（运行时 0.7.11）* |

---

## Quick Start

三步用好本仓库（约 20 分钟）：

1. **（3 分钟）建立全景**：读上方 [TL;DR](#核心发现-tldr) 与[能力矩阵](#能力矩阵总表)，锁定你关心的 2–3 家；
2. **（15 分钟）精读 2 个分册**，推荐组合——自研加固 vs 它的对齐源头看 `agents/zcode/` + `agents/codex/`；两个架构极值看 `agents/grok/`（代工换牌）+ `agents/goose/`（执行层外包）；
3. **（1 分钟）跑参考实现自测**，确认每个分册描述的「观察 → 动作 → 验证」闭环在代码里真实成立（cleanroom 重构 + 零依赖 mock，无需安装被分析对象）：

```bash
node source/zcode/reference/test.mjs                    # 单家：ALL PASSED (18 checks)
for d in source/*/reference; do node "$d"/*.mjs; done   # 12 家全量冒烟（grok 为协议 demo）
```

---

## 深入阅读

- **[comparison/capability-matrix.md](comparison/capability-matrix.md)** —— 12 维总矩阵 + 观察机制 / 动作注入 / 安全模型三场深度对照 + 谱系关系图（直接内嵌 / 公开致谢 / API 对齐 / 描述派生四种关系，没有谁整体 fork 谁）+ 5 条文档间矛盾勘误注记
- **[reusable/patterns.md](reusable/patterns.md)** —— **本仓库核心价值**：20 个可复用设计模式（P1 独立 Helper 进程 … P17 错误即指令协议 … P20 代工换牌识别），每条含问题定义 / 使用者（带分册链接）/ 实现要点 / 取舍，附最小可行架构组合图
- **[docs/methodology.md](docs/methodology.md)** —— 全程不运行、不抓包的静态还原流程：安装面侦察 → 签名/provenance 判定 → asar 解包 grep → 原生二进制四件套 → **负证据判定五面法** → 置信度标注体系 → 合规边界
- **[source/README.md](source/README.md)** —— 源码层整理规范：schemas / reference / vendor 三层；vendor 只收上游本身开源的组件（如 MIT cua-driver、Apache-2.0 qwen-node-repl），专有件仅出 schemas + cleanroom reference

---

## 仓库结构

```
computer-use/
├── README.md                        ← 本文
├── agents/                          ← 12 个 Agent 分册（48 份文档，7400+ 行）
│   └── <slug>/                      ← 统一四件套：README + computer-use + browser-use + evidence/inventory
├── comparison/capability-matrix.md  ← 12 维横向矩阵 + 深度对比 + 谱系图
├── reusable/patterns.md             ← 20 个可复用设计模式（核心价值）
├── source/                          ← 源码层（schemas / reference / vendor 三层，规范见 source/README.md）
│   ├── zcode|codex|claude-code|cursor/   ← schema + cleanroom 重构参考实现（附自测脚本）
│   ├── minimax-code|synara/              ← MIT cua-driver 两版本 vendor（28 文件 blob-SHA 一致）
│   ├── qoder/                            ← Apache-2.0 qwen-node-repl vendor（40 文件）
│   ├── goose/                            ← Apache-2.0 goose-mcp 子集 vendor（7 文件 sha256 校验）
│   └── mimo/ …                           ← MIT 插件 SDK vendor；grok|devin 等专有件仅 schemas + reference
├── site/                            ← GitHub Pages 主站源码（在线版见顶部徽章）
└── docs/methodology.md              ← 可复现的逆向方法论
```

---

## Changelog

- **2026-10-06** — 首批 7 家分册发布（ZCode / Codex / Claude / Cursor / MiniMax / Synara / Kimi）
- **2026-10-06** — 新增 Qoder；随后扩至 **12 家**（+ Grok / Devin / Goose / MiMo），同步上线 `source/` 源码层与 12 家横向对比
- **2026-10-06** — GitHub Pages 主站上线，12 家接入真实 logo

---

## 参与贡献

欢迎按同一口径补充新 Agent 分册，PR 请附证据：

1. **口径**：只读静态分析——不运行被分析对象、不抓包、不触碰凭据；结论标注分析时点版本与置信度；「没有某能力」的负证据判定须给出五面法（门控/安装/进程/配置/权限）依据。全流程见 [docs/methodology.md](docs/methodology.md)。
2. **目录结构**：`agents/<slug>/` 四件套（README 总览 + computer-use.md + browser-use.md + evidence/inventory.md，证据落到路径:行号）；整理出的接口事实按 [source/README.md](source/README.md) 三层规范入 `source/`。
3. **合规红线**：不含任何专有源码 / 二进制 / 凭据；非上游开源的代码不得 vendor；引用专有内容 ≤10 行/处且以说明为目的。

---

## 引用

研究或写作引用本仓库，请使用：

```bibtex
@misc{cubureverse2026,
  author       = {freeall12},
  title        = {CU/BU Reverse -- 主流 Coding Agent 的 Computer Use 与 Browser Use 能力逆向},
  year         = {2026},
  howpublished = {\url{https://github.com/freeall12/computer-use}},
  note         = {12 个 Agent、48 份分册文档，分析基线 2026-10-06}
}
```

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=freeall12/computer-use&type=Date)](https://star-history.com/#freeall12/computer-use&Date)

---

## 免责声明

- **独立研究**：与文中任何厂商均无关联，未获授权或审阅；结论不代表官方立场，可能随版本更新失效（各分册头部标注分析时点版本）。产品名称与商标归各自所有者，提及仅为识别与学术比较。
- **合规边界**：仓库不含任何专有源码、二进制或凭据；仅对分析者本机合法安装的软件做静态分析——未运行被分析对象、未抓包、无任何 DRM 规避或访问控制绕过。
- **用途限制**：安全相关内容仅作架构学习与防御性工程参考；请勿将任何模式用于未经授权操控他人设备或绕过产品安全策略。

## License

[MIT](LICENSE) © 2026 freeall12。分册文档中引用的第三方文字版权归原权利人，引用仅为研究说明。
