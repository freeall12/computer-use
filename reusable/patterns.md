# 可复用设计模式：自己做一个 CU/BU Agent 需要的一切

> 从 20 家实现提炼 24 条模式。每条四件套：**解决什么 → 谁在用（表）→ 要点 → 取舍**。
> 链接指向本仓库 [agents/](../agents/) 分册；证据细节见各分册 evidence/inventory.md。

**模式索引**

| # | 模式 | 一句话 | 代表 |
|---|---|---|---|
| [P1](#p1) | 独立 Helper 进程 | 权限挂 Helper 不挂宿主 | ZCode / Codex / Kimi |
| [P2](#p2) | 语义优先+视觉兜底双路径 | 观察-动作-再观察循环 | ZCode / Codex |
| [P3](#p3) | 元素句柄与防漂移 | 校验由知道真相的一侧做 | ZCode / Kimi / Comet |
| [P4](#p4) | 后台定向输入 | 不抢焦点是分界线 | Kimi / ZCode |
| [P5](#p5) | 剪贴板 paste 与 setValue 分层 | 三层文本输入显式暴露 | ZCode / Qoder |
| [P6](#p6) | 控制租约与互斥 | 同一时刻只有一个控制器 | ZCode / MiniMax |
| [P7](#p7) | 防重放与 kill switch | 「可能已下发」不是「失败」 | ZCode / Kimi |
| [P8](#p8) | 浏览器架构选型 | 内嵌/扩展/云端/外挂/载体五选 | Codex / Comet |
| [P9](#p9) | MCP 通用挂载 | 跨宿主复用工具面 | Kimi / Grok / Agent TARS |
| [P10](#p10) | 审批分级与域白名单 | 默认拒绝，策略弹权限硬 | Claude / Codex / Dia |
| [P11](#p11) | Fail-closed 工具注入 | 未启用=工具不存在 | MiniMax / Cursor |
| [P12](#p12) | 批量动作与坐标基准 | 批前截图锚定坐标系 | Claude / Comet |
| [P13](#p13) | 可视化示能与人机共驾 | 让人看见、能夺回 | ZCode / Comet / Atlas |
| [P14](#p14) | 注册表文件型传输 | 低耦合服务发现+懒拉起 | Qoder / Grok |
| [P15](#p15) | 钉死第三方基线 | 兼容=启动时可校验断言 | Qoder / Stagehand |
| [P16](#p16) | 录制→Skill 演示学习 | 泛化外包给人 | Qoder（唯一闭环） |
| [P17](#p17) | 错误即指令协议 | 失败是协议不是异常 | Grok / Comet |
| [P18](#p18) | 执行层外包与 CLI 透传 | 1 个工具吃下命令空间 | Goose（唯一） |
| [P19](#p19) | 云端执行、本地投影 | 本机零权限的代价 | Devin / Fellou |
| [P20](#p20) | 代工换牌与供应链识别 | TeamID 不会骗人 | Grok Bot ← Anysphere |
| [P21](#p21) | **被集成库形态**（新） | 库被产品包进去的反面 | browser-use / stagehand / eko |
| [P22](#p22) | **确定性+AI 逃生舱**（新） | 缓存放选择器序列不放答案 | stagehand |
| [P23](#p23) | **云端全控制委派**（新） | "full computer control"的极端形态与风险 | fellou / devin |
| [P24](#p24) | **prompt 内嵌动作语法**（新） | 无 schema 时代的活化石 | SOC / Agent TARS |

---

<a id="p1"></a>
## P1. 独立 Helper 进程模式（持 TCC 权限、权限中介、与宿主解耦）

**解决什么问题**：桌面控制需要系统权限，但宿主不适合持权、更新重签名会丢授权、原生调用需隔离崩溃域。

| 形态 | 家 | 要点 |
|---|---|---|
| 独立 .app（签名分发+懒启动） | [ZCode](../agents/zcode/computer-use.md) / [Codex](../agents/codex/computer-use.md) / [Cursor](../agents/cursor/computer-use.md) / [Kimi](../agents/kimi-code/computer-use.md) / [Qoder](../agents/qoder/computer-use.md) / [Grok](../agents/grok/computer-use.md) / [MiMo](../agents/mimo/computer-use.md) | 独立签名独占 TCC；IPC 带 token/签名校验（ZCode 钉 TeamID、Grok 升级为团队白名单） |
| 进程内变体 | [MiniMax](../agents/minimax-code/computer-use.md)（Electron utility process）/ [Synara](../agents/synara/computer-use.md)（宿主 spawn `--embedded`） | 免安装链；权限挂宿主，重签名即重授权 |
| Rust 子进程 | [Claude](../agents/claude-code/computer-use.md)（stdio JSON-RPC，退避重启） | 执行层 ComputerUseSwift 静态链接 |
| **反例：新 8 家全无 Helper** | browser-use/stagehand（库）· ui-tars（宿主 App 持权）· SOC（终端持权）· comet/dia/atlas（浏览器自持，无 OS 权限面）· fellou（无本地执行） | 库/浏览器载体形态**结构性不需要**权限中介——这是范式分化最深的一条缝 |

**要点**：安装验签（钉 TeamID）；IPC 鉴权四件套（token/属主/非 symlink/对端签名）；冷启动返回可重试错误（ZCode 退避表、Codex "call this tool again"）；生命周期卫生（随机 socket+陈旧清理）。

**取舍**：独立 Helper 换权限稳定与崩溃隔离，代价是分发安装链复杂；进程内变体省链路但权限挂宿主。库/浏览器形态干脆不进这场游戏。

---

<a id="p2"></a>
## P2. 无障碍优先 + 视觉兜底双路径；观察-动作-再观察循环

**解决什么问题**：纯视觉对文本定位不精且吃 token；纯 AX 对 canvas/自绘控件无效。成熟实现「语义优先、像素兜底」+ 循环纪律。

| 路线 | 家 | 观察 | 动作 |
|---|---|---|---|
| AX 树 diff + 截图辅助 | [ZCode](../agents/zcode/computer-use.md) / [Codex](../agents/codex/computer-use.md) / [Kimi](../agents/kimi-code/computer-use.md) / [Qoder](../agents/qoder/computer-use.md) / [MiniMax](../agents/minimax-code/computer-use.md) / [Synara](../agents/synara/computer-use.md) / [MiMo](../agents/mimo/computer-use.md) / [Grok](../agents/grok/computer-use.md) | 增量 diff（行数预算/台账） | AX 句柄主 + CGEvent 兜底 |
| 页面内文本快照（AX 派的浏览器变体） | [Dia](../agents/dia/browser-use.md)（a11y 快照 diff）/ [Atlas](../agents/atlas/computer-use.md)（ARIA 快照 `ref=`）/ [Comet](../agents/comet/browser-use.md)（AX 伪 HTML）/ [Stagehand](../agents/stagehand/browser-use.md)（CDP AX 文本树） | 结构化文本 + 句柄 | Playwright/CDP 语义动作 |
| 纯视觉（AX 零参与） | [UI-TARS](../agents/ui-tars/computer-use.md) / [SOC](../agents/self-operating-computer/computer-use.md) | 整屏截图（SOC 另有 OCR/YOLO 档） | 模型坐标 → nut-js / pyautogui |
| SoM 三态 | 见 [capability-matrix §3.2](../comparison/capability-matrix.md#32-som-三态20-家后的第三次结论改写) | SOC 真用例 / browser-use 渲染器零调用 / Goose AX 叠注变体 | — |

**要点**：观察要便宜（diff、行数预算、裁剪）；动作后稳定等待再观察（ZCode ActionSettler、Codex 禁手动 setTimeout）；坐标纪律写进工具描述。

**取舍**：AX 精确但脆弱（Electron 需 `AXManualAccessibility`）；截图通用但贵。UI-TARS/SOC 证明纯视觉是可活路线——代价是放弃精确与防漂移，换来跨应用泛化。

---

<a id="p3"></a>
## P3. 元素句柄/ref 机制与防漂移校验

**解决什么问题**：模型拿「42 号元素」去点击时页面可能已变——句柄失效是 CU/BU 第一大错误源。

| 方案（强度递增） | 机制 | 代表 |
|---|---|---|
| 1. 流程纪律 | 错误内嵌新鲜 diff，无运行时校验 | [Codex](../agents/codex/computer-use.md)；[Fellou/eko](../agents/fellou/browser-use.md)（「只用最新索引」）、[UI-TARS](../agents/ui-tars/computer-use.md)/[SOC](../agents/self-operating-computer/computer-use.md)（每轮重截图） |
| 2. 双基线台账 | 数据变没变 / 模型见没见过 分离 | [ZCode](../agents/zcode/computer-use.md)（`tree_shown_to_model`） |
| 3. snapshot_id 绑定 | 动作必带 id，stale 拒绝 | [Cursor](../agents/cursor/computer-use.md)、[Kimi](../agents/kimi-code/computer-use.md)、[MiniMax BU](../agents/minimax-code/browser-use.md)、[Grok](../agents/grok/computer-use.md)（双句柄分账）、[Dia](../agents/dia/browser-use.md)（ref 绑快照、文档替换即过期）、[Atlas](../agents/atlas/computer-use.md)（`ref=` 快照） |
| 4. 描述校验 | assertDescriptionMatches 比对漂移 | [Cursor BU](../agents/cursor/browser-use.md)；ZCode/Kimi prefix-suffix 消歧 |
| 5. verify 三态/效果证据 | verified/未验证/verification_required | [Kimi](../agents/kimi-code/computer-use.md)、[MiniMax](../agents/minimax-code/browser-use.md)、[ZCode](../agents/zcode/computer-use.md)、[Synara](../agents/synara/computer-use.md)、[Qoder](../agents/qoder/computer-use.md)、[Grok](../agents/grok/computer-use.md)；Goose 最轻档（自动补拍） |
| 6. **宁空勿错**（新） | 状态超时→清空句柄台账，报「索引均不可用」 | [browser-use](../agents/browser-use/browser-use.md)（`selector_map` 清空） |
| 7. **视口版本守卫**（新） | 截图-坐标版本不一致→拒绝整批+回新截图 | [Comet](../agents/comet/browser-use.md)（客户端强制一致性） |
| 8. **确定性解析+缓存键**（新） | elementId 由快照 map 确定性解析；缓存按「指令+DOM 键」重放 | [Stagehand](../agents/stagehand/browser-use.md) |

**要点**：ref 作用域显式（绑快照/观察上下文）；旧 ref 主动回收；「容器部分上报」与「裁剪可救回」要区分（ZCode `elements()` 逃逸口）。

**取舍**：强校验降错误率但多往返；纪律派把成本转嫁给模型。20 家后结论更强：**校验应该由知道真相的一侧做**——browser-use 在执行层清台账、Comet 在扩展层卡版本、Stagehand 在快照 map 里定 xpath。

---

<a id="p4"></a>
## P4. 后台定向输入（不抢焦点）

**解决什么问题**：让 agent 后台操作窗口不打断用户——「agent 用电脑」与「agent 抢电脑」的分界线。

| 路线（侵入性递增） | 代表 |
|---|---|
| 1. AX settable 语义写值 | [ZCode](../agents/zcode/computer-use.md)、[Cursor](../agents/cursor/computer-use.md)、[MiniMax](../agents/minimax-code/computer-use.md)、[Kimi](../agents/kimi-code/computer-use.md)、[Qoder](../agents/qoder/computer-use.md)、[Grok](../agents/grok/computer-use.md)、[MiMo](../agents/mimo/computer-use.md) |
| 2. 窗口相对事件路由 | ZCode（pid+bounds+相对坐标）、Kimi（channel 双通道）、Qoder（`CGEventPostToPid`+`BackgroundTextInputSession`） |
| 3. SLS 签名事件认证封包 | [Kimi SignedKeyboard](../agents/kimi-code/computer-use.md)（遮挡窗口也能落键，致谢 Cua AI） |
| 4. 私有框架窗口/空间操作 | [Claude app-cu-helper](../agents/claude-code/computer-use.md)（SkyLight/CGS）、[Synara](../agents/synara/computer-use.md)（activation shield） |

**新 8 家全部缺席此赛道**：CDP/页内合成不占真实光标（不需要后台语义）；nut-js/pyautogui 只有全局前台（做不到）。配套纪律趋同：永不移动真实光标/永不抢前台/永不用 HID；失败时「投递成功 ≠ 生效」单独上报。

**取舍**：私有 API 能力最强但随 macOS 演化有失效风险、过不了 App Store——本地执行系全走 Developer ID 侧面印证；纯 AX 最稳但覆盖不了 Chromium 后台键盘（SignedKeyboard 存在的理由）。

---

<a id="p5"></a>
## P5. 剪贴板 paste 与 setValue 分层

**解决什么问题**：往字段放文本有三条路——AX 写值、剪贴板+Cmd+V、逐键合成——可靠性与侵入性不同，要让模型选对。

| 层 | 代表 | 要点 |
|---|---|---|
| setValue（AX 写值） | 本地执行系 10 家 | 可后台、无自动纠错；Qoder 限 `(settable, string)` 并警告 Monaco「只改 AX 镜像」陷阱 |
| paste（借还剪贴板） | [ZCode](../agents/zcode/computer-use.md)、[Codex](../agents/codex/computer-use.md)、[Kimi](../agents/kimi-code/computer-use.md)、[Qoder](../agents/qoder/computer-use.md)（条件恢复+「粘贴≠编辑成功」） | 恢复放 finally；后台 app 触发 `FOREGROUND_REQUIRED`（ZCode 实证） |
| type（逐键合成） | Claude（多行走剪贴板快速通道）、Kimi（UTF-8+回读） | 最慢但最通用 |
| **变体（新）** | [UI-TARS](../agents/ui-tars/computer-use.md)：Windows `type`=剪贴板 Ctrl+V 再还原 | **type 借剪贴板规避 IME**——快速通道之外的新用途 |
| **截断（新）** | [browser-use](../agents/browser-use/browser-use.md)：`<secret>` 占位符执行期替换 | 敏感值不进模型上下文，比借还更早截断 |
| 反向红线 | [MiniMax BU](../agents/minimax-code/browser-use.md) 不读宿主剪贴板；Synara `read_clipboard` 唯一必审读工具 | 剪贴板是隐私面 |

**取舍**：paste 快但动用户剪贴板且要求前台；setValue 最干净但只对 AX 可达控件有效；三层显式暴露（不自动降级）是共同演化方向。

---

<a id="p6"></a>
## P6. 控制租约与互斥（lease / generation fencing）

**解决什么问题**：多会话同操一台电脑=灾难；需要「同一时刻只有一个控制器」+陈旧消息作废。

| 家 | 实现 |
|---|---|
| [ZCode](../agents/zcode/computer-use.md) | `CONTROLLER_BUSY` 永不重试、报 owner；浏览器侧 `browserGeneration` |
| [MiniMax](../agents/minimax-code/computer-use.md) | lease（观察不占）+TTL+**generation fencing** 防旧进程串话 |
| [Cursor](../agents/cursor/computer-use.md) | 显式租约；教训：只控「屏上存在感」不管输入的租约是负资产 |
| [Claude](../agents/claude-code/computer-use.md) / [Synara](../agents/synara/computer-use.md) / [Grok](../agents/grok/computer-use.md) | 独占锁 / 线程禁下放+nativeInputEpoch / `CURemoteControlLease`+Permit 即时撤销 |
| [Codex](../agents/codex/computer-use.md) / [Qoder](../agents/qoder/computer-use.md) | 无 lease（turn 回收简化）/ 串行化是租约弱形态（单飞+Admission） |
| [MiMo](../agents/mimo/computer-use.md) | 独家锁屏 1–20s 一次性租约 |
| **新 8 家零租约**（反例） | 替代物两种弱形态：[Dia](../agents/dia/browser-use.md)「同时仅一个 browser 委派」串行化；[Comet](../agents/comet/computer-use.md)「标签组被关闭即强制 terminate」 |

**要点**：租约「永不自动重试」并报 owner；fencing 与租约正交（租约管现在谁在控制，generation 管迟到消息作废）。

**取舍**：租约+fencing 是多会话必需品；单会话产品可省——新 8 家多为单会话库/浏览器形态，结构性免租。

---

<a id="p7"></a>
## P7. 防重放（possibly_sent）与 kill switch

**解决什么问题**：动作「发出去没有」是三态不是两态；把「可能已下发」当失败重试会双击双下单。还需用户可控总闸。

| 家 | 实现 |
|---|---|
| [ZCode](../agents/zcode/computer-use.md) | `dispatch_status` 三态收据 + `broker_response_ambiguous` + kill switch 闩锁（两豁免） |
| [Kimi](../agents/kimi-code/computer-use.md) | `delivery_unverified`/`focus_unverified`/`unverifiable` 三态；已投递未观察绝不自动重发 |
| [MiniMax](../agents/minimax-code/browser-use.md) | `click_and_wait_for_navigation` 原子动作消除竞态；复活绝不重放 |
| [Synara](../agents/synara/computer-use.md) / [Grok](../agents/grok/computer-use.md) | nativeInputEpoch /「未投递即失败」不做半截动作 |
| 急停家族 | 软件闩锁（ZCode）/ 物理 Esc（Synara/Claude/Grok）/ UI 停止（MiniMax）/ Takeover（Kimi/Cursor） |
| **（新）**[Comet](../agents/comet/browser-use.md) | 视口守卫：版本不一致**拒绝执行整批**——「未投递即失败」族的批量版 |
| **（新）**[Dia](../agents/dia/browser-use.md) | `outcome=unknown` 禁整格重放、失败格重置 bindings 但副作用不回滚 |
| **（新）**[Atlas](../agents/atlas/computer-use.md) | 停止后内嵌指令 "all tool calls will be ignored. End the agent turn."——急停写进提示词层 |

**要点**：错误对象带 `actionSent`+`retry` 建议；「已派发-效果未知」是一等状态；kill switch 豁免自身与状态查询；闩锁保留首个 reason。

**取舍**：收据三态复杂但双击不可接受——ZCode 事故驱动设计值得直接抄；提示词层急停（Atlas）只能做补充，不能替代协议层。

---

<a id="p8"></a>
## P8. 浏览器架构选型：内嵌 / 扩展 / 云端 / 外挂，外加两种新变体

**解决什么问题**：控制浏览器有几条根本不同的路——自内嵌（可控无登录态）、驱动真浏览器（有登录态不可控）、云端开一个（隔离无本机数据）。20 家后从三架构+一变体扩成六格。

| 架构 | 优点 | 代价 | 实例 |
|---|---|---|---|
| 内嵌 WebView | 完全可控、免权限、可审计 | 无真实登录态 | [ZCode IAB](../agents/zcode/browser-use.md)、[MiniMax](../agents/minimax-code/browser-use.md)、[Synara 面板](../agents/synara/browser-use.md)、[Cursor](../agents/cursor/browser-use.md)、[Kimi 桌面内嵌](../agents/kimi-code/browser-use.md)、[Qoder in-app](../agents/qoder/browser-use.md)、[Codex iab](../agents/codex/browser-use.md)、[Claude Browser pane](../agents/claude-code/browser-use.md) |
| 真浏览器扩展 | 复用真实登录态 | 依赖安装、`isTrusted=false` | [Claude in Chrome](../agents/claude-code/browser-use.md)、[Kimi webbridge](../agents/kimi-code/browser-use.md)、[Codex 扩展](../agents/codex/browser-use.md)、[Qoder Connector](../agents/qoder/browser-use.md)、**[Stagehand MV3 运行时](../agents/stagehand/browser-use.md)（推理执行都在扩展里）**、**[Comet 特权 CRX](../agents/comet/browser-use.md)（浏览器自带+23 私有 API）** |
| 云端浏览器 | 完全隔离、弹性 | 延迟、无本地登录态 | [Codex cdp](../agents/codex/browser-use.md)、[Cursor 云 worker](../agents/cursor/computer-use.md)、[Grok 云四件套](../agents/grok/browser-use.md)、[Devin 云 VM](../agents/devin/browser-use.md) |
| 纯 MCP 外挂 | 零自研载体 | 能力安全归第三方 | [Goose](../agents/goose/browser-use.md)（五扩展）、[MiniMax chrome-devtools-mcp](../agents/minimax-code/browser-use.md)、**[Agent TARS 进程内 MCP](../agents/ui-tars/browser-use.md)（`InMemoryTransport` 零子进程——外挂的内向变体）** |
| **（新）CDP 直连/附着真浏览器** | 真登录态、免扩展安装 | 需调试端口/端口发现；凭据面全开 | **[browser-use](../agents/browser-use/browser-use.md)（自启 Chrome+cdp-use）、[UI-TARS](../agents/ui-tars/browser-use.md)（BrowserFinder+puppeteer-core）、[Dia](../agents/dia/browser-use.md)（DevToolsActivePort 附着用户登录态）、[eko-nodejs](../agents/fellou/browser-use.md)（`setCdpWsEndpoint`）** |
| **（新）fork Chromium 即载体** | 登录态=产品资产；执行观察同进程侧 | 浏览器工程极重；OS 边界不可逾越 | **[Comet](../agents/comet/README.md)、[Atlas](../agents/atlas/README.md)（Mojo 进程内）、[Dia](../agents/dia/README.md)（定制+附着）、[Fellou](../agents/fellou/README.md)（扩展宿主）**——agentic browser 四家（[capability-matrix §6](../comparison/capability-matrix.md#6-谱系关系图)） |

**要点**：扩展安全四件套（双向 pin 扩展 ID、0700 回环、会话容器化、tab 借用治理）；内嵌配套（后端广告制、CDP 黑/白名单、无任意 JS）；成熟产品走向多后端统一 API+能力广告。

**取舍**：三种旧架构对应三种风险偏好；两种新变体把「登录态」从负债变成资产——代价是永远出不了浏览器边界（这恰是 [P23](#p23) 云端委派要补的洞）。

---

<a id="p9"></a>
## P9. MCP 作为模型面通用挂载

**解决什么问题**：CU/BU 工具面要跨宿主跨产品复用；MCP 是最低成本挂载协议。

| 挂载形态 | 家 | 要点 |
|---|---|---|
| 隐藏子命令入口 | [Claude](../agents/claude-code/README.md) | `--computer-use-mcp` 同一二进制自挂自连 |
| 一方 MCP provider | [Cursor](../agents/cursor/README.md) | 与用户 MCP 同一审批管线 |
| 插件+Host Binding | [MiniMax](../agents/minimax-code/README.md) | 准入后注入原生工具；吊销掐断在途 |
| CU 服务即 MCP server | [Kimi](../agents/kimi-code/computer-use.md) | `kimi-cu mcp` stdio + node-repl facade |
| REPL+极简面 | [Codex](../agents/codex/computer-use.md) / [MiMo](../agents/mimo/computer-use.md) | 面在 `cua`/`@mimo/sky` 对象图 |
| 共享 REPL+Symbol 桥接 | [ZCode](../agents/zcode/README.md) | 一个工具承载 CU+BU |
| SKILL 注入+内置 MCP 双轨 | [Qoder](../agents/qoder/README.md) | 按平台/能力选面 |
| 编排下沉（sidecar 即 server） | [Grok Bot](../agents/grok/computer-use.md) | catalog 嵌二进制 `--mcp-stdio` 直挂 |
| **（新）进程内内存管道** | [Agent TARS](../agents/ui-tars/browser-use.md) | 三 server `InMemoryTransport` 直连——**零子进程 MCP** |
| **（新）内嵌 handler 巨面** | [Dia](../agents/dia/browser-use.md) | dia-tools MCP 80 工具（浏览器 7+SaaS 22 家），spec.yaml 白名单下发 |
| **（新）远端 MCP 脚本回传** | [Fellou/eko](../agents/fellou/browser-use.md) | 响应带 `extInfo.javascript`→页内 `execute(args)`——**工具逻辑服务端热更新** |

**要点**：schema 单一事实源生成（Kimi）；未启用=工具不存在（fail-closed）；延迟披露（ToolSearch/tool_search）。

**取舍**：面越薄越靠模型编程能力，越厚越靠 routing 检索；脚本回传形态换取热更新，但「云端下发代码本地执行」是全新信任面（[P23](#p23) 风险）。

---

<a id="p10"></a>
## P10. 审批分级与域白名单

**解决什么问题**：「能操作」≠「什么都能干」；需要按目标与动作风险分级授权，默认拒绝。

| 机制 | 家 | 要点 |
|---|---|---|
| 应用 tier 限权 | [Claude](../agents/claude-code/computer-use.md) | 浏览器 read / 终端 click / 其他 full |
| 服务端目标策略 | [Codex](../agents/codex/computer-use.md) | AppApprovalStore 四档 + elicitation；策略弹、权限硬 |
| origin 白名单+CDP 拒绝列表 | [Cursor](../agents/cursor/browser-use.md) / [Synara](../agents/synara/browser-use.md) | file:// 禁、cookie 四件套拒 |
| 凭据红线 | Codex browserAuth / MiniMax / Synara | 值不回传模型；上传路径白名单 |
| 语义级授权引擎 | [Synara](../agents/synara/computer-use.md) | 可见使用正则；授权绑定对话语义 |
| 最终动作确认合同 | [MiniMax](../agents/minimax-code/browser-use.md) | 发布/支付须紧邻显式确认；草稿变化即作废 |
| 通用权限伞（无专用门） | [Goose](../agents/goose/computer-use.md)（fail-open）/ [Devin](../agents/devin/computer-use.md)（两层浓缩） | 两极对照 |
| **（新）委派级授权** | [Dia](../agents/dia/browser-use.md) | 购买/发消息/删除需父级传授权，否则回 `exact pending action`；**无逐动作弹窗**；`contentIsUntrusted` 免疫注入 |
| **（新）聊天内凭据表单** | [Atlas](../agents/atlas/computer-use.md) | BrowserAuth：agent 遇登录页渲染表单、**用户手填**、agent 只接管填写——凭据根本不过模型 |
| **（新）域名黑白名单+负设计** | [Comet](../agents/comet/computer-use.md) | 企业 policy+内部页恒禁；但 JS 对话框**自动接受**（效率优先，无人工确认） |
| **（新）框架纪律与产品话术分裂** | [Fellou](../agents/fellou/computer-use.md) | 框架 `request_help` 把 CAPTCHA/支付交还人，官网却宣称 AI 解 CAPTCHA——两张皮警示 |

**要点**：拒绝带 `decisionSource`+反绕过指令——拒绝不是建议是跨面禁令；**策略层弹性、权限层与禁区硬**（Codex 本机 `approval_policy="never"` 证明纯 prompt 可被整体调低）。

---

<a id="p11"></a>
## P11. Fail-closed 工具注入（能力门控）

**解决什么问题**：未启用时模型不该看到工具；吊销时要能掐断在途调用。

| 家 | 实现 |
|---|---|
| [MiniMax](../agents/minimax-code/computer-use.md) | 装配时剔除 computer_*；执行时再查；AbortController 掐断在途 |
| [Cursor](../agents/cursor/computer-use.md) | Statsig 门关→延迟注册；区分「门真关」与「未水合」 |
| [ZCode](../agents/zcode/browser-use.md) | 后端广告制：`list()` 是唯一可用性来源，绝不静默换后端 |
| [Claude](../agents/claude-code/computer-use.md) | `app_scoped && darwin` 条件注册 |
| **（新）**[UI-TARS](../agents/ui-tars/browser-use.md) | 非 VLM provider + visual 模式 → **启动期校验拒绝** |
| **（新）**[Stagehand](../agents/stagehand/browser-use.md) | 外部 MCP 未配置=工具不存在（fail-closed） |
| **（新）**[Dia](../agents/dia/browser-use.md) | spec.yaml 白名单 + 双层 Seatbelt deny default——工具面与进程面双 fail-closed |

**要点**：三层校验（装配/执行/转发）；吊销必须能中断在途请求。动态工具列表与 prompt 缓存有张力（Cursor 延迟注册、Kimi `deferred:true` 是工程化解法）。

---

<a id="p12"></a>
## P12. 批量动作与统一坐标基准

**解决什么问题**：逐步往返太慢；批量时坐标系必须唯一，否则批内外截图漂移。

| 家 | 实现 |
|---|---|
| [Claude](../agents/claude-code/computer-use.md) | computer_batch/app_batch：首错即停；**批内坐标一律参照批前截图**；每步过权限门 |
| [Kimi](../agents/kimi-code/computer-use.md) | drag_paths ≤500 笔画×1024 点；非事务可续作；用户光标守卫 |
| [Cursor](../agents/cursor/computer-use.md)（Win） | `expect_change` 每步期望声明；action-result 自带 2× 放大图 |
| **（新）**[Comet](../agents/comet/browser-use.md) | ComputerBatch：每步随机延迟拟人；**视口守卫（版本不一致拒整批回新截图）**——批协议内建失败语义 |

**要点**：批量三必答——坐标系锚定（批前截图）、失败语义（首错停 vs 收集继续）、权限粒度（每项查 vs 整批查）。

**取舍**：批量提升吞吐但放大错误半径；Comet 把「失败即重新定位」编进批协议，是 Claude「每步门控」之外的第三种风格。

---

<a id="p13"></a>
## P13. 可视化示能与「人机共驾」

**解决什么问题**：agent 操作时用户看不见=信任崩塌；要把「正在干什么」渲染出来并给人夺回通道。

| 家 | 实现 |
|---|---|
| 合成光标/点击可视化 | [ZCode Ghost+涟漪](../agents/zcode/computer-use.md)、[MiniMax 54px 指针](../agents/minimax-code/computer-use.md)（不进截图）、[Synara 合成光标](../agents/synara/computer-use.md)、[Kimi Overlay](../agents/kimi-code/computer-use.md) |
| 窗口展示/遮罩 | ZCode PiP；MiniMax 遮罩条+停止按钮；Synara activation shield |
| 活动语义浮层 | [Kimi 桌面浏览器](../agents/kimi-code/browser-use.md)（14 类活动+takeover 即停+receipts） |
| 反向教学 | [Claude teach mode](../agents/claude-code/computer-use.md)：tooltip 引导**用户**操作 |
| **（新）**[Atlas](../agents/atlas/computer-use.md) | AgentCursor 虚拟光标**画进截图**（Operator 同款）——模型与人看到同一视觉 |
| **（新）**[Comet](../agents/comet/computer-use.md) | overlay 状态机：渐变边框+31 条状态标签+Pause/**Take control**；同时 `stopImmediatePropagation` **封锁人类输入**——可视化与输入互斥的反向设计 |
| **（新）**[UI-TARS](../agents/ui-tars/computer-use.md) | 水流特效+预测点击位画框——执行可见但**不可拦截单步** |
| **（新）**[SOC](../agents/self-operating-computer/computer-use.md) | 0.5s 装饰性画圈动画——最简「可见性」，代码自认是动画非安全机制 |

**要点**：可视化层与数据面隔离（指针不进截图——Atlas 反其道把光标画进截图是「给人看」与「给模型看」合一的新解）；接管语义精确到「打断什么」。

**取舍**：可视化耗工程预算，但同时是 UX、信任与审计界面；20 家中完全没做的收窄为：Devin/Goose（透传/云端无本地渲染层）与库形态四家（browser-use/stagehand/SOC/fellou 开源侧）。

---

<a id="p14"></a>
## P14. 注册表文件型传输（ipc/*.json + token + 懒拉起）

**解决什么问题**：宿主与 Helper 需要低耦合服务发现与鉴权；Helper 应「用到才起」。

| 变体 | 家 | 要点 |
|---|---|---|
| 注册表+懒拉起 | [Qoder](../agents/qoder/computer-use.md) | `lstat` 硬校验（0600/非 symlink）；BU 侧心跳文件+存活校验 |
| service.json+懒拉起 | [Grok Bot](../agents/grok/computer-use.md) | 对端 codesign **团队白名单** |
| 固定 shim+四重校验 | [MiMo](../agents/mimo/computer-use.md) | symlink 落点→plist→codesign→build receipt |
| 会合文件+CDN 分发 | [Cursor](../agents/cursor/computer-use.md) | Windows 命名管道+0600 launch token |
| 每会话铸造 socket | [ZCode](../agents/zcode/evidence/inventory.md) | `broker-<hex>.sock`+env 注入 |
| 固定路径派（对照） | [Kimi](../agents/kimi-code/computer-use.md) / [Codex](../agents/codex/computer-use.md) | launchd 常驻/Group Container——零发现延迟，代价是生命周期绑定 |

**新 8 家零注册表**——无 Helper 即无服务发现，这是库/浏览器载体形态的结构性简化。

**取舍**：注册表把生命周期还给按需启动，代价是多一类「陈旧文件」状态；常驻派用 launchd 换零延迟。

---

<a id="p15"></a>
## P15. 钉死第三方工具基线（pinned baseline）

**解决什么问题**：与第三方契约保持兼容时，上游漂移会让「兼容」悄悄失效——兼容必须是启动时可校验的断言。

| 家 | 校验 |
|---|---|
| [Qoder](../agents/qoder/browser-use.md) | 注册时 join 比对 chrome-devtools-mcp 基线，不一致拒绝启动 |
| [Synara](../agents/synara/computer-use.md) / [Codex](../agents/codex/computer-use.md) / [Kimi](../agents/kimi-code/computer-use.md) / [ZCode](../agents/zcode/evidence/inventory.md) | 握手 native_revision / ping apiVersion / assertRuntimeCompatible / producer pin 同 commit |
| **（新）**[Stagehand](../agents/stagehand/browser-use.md) | RuntimeDescriptor **协议主版本协商**——不匹配初始化即失败 |
| **（新）**[Dia](../agents/dia/README.md) | `info.json` `claudeCodeVersion: "2.1.280"`——内嵌运行时**版本自述文件**作为谱系与基线证据 |

**要点**：校验在注册/握手时（非首次调用）；错误写出基线名；pin 到 commit/清单级而非版本号级。

**取舍**：钉死换契约稳定，代价是上游每次更新要显式 re-pin；不校验的兼容声明只是营销。

---

<a id="p16"></a>
## P16. 录制 → Skill 演示学习闭环

**解决什么问题**：纯观察-模仿不可靠；让**用户演示一遍**、从事件流反推可复用意图，泛化难题交还给人。

| 光谱位置 | 家 | 状态 |
|---|---|---|
| 完整闭环（唯一） | [Qoder](../agents/qoder/computer-use.md) | events.jsonl → 推断意图 → 生成 SKILL.md（Claude Code 兼容）；抑制诊断+审批前置 |
| 只录不放 | [Codex](../agents/codex/computer-use.md) | 30 分钟事件流录制，无 Skill 生成 |
| 反方向（教学） | [Claude](../agents/claude-code/computer-use.md) | teach mode：agent 引导用户操作 |

**新 8 家零命中**（无录制面）。**要点**：录制三件套（主证据/生命周期/抑制诊断）；Skill 生成时敏感值转显式输入。**取舍**：演示比描述精确，但录制面=持续屏幕/输入观察——隐私抑制必须前置；从事件流自动萃取可靠 Skill 的产品化难度解释了为何 20 家只有一家走完。

---

<a id="p17"></a>
## P17. 错误即指令协议（结构化拒绝 + 升级建议）

**解决什么问题**：裸错误让模型瞎猜（盲试/绕过/放弃）；把失败设计成带行为指令的结构化对象。

| 家 | 形态 |
|---|---|
| 最完整：[Grok Bot](../agents/grok/computer-use.md) | 16 错误码→retry/ask_user/use_different_tool/stop 四档，`structuredContent{code,message,escalation}` |
| [Cursor](../agents/cursor/computer-use.md) | refusal 四档 escalation（同仓库不完全实现） |
| [Codex](../agents/codex/browser-use.md) / [ZCode](../agents/zcode/computer-use.md) | 拒绝目录+反绕过硬编码 / `{actionSent, dispatchStatus, retry}` |
| **（新）**[Comet](../agents/comet/browser-use.md) | 视口不一致→拒绝整批+**回新截图**——错误即「重新定位」指令 |
| **（新）**[Atlas](../agents/atlas/computer-use.md) | 停止后内嵌指令即协议：全部工具调用将被忽略、结束回合 |
| **（新）**[UI-TARS](../agents/ui-tars/computer-use.md) | 7 个负数错误码（-100000 系）——**有码无协议**（无分档建议），反例样本 |

**要点**：错误码表编译期静态映射；`escalation` 区分「重试安全」与「未生效才可重试」；`stop` 写明波及范围。

**取舍**：错误表成为公共契约，新增码=破坏性变更；裸错误+prompt 纪律省契约但行为不可控。

---

<a id="p18"></a>
## P18. 执行层外包与 CLI 透传

**解决什么问题**：自研 CU 执行层工程重；外包给成熟第三方 CLI，agent 侧只做「1 工具+命令透传」。

| 家 | 实现 |
|---|---|
| [Goose](../agents/goose/computer-use.md)（**20 家中唯一**） | `computer_control` 命令字符串 `shell_words::split` 后原样交 Peekaboo；首次自动 `brew install`；自身零 AX/CGEvent/SCK 代码 |
| 半外包变体 | [Cursor Linux 云 worker xdotool](../agents/cursor/computer-use.md)、[MiMo 非 mac 退化 nut.js](../agents/mimo/computer-use.md)——主执行层仍在自己手里 |
| **对照（新）**[SOC](../agents/self-operating-computer/computer-use.md) | 同为 15 文件级极简，但**自带** pyautogui——极简两路：外包执行（Goose）vs 自带执行（SOC） |

**要点**：透传前分词+参数白名单化；GUI 环境重建 PATH；extension 内嵌第三方 CLI 命令手册把命令空间写进模型上下文。

**取舍**：工具面永不膨胀、能力随 `brew upgrade` 演进；代价是无 lease/无急停/无后台语义/无超时，TCC 归 Peekaboo。Peekaboo `see --annotate`（AX 标注截图）意外贡献了 SoM 三态中的「AX 叠注变体」（[§3.2](../comparison/capability-matrix.md#32-som-三态20-家后的第三次结论改写)）。

---

<a id="p19"></a>
## P19. 云端执行、本地投影

**解决什么问题**：GUI 控制放云 VM，本机免 TCC/免 Helper/天然隔离——但模型与人需要「看得见、够得着、能接管」的本地入口。

| 家 | 形态 | 投影 |
|---|---|---|
| [Devin](../agents/devin/computer-use.md)（纯度最高） | 云 VM `computer`+Interactive Browser（CDP :29229） | 三投影：ACP 能力位 / `mcp add` 外挂 / `--cloud` 代理直连；人接管走会话 UI 同屏 |
| [Grok Bot](../agents/grok/browser-use.md)（混合） | 本地 CU 完整+云端 BU 四件套 | 本机留 cookie 审批导入+noVNC 控制台 |
| **（新）**[Fellou](../agents/fellou/computer-use.md)（最不透明） | deepAction 云端 Javis「full computer control」（中置信） | 投影面不明——比 Devin 少了 Interactive Browser 级证据；包已死亡无法复核 |
| **（新）**[Comet](../agents/comet/README.md)（**镜像形态**） | 决策在 perplexity.ai 云、执行在本机浏览器 | 投影的是「大脑」不是「手脚」——P19 的倒置：云管编排，本地管键鼠 |

**要点**：登录态是云执行命门——blueprint（Devin ≤200MB 跳密码库）/ cookie 逐 origin 人审（Grok）/ 用户本机会话直用（Comet/Dia 反向：不隔离）。程序化入口用受限 CDP；人介入通道多样化（同屏/noVNC）。

**取舍**：本机零权限零残留、算力弹性；代价是延迟、云成本、登录态上传隐私面、「本地投影」误导——负证据判定（[capability-matrix §7](../comparison/capability-matrix.md#7-本机可用性一览分析时点快照)）因此成必备功课。

---

<a id="p20"></a>
## P20. 代工换牌与白牌供应链识别

**解决什么问题**：A 公司产品由 B 公司代工；不识别换牌会重复归因或错记安全责任。

| 案例 | 关系 | 识别证据 |
|---|---|---|
| **Grok Bot ← Anysphere**（谱系最硬） | 同一产品线换牌 | TeamID `DCNK4UB866` 双方一致；homepage cursor.com；JS 残留 `CUCursorService`；CDN `downloads.cursor.com`；`sand-cua` 同名 |
| 借鉴/迁移/复刻先例 | ZCode←Codex、Qoder←qwen-code（UPSTREAM.md）、MiMo←Codex sky（自述复刻） | 方法同源但非换牌 |
| **（新）Dia ← Claude Code SDK** | **整包内嵌开源运行时** | `info.json` `claudeCodeVersion: "2.1.280"` 铁证 + bunfs 内 `computer-use-swift.js` + spec `harness: claude-sdk`——识别第 5 件：**内嵌运行时的版本自述文件** |
| **（新）Atlas ← Operator 协议** | **同源不同栈** | 同 Team `2DC432GLL2`、同 ChatGPT 扩展 id、同 guardian 审批话术；但 Sky 栈零命中——血统相同、执行栈独立（防误并） |
| **（新）Fellou ← Eko** | 产品引用自家开源 | 官方博客自认 "Eko 2.0, a crucial open-source Browser-use infrastructure" |

**取证五件套**：`codesign -dv` TeamID；包元数据残留；运行时默认值/字符串残留；交叉资产（同 CDN/模型 ID/flag 家族）；**内嵌运行时版本自述文件（新增）**。

**取舍**：换牌识别保证横向归因准确，也是安全审计必查（代工=安全模型继承代工方）；行文 stick to 静态证据、标注推断边界。

---

<a id="p21"></a>
## P21. 被集成库形态（「产品内嵌」的反面：库被产品包进去）

**解决什么问题**：产品内嵌 BU（ZCode IAB/Cursor webview）把浏览器能力当私产；另一条路是把自己做成**库**，让任意产品/开发者把你包进去——能力面由集成方组合。

| 家 | 库形态 | 集成面 |
|---|---|---|
| [browser-use](../agents/browser-use/README.md) | `Agent(task, llm, browser_session)` 四参数起步、90+ 可调参数、16 家 LLM 适配器（协议仅一个 `ainvoke`） | 可反挂 MCP server / CLI / 云；「被集成的事实标准」 |
| [stagehand](../agents/stagehand/README.md) | npm/pip/go 三语言 SDK；"The SDK for browser agents"；v4 无 Agent 循环（控制流归开发者） | 被 CrewAI/Mastra/Vercel AI SDK/Claude Code/Codex 以「浏览器工具箱」接入 |
| [eko](../agents/fellou/README.md) | MIT 工作流框架：XML DSL 多 agent 依赖图+变量+watch | Fellou 官方自认 BU 基础设施——**产品把库包进去的活样本** |

**要点**：无宿主假设（不预设 UI/权限/登录态）；LLM 面协议化（browser-use 单 `ainvoke`、stagehand 三路模型抽象）；集成文档即 API 面（stagehand 迁移文档逐条教「从 browser-use 迁来」）。

**取舍**：被集成性换分发广度，代价是产品级安全层缺席——stagehand 无 TCC/租约/急停（浏览器沙箱即边界）；browser-use 靠 `<secret>` 占位符+域围栏自补。CU 分册的「Helper/租约/急停」清单对库形态整体不适用。

---

<a id="p22"></a>
## P22. 确定性 + AI 逃生舱混合范式

**解决什么问题**：全自动 agent 每步推理——贵、慢、不可 review。把大部分步骤交给确定性代码，AI 只在选不出元素时出场，脚本随时间「沉淀」为纯代码。

**代表：[stagehand v4](../agents/stagehand/browser-use.md)**（20 家中唯一完整样本）：

| 机制 | 行为 |
|---|---|
| act 双分派 | 传字符串→AX 快照→结构化推理→elementId→xpath→执行；传 Action 对象（observe 返回值）→**零推理直执行** |
| 确定性主体 | 77 个 Playwright 形状 API 零 token；官方原话 "There is no `Agent`" |
| 缓存 | 服务端按「指令+DOM 键」命中后**无 LLM 确定性重放选择器序列**——缓存放的是真实 DOM 操作序列，不是答案 |
| 自愈 | 执行失败且 selfHeal:on → 重快照重推选择器重试一次；重放失败回退全推理（三层递进） |

**取舍**：控制流可 review/diff/版本化、确定性步骤零 token、缓存重放比记 LLM 文本更抗漂移；代价是没有「一句话任务」——复杂流程要开发者写循环。browser-use 走另一极端（每步推理），两家官方互为迁移指南对象——这是范式光谱的两个端点，不是优劣关系。

---

<a id="p23"></a>
## P23. 云端全控制委派（极端形态与风险对照）

**解决什么问题**：本地执行要 TCC/Helper/审计；把「computer control」整体外包给云端执行体，本机只留委派入口。

| 家 | 委派形态 | 本机残留 | 透明度 |
|---|---|---|---|
| [Devin](../agents/devin/computer-use.md) | 云 VM `computer` 工具+Interactive Browser | 本地投影三件（能力位/mcp add/代理直连） | 高：官方文档+本机数据面交叉可验 |
| [Fellou](../agents/fellou/computer-use.md) | deepAction："delegate to **Javis** with **full computer control** over **networked computers**" | 授权面宣称+eko 开源编排 | 低：云沙箱不可见、包已死亡——判**中置信** |

**风险对照**：

| 风险 | Devin 的答案 | Fellou 的答案 |
|---|---|---|
| 登录态供给 | blueprint ≤200MB、跳过 Chrome 密码库、org 级共享 | 未披露 |
| 审计 | Progress 标签统一记录、sessions.db | 黑箱 |
| 人机边界 | SSO/MFA/CAPTCHA 天然是人的活 | 框架 `request_help` 交还人；**官网却宣称 AI 模拟人类行为解 CAPTCHA**——话术与纪律相悖 |
| 误引导 | 「本地投影」易被误读为本机能力 | 连投影面都不明——用户无从判断执行在哪 |

**取舍**：本机零权限零残留、算力弹性、云侧统一风控；代价是延迟、登录态上传隐私面、审计黑箱。**委派边界必须显式**：Devin 用文档+能力位把「什么在云上」说清楚，Fellou 的模糊恰是反面教材——云端全控制与「网络ed computers」话术叠加时，安全评审应默认最坏解释。

---

<a id="p24"></a>
## P24. prompt 内嵌动作语法（无 schema 时代的活化石）

**解决什么问题**：模型不会调工具时，动作协议只能写进 system prompt 文本。[SOC](../agents/self-operating-computer/computer-use.md) 是这套打法的完整存档，也标定了工具协议的演化起点。

| 层 | SOC 形态 | 现代对照 |
|---|---|---|
| 动作面 | 4 操作（click/write/press/done）写在 prompt；输出=JSON 数组过 `json.loads` | MCP schema / REPL 对象面 / CLI 透传 |
| 解析容错 | `clean_json` 剥 ```` ```json ```` 围栏——唯一容错层 | schema 校验+类型系统 |
| 演化地层 | `misc.py` v1.0 行式协议（`CLICK{}`）死代码与 v1.2 JSON 协议同仓 | 两代协议同仓=地层学样本 |
| 平台适应 | 键位随平台换（mac Spotlight / Win win 键写进 prompt 示例） | 工具层自适应，无 prompt 分支 |
| 反面教材 | 默认 prompt 压制模型拒绝话术（"Don't respond saying you're unable to assist"） | 拒绝升级为结构化协议（[P17](#p17)） |

**残余价值**：零原生 tool-call 依赖=任何会吐文本的模型都能跑。[Agent TARS](../agents/ui-tars/browser-use.md) `browser_vision_control` 同思路（`thought/step/action` 三个字符串参数，服务端复用同一解析器）——prompt 内嵌语法在与视觉模型结合的场景仍然活着。

**取舍**：无 schema 校验、无发现性、错误即停；换来的是模型无关性与三行代码的极简。现代实现仅在兼容不支持 tool-call 的模型时保留此形态。

---

## 附：模式组合的最小可行架构

从头做一个 CU/BU Agent，20 家经验给出的推荐组合：

```
P1 独立 Helper（持 TCC+权限中介；服务发现用 P14）——或走 P21 库路线跳过整层
 ├── P2 AX/页面结构优先+截图兜底；观察-动作-再观察+稳定等待
 ├── P3 snapshot_id 绑定+verify 三态（收据派）；浏览器场景加视口版本守卫
 ├── P4 AX 写值→窗口相对事件→（可选）签名事件；后台失败不升级前台
 ├── P5 setValue / paste（借还）/ type 三层；敏感值用 <secret> 式截断
 ├── P6 单持有者 lease（观察不占）+generation fencing
 ├── P7 dispatch_status 三态收据+kill switch 闩锁（两豁免）
 ├── P8 先内嵌 WebView 起步，扩展/云端/CDP 附着按需加；能力广告屏蔽差异
 ├── P9 MCP 挂载+skill 驱动模型面；未启用即不存在
 ├── P10 应用 tier+域白名单+凭据红线+反绕过错误文案
 ├── P11 三层门控（装配/执行/转发）+在途可掐断
 ├── P12 批量动作（批前截图坐标系+expect_change+批内失败语义）
 ├── P13 合成光标/活动浮层+Takeover+receipts 审计
 ├── P14 注册表文件型传输（0600/非 symlink/存活校验）
 ├── P15 钉死第三方基线（注册/握手时校验，fail-fast）
 ├── P16 （可选）录制→Skill：先「只录不放」，抑制诊断前置
 ├── P17 错误即指令（错误码→四档建议，编译期映射）
 ├── P18 （低成本替代）CLI 透传：单工具+命令手册内嵌 instructions
 ├── P19 （云产品路线）云端执行+本地投影：接管通道与负证据判定必备
 ├── P20 供应链卫生：TeamID/CDN/flag 命名会被取证
 ├── P21 （库路线）被集成形态：无宿主假设+LLM 面协议化；安全层自补
 ├── P22 （生产路线）确定性主体+AI 逃生舱：act 双分派+缓存放选择器序列
 ├── P23 （委派路线）云端全控制要显式边界：登录态/审计/人机边界缺一即反面教材
 └── P24 （兼容路线）prompt 内嵌动作语法：仅当模型不支持 tool-call 时保留
```

> 路线分岔：本地产品走 P1–P20 主干；库（P21）与半自动 SDK（P22）跳过 Helper/租约/急停层；云委派（P23）把安全重心移到登录态与审计；P24 只做兼容层。
