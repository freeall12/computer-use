# 横向能力矩阵：20 个对象的 Computer Use 与 Browser Use

> 本文横向对比 [agents/](../agents/) 下 20 个对象、80 份逆向文档。数字与专有名词以各分册为准；
> 分册间矛盾以各自 evidence/inventory.md 为准，并在 [§8 勘误注记](#8-矛盾与勘误注记)标注。
> 基线：本机安装/留存版本 + 上游源码取证（2026-10-06/07）。

## 对象表（20 家）

| 简称 | 产品（厂商） | 关键版本/基线 |
|---|---|---|
| ZCode | ZCode 桌面 Agent | computer-use 插件 0.6.3 / browser-use 0.5.1 / CUA Helper 3.14.4 |
| Codex | OpenAI Codex（CLI + Desktop） | CLI 0.155.1 / ChatGPT.app 26.930.31730 / @oai/cua 0.2.5 |
| Claude | Claude Code CLI + Claude 桌面端 | CLI 2.1.212 / 桌面端 1.44121.4 |
| Cursor | Cursor + cursor-agent CLI | 3.22.12 / CLI 2026.09.23 |
| MiniMax | MiniMax Code 桌面端 | 3.1.0 / cua-driver 0.22.1 |
| Synara | Synara（独立开发者产品） | 0.9.2 / cua-driver 0.28.2 patched |
| Kimi | Kimi Code CLI + Desktop + KimiCU | CLI 0.39.1 / KimiCU 0.6.6 / webbridge 2.0.22 |
| Qoder | Qoder（阿里系，自研 Electron workbench） | 0.4.3 / CU Runtime 1.0.12 / BU SDK（@ali）0.4.0 |
| Grok | xAI Grok——**两个产品**：Grok CLI（无 CU/BU）+ Grok Bot 桌面端（Anysphere 代工） | CLI 1.0.46 / Grok Bot 0.66.0 / CU Helper 1.0.0 |
| Devin | Cognition Devin——全云端执行；CLI 内部代号 chisel；Desktop=Windsurf 更名 | CLI 3000.6.19 |
| Goose | Block Goose（开源，本机已卸载，按上游源码分析） | v1.53.0（commit 5bd5e548，Apache-2.0） |
| MiMo | Xiaomi MiMo AI（Codex sky 清洁室复刻） | 应用 26.914.142245 / 运行时 0.7.11 |
| browser-use | browser-use（开源库，browser-use.com） | Python 库 0.13.11（commit c75e8476，MIT） |
| UI-TARS | UI-TARS Desktop + Agent TARS（字节） | desktop 0.2.4 / CLI 0.3.0（commit 2ff41a9e，Apache-2.0） |
| Stagehand | Stagehand（Browserbase） | SDK 4.1.0 + MV3 扩展 Runtime 1.0.2（commit fdd17958，MIT） |
| SOC | Self-Operating Computer（OthersideAI） | v1.5.8（commit fac568e，MIT；上游已停更） |
| Comet | Perplexity Comet | 145.2.7632.4587（Chromium fork；官方最新 153.0.8010.222） |
| Dia | Dia（The Browser Company） | 1.51.1 (88214) + 整包内嵌 Claude Code SDK 2.1.280 |
| Atlas | ChatGPT Atlas（OpenAI） | 1.2026.189.1 + fork Chromium 150.0.7871.115 |
| Fellou | Fellou（Fellou AI，产品 2025-11 停更） | 包未获得（末版 2.5.18，分发链死亡）；基线 Eko 4.1.3（commit c3de315，MIT） |

---

## 0. 执行范式轴：六派分工（8 家加入后的最大结构升级）

**能力面按范式分化，不按厂商分化。** 六派定义：

| 范式 | 一句话定义 | 判据 |
|---|---|---|
| **AX 语义派** | 观察=无障碍/页面结构文本树，动作=语义句柄，截图辅助 | 句柄寻址 + 增量 diff |
| **纯视觉派** | 观察=截图，动作=模型吐坐标 | AX 零参与或仅展示 |
| **半自动原语派** | 无 agent 循环，AI 只在少数原语出现 | 控制流归开发者代码 |
| **极简/透传派** | 1 个工具吃下整个命令空间，或执行整体外包 | 工具面永不膨胀 |
| **云端委派派** | 重活在云端执行体，本机只剩投影 | 本机零/薄执行原语 |
| **编排下沉派** | 工具 catalog 嵌进 sidecar 二进制直挂模型 | 宿主编排层被绕过 |

20 家 × 范式归属（● 主范式 / ◐ 部分 / — 无）：

| 简称 | AX 语义 | 纯视觉 | 半自动原语 | 极简/透传 | 云端委派 | 编排下沉 |
|---|---|---|---|---|---|---|
| ZCode | ● | — | — | — | — | — |
| Codex | ● | — | — | — | ◐（云端后端选项） | — |
| Claude | ● | — | — | — | — | — |
| Cursor | ● | — | — | — | ◐（云 worker） | — |
| MiniMax | ● | — | — | — | — | — |
| Synara | ● | — | — | — | — | — |
| Kimi | ● | — | — | — | — | — |
| Qoder | ● | — | — | — | — | — |
| Grok | ●（本地 CU） | — | — | — | ◐（BU 全云端） | ● |
| Devin | — | ◐（VM 截图循环） | — | — | ● | — |
| Goose | — | — | — | ●（透传 Peekaboo） | — | — |
| MiMo | ● | — | — | — | — | — |
| browser-use | ◐（DOM 语义句柄，AX 三源之一） | — | — | — | — | — |
| UI-TARS | — | ●（AX 零参与） | — | ◐（17 动作极简空间） | — | — |
| Stagehand | ◐（AX 文本树观察） | — | ● | — | — | — |
| SOC | — | ● | — | ●（极简，不透传） | — | — |
| Comet | — | ◐（截图循环+AX 伪 HTML） | — | — | ◐（大脑在云、手脚本机） | — |
| Dia | ◐（a11y 快照+ref，浏览器内） | — | — | — | — | — |
| Atlas | ◐（ARIA 快照，页内） | ◐（tab 截图+虚拟光标） | — | — | — | — |
| Fellou | — | — | — | — | ●（云端 Javis，中置信） | — |

> 读法：前 12 家集中在 AX 语义派一极；8 家新对象把光谱撕开——browser-use/Stagehand 贡献「库」与「半自动」两极，UI-TARS/SOC 补上纯视觉与极简极，Comet/Dia/Atlas/Fellou 开辟「浏览器即载体」（见 [§6 谱系](#6-谱系关系图)）。

---

## 1. 总矩阵

### 1.1 CU 面

| 简称 | CU | 载体形态 | 工具面 | 观察 | 动作 | 后台 |
|---|---|---|---|---|---|---|
| ZCode | 有 | Helper（Node SEA）+ ax_native.node | 14（app/窗口级） | AX 双基线 diff + 栅格截图 | AX 主 + CGEvent 窗口相对兜底 | 有（永不抢焦点） |
| Codex | 有 | Sky 服务 + `cua` REPL | MCP 3（面藏 `cua` 全局） | AX diff + Skyshot 原子 | CGEvent+EventTap；AX 读写 | 有（后台拉起） |
| Claude | 有（三控制域） | ComputerUseSwift + Rust helper | 约 40 | 截图（隐私过滤）+ AX 摘要 + zoom | CGEvent 前台 + AX 后台 + SkyLight/CGS | 有（app-scoped） |
| Cursor | 有（门控未启用） | sidecar.app（CDN 签名分发） | 16（mac）+2（Win） | WEBP 截图 + AX 树（snapshot_id） | companion 走 AX / remote 真实输入 | 有（不动真实鼠标） |
| MiniMax | 有 | cua-driver（Electron utility process） | 17 | AX/UIA 语义树 + 截图 + verify_state | background（AX）默认 + foreground（HID） | 有（background 默认） |
| Synara | 有 | cua-driver patched 独立进程 | 33（gateway） | SCK 截图 + 完整 AX + zoom | CGEvent 前台 + AX 后台 | 有（宿主信封 deliveryMode） |
| Kimi | 有 | KimiCU.app（launchd 常驻） | 18 + js | SCK 截图 diff + 收敛 AX | SkyLight 签名事件；无 HID | 有（never-front） |
| Qoder | 有（未启用） | 自研 Swift Runtime.app | 11 SDK 方法（mac） | AX elementIndex + 截图新鲜度仲裁 | AX 优先 + `CGEventPostToPid` 兜底 | 有（单 app key window） |
| Grok | 有（门控全关） | Swift sidecar（**Anysphere 代工**） | 16 + daemon 14 + 云 11 | SCK 单窗 + AX；双句柄分账 | companion AX / remote CGEvent 接管 | 有（默认后台不抬窗） |
| Devin | 有（**全云端**） | 云 VM `computer` 工具 | 1（云） | VM 截图 1024×768 循环 | VM 内合成输入 | —（云语义） |
| Goose | 有（默认关） | 纯透传 Peekaboo CLI | 1（透传） | Peekaboo AX 标注截图 | Peekaboo 内 CGEvent+AX | 无 |
| MiMo | 有（本机已启用） | sky-mac Swift（复刻 Codex sky） | 1 js REPL | AX index 化 + 窗口截图 + diff | AX + SkyLight SPI 免聚焦 | 有（免聚焦优先） |
| browser-use | **无**（纯 BU 极端） | — | 0 | — | — | — |
| UI-TARS | 有（纯视觉） | 宿主 App + nut-js | 17 动作坐标空间 | 整屏截图（AX 零参与） | 坐标 → nut-js（CGEvent） | 无（全前台） |
| Stagehand | **无**（判定书） | — | 0 | — | — | — |
| SOC | 有（纯视觉极简） | 无 Helper（pyautogui） | 4 操作（prompt 内嵌） | 纯截图（+OCR/YOLOv8） | pyautogui 全局前台合成 | 无 |
| Comet | 浏览器内（无 OS CU） | comet-agent CRX（chrome.debugger） | ComputerBatch 10 动作 | AX 伪 HTML + 截图视觉循环 | CDP Input 合成 + 视口守卫 | —（标签页域） |
| Dia | **无**（SDK 预埋未接通） | — | 0 | — | — | — |
| Atlas | 浏览器内（Dragonfruit） | fork Chromium + Swift 壳 | `computer.*` 16 命令 | 页内 ARIA 快照 `ref=` + tab 截图 | 页内 JS 合成事件（零 OS 注入） | —（页面域） |
| Fellou | 宣称云端委派（中置信） | 无本地执行实证 | 0（开源侧） | —（云侧不可见） | — | — |

### 1.2 BU 面

| 简称 | BU | 架构 | 协议/通道 | 工具面 |
|---|---|---|---|---|
| ZCode | 有 | 内嵌 WebView（IAB）单后端 | NDJSON broker；Playwright 语义串行 | js 1 工具 + 约 25 命令 |
| Codex | 有 | 内嵌+扩展+云+mcpapps 四后端 | 统一对象面 + 受限 CDP（origin 白名单） | 藏在 `cua` 半边 |
| Claude | 有（本机断链） | 扩展 + native messaging | Chrome 扩展构造 `ref_N` | 约 23 mcp 工具 |
| Cursor | 有 | 内嵌 webview（扩展/云为常量） | 注入 JS 合成 + CDP 逃生舱（拒绝列表） | 16 |
| MiniMax | 有 | WebContentsView + CDP | CDP 五域 | `browser`×24（+13 full 形态） |
| Synara | 有（三路径） | BetterWright 面板 + driver CDP | Playwright over `contents.debugger`（黑名单） | browser_* 13 + 10 |
| Kimi | 有（双轨三链路） | 扩展（WS daemon）+ 桌面内嵌 | HTTP+WS；`cdp` 直通；43 操作 | BU-A 14+ / BU-B `run`×43 |
| Qoder | 有（in-app 实用） | WebContentsView + 扩展执行 + Browser Agent | 内置 MCP16（**钉死基线**）+ HTTP Bearer | 16 + 对象方法面 |
| Grok | 本地无；云端有 | 云端四件套（subagent+MCP+box 沙箱） | 本机**零**浏览器 API | 云 browser_subagent |
| Devin | 有（云端；本地投影） | 云 VM Chromium | CDP :29229 同状态附着 | Interactive Browser |
| Goose | 本地零内置；外挂有 | 纯 MCP 外挂 | 归第三方 server | 官方收录 5 扩展 |
| MiMo | 完整（未启用） | MV3 扩展 Bridge + chrome.debugger | JSON-RPC 2.0 + CDP 1.3 白名单 | js 内 `agent.browsers` |
| browser-use | 有（**本尊**） | 自启 Chrome 子进程 + 自研 cdp-use 直连 | CDP 全量 | 24 动作 |
| UI-TARS | 有 | BrowserFinder 附着本机 Chrome | puppeteer-core CDP | 3 模式 dom18 / visual9 / hybrid20（默认） |
| Stagehand | 有（**本尊**） | MV3 扩展运行时（chrome.debugger） | JSON-RPC over CDP | 3 原语 + 77 确定性 API |
| SOC | **无**（键盘路径） | — | — | 0 |
| Comet | 有（执行器本体） | 浏览器 fork 自带特权扩展 | WS CDP 桥（远端白名单 15 方法） | 同 CU 执行器 + GetContent 等 |
| Dia | 有（**唯一动作通道**） | CDP 附着用户已登录浏览器 | @replayio/playwright 子集 | browser_use 1 REPL + 辅助 6 |
| Atlas | 有（fork 本体） | fork Chromium + 进程内 Mojo | `owl.mojom.*`（无 CDP 外露） | `computer.*` 面 + browser memories |
| Fellou | 有（eko 开源实证） | 扩展 / Node Playwright / 页内三运行时 | chrome API + Playwright + 远端 MCP 脚本回传 | 13 工具 |

---

## 2. 工具面数量级对照

各家「工具数」口径不同（MCP 工具 / 对象方法 / 动作枚举 / prompt 协议），横向比较必须折算：

| 简称 | CU 口径 | BU 口径 | 形态一句话 |
|---|---|---|---|
| ZCode | 14 个 MCP 工具（前代 0.5.12 曾 30） | js 1 工具 + 约 25 wire 命令 | 刻意收缩：「屏幕中心 → app/窗口中心」 |
| Codex | 3（js/js_reset/turn_ended） | 同左（browser 是 cua 半边） | 「一个 REPL、一个全局对象」极简面 |
| Claude | 约 40 命名工具 | 约 23 mcp 工具 | 拆分最细、动作原语最多 |
| Cursor | 16（mac）+2（Win） | 15 + browser_lock = 16 | 一方 MCP provider，zod schema |
| MiniMax | 17 个 computer_* | 1 统一 browser×24（+13 full） | compact/full 双暴露形态 |
| Synara | gateway 33（13 读+20 变更） | browser_* 13 + 10 | 原生面 14+18+9 经前缀映射 |
| Kimi | 18 + js/js_reset | BU-A 14+ 命令；BU-B run×43 | 双轨 BU，两种协议风格 |
| Qoder | 11 SDK 方法（mac）；Win 另 16+3 | 内置 MCP 16 + Browser Agent 面 | mac「SKILL 注入+REPL SDK」、Win 走 MCP |
| Grok | 16 + daemon 14 动词 + 云 11 | 本地 0；云端不下发 | 双工具面同二进制（高层词 + 低层词并存） |
| Devin | 1 个 computer（云 VM） | 云 Interactive Browser + CDP | 「工具在云、本地零 GUI」 |
| Goose | 1（computer_control 透传）+ 办公三件套 | 0 内置；外挂 5 扩展 | 面在外部 CLI 命令空间，永不膨胀 |
| MiMo | 唯一 js REPL（10 方法） | 同一 js 内对象图 | 与 Codex/ZCode 同构；离散工具只是 fixture |
| browser-use | 0（纯 BU） | 24 动作（26 处注册，click/done 各两变体） | 纯库无 MCP 面（可反挂 MCP server） |
| UI-TARS | 1 动作空间（17 动作，坐标即参数） | dom 18 / visual 9 / hybrid 20 | 动作语法在解析层（正则+约 50 别名），非工具 schema |
| Stagehand | 0（判定书） | 3 原语 + 77 确定性 RPC = 80 | 「原语 + 确定性」双层面；无 MCP |
| SOC | 4 操作（**prompt 内嵌**，非工具） | 0（键盘路径） | 工具面不存在的极端——语法在 system prompt |
| Comet | ComputerBatch 10 动作（批量） | 同一执行器 + GetContent/标签编排/检索/截图等本地工具 | 工具类在扩展 service worker，云端 CALL_TOOL 调用 |
| Dia | 0（预埋未接通） | browser_use 1 REPL + 辅助 6（80 工具 MCP 之内） | 80 工具 = 浏览器 7 + 22 家 SaaS 连接器 + 记忆工件 |
| Atlas | computer.* 16 命令 | Chromium 本体 + browser memories | 客户端无 MCP——协议面在 ChatGPT 后端 |
| Fellou | 0（开源侧；云端未验） | 13 工具（v4.1.3 实测；旧口径 15） | 工具可下沉远端 MCP（脚本回传执行） |

**三种极值凑齐**：最省 1 个工具有两派——「REPL 门面」（Codex/MiMo/Qoder SDK）与「CLI 透传」（Goose）；SOC 是第三种：「prompt 内嵌协议」（[P24](../reusable/patterns.md#p24)）。最繁仍是 Claude 约 40。Grok Bot「编排下沉」是承载第三条路。

---

## 3. 深度对比：观察机制

### 3.1 四种观察原语在 20 家的分布

| 原语 | 说明 | 使用者 |
|---|---|---|
| **AX/页面结构树 + 增量 diff** | 序列化带索引的文本树，只回变化 | 本地 10 家（Codex/ZCode/Kimi/MiniMax/Synara/Cursor/Qoder/Grok/MiMo/Claude-辅助）＋浏览器变体 4 家：Dia（a11y 快照 diff+snapshotID）、Stagehand（CDP AX 合成文本树）、Comet（AX 伪 HTML）、Atlas（页内 ARIA 快照） |
| **截图（窗口/屏幕捕获）** | SCK / CDP / x11grab / 云 VM | 全部 BU；CU 主观察：Claude display、Cursor remote、UI-TARS 与 SOC（**唯一观察**）、Comet（视觉循环）、Atlas（tab 截图+虚拟光标）、Devin/Grok 云 |
| **DOM/可交互元素快照 + 不透明 ref** | 遍历 DOM/AX 产出 ref，动作按 ref 寻址 | 几乎全部 BU＋新 4 家：browser-use（`[index]` 三 CDP 源合并）、dia（ref+snapshotID）、atlas（`ref=`/node_id/selector）、stagehand（elementId→xpath）、eko（`[33]:` 索引） |
| **set-of-marks 视觉标注** | 截图叠编号供点选 | 结论三态化，见 [§3.2](#32-som-三态20-家后的第三次结论改写) |

### 3.2 SoM 三态：20 家后的第三次结论改写

**SoM 在 20 家的主流答案是「不用」——真用在观察主路径的只有 SOC；前两版「12 家唯一」的口径就此作废。**

| 三态 | 家 | 形态 | 状态 |
|---|---|---|---|
| **经典 SoM 真用例** | SOC（`gpt-4-with-som` 档） | YOLOv8 `best.pt` 检测按钮 → 红框 + `~x` 标签叠加（引用 arXiv:2310.11441） | **CU 观察主路径可选档**——20 家中唯一「视觉检测 + 编号」的真 SoM |
| **渲染器存在但零调用** | browser-use | `create_highlighted_screenshot` 渲染器仍在 | **主链路 0 调用**：每步拍干净截图（截图前强制抹高亮），句柄走文本 `[index]` |
| **AX 叠注变体** | Goose（经 Peekaboo） | 元素 ID（B1/T2 式）标注叠加在截图上 | **CU 观察主路径**——但编号来自 **AX 树**而非视觉检测 |

| 近似物（不属三态） | 家 | 差异 |
|---|---|---|
| BU 侧标注+索引对齐 | Fellou/Eko | 彩色框截图与 `[33]:<button>` 索引互相对齐——BU 主通道的 SoM 近亲 |
| 展示层画框 | UI-TARS（Midscene 致谢）/ Atlas（AgentCursor 画进截图） | 只给人看 / 视觉验证，**不参与接地** |
| 辅助示能 | Cursor browser_highlight、Kimi annotation world、Claude zoom | 高亮/放大，非编号叠加 |

### 3.3 防句柄漂移的解法光谱（核心分水岭）

| 方案 | 机制 | 代表 |
|---|---|---|
| 流程纪律 | 不做运行时校验，错误内嵌新鲜 diff | Codex；SOC/UI-TARS/Fellou（「只用最新索引」，每轮重截图自然刷新） |
| 双基线 diff 台账 | 「数据变没变」与「模型见没见过」分离 | ZCode |
| 快照 ID 绑定 | 动作必须携带 snapshot_id，stale 拒绝 | Cursor、Kimi、MiniMax BU、Grok、**Dia（snapshotID+ref 过期）**、**Atlas（`ref=` 快照）** |
| 描述校验 | assertDescriptionMatches 比对漂移 | Cursor BU；ZCode/Kimi prefix-suffix |
| 投递后验证回读 | 三态 verified/未验证/verification_required | Kimi、MiniMax、ZCode、Synara、Qoder、Grok、MiMo；Goose（最轻补拍） |
| **宁空勿错**（新） | 状态采集超时 → 清空句柄台账，返回「索引均不可用」 | browser-use（`selector_map` 清空） |
| **视口版本守卫**（新） | 截图与坐标版本不一致 → 拒绝执行整批、回新截图 | Comet（客户端强制截图-坐标一致性） |
| **确定性解析+缓存键**（新） | elementId 由快照 map 确定性解析为 xpath；缓存按「指令+DOM 键」命中重放 | Stagehand |

> 结论不变：越晚出现越偏向运行时强校验；新增三家把校验下沉到「版本一致性」与「确定性解析」——校验由知道真相的一侧做（browser-use/Stagehand 在执行层，Comet 在扩展层）。

---

## 4. 深度对比：动作注入

### 4.1 五条注入通道在 20 家的分布

| 通道 | 原理 | 使用者（新增加粗） |
|---|---|---|
| **AX 语义动作** | AXPress/AXValue 等语义接口直达元素 | 本地执行系 10 家全部（主路径或兜底）；Goose 委托 Peekaboo。**新 8 家零命中**——Dia/Atlas 的「AX」只在观察侧，动作全在页面层 |
| **CGEvent/HID 合成** | 全局/窗口事件注入 | Codex(+EventTap)、Claude、Synara、MiniMax、Cursor remote、ZCode/Qoder/Grok/MiMo 兜底、Goose（经 Peekaboo）；**UI-TARS（nut-js→CGEvent）、SOC（pyautogui：mac CGEvent 系 / Win SendInput / X11）** |
| **合成 DOM 事件** | 页内 el.click()/PointerEvent | Cursor BU（主通道）、Kimi webbridge、Claude 扩展、Qoder in-app；**Atlas（完整 pointer 序列）、Dia（Playwright 语义）、Stagehand（understudy 方法表）、Fellou/eko（页内按索引派发）、browser-use（JS 兜底）** |
| **CDP** | Input.dispatch* 等域指令 | MiniMax、Synara、Codex（受限）、Cursor/Kimi（逃生舱）、Qoder/MiMo（允许列表）、Devin（云内）、**browser-use（自研 cdp-use 全量）、Stagehand（扩展内 chrome.debugger）、Comet（chrome.debugger）、Dia（Playwright over CDP）、UI-TARS（puppeteer-core）、eko-nodejs（Playwright）**；**Atlas 例外：进程内 Mojo 非 CDP** |
| **SkyLight/SLS 私有 API** | 私有窗口服务定向投递 | Kimi（SignedKeyboard）、Claude app-cu-helper、ZCode、Synara、Qoder、Grok、MiMo——**新 8 家零命中** |

### 4.2 后台定向输入：仍是本地执行系专属

四条路线（AX 写值 / 窗口路由合成 / SLS 签名封包 / 私有框架空间操作）见 [reusable/patterns.md P4](../reusable/patterns.md#p4)，20 家后无第五条。

**新 8 家全部缺席此赛道**：CDP/页内合成不占真实光标（不需要后台语义）；nut-js/pyautogui 只有全局前台（做不到）。后台交付语义 = 有本地 OS 执行层的家的军备竞赛。

### 4.3 剪贴板与文本输入分层

setValue（AX 写值）→ paste（借还剪贴板）→ type（逐键合成）三层不变（见 [P5](../reusable/patterns.md#p5)）。新增样本：

| 家 | 样本 | 注记 |
|---|---|---|
| UI-TARS | Windows `type` = 剪贴板 Ctrl+V 粘贴再还原 | 「type 借剪贴板」用于 IME 规避——快速通道之外的第三种用途 |
| Atlas | Mojo `TabClipboardRead/Write*` | 浏览器内剪贴板面，无借还语义 |
| browser-use | `<secret>` 占位符执行期替换 | 敏感值根本不进模型上下文——比借还更早截断 |

---

## 5. 深度对比：安全模型

### 5.1 机制覆盖矩阵（20 行，含零安全基线参照行）

| 简称 | OS 权限 | 范围审批 | 租约/互斥 | 防重放 | 验证回读 | 急停/人接管 |
|---|---|---|---|---|---|---|
| ZCode | TCC 挂 Helper | app/窗口绑定 + 作用域 | CONTROLLER_BUSY | possibly_sent 三态 | effect_evidence + ActionSettler | stop 闩锁（两豁免） |
| Codex | TCC 双权限 | AppApprovalStore 四档 + elicitation | 无（turn 回收） | —（Promise<void>） | getAXState 稳定等待 | URL 禁区 + 锁屏守护 |
| Claude | TCC 双权限 | 应用 tier（read/click/full） | 独占锁 | 批内坐标参照批前截图 | batch 每步门控 | Esc 急停 + 接管遮罩 |
| Cursor | TCC 双权限 | origin allowlist | 输入租约 | 「未动作才可原样重试」 | 动作后自动回截图 | Take Control 夺回 |
| MiniMax | TCC 三件套 | 插件准入 Host Binding | lease+TTL+generation | 复活绝不重放输入 | verify_state 谓词 AND | 遮罩条停止按钮 |
| Synara | TCC 三件套 | 能力域+可见使用正则 | 线程禁下放 | nativeInputEpoch | verify_state+取证 | 物理 Escape（专职 helper） |
| Kimi | TCC 归 launchd 服务 | approval_token | observation_context 隔离 | 已投递未观察不重发 | verify_after 三态 | BROWSER_USER_TAKEOVER |
| Qoder | TCC 双权限+自有授权窗 | per-app+URL 禁区 | 单连接单飞+Admission | 超时主动断链 | post-action 自动回传 | requestManualHandoff |
| Grok | TCC 归助手 App | 门控 fail-closed+cookie 逐 origin | CURemoteControlLease | 未投递即失败 | 写后回读+staleness 归因 | 物理 Esc+USER_ABORTED |
| Devin | 云 VM 内平台管 | 组织级开关（admin） | 会话即边界 | —（未披露） | 截图循环 | 同屏接管（SSO/MFA 归人） |
| Goose | TCC 一次性归 Peekaboo | 通用三层（无 CU 专用） | 无 | 无 | 动作后自动补拍 | 会话级停止 |
| MiMo | TCC 归签名 App | 插件门+四档 SAFETY_MODE | 锁屏 1–20s 一次性租约 | 动作一次性有效 | 动作即观察同事务 | 物理输入即撤销 |
| browser-use | 无（浏览器沙箱边界） | 域白名单 glob+IP 封禁 | 每 Agent 一 Session | terminates_sequence 静态短路 | checkbox 回读+宁空勿错 | —（无急停原语） |
| UI-TARS | TCC 归宿主 App | **无逐动作门** | 无 | 无 | 无（截图自然刷新） | pause/abort/call_user |
| Stagehand | 无 TCC | — | — | 缓存失败静默降级 | self-heal 重试一次 | close()（进程内） |
| **SOC（零基线）** | TCC 归终端 | **无** | **无** | **无** | **无**（prompt 一句 reflect） | **Ctrl-C 杀进程** |
| Comet | 无 TCC 面 | 域名黑白名单+企业 policy | 标签组关闭即 terminate | 视口守卫拒绝整批 | 截图回传再定位 | Pause/Take control+输入封锁 |
| Dia | 无（双层 Seatbelt） | 委派级授权（购买/删除） | 单委派串行 | outcome=unknown 禁重放 | a11y diff+settled 100ms | 回传 exact pending action |
| Atlas | 无 OS 自动化权限 | 站点黑名单+分级审批 | AgentTabGroup 专用 | 停止后全部忽略 | ARIA 快照+截图回传 | Safe Mode+turn 熔断 |
| Fellou | 无本地执行实证 | workflow_confirm（**默认关**） | 无 | 无 | 无 | human_interact 四型+request_help |

### 5.2 独有设计（20 家后补 5 条）

| 家 | 独有设计 | 一句话 |
|---|---|---|
| Codex / MiMo | 锁屏两相反路线 | 前者当危险边界守护，后者做成可控能力（详见 [P6](../reusable/patterns.md#p6)） |
| Synara | 前台可见使用授权引擎 | 授权生命周期绑定对话语义 |
| Claude | teach mode | agent 教人操作的第三种角色安排 |
| Qoder | 扩展侧校验替代逐动作弹窗 | 弹窗成本换成边界校验 |
| Grok Bot | 错误即指令协议 | 16 错误码→四档行为建议 |
| Devin | 人审批浓缩两层 | 组织开关+同屏接管，无逐动作队列 |
| **browser-use** | `<secret>` 占位符执行期替换 | 敏感值不进模型上下文，日志只回显「Typed <sensitive>」 |
| **Dia** | 授权随委派传递+untrusted 免疫 | 无逐动作弹窗；父级不传授权即回 `exact pending action` |
| **Atlas** | BrowserAuth 聊天表单 | agent 遇登录页渲染表单、**用户手填**、agent 只接管填写 |
| **Comet** | overlay 封锁人类输入 | 任务中 `stopImmediatePropagation` 封锁键盘鼠标——防干预也防抢夺（独此一家反向设计） |
| **Fellou** | 官网宣称「模拟人类行为解 CAPTCHA」 | 与 20 家「CAPTCHA 交还人」纪律正面相悖（框架 request_help 与产品话术两张皮） |

### 5.3 零安全基线参照：SOC

**SOC 把 20 家每个安全机制的对立面做齐了——它是「什么都不做」的完整样本，用作横向参照原点。**

| 机制 | 20 家主流 | SOC | 差距 |
|---|---|---|---|
| 执行租约 | ZCode/MiniMax/Kimi lease+BUSY | 无 | 无并发防护 |
| 防重放 | possibly_sent 三态 / generation | 无 | 动作可重复投递 |
| 动作验证 | verify 三态 / AX 回读 | 无（prompt 一句 reflect） | 验证靠模型自觉 |
| 白名单 | tier / origin / 域 | 无 | 全盘可点 |
| 急停 | Esc / STOP / kill switch | Ctrl-C 杀进程 | 无软急停 |
| 失败语义 | 错误码分档建议 | unknown 即停；模型层无界重试 | 两极都有问题 |
| 凭据 | 钥匙串 / env 隔离 / `<secret>` | 明文追加 `.env` | 凭据裸奔 |
| 可见性 | 光标可视化 / PiP / 审计 | 画圈动画（非安全设计） | 仅氛围级 |

> UI-TARS 是次薄档（无逐动作门，但有 call_user/熔断/allowedDirectories）；两者共同标定下界：20 家的每个机制都是对这套范式已知事故的修补。

---

## 6. 谱系关系图

```
开源上游：Cua AI（trycua/cua，MIT，Rust cua-driver）
 │ vendored ──► MiniMax（0.22.1，utility process）/ Synara（0.28.2 patched，provenance 实证）
 │ 机制公开致谢 ──► Kimi KimiCU（SignedKeyboard，非 fork）
 │ 同一设计范式 ──► ZCode cua-helper（平行实现，工具面趋同）

OpenAI Codex @oai/cua（tinyskyAlt 0.2.5）
 ├─ API 面逐字对齐+自研加固 ──► ZCode computer-use SDK（台账/防重放/lease 为自加）
 └─ 明示清洁室复刻 ──► MiMo @mi/mimo-computer-use（自述 inspired by sky，自带对比文档）

Anysphere（Cursor 母公司）sidecar 产品线 ──整体代工/换牌──► Grok Bot 桌面端
（TeamID DCNK4UB866 双方一致、CDN downloads.cursor.com、sand-cua 同名——谱系证据最硬）

Anthropic 官方 computer-use-demo ──工具描述文本派生──► Claude 桌面「浏览器版 computer」
Playwright MCP 风格动作词汇 ──词汇同源──► Cursor cursor-ide-browser
Anthropic Messages 工具协议 ──准协议──► MiniMax / Synara / MiMoCode
qwen-code node_repl ──UPSTREAM.md 确证──► Qoder（ZCode 疑同源，标注推断）

开源生态分支：被引用的三个库（无人整体 fork；均为引用/对照关系）
   browser-use（MIT）──「文本 DOM+[index] 句柄」范式源头；Stagehand 官方迁移文档直接教「从 browser-use 迁来」
   stagehand（MIT）── SDK 形态；Playwright API 形状复刻（零代码继承，无 interop）
   eko（MIT，FellouAI）── Fellou 官方自认的 BU 基础设施（产品把库包进去的活样本）

产品引用开源（4 条新证）
   Fellou ──► Eko（自家开源，官方博客自认）
   Dia ──► Claude Code SDK 2.1.280（整包内嵌：info.json claudeCodeVersion + spec harness: claude-sdk）
   Atlas ──► OpenAI Operator 协议（computer.* + AgentCursor 同款；Sky 栈零命中＝独立执行栈）
   Goose ──► Peekaboo（执行层外包，前版已录）
   （弱证）UI-TARS SoM 标注实现 ◄── 致谢 Midscene；Agent TARS 系统提示自述「Inspired from Manus」

浏览器即载体（agentic browser）四家
   comet（Chromium fork + 特权 CRX + 云端大脑）   dia（Chromium 定制 + 整包 Claude SDK）
   atlas（fork Chromium + Operator 协议本地化）   fellou（eko 三运行时 + 云端 Javis 委派）
   共同点：CU 边界=浏览器；登录态=核心资产；本机 OS 原语零或薄
```

关系类型（20 家后从六种扩到十种）：

| # | 关系 | 样本 |
|---|---|---|
| 1 | 直接内嵌开源驱动 | MiniMax/Synara ← Cua AI |
| 2 | 公开致谢单点借鉴 | Kimi ← Cua AI；UI-TARS SoM 标注 ← Midscene |
| 3 | API 面逐字对齐+自研加固 | ZCode ← Codex |
| 4 | 工具描述/schema 文本派生 | Claude 桌面浏览器版 ← 官方 demo；Cursor ← Playwright MCP |
| 5 | 整体代工/白牌 | Grok Bot ← Anysphere |
| 6 | 明示清洁室复刻 | MiMo ← Codex sky |
| 7 | **整包内嵌开源运行时**（新） | Dia ← Claude Code SDK；Fellou ← Eko（自家） |
| 8 | **API 形状复刻，零代码继承**（新） | Stagehand ← Playwright；Atlas 观察层 ← Playwright 移植 |
| 9 | 执行层外包 | Goose → Peekaboo |
| 10 | 协议层趋同 | Anthropic Messages 准协议；qwen-code 公共内核线索 |

> 读法：「形」高度收敛，「骨」各自独立，供应链分工加速——开源库（browser-use/stagehand/eko）成为被引用的地基，agentic browser 四家把「浏览器」本身变成 agent 运行时。

---

## 7. 本机可用性一览（分析时点快照）

| 简称 | CU | BU | 断点/备注 |
|---|---|---|---|
| ZCode | 可用 | 可用 | Helper 运行日志含真实 AXPress/坐标派发 |
| Codex | 可用 | 可用 | Sky 服务已装；approval_policy=never（用户调低） |
| Claude | 不可用 | 不可用 | 扩展未装、native host 未注册、TCC 未授予 |
| Cursor | 未启用 | 可用 | Statsig 门默认关；browser-logs 有 2026-08/09 痕迹 |
| MiniMax | 可用 | 可用 | 插件缓存就位 |
| Synara | 可用 | 可用 | BetterChromium 未下载；device-helper 需现场编译 |
| Kimi | 可用 | 部分 | KimiCU 常驻+双授权；webbridge 分析时未运行 |
| Qoder | 未启用 | 可用（in-app） | `ipc/` 空负证据；BU 有 42 次调用实证 |
| Grok | 未启用（桌面端） | 本地无；云端默认开 | CLI 无能力（产品边界）；门控三重负证据 |
| Devin | 全云端 | 全云端 | 本机已卸载（日志/Windsurf 残留） |
| Goose | 不可用 | 不可用 | 已卸载（99 断链 skills）；按上游源码分析 |
| MiMo | **已启用**（锁屏 opt-in） | 完整未启用 | env CU=1 / BU=0 五面负证据 |
| browser-use | —（不适用） | 未安装 | 上游源码基线（pip 即用） |
| UI-TARS | 未安装 | 未安装 | 上游 commit 2ff41a9e 源码基线 |
| Stagehand | —（CU=0） | 未安装 | npx 即起；纯 SDK |
| SOC | 不适用（框架） | —（无 BU 面） | 需自备 API key + 终端 TCC |
| Comet | 静态还原（未运行） | 同左（执行器本体） | 零运行痕迹；CRX 解包实证 |
| Dia | **恒 ❌**（缺执行层） | 静态还原 | 代码配置完整未启动验证；SDK 预埋未接通 |
| Atlas | 静态逆向（未安装） | 同左（fork 本体） | Mojo/strings 实证；未启动 |
| Fellou | ❌ 包已死亡 | 开源框架可自行运行 | S3 停用无镜像；基线=Eko+Wayback |

> 「未启用」≠「没有能力」：多家结论建立在负证据判定上（[methodology §9](../docs/methodology.md#9-负证据判定如何证明未启用)）；「包已死亡」（Fellou）是 20 家中新的证据形态——用厂商自家开源框架 + 官网存档替代二进制取证。

---

## 8. 矛盾与勘误注记

1. **ZCode 工具数 14 vs 30**：30 是上一代 0.5.12 屏幕级面；0.6.3 收敛 14。Kimi/Codex 分册引用的旧版观察以 ZCode 分册为准。
2. **@oai/cua 0.2.4 vs 0.2.5**：ZCode SDK 自述基线 0.2.4；本机实装 0.2.5，未见 API 面差异。
3. **Kimi webbridge 状态**：「daemon 未运行」仅指分析时点；KimiCU 本体常驻且已授权。
4. **Cursor「16+2」**：mac 16（含 2 租约工具）；Win 加 zoom/batch。BU=16。
5. **Synara「33」**：仅 gateway computer_*；不含 browser_* 13 与 10。
6. **ZCode BU 入口**：单一 `js` MCP 工具 + `agent.browsers` 对象面 + IAB；「browser_visit 等工具名」系早期误记，已更正。
7. **Qoder 确认分类编号上限**：正文列至 [17]（医疗），evidence C8 记 [15]——以分册正文为准。
8. **Grok CLI 负证据口径**：以分册三证据（工具表 16 件无 computer/browser、93 处 browser 全为 OAuth 文案、CHANGELOG 无条目）为准，「12 处命中」数字作废。
9. **新分册「N 家」为写作时点口径**：grok「9 家」、goose「9 个中唯一」、mimo「八家中最明示」、**ui-tars「12 家里唯一看截图给坐标」（SOC 加入后不再唯一，需注时点）、browser-use/comet/dia/atlas/fellou 各处的「12 家」对照**——分母为各分册写作时点。扩到 20 家后：Goose 仍是唯一纯 CLI 透传、Grok Bot 仍谱系最硬、MiMo 仍最明示复刻；「纯 CU 极端=Claude CLI / 纯 BU 极端=browser-use / 双无=Grok CLI」的谱系两端表（browser-use 分册）在 20 家口径下仍成立。
10. **Dia agent 规格数 45 vs 43**（分册内部）：README 复核命令注释「43 agents」与正文/evidence 的「45 个 spec.yaml」不一致——以 evidence §「45 个命名 agent 规格」为准，命令注释疑为旧数（引用时注意复核命令输出）。
11. **Fellou BU 工具数 13 vs 15**：旧文档口径 15；v4.1.3 实测 13（`scroll_to_element` 降为 protected 方法）——以 13 为准。
12. **Comet ComputerBatch 动作数 10 vs 逐项 12**：README/判定书口径「10 动作」；browser-use.md 动作表逐项展开为 12 项（click 四连各计、SCREENSHOT/WAIT 归并口径不同）——以「10 动作」为官方口径，逐项表为展开视图，待复核定谳。
13. **Stagehand「80 RPC」分账**：3 原语 + 77 确定性 = 80；分册按 page 31 / context 17 / locator 17 / stagehand 8 / response 6 / llm 1 分账，与「77 确定性 API」口径一致（llm 1 计入原语侧），不构成矛盾，录此备查。
