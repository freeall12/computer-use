# 可复用设计模式：自己做一个 CU/BU Agent 需要的一切

> 本文从 7 家实现中提炼「自己做一个 Computer Use / Browser Use Agent」所需的设计模式。
> 每条含：模式名、解决什么问题、谁在用（附各 agent 文档相对路径）、实现要点、取舍。
> 链接均指向本仓库 [agents/](../agents/) 内的分册；证据细节见各分册 [evidence/inventory.md](../agents/)。

**目录**

1. [独立 Helper 进程模式（持 TCC 权限、权限中介）](#p1)
2. [无障碍优先 + 视觉兜底双路径；观察-动作-再观察循环](#p2)
3. [元素句柄/ref 机制与防漂移校验](#p3)
4. [后台定向输入（不抢焦点）](#p4)
5. [剪贴板 paste 与 setValue 分层](#p5)
6. [控制租约与互斥（lease / generation fencing）](#p6)
7. [防重放（possibly_sent）与 kill switch](#p7)
8. [浏览器三架构选型](#p8)
9. [MCP 作为模型面通用挂载](#p9)
10. [审批分级与域白名单](#p10)
11. [Fail-closed 工具注入（能力门控）](#p11)
12. [批量动作与统一坐标基准](#p12)
13. [可视化示能与「人机共驾」](#p13)

---

<a id="p1"></a>
## P1. 独立 Helper 进程模式（持 TCC 权限、权限中介、与宿主解耦）

**解决什么问题**：桌面控制需要 Accessibility / Screen Recording 等系统权限，但 (a) 宿主（Electron/CLI）往往不适合或不能持权；(b) 权限挂在宿主上意味着每次更新/重签名都可能丢授权；(c) 原生 API 调用希望与业务进程隔离崩溃域。

**谁在用**（5/7 有独立 Helper；两家用进程内变体）：
- [ZCode](../agents/zcode/computer-use.md)：`ZCode Computer Use.app`（Node SEA 111MB + `ax_native.node`），宿主验签安装（TeamID 硬钉、staging → 原子 promote、安装锁）、懒启动、LSUIElement；权限中介 `/tmp/zcode-cua-<uid>/broker.sock`（IPC v2，对端代码签名校验）。
- [Codex](../agents/codex/computer-use.md)：Swift 服务 `com.openai.sky.CUAService`，UDS `~/Library/Group Containers/…/computeruse.sock`；客户端三级自愈拉起（host services 管道 → LaunchServices → 重连）。
- [Claude](../agents/claude-code/computer-use.md)：Rust `app-cu-helper`（stdio JSON-RPC，默认 8s 超时，崩溃重启退避 `[0,1s,5s]` 后 60s 冷却）；mac 执行层为 `ComputerUseSwift`。
- [Cursor](../agents/cursor/computer-use.md)：Swift `computer-use-sidecar.app`，CDN 签名 manifest 分发，`service.json` 会合文件 + Unix socket 行分隔 JSON-RPC；Windows Rust sidecar（命名管道 + 0600 launch token 握手）。
- [Kimi](../agents/kimi-code/computer-use.md)：`KimiCU.app`（Swift），launchd Mach service 按需常驻——"CLI may lack accessibility permission; the launchd Service holds it for MCP"，**权限明确归属服务而非 CLI**。
- 变体：[MiniMax](../agents/minimax-code/computer-use.md) 用 Electron **utility process**（`mavis-cua`，macOS `--message-loop-type-ui`）承载 Rust 驱动，MessagePort + generation 隔离；[Synara](../agents/synara/computer-use.md) 由宿主 spawn `cua-driver --embedded`（随机 UUID socket + 孤儿进程清理）。

**实现要点**：
1. Helper 独立签名、独立 bundle id、独占 TCC 授权；宿主安装时校验签名（ZCode 钉 TeamID `8A5X4JJ39T`、Cursor 钉 `DCNK4UB866` + `pinnedSignerSubjects`）。
2. 本地 IPC 一律带鉴权：一次性 token（ZCode/Kimi `runtime.token`）、对端 uid 校验（socket 不可 world-writable）、对端代码签名摘要（ZCode `PeerCodeSigningSummary`）。
3. 冷启动契约：Helper 未就绪返回**可重试**错误（ZCode `CUA_NOT_READY` 退避表 `[250,500,750,1000,1500]ms`；Codex "Do not end your turn yet, just call this tool again"）。
4. 生命周期卫生：随机 socket 路径 + 陈旧清理（ZCode 24h、Synara 孤儿扫描 kill）。

**取舍**：独立 Helper 换来权限稳定与崩溃隔离，代价是分发/安装/升级链路复杂（Cursor 为此造了整套签名分发体系；Kimi 提醒「升级不会自动替换长寿 MCP 桥」）。MiniMax 的 utility process 变体省掉安装链，但权限只能挂宿主 app，更新重签名即重授权。

---

<a id="p2"></a>
## P2. 无障碍优先 + 视觉兜底双路径；观察-动作-再观察循环

**解决什么问题**：纯视觉（截图+坐标）对文本定位不精确且吃 token；纯 AX 对 canvas/自绘控件无效。所有成熟实现都是「语义优先、像素兜底」，并把「观察→动作→再观察」固化为循环纪律。

**谁在用**：全部 7 家。
- [ZCode](../agents/zcode/computer-use.md)（§4–5）：`strategy:"auto"` 默认 AX；`strategy:"event"` 兜底且**要求已在前台**（永不主动激活）；隐藏窗口 AX 树可用而栅格 fail-closed，错误信息引导改走元素路径。
- [Codex](../agents/codex/computer-use.md)（§4–5）：AX diff 为主、Skyshot（AX+截图+分类器）为观察原子；指令硬约束「每动作后必须 getAXState 再决策」。
- [Claude](../agents/claude-code/computer-use.md)（§4）：display-scope 纯截图系（含 `zoom` 从上次截图裁剪），app-scoped 附 AX 摘要 `[N]` 索引 + `app_ax_find`。
- [Cursor](../agents/cursor/computer-use.md)（§4）：截图（固定 canvas WEBP）+ AX 树文本；BU 侧同构（snapshot 结构 + screenshot 视觉，提示词明示「不能基于截图定位动作」）。
- [MiniMax](../agents/minimax-code/computer-use.md)（§5）：element_token 或 x/y **互斥**（混用直接报错）；`computer_verify_state` 结构化后置条件。
- [Kimi](../agents/kimi-code/computer-use.md)（§3–4）：AX index + 截图像素双轨 + `rect` 局部裁剪。
- [Synara](../agents/synara/computer-use.md)（§4）：SCK 截图 + 完整 AX 树 + `zoom` + `verify_state`。

**实现要点**：
1. 观察要「便宜」：AX 树增量 diff（只回变化）、行数预算（Codex `AccessibilityDifferenceLineBudgetExceeded`）、大树优先级裁剪（ZCode 祖先保留 + `elements()` 逃逸口）。
2. 动作后**稳定等待**再观察：ZCode ActionSettler（300ms 起步、树指纹连续两次一致或 5s 上限）、Codex 内置自动等待并禁止模型手动 setTimeout、Cursor 动作后自动回新截图。
3. 坐标纪律写进工具描述：坐标是「最近一次截图/栅格的全分辨率坐标系」，scale 只缩返回图省 token（Claude/MiniMax/ZCode 三家逐字级一致）。

**取舍**：AX 路径精确但脆弱（Electron 应用常需 `AXManualAccessibility` 手工开启，Codex/Kimi 符号表均见）；截图路径通用但贵。双路径 + 明确的路由提示（Kimi 输出 `is_electron/has_cef` 供路由判断）是当前最优解。

---

<a id="p3"></a>
## P3. 元素句柄/ref 机制与防漂移校验

**解决什么问题**：模型拿着「第 42 号元素」去点击时，页面可能已经变了。句柄失效是 CU/BU 第一大错误源。

**谁在用**（五个递强度的方案，可组合）：
1. **diff 基线 + 流程纪律**：[Codex](../agents/codex/computer-use.md)（§3.5、§4.1）——动作后错误信息**内嵌新鲜 AX diff**；不做运行时校验。
2. **diff 基线 + 模型可见性台账**：[ZCode](../agents/zcode/computer-use.md)（§4.1–4.2）——Helper 管「数据有没有变」，宿主管「模型有没有见过」（`tree_shown_to_model` 台账 + `recordModelVisibleTree` 索引位移校验）；只截图的观察不算基线。
3. **snapshot_id 绑定**：[Cursor CU](../agents/cursor/computer-use.md)（element_id + snapshot_id，树未变可复用连续填表）、[Kimi](../agents/kimi-code/computer-use.md)（"stale or other-context IDs are rejected"）、[MiniMax BU](../agents/minimax-code/browser-use.md)（snapshotId + nextOffset 续页）。
4. **描述校验 assertDescriptionMatches**：[Cursor BU](../agents/cursor/browser-use.md)（§4.1）——动作带人类可读描述，执行前比对 tag/role/text，漂移即要求重新 snapshot；同族：ZCode/Kimi `select_text` 的 prefix/suffix 消歧。
5. **verify_after 三态 / 效果证据**：[Kimi](../agents/kimi-code/computer-use.md)（verified / 未验证 / verification_required；"A delivered click with an unobserved effect is never automatically repeated"）、[MiniMax](../agents/minimax-code/browser-use.md)（effect.verified + VERIFIED_FILL 4 次采样 + `verificationRequired`）、[ZCode](../agents/zcode/computer-use.md)（`[effect_evidence unchanged]` 寄存——修复了模型对「点了没反应」零感知、连点三次的事故）、[Synara](../agents/synara/computer-use.md)（点击前截图 marker + evidence.json 取证、ref frame identity 重验）。

**实现要点**：
- ref 作用域必须显式：绑定「最近一次快照」（Cursor BU 明文）或「观察上下文」（Kimi `observation_context` 随机 UUID，跨上下文复用直接拒绝）。
- 旧 ref 主动回收：Cursor 注入脚本「本次未引用到的旧 ref 会被清除」。
- 裁剪可救回：ZCode 被裁剪索引可从 `elements()` 逃逸口拿回；但容器部分上报（`showing A-B of N`）救不回，只能滚动后再观察——要把这两种截断区分开。

**取舍**：运行时强校验（方案 3–5）显著降低错误率，但每次动作多带参数、多一次往返；「纪律派」（方案 1）最省但把错误成本转嫁给模型。ZCode 的经验是：**校验应该由知道真相的一侧做**（Helper 知道元素是否还在，客户端的 stateId 守卫反而删除了）。

---

<a id="p4"></a>
## P4. 后台定向输入（不抢焦点）

**解决什么问题**：让 agent 在后台操作某个窗口，不打断用户正在做的事——这是「agent 用电脑」与「agent 抢电脑」的分界线。

**谁在用**（四条技术路线，按侵入性递增）：
1. **AX settable / 语义写值**：[ZCode `set_value`](../agents/zcode/computer-use.md)、[Cursor `computer_set_value`](../agents/cursor/computer-use.md)、[MiniMax `set_value`](../agents/minimax-code/computer-use.md)、[Kimi no-raise 后台替换](../agents/kimi-code/computer-use.md)（§3.2）——不敲键盘、可后台、无自动纠错干扰。
2. **窗口相对事件路由**：[ZCode](../agents/zcode/computer-use.md)（§5.1）坐标点击归一为「pid + bundle_id + window_id + 窗口 bounds + 窗口内相对坐标」派发（日志实证），永不发全局屏幕点击；[Kimi](../agents/kimi-code/computer-use.md)（§5.1）`channel:auto|skylight|public` 双通道（SkyLight WindowServer 补全窗口号 vs NSEvent 工厂事件 postToPid，无跨通道自动重试）。
3. **签名事件认证封包（SLS 私有 API）**：[Kimi SignedKeyboard](../agents/kimi-code/computer-use.md)（§5.2）——`SLSEventAuthenticationMessage` + `SLEventPostToPid` 定向投给目标 pid，**窗口完全被遮挡也能落键**（公开致谢 Cua AI，独立实现）；回退 `CGEventPostToPid`。
4. **私有框架窗口/空间操作**：[Claude app-cu-helper](../agents/claude-code/computer-use.md)（§5）——SkyLight/CGS 私有 API（`SLSGetActiveSpace`/`SLPSPostEventRecordTo`/`CGSCopySpacesForWindows`），异 Space 窗口拉回、后台菜单遍历点击；[Synara](../agents/synara/computer-use.md) activation shield / Space 指定。

配套的合成焦点会话：ZCode `RegisterBackgroundInput` + `*_to_app` 键盘路径（按压前后采样 `frontmostPid`/`axFocusedPid` guard，受理与生效分离上报）。

**实现要点**：
- 焦点 guard 三态上报：ZCode `focusSetStatus:"invalid_element"` 但 `ax_ok:true`——焦点设置失败不影响动作受理，两者**分开报告**。
- 后台失败不静默升级：MiniMax "background 被应用拒绝时，运行时绝不自动改发 foreground"，升级决定留给模型+用户；ZCode event 策略直接拒 `FOREGROUND_REQUIRED` 且什么都不发。
- 兜底阶梯明确：AX 写值 → 编辑命令 → AX 聚焦 → `activate:true`（短暂抬窗，上报 `used_backend=foreground_targeted`）。

**取舍**：私有 API 路线（3/4）能力最强但随 macOS 版本演化有失效风险，且过不了 App Store 审核——7 家全部走 Developer ID 分发侧面印证了这一点。纯 AX 路线最稳但覆盖不了 Chromium 后台键盘，这正是 SignedKeyboard 存在的原因。

---

<a id="p5"></a>
## P5. 剪贴板 paste 与 setValue 分层

**解决什么问题**：往字段里放文本有三条路——AX 写值、剪贴板+Cmd+V、逐键合成——可靠性与侵入性完全不同，需要分层并让模型能选对。

**谁在用**：
- [ZCode `paste`](../agents/zcode/computer-use.md)（§5.3）：`ZCodeCuaPasteDataProvider` 借系统剪贴板 → 模拟 Cmd+V → **恢复用户原剪贴板**；无 app 读取粘贴内容 → 超时报错而非假成功；后台 app 触发 `FOREGROUND_REQUIRED`（本质是事件路径）。
- [Codex](../agents/codex/computer-use.md)（§3.3）：mac paste 同样恢复用户剪贴板；`format: text|md|html` 富文本。
- [Kimi `paste`](../agents/kimi-code/computer-use.md)（§3.2）：临时剪贴板投递并事后恢复；`text|md|html`。
- [MiniMax BU `paste`](../agents/minimax-code/browser-use.md)：**不读宿主 OS 剪贴板**，headless 用会话内隔离剪贴板——反向红线。
- setValue 面：全部 7 家均有（见 P4 路线 1）；MiniMax 还提示「值变了不等于输入处理器执行过，需验证依赖 UI」。

**实现要点**：借还必须原子且失败安全（恢复剪贴板放在 finally）；paste 结果要验证（有没有 app 真的读了）；`type` 多行走剪贴板快速通道（Claude）。

**取舍**：paste 快且保留富文本，但动用户剪贴板（需要借还）且要求前台；setValue 最干净但只对 AX 可达控件有效。把三者作为显式分层暴露（而不是自动降级链）让模型按场景选择，是 7 家的共同演化方向。

---

<a id="p6"></a>
## P6. 控制租约与互斥（CONTROLLER_BUSY / lease / generation fencing）

**解决什么问题**：多个会话同时操作一台电脑 = 灾难。需要「同一时刻只有一个控制器」的硬保证，以及陈旧控制器消息不串话的防护。

**谁在用**：
- [ZCode](../agents/zcode/computer-use.md)（§6.3）：`CONTROLLER_BUSY`——另一会话持有输入租约时动作失败，**永不重试**，`details.owner` 携带占用者，要求模型报告并请用户处理；浏览器侧对应 `browserGeneration` 陈旧路由防护。
- [MiniMax](../agents/minimax-code/computer-use.md)（§3.3–3.4）：单持有者 lease，变更类请求才占租约（观察不占）、TTL 定时器、FIFO 缓存 64 条已释放 turn；**generation fencing**——每次重建 generation +1，控制消息校验 generation 防旧进程串话（`computer_generation_mismatch`）。
- [Cursor](../agents/cursor/computer-use.md)（§3.4）：`computer_start/release_control` 显式租约（remote 模式首个输入前必调）；Windows 侧注释直言：只控「屏上存在感」不做输入门控的租约是负资产（实测一次会话浪费 13 秒）——**租约要么管输入，要么别要**。
- [Claude](../agents/claude-code/computer-use.md)（§6）：独占锁 + `app_release` 例外放行。
- [Synara](../agents/synara/computer-use.md)（§6）：能力域闸门 `computer:control` + "Threads cannot delegate computer control to tasks they create"（父线程不得向子任务下放桌面控制权）；`nativeInputEpoch` 让人接管后旧在途结果按「已派发-效果未知」上报。
- [Codex](../agents/codex/computer-use.md)（§6.3）：**无 lease**（实证无符号）；靠 `turn_ended` 回收 + per-turn 停止 + `codexTurnMetadata` 请求记账——单用户桌面场景下的简化选择。

**实现要点**：租约要「永不自动重试」并报告 owner（把冲突决策交给人）；fencing token（generation）与租约正交——租约管「现在谁在控制」，generation 管「旧控制器的迟到消息作废」。

**取舍**：租约 + fencing 是多会话产品的必需品（ZCode/MiniMax/Synara 都是多会话形态）；单会话产品（Codex）可以省。Cursor 的教训说明租约本身也有成本，要和真实威胁模型对齐。

---

<a id="p7"></a>
## P7. 防重放（actionSent / possibly_sent）与 kill switch

**解决什么问题**：网络/进程边界上「动作到底发出去没有」是三态而非两态。把「可能已下发」当成「失败」去重试，会双击、双发消息、双下单。同时需要一个用户可控的**总闸**。

**谁在用**：
- [ZCode](../agents/zcode/computer-use.md)（§6.3–6.4）：收据 `dispatch_status ∈ {sent, possibly_sent, not_sent}`；`possibly_sent ⇒ actionSent=true ⇒ retry:"reobserve"`——非幂等动作只有 `actionSent===false` 才允许重放；broker 响应丢失显式建模为 `broker_response_ambiguous`（不可自动重试）。kill switch：`stop_computer_control` 闩锁后每个工具入口 `ensureRunning()` 在任何 backend 读取**之前** fail-hard（仅 `request_access`/`stop` 两豁免，否则无法报告状态/停止）。
- [Kimi](../agents/kimi-code/computer-use.md)（§5.4）：`delivery_unverified`/`focus_unverified`/`effect:"unverifiable"` 三态；"A delivered click with an unobserved effect is never automatically repeated"；被吞事件可能分钟级后才落地——盲目重发同一坐标可能双击。
- [MiniMax](../agents/minimax-code/browser-use.md)（§3.1）：`click_and_wait_for_navigation` 原子动作（先注册导航监听再点击，消除「先点击后监听」竞态）；空闲会话复活「绝不重放输入动作」。
- [Synara](../agents/synara/computer-use.md)（§5）：每次原生输入派发推进 `nativeInputEpoch`，人接管/暂停后 epoch 变化，旧在途结果按「已派发-效果未知」上报。
- kill switch 家族：[MiniMax 桌面遮罩停止按钮](../agents/minimax-code/computer-use.md)（点击等价 abort API）、[Synara 物理 Escape 急停](../agents/synara/computer-use.md)（专职 helper 进程，仅活跃 generation 时武装 + 输入冷却窗）、[Claude EscHotkey](../agents/claude-code/computer-use.md)、[Codex URL 禁区/per-turn 停止](../agents/codex/computer-use.md)（§6.1）。

**实现要点**：
1. 错误对象携带 `actionSent`（保守默认 false）+ `retry` 建议（reobserve/retry/never）三件套。
2. 「已派发-效果未知」是一等结果状态，不是错误。
3. kill switch 必须豁免自身与状态查询（否则停不下来也看不到状态）；闩锁语义（保留第一个 reason）保证审计一致。
4. 急停入口多样化：软件闩锁（ZCode）、物理 Esc（Synara/Claude）、UI 停止按钮（MiniMax）、浏览器 Takeover（Kimi/Cursor）。

**取舍**：收据三态让协议变复杂，但「双击」类事故不可接受——ZCode 是事故驱动设计（注释明言），值得后来者直接抄。

---

<a id="p8"></a>
## P8. 浏览器三架构选型：内嵌 WebView / 真浏览器扩展+native messaging / 云端浏览器

**解决什么问题**：控制浏览器有三条根本不同的路：自己内嵌一个（可控、无登录态）、驱动用户真浏览器（有登录态、不可控）、云端开一个（完全隔离、无本机数据）。7 家各有实例，且多家**并存两条以上**。

| 架构 | 优点 | 代价 | 实例 |
|---|---|---|---|
| **内嵌 WebView** | 完全可控、免系统权限、可录屏可审计 | 无用户真实登录态、非真实环境 | [ZCode IAB](../agents/zcode/browser-use.md)（BrowserView + `executeBrowserCommandOnView`）、[MiniMax](../agents/minimax-code/browser-use.md)（WebContentsView + CDP）、[Synara 面板](../agents/synara/browser-use.md)（BetterWright + `contents.debugger`）、[Cursor browserViewMainService](../agents/cursor/browser-use.md)、[Kimi 桌面内嵌](../agents/kimi-code/browser-use.md)（隔离世界 1001/1002 注入）、[Codex iab](../agents/codex/browser-use.md)、[Claude Browser pane](../agents/claude-code/browser-use.md)（第二注册表） |
| **真浏览器扩展** | 复用真实登录态、真实环境 | 依赖用户安装、`isTrusted=false`、iframe 受限 | [Claude in Chrome](../agents/claude-code/browser-use.md)（native messaging + 唯一扩展 ID 双向锁定）、[Kimi webbridge](../agents/kimi-code/browser-use.md)（Go daemon + WS 反连扩展）、[Codex chrome 扩展](../agents/codex/browser-use.md)（官方扩展 + extension-host 原生宿主）、[Cursor cursor-browser-extension](../agents/cursor/browser-use.md)（常量，本机未验证） |
| **云端浏览器** | 完全隔离、无本机数据、可弹性伸缩 | 延迟、无本地登录态、服务不可见 | [Codex cdp 后端](../agents/codex/browser-use.md)（id 固定 `"cdp"`）、[Cursor remote 模式/云 worker](../agents/cursor/computer-use.md)（xdotool + ffmpeg x11grab） |

**实现要点**：
- 扩展架构的安全四件套（从 Claude/Kimi/Codex 归纳）：`allowed_origins` 锁定唯一扩展 ID ↔ native host 仅接受唯一扩展（双向 pin）；本地 socket/端口 0700 + 回环绑定 + 非回环明文警告；会话容器化（Claude 的 MCP tab group / Kimi 的 session=tab group，只动自己组的 tab）；用户 tab 借用治理（`claimTab` 显式接管 / `find_tab active:true` 只借不抢 `borrowed:true`）。
- 内嵌架构的配套：后端广告制（`agent.browsers.list()` 是唯一可用性来源，绝不静默换后端——ZCode）、CDP 方法黑名单（Cursor 拒绝 Input/Storage/Target 域；Synara 禁 cookie/证书/下载行为）、无任意 JS（MiniMax 原生工具明确不提供 evaluate，JS 执行让位给 chrome-devtools-mcp 插件）。
- 录屏走内嵌优势区：ZCode 用 Electron 内置 Chromium `MediaRecorder` 出 WebM（无 FFmpeg 依赖），并成为 video2code 插件「录制→复刻」流水线的上游。

**取舍**：三种架构覆盖三种风险偏好，成熟产品最终都走向多后端统一 API（Codex 四后端、Synara 三路径、Kimi 双轨），以「后端能力广告（capabilities advertised）」向上屏蔽差异。

---

<a id="p9"></a>
## P9. MCP 作为模型面通用挂载

**解决什么问题**：CU/BU 工具面需要跨宿主（CLI/桌面/插件）、跨产品复用；MCP 是最低成本的通用挂载协议。

**谁在用**（六种挂载形态）：
- **隐藏子命令入口**：[Claude](../agents/claude-code/README.md)——`claude --computer-use-mcp` / `--claude-in-chrome-mcp` / `--chrome-native-host`，同一二进制自挂自连（stdio）。
- **一方 MCP provider**：[Cursor](../agents/cursor/README.md)——内置扩展调 `vscode.cursor.registerMcpProvider()`（`cursor-ide-browser` / `cursor-computer-use`），与用户 MCP 走同一审批管线。
- **插件 + Host Binding 门控**：[MiniMax](../agents/minimax-code/README.md)——官方插件带 `*.binding.json` 声明 `hostCapability: computer.use/browser.use`，准入后运行时才注入原生工具；插件吊销立即 `setEnabled(false)` 并掐断在途调用。
- **CU 服务即 MCP server**：[Kimi](../agents/kimi-code/computer-use.md)——`kimi-cu mcp` 直接把原生服务暴露成 stdio MCP（18 工具 + js/js_reset），另经 node-repl facade `@kimi/cu` 走代码模式。
- **REPL + 极简工具面**：[Codex](../agents/codex/computer-use.md)——MCP 只露 `js`/`js_reset`，banner `await import("@oai/cua/tinyskyAlt")` 后整个能力在 `cua` 全局对象上。
- **共享 REPL + Symbol 桥接**：[ZCode](../agents/zcode/README.md)——`mcp__node_repl__js` 一个工具承载 CU+BU，`Symbol.for("zcode.node-repl.computer-use-bridge")` 注入桥接器，SDK+skill 文档教模型写 JS。

**实现要点**：
- 工具 schema 可以由原生侧单一事实源生成（Kimi：二进制内嵌 schema JSON + `generate-tool-catalog.py`；facade 与 MCP 双轨参数别名表）。
- 未启用 = 工具不存在（fail-closed），而不是存在但报错（MiniMax/Cursor 的门控共同点）。
- 延迟披露：Claude 的 ToolSearch、MiniMax 的 `tool_search`——大量工具不进初始列表，按需加载。

**取舍**：MCP 面越薄（Codex 3 工具）越依赖模型编程能力；越厚（Claude ~40 工具）越依赖 routing 与检索。skill/文档驱动的「模型面」（ZCode/Kimi）是折中：常驻的是方法论手册，参数细节按需拉取。

---

<a id="p10"></a>
## P10. 审批分级与域白名单

**解决什么问题**：「能操作电脑」不等于「什么都能干」。需要按目标（app/域）与按动作风险分级的授权体系，且默认拒绝。

**谁在用**：
- **应用白名单 + tier 限权**：[Claude](../agents/claude-code/computer-use.md)（§6.1）——浏览器→`read`（可见不可点，指引改用 Chrome MCP）、终端/IDE→`click`（可点不可打字，防"AI 往 shell 里打命令"，指引改用 Bash）、其他→`full`；执行靠前台应用门控，batch 每步前重查。风险敏感动作（删除数据/CAPTCHA/支付/医疗）在 Codex 策略 prompt 里编号 [1]–[17] 四档确认。
- **服务端目标策略**：[Codex](../agents/codex/computer-use.md)（§6.1）——`getAppPolicy → {decision, risk, allowPersistentApproval}` + AppApprovalStore 持久化（ALWAYS/ONCE/SESSION/TURN）+ MCP elicitation 弹审批；企业托管键可整体关闭能力。
- **origin 白名单 + CDP 拒绝列表**：[Cursor](../agents/cursor/browser-use.md)（§7）——导航禁 `file://`、管理员 allowlist、CDP 域级拒绝（Input/Storage/Target/Tethering）+ 方法级拒绝（cookie 四件套、`Page.navigate`…）；[Synara](../agents/synara/browser-use.md) 页面域白名单 + cookie/证书/下载黑名单。
- **凭据红线**：[Codex browserAuth](../agents/codex/browser-use.md)（凭据在安全表单收集、值不回传模型）、[MiniMax](../agents/minimax-code/browser-use.md)（不可读/生成/填写任何认证输入；上传路径白名单=当前轮附件∪活动工作区，含 symlink 解析）、[Synara BetterWright](../agents/synara/browser-use.md)（`credentialCapture:false`、密码填充 vault 值永不回传模型）。
- **语义级授权引擎**：[Synara computerVisibleUse](../agents/synara/computer-use.md)（§6.3）——从用户消息正则判定「可见使用」意图（引用块/代码块先剥离防注入），后台倾向短语一票否决，授权只沿「例行继续」存续，2 秒用户安静期。
- **最终动作确认合同**：[MiniMax](../agents/minimax-code/browser-use.md)（§6.6）——发布/发送/删除/购买/转账必须紧邻的用户显式确认；"继续/好的"不算确认；草稿变化后确认作废；确认卡 affirmative 必须点名精确动作。

**实现要点**：拒绝要带 `decisionSource` 与**反绕过指令**（Codex 错误文案硬编码 "must not attempt to achieve the same outcome via workaround, indirect execution, raw CDP…"；ZCode「权限被拒后禁止换用其他 UI 自动化技术」）——拒绝不是建议，是跨面禁令。

**取舍**：白名单维护成本高（Claude 硬编码敏感应用分类）；纯 prompt 策略可被用户整体调低（Codex 本机 `approval_policy="never"`），所以**策略层必须是弹性的、权限层与禁区必须是硬的**（Codex 分册原话）。

---

<a id="p11"></a>
## P11. Fail-closed 工具注入（能力门控）

**解决什么问题**：能力未启用/未授权时，模型不应该看到工具（看到就会试图调用）；权限中途吊销时，在途调用要能被掐断。

**谁在用**：
- [MiniMax](../agents/minimax-code/computer-use.md)（§3.1）——工具目录装配时先**剔除所有** `computer_` 前缀工具，仅当插件准入 + 用户会话选中 + client 就绪才重建追加；执行时再查一次 `isComputerUseEnabled()`，AbortController 注册表让吊销即时掐断在途调用；BU 侧 kill switch 吊销后「连工作区 I/O 都不做」。
- [Cursor](../agents/cursor/computer-use.md)（§2）——Statsig 门关 → 不注册 provider，只挂 `onDidChangeGates` 监听延迟注册；注释明言要区分「门真的关」与「Statsig 未水合」。
- [ZCode](../agents/zcode/browser-use.md)（§6）——后端广告制：`agent.browsers.list()` 是唯一可用性来源，显式选择未广告后端 → `backend_unavailable`，绝不静默换后端；宿主剔除没有 broker env 的可疑 CUA MCP server。
- [Claude](../agents/claude-code/computer-use.md)——`app_scoped && platform==="darwin"` 条件注册；权限模式 env 仅在 bypass 模式注入。

**实现要点**：三层校验（装配时、执行时、宿主转发时）；吊销路径必须能中断在途请求而不只是拒绝新请求。

**取舍**：动态工具列表与 prompt 缓存有张力（工具集变化会使缓存失效）——Cursor 的「延迟注册」与 Kimi 的 `deferred:true` per-session MCP 都是围绕这个张力的工程化。

---

<a id="p12"></a>
## P12. 批量动作与统一坐标基准

**解决什么问题**：一步步往返太慢（每步一个模型推理回合）；批量时坐标参照系必须唯一，否则「批内截图」与「批外截图」坐标系漂移。

**谁在用**：
- [Claude `computer_batch`/`app_batch`](../agents/claude-code/computer-use.md)（§3.3–3.4）——一次往返顺序执行、首错即停；**批内坐标一律参照批前全屏截图**；每步前跑前台应用门控；`ineffective` 结果不停批（app_batch）。
- [Kimi `drag_paths`](../agents/kimi-code/computer-use.md)（§3.2）——≤500 笔画 × ≤1024 点的同窗口批量（绘画/手势）；非事务，返回 `results/delivered/total`，中断可从首个 false 续作；`abort_if_cursor_in_window` 用户光标守卫。
- [Cursor `computer_batch`](../agents/cursor/computer-use.md)（§3.5，Windows）——步骤内是 sidecar 原生词汇、`expect_change` 每步期望声明、`allow_destructive` 显式开关；action-result 自带 2× 局部放大图省一次 zoom 往返。
- [Claude `browser_batch`](../agents/claude-code/browser-use.md)——每项独立过权限检查（无权限域的下一项失败停批）、不能嵌套。

**实现要点**：批量的三个必答题——坐标系锚定（批前截图）、失败语义（首错停 vs 收集继续，按动作幂等性选择）、权限粒度（每项查还是整批查）。

**取舍**：批量提升吞吐但放大错误半径；Claude 的「每步门控」与 Cursor 的「expect_change」是把安全语义编进批协议的两种风格。

---

<a id="p13"></a>
## P13. 可视化示能与「人机共驾」

**解决什么问题**：agent 在操作电脑时用户完全看不见 = 信任崩塌 + 无法及时纠偏。需要把「agent 正在干什么」渲染出来，并给人随时夺回控制权的通道。

**谁在用**：
- **合成光标/点击可视化**：[ZCode Ghost 光标 + 点击涟漪](../agents/zcode/computer-use.md)（§9）、[MiniMax 54px 指针动画窗口](../agents/minimax-code/computer-use.md)（`setContentProtection(true)` 不进截图、不读不动真实光标）、[Synara patched driver 合成光标](../agents/synara/computer-use.md)（`--compact-cursor --idle-hide-ms`）、[Kimi Overlay 浮层](../agents/kimi-code/computer-use.md)（cursor/click_glow 素材）。
- **正在操作的窗口展示**：[ZCode PiP 画中画](../agents/zcode/computer-use.md)（按 session/turn 复位、启动前 hit-surface 校验）、[MiniMax cua-preview + 窗口移交](../agents/minimax-code/computer-use.md)。
- **操作遮罩与公告**：[MiniMax 桌面遮罩条 + 停止按钮](../agents/minimax-code/computer-use.md)、[Synara activation shield](../agents/synara/computer-use.md)（目标窗口矩形上的护盾面板，防误点其下的系统 UI）。
- **活动语义浮层**：[Kimi 桌面浏览器 surface 状态机](../agents/kimi-code/browser-use.md)（§3.5）——14 类活动（reading/clicking/typing…）+ 指针/键入动画实时渲染 + 用户 takeover 即停 + receipts 审计（截图 ≤720px、JPEG q72、归一化标记、30 天留存）。
- **反向教学**：[Claude teach mode](../agents/claude-code/computer-use.md)（§3.5）——全屏 tooltip 引导**用户**操作，`explanation` 是"用户唯一能看到你说话的地方"。

**实现要点**：可视化层必须在合成器层与数据面隔离（指针不进截图、PiP 不占帧预算）；接管语义要精确到「打断什么」——Synara 只打断前台在途动作，后台控制刻意不被人输入打断（"Background control shares the Mac with the human"）。

**取舍**：可视化消耗工程预算与系统资源（PiP 一套 30+ 导出符号、故障注入钩子），但它同时是 UX、信任机制和审计界面——7 家中唯一没做的是 Codex（用 ChatGPT 级通知 + computer-history 覆盖层替代）。

---

## 附：模式组合的最小可行架构

如果从头做一个 CU/BU Agent，7 家经验给出的推荐组合：

```
P1 独立 Helper（持 TCC + 权限中介，签名分发）
 ├── P2 AX 优先 + 截图兜底，观察-动作-再观察 + ActionSettler
 ├── P3 snapshot_id 绑定 + 描述校验 + verify 三态（收据派，跳过 Codex 纪律派）
 ├── P4 AX 写值 → 窗口相对事件 → （可选）签名事件；后台失败不升级前台
 ├── P5 setValue / paste（借还）/ type 三层文本输入
 ├── P6 单持有者 lease（观察不占）+ generation fencing
 ├── P7 dispatch_status 三态收据 + kill switch 闩锁（两豁免）
 ├── P8 先内嵌 WebView 起步，扩展/云端按需求加，统一对象面 + 能力广告
 ├── P9 MCP 挂载 + skill/文档驱动的模型面 + 未启用即不存在
 ├── P10 应用 tier + 域白名单 + 凭据红线 + 反绕过错误文案
 ├── P11 三层门控（装配/执行/转发）+ AbortController 即时掐断
 ├── P12 批量动作（批前截图坐标系 + expect_change）
 └── P13 合成光标 + 活动浮层 + Takeover + receipts 审计
```
