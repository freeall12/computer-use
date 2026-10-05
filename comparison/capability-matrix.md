# 横向能力矩阵：12 个 Agent 的 Computer Use 与 Browser Use

> 本文综合 [agents/](../agents/) 下 12 个 Agent、48 份逆向文档的横向对比。所有数字与专有名词以各
> agent 文档为准；文档间矛盾以各自 evidence/inventory.md 为准并在 [§8 勘误注记](#8-矛盾与勘误注记)标注。
> 对象（本机安装/留存版本，2026-10-06 分析基线）：
>
> | 简称 | 产品 | 关键版本 |
> |---|---|---|
> | ZCode | ZCode 桌面 Agent | computer-use 插件 0.6.3 / browser-use 0.5.1 / CUA Helper 3.14.4 |
> | Codex | OpenAI Codex（CLI + Desktop） | CLI 0.155.1 / ChatGPT.app 26.930.31730 / @oai/cua 0.2.5 |
> | Claude | Claude Code CLI + Claude 桌面端 | CLI 2.1.212 / 桌面端 1.44121.4 |
> | Cursor | Cursor + cursor-agent CLI | 3.22.12 / CLI 2026.09.23 |
> | MiniMax | MiniMax Code 桌面端 | 3.1.0 / cua-driver 0.22.1 |
> | Synara | Synara（独立开发者产品） | 0.9.2 / cua-driver 0.28.2 patched |
> | Kimi | Kimi Code CLI + Desktop + KimiCU | CLI 0.39.1 / KimiCU 0.6.6 / webbridge 2.0.22 |
> | Qoder | Qoder（阿里系，自研 Electron workbench，非 VSCode fork） | 0.4.3 / CU Runtime 1.0.12 / BU SDK（@ali）0.4.0 |
> | Grok | xAI Grok——**两个产品**：Grok CLI（无 CU/BU）+ Grok Bot 桌面端（Anysphere 代工） | CLI 1.0.46 / Grok Bot 0.66.0 / CU Helper 1.0.0 |
> | Devin | Cognition Devin——全云端执行；CLI 内部代号 chisel；Desktop=Windsurf 更名 | CLI 3000.6.19 |
> | Goose | Block Goose（开源，本机已卸载，按上游源码分析） | v1.53.0（commit 5bd5e548，Apache-2.0） |
> | MiMo | Xiaomi MiMo AI（MiMoCode 引擎 + @mi/mimo-computer-use，Codex sky 清洁室复刻） | 应用 26.914.142245 / 运行时 0.7.11 |

---

## 1. 总矩阵

| 维度 | ZCode | Codex | Claude | Cursor | MiniMax | Synara | Kimi | Qoder | Grok | Devin | Goose | MiMo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **CU 有无** | 有 | 有 | 有（三控制域） | 有（静态还原） | 有 | 有 | 有 | 有（静态还原） | 桌面端有（CLI 无） | 有（**全云端**） | 有（extension，默认关） | 有（**本机已启用**） |
| **CU 载体形态** | cua-helper（Node SEA 111MB）+ ax_native.node（NAPI） | Sky 服务（Swift，`com.openai.sky.CUAService`）+ cua_node REPL | ComputerUseSwift（静态链接/`computer_use.node`）+ app-cu-helper（Rust） | computer-use-sidecar.app（Swift，CDN 分发）；Win Rust sidecar；Linux 云 worker xdotool | `@trycua/cua-driver` 0.22.1（Rust/UniFFI）于 Electron utility process `mavis-cua` | cua-driver 0.28.2 patched（Cua AI，Rust 33MB）独立进程 | KimiCU.app（Swift 6.2MB，launchd 常驻） | 自研 Swift `Qoder Computer Use.app` 1.0.12（Runtime AX/CGEvent/SCK + Bridge stdio MCP；**非 trycua 系**） | Swift `Grok Bot Computer Use.app`（CUGrokBotService 1.0.0）——**Anysphere（Cursor 母公司）代工换牌**（TeamID `DCNK4UB866` 同 Cursor、CDN downloads.cursor.com） | 云会话 VM `computer` 工具；本地 CLI chisel（Rust）**零 CU** | 内置 Computer Controller extension → **纯透传 Peekaboo CLI**（第三方，brew 自动安装）；Goose 零 AX/CGEvent 代码 | 自研 Swift sky-mac（npm `@mi/mimo-computer-use` 0.7.11，**Codex sky 明示清洁室复刻**）+ 签名伴生 app 持 TCC |
| **CU 工具数** | 14（app/窗口级） | MCP 仅 3（`js`/`js_reset`/`turn_ended`），面藏在 `cua` 全局 | 约 40（桌面端三控制域合计） | 16（mac companion；Win 加 zoom/batch） | 17 | 33（gateway `computer_*`：13 读 + 20 变更；原生面另 14+18+9） | 18 + `js`/`js_reset` | 11 SDK 方法（mac，SKILL 注入面）；Windows 独立 16 工具 MCP；Record&Replay 3 工具 | 16（`computer_*` MCP catalog **内嵌 sidecar 二进制**，`--mcp-stdio` 直挂）+ daemon RPC 14 动词 + 云端 proto 11 动作 | 1 个 `computer`（云 VM）；本地仅 read/edit/grep/glob/exec | 1（`computer_control` 命令字符串透传）+ 办公三件套 | 唯一 `js` REPL 工具（`@mimo/sky` 10 方法；51 工具全量档为研究 fixture） |
| **观察机制** | AX 树增量 diff（双基线）+ SCK 窗口栅格 | AX 树 diff（行数预算）+ Skyshot（AX+截图原子） | 截图（合成器级隐私过滤）+ AX 摘要 + zoom | 截图（WEBP 固定 canvas）+ AX 树文本（snapshot_id） | AX/UIA 语义树（element_token）+ 截图 + verify_state | SCK 截图 + 完整 AX 树 + zoom + verify_state | SCK 截图（会话 diff）+ 收敛 AX 树（snapshot_id 绑定） | AX 树文本（elementIndex + diff）+ SCK 截图（新鲜度仲裁）+ appshot/PiP 帧流 | SCK 单窗捕获（1MiB JPEG 预算、1280×800 固定画布）+ AX 树文本；snapshot_id + coordinate_token **双句柄分账** | 云 VM 截图 1024×768 循环 | Peekaboo `see --annotate`（**AX 元素 ID 标注截图 = SoM 变体**）+ JSON stdout | AX 树 index 化 + SCK 窗口截图 + diff；无 OCR（刻意对齐 Codex） |
| **动作机制** | AX 语义动作主路径 + CGEvent 窗口相对兜底 + 后台合成焦点会话 | CGEvent 注入 + EventTap；AX 语义读写 | CGEvent 前台 + AX 后台（dispatchRaw/menu）+ SkyLight/CGS 私有 API | sidecar：companion 走 AX、remote 真实输入；云 worker xdotool | cua-driver：background（AX/UIA）默认 + foreground（HID）需公告 | CGEvent 前台 + AX 后台；deliveryMode 宿主信封 | SkyLight 路由 / postToPid 签名事件；无 HID、不动真实光标 | AX 语义优先（elementIndex）+ CGEvent 合成兜底（`CGEventPostToPid` 定向 + EventTap）+ paste 借还事务 | companion 档 AX 语义（遮挡窗口坐标可命中、`skylight-no-raise` 不抬升）+ remote 档 CGEvent 整屏接管（EventSequencer 定序） | 云 VM 内 click/type/scroll/快捷键/drag（macOS VM 需 TCC 双权限） | Peekaboo 子命令字符串（CGEvent+AX 在 Peekaboo 内）；同步阻塞无超时 | AX 语义 + SkyLight 私有 SPI 免聚焦坐标（`SLEventPostToPid`+activate-without-raise）双路由；「动作即观察」同事务回传 |
| **后台操作能力** | 有（永不抢焦点；event 策略要求已在前台） | 有（startApp 后台拉起；Linux 输入不激活） | 有（app-scoped 全家，不抢焦点） | 有（companion 不动真实鼠标不抢屏幕） | 有（background 默认；被拒绝不自动升级 foreground） | 有（后台不受人输入打断；前台需可见使用授权） | 有（never-front 产品主打；窗口全遮挡可落键） | 有（getAppState 隐式后台拉起；`BackgroundTextInputSession` 符号；能力域=单 app key window） | 有（companion 默认后台、不抬窗、真光标可视化；remote 需显式升级阀） | —（云端 VM 语义；人经 Browser/Computer 标签同屏接管） | 无（无后台交付语义；Peekaboo 有 `--no-auto-focus` 参数但无后台会话） | 有（免聚焦优先；多行输入走亚毫秒「前台翻转-打字-还原」） |
| **Helper 模式** | 独立 .app，宿主验签安装 + 懒启动 + 权限中介 broker.sock | 独立 Swift 服务，Group Container socket，三级自愈拉起 | Rust helper 子进程（stdio JSON-RPC，退避重启） | 独立 .app，CDN 签名 manifest 分发，service.json 会合 | 无独立 app：Electron utility process（MessagePort + generation） | 宿主 spawn `cua-driver --embedded`（随机 socket，孤儿清理） | 独立 .app + launchd Mach service 按需常驻 | 独立 Swift .app，注册表 `ipc/computer-use-tools.json`（token/0600/非 symlink）+ `open -g` 懒拉起 + 15s 心跳 | 独立 Swift .app（Helpers 携带 + CDN 分发），socket 对端 **codesign 团队白名单**，`open -g` 懒拉起 | 无本地 helper（全部在云 VM） | **无 helper**：执行层是外部 CLI（首次 `brew install` 自动装） | 独立签名 .app（启动链四重校验 + build receipt 核对）；MCP 不暴露任何权限工具 |
| **BU 有无** | 有 | 有 | 有（本机断链） | 有 | 有 | 有（三路径） | 有（双轨三链路） | 有（in-app 已真实使用） | 本地**无**（负证据判定书）；云端有 | 有（云端；本地仅投影） | 本地**零内置**；外挂有 | 能力完整（本机未启用） |
| **BU 架构** | 内嵌 WebView（IAB）单后端 | 内嵌 + 真浏览器扩展 + 云端 + mcpapps 四后端 | 真浏览器扩展 + native messaging（另有内嵌 Browser pane / framebuffer） | 内嵌 Electron webview（另有扩展/云 provider 常量） | 内嵌 WebContentsView + CDP（另有 chrome-devtools-mcp 插件） | 内嵌面板（BetterWright/CDP）+ cua-driver CDP 家族 + cookie 导入 | 扩展（WS daemon 复用真实登录态）+ 桌面内嵌浏览器（HTTP MCP） | 内嵌 WebContentsView + Browser Connector 扩展执行 + Browser Agent API 三链路 | **纯云端四件套**：browser_subagent + 托管 MCP + box 沙箱（docker cursor-box-computer）+ Chrome cookie 逐 origin 审批导入 | 云 VM Chromium（Interactive Browser）+ 本地投影（ACP `browser_preview` 能力位 + Desktop Previews 回灌） | **纯 MCP 外挂**（Playwright/Chrome DevTools/Puppeteer/Selenium/Browserbase 五扩展）+ CU 兜底 | MV3 扩展 Browser Bridge + Native Messaging + chrome.debugger CDP；四后端 iab/extension/managed/raw cdp |
| **BU 协议** | NDJSON socket broker → `executeBrowserCommandOnView`；Playwright 语义命令串行化 | 统一对象面（ax/cua/dom_cua/playwright/clipboard/dev）+ 受限 CDP（origin 白名单） | Chrome Native Messaging + unix socket 桥 + 扩展内执行 | 注入 JS 合成 DOM 事件 + CDP 逃生舱（拒绝列表） | CDP（DOM/Accessibility/Input/Runtime/Network 域） | Playwright 语义 over `contents.debugger` CDP + 方法黑名单 | HTTP+WS；`cdp`=chrome.debugger 直通；`kimi.browser/1.0.0` 43 操作 | 内置 MCP 16 工具（**注册时钉死校验 chrome-devtools-mcp 基线**）；Native Messaging 心跳文件发现；HTTP loopback + Bearer（Browser Agent） | 本机**零浏览器 API**（面比 Codex 收得更紧）；noVNC 控制台为人的介入面 | 云内 CDP :29229（Playwright `connect_over_cdp` 同状态附着）；`exa.browser_preview_pb` 回灌 | 归各第三方 MCP server（Goose 不改写不包装） | JSON-RPC 2.0 帧 + CDP 1.3 **白名单**（无调试端口）；socket 注册表 + tab 租约 |
| **安全模型** | 租约 CONTROLLER_BUSY + possibly_sent 防重放 + kill switch + fail-closed 全链 + 子代理禁用 | 四层：OS → 服务端审批（AppApprovalStore/MCP elicitation）→ 模型策略 prompt → 熔断（URL 禁区/锁屏守护） | 应用白名单 tier（read/click/full）+ 批量授权对话框 + 独占锁 + 全屏二次确认 + Esc 急停 | TCC 双权限 + 输入租约 + CDN 签名分发链 + Statsig 门控 + origin allowlist + browser_lock 用户夺回 | TCC 双权限 + 插件准入 Host Binding + 单会话 lease + generation fencing + 桌面遮罩/停止按钮 | `computer:control` 能力域 + 前台可见使用正则授权 + 人接管/物理 Escape + activation shield + 审计 | TCC 归服务 + UDS token + observation_context 隔离 + approval_token + abort_if_cursor_in_window | per-app 审批 + URL 禁区 + CUA 风格四档确认分类 + 扩展侧校验（无逐动作弹窗）+ CDP 允许列表 | 16 错误码→四档建议「**错误即指令**」+ 租约/Esc 急停/USER_ABORTED 行为指令 + cookie 逐 origin 人审（默认 deny） | 组织级开关（admin）+ 人接管同屏（SSO/MFA/CAPTCHA）+ blueprint 登录态（≤200MB 跳过密码库）+ sandbox deny 恒胜 | GooseMode 四档 × 工具三级 × LLM 审查（smart_approve/adversary，**fail-open**）；无 CU 专用授权（TCC 归 Peekaboo） | CCU_SAFETY_MODE 四档（enforce 走 elicitation）+ 签名四重校验 + **独家锁屏操作**（SecurityAgentPlugins + 审计 token 钉死 socket + 1–20s 一次性租约） |
| **本机可用性** | **可用**（运行日志实证真实动作） | **可用**（服务已装、审批配置在用） | **断链**（代码完整；扩展未装、TCC 未授权） | **BU 可用有痕迹；CU 未启用**（Statsig 门默认关，sidecar 未装） | **可用** | **可用**（BetterChromium 未装、device-helper 需现场编译） | **CU 可用**（服务常驻、TCC 双授权、UDS listening）；webbridge daemon 分析时未运行 | **BU in-app 可用**（2026-10-05 会话 42 次调用）；**CU 未启用**（`ipc/` 空负证据，Runtime 本体已装） | **CU 门控全关未激活**（门/目录/进程三重负证据）；BU 云侧默认开（本机无法静态验证） | 全在云端；本机 CLI 已卸载（存 3 天日志/配置）；Desktop=Windsurf 更名已卸载（悬挂 symlink） | **本机已卸载**（99 断链 skills 残留）；按上游源码 v1.53.0 分析 | **CU 已启用**（env=1，锁屏 opt-in）；BU 未启用（五面负证据） |

---

## 2. 工具面数量级对照

各家对「工具数」的统计口径不同（MCP 工具 / gateway 工具 / 对象方法 / action 枚举），横向比较时必须折算：

| Agent | CU 口径 | BU 口径 | 形态说明 |
|---|---|---|---|
| ZCode | 14 个 MCP 级工具（0.6.3；前代 0.5.12 曾为 30 个屏幕级工具） | 单一 `js` MCP 工具；`agent.browsers` 对象面下约 25 个 wire 命令 + Playwright action 袋 | 工具面刻意收缩，「屏幕中心 → app/窗口中心」 |
| Codex | 3 个 MCP 工具（js/js_reset/turn_ended），桌面+浏览器全部 API 藏在 `cua` JS 全局 | 同左（browser 是 cua 的半边）+ 独立 browser 插件的 `agent.browsers` 对象面 | 「一个 REPL、一个全局对象」极简面 |
| Claude | 约 40 个命名工具：授权/状态 8 + 观察 6 + display 动作 16 + app-scoped 7 + teach 3（CLI 2.1.212 无 app_* 族与 framebuffer） | 约 23 个 `mcp__claude-in-chrome__*`（另有桌面 Browser pane 第二注册表、framebuffer 13 个） | 拆分最细、动作原语最多的一家 |
| Cursor | 16（mac companion）+2（Windows zoom/batch） | 15 注册 + `browser_lock`（callTool 内）= 16 | 一方 MCP provider，zod schema + 长指令描述 |
| MiniMax | 17 个 `computer_*` | 1 个统一 `browser` 工具 × 24 action（另有 13 个细粒度定义 full 形态）；chrome-devtools-mcp 29 工具 | compact/full 双暴露形态 |
| Synara | gateway `computer_*` 33（13 读 + 20 变更） | `browser_*` 13 + `computer_browser_*` 10 | 原生驱动面 14 读 + 18 动作 + 9 浏览器经前缀映射暴露 |
| Kimi | 18 + js/js_reset（node-repl 代码模式） | BU-A webbridge 14+ 命令；BU-B 单一 `run` 工具 × 43 操作 | 双轨 BU，两种协议风格 |
| Qoder | 11 个 SDK 方法（mac，SKILL 注入 + node_repl SDK，无独立 MCP）；Windows 另有 16 工具 MCP + Record&Replay 3 工具 | 16 工具内置 MCP（in-app/external 双后端同面）+ Browser Agent 对象方法面 | mac CU 走「SKILL 注入 + REPL SDK」、Windows 走 MCP——按平台选面 |
| Grok | 16 个 `computer_*`（MCP catalog 内嵌 sidecar 二进制，`--mcp-stdio` 直挂模型侧）+ daemon RPC 14 动词 + 云端 proto 11 动作 | 本地 0（负证据）；云端 browser_subagent 面不下发到客户端 | 双工具面同二进制：高层语义词汇（computer_*）与低层动作词汇（computer_use_*）并存 |
| Devin | 1 个 `computer` 工具（云 VM desktop-mode 自带） | 云 Interactive Browser + `save_browser_profile` + CDP :29229 | 本地 CLI 工具面仅 read/edit/grep/glob/exec——「工具在云、本地零 GUI」 |
| Goose | 1 个 `computer_control`（命令字符串透传 Peekaboo）+ 办公三件套 | 0 内置；官方收录 5 个第三方浏览器 MCP 扩展 | 「一个工具吃下整个 CLI 命令空间」——工具面永不膨胀，能力随外部 CLI 升级 |
| MiMo | 唯一 `js` REPL 工具（`@mimo/sky` 10 方法）；51 工具全量档为研究 fixture | 同一 `js` 内 `agent.browsers` 对象图（无离散 browser 工具） | 与 Codex/ZCode 形态同构；离散 computer_*/browser_* 只是 A/B fixture |

观察：

- **两极分化**：Codex 把整个能力面折叠成 3 个工具（编程面在 REPL 里），Claude 把每个动作拆成独立工具（约 40 个）。前者依赖模型写 JS 的能力，后者依赖服务端 routing 与工具检索。
- **ZCode 与 Kimi 工具面几乎一一对应**（get_app_state/click/type_text/press_key/scroll/set_value/select_text/drag_paths…），属同一设计范式的平行实现（见 [Kimi CU §9](../agents/kimi-code/computer-use.md)）。
- **Qoder 的 11 SDK 方法落在同一族**（getAppState/listApps/click/typeText/paste/pressKey/scroll/setValue/selectText/drag/performSecondaryAction——与 Codex `Target` 系、ZCode/Kimi 工具面同构），但承载方式是「SKILL.md 注入 + node_repl SDK」而非 MCP 工具列表（[Qoder CU §4.1](../agents/qoder/computer-use.md)）。
- **工具数的三种极值在 12 家凑齐**：最省的 1 个工具有两个流派——「REPL 门面」（Codex `cua`/MiMo `js`/Qoder SDK：面在对象图里）与「CLI 透传」（Goose `computer_control`：面在外部 CLI 的命令空间里）；最繁的仍是 Claude ~40。Grok Bot 的「编排下沉」（catalog 嵌进 Swift 二进制、sidecar 直挂 MCP）是工具面承载的第三条路（[Grok CU §2](../agents/grok/computer-use.md)）。

---

## 3. 深度对比：观察机制

### 3.1 四种观察原语在 12 家的分布

| 原语 | 说明 | 使用者 |
|---|---|---|
| **AX 树 + 增量 diff** | 把应用无障碍树序列化为带索引的文本，只回「自上次以来变了什么」 | Codex（服务端 diff、行数预算）、ZCode（Helper snapshotCache + 宿主 `tree_shown_to_model` 台账**双基线**）、Kimi（ObservedSnapshotStore 会话 diff + 截图 meanAbsDiff）、MiniMax / Synara（cua-driver 内建）、Cursor CU（snapshot_id + `(+N descendants omitted)` 可展开）、Qoder（elementIndex 行 + 紧凑 diff；AX 与截图双通道带新鲜度仲裁）、Grok（AX 树文本 + `(+N descendants omitted)` + element_id 钻取展开）、MiMo（AX 树 index 化 + AX 修订 diff） |
| **截图（窗口/屏幕捕获）** | ScreenCaptureKit（mac 本地系）、Electron/CDP 截图（BU）、x11grab（Cursor Linux 云 worker）、云 VM 截图（Devin/Grok 云） | 全部；Claude display-scope 与 Cursor remote 以截图坐标为**主**定位；Devin 与 Grok 云端 CU 纯截图循环（Devin 无 AX 通道证据） |
| **DOM / 可交互元素快照 + 不透明 ref** | BU 侧共识：遍历 DOM 或 CDP AX 树产出 `ref`（`data-cursor-ref` / `@e` / `node_id` / snapshot ref），动作按 ref 寻址 | 几乎全部 BU：ZCode（AI/ARIA domSnapshot）、Codex（页内 WASM AX 渲染）、Claude（扩展构造 a11y 树 `ref_N`）、Cursor（注入 JS YAML + `data-cursor-ref`）、MiniMax（CDP `Accessibility.getFullAXTree` + 不透明 ref）、Synara（BetterWright Playwright 快照）、Kimi（webbridge `@e` refs / 桌面 TOON 快照）、Qoder（take_snapshot AX 树文本 + uid/ref / Browser Agent `tab.ax.get`）、MiMo（aria-snapshot + CDP AX 白名单） |
| **set-of-marks 视觉标注** | 在截图上叠编号圆圈供模型点选 | **12 家中只有 Goose（经 Peekaboo `see --annotate`）在 CU 观察主路径上使用**——且是**变体**：标注元素 ID（B1/T2 式编号）来自 **AX 树**而非视觉模型检测，叠加在截图上。其余 11 家 CU 均未使用（MiniMax 负证据明示「未发现」）。近似物：Cursor BU 的 `browser_highlight`、Kimi 桌面浏览器的 annotation world（1002）、Claude 的 `zoom` 区域放大——都是辅助示能，不是 SoM 编号叠加 |

### 3.2 防「索引/句柄漂移」的五种实现（核心分水岭）

元素引用失效（页面变了、窗口关了、索引重排）是 CU/BU 第一大错误源。12 家给出一个完整的解法光谱：

| 方案 | 机制 | 代表 |
|---|---|---|
| **流程纪律** | 不做运行时校验，靠「每动作后必须重新 getAXState」的指令约束 + 失败时把**新鲜 diff 内嵌进错误信息**引导重新索引 | Codex（动作全是 `Promise<void>`） |
| **双基线 diff 台账** | 「数据有没有变」（Helper 缓存）与「模型有没有见过」（宿主台账）分离；只截图的观察不算基线 | ZCode（`snapshotCache` + `recordModelVisibleTree`，另有动作后索引位移校验） |
| **快照 ID 绑定** | 每次观察发 snapshot_id，动作必须携带；跨上下文/stale 直接拒绝；树未变可复用连续填表 | Cursor CU（element_id + snapshot_id）、Kimi（snapshot_id，"stale or other-context IDs are rejected"）、MiniMax BU（snapshotId + nextOffset 续页）、Kimi BU-B（视觉 snapshotId 60s 缓存） |
| **描述校验防错位** | 动作可携带人类可读描述，执行前 `assertDescriptionMatches` 比对 tag/role/text，漂移即报错 | Cursor BU（`element` 参数）；同族：ZCode `select_text` 的 prefix/suffix 消歧、Kimi 的 prefix/suffix |
| **投递后验证回读** | 动作后 AX/像素复核，产出三态：verified / 未验证 / verification_required；「未观察到效果的点击绝不自动重发」 | Kimi（verify_after 三态）、MiniMax（effect.verified + VERIFIED_FILL 4 次采样）、ZCode（`[effect_evidence unchanged]` 效果证据寄存）、Synara（`stale_geometry` / ref frame identity 重验 + verify_state）、MiniMax CU（verify_state 谓词 AND）、Cursor（动作后自动回新截图 "look before you click"）、Qoder（动作自动回传 post-action 状态 + paste 回读告诫 + 坐标守卫「截图未过期且窗口几何未变」）、Grok（AXValue 写后回读校验 + staleness 五种具体归因 + 错误内嵌补救动作）、Goose（最轻量档：`capture_screenshot:true` 动作后自动补拍，无三态）、MiMo（「动作即观察」：变更动作同事务返回 dispatchStatus/uiChanged/retrySafe 下一观察） |

> 结论：**越晚出现的实现越偏向运行时强校验**。Codex 的「纪律派」是起点，ZCode/Kimi/MiniMax 的「收据派」（动作回执 + 效果证据 + fail-closed）是当前最完备形态；Qoder/MiMo 以「动作自动回传新状态」把再观察做成默认行为（MiMo 称之为与 Codex parity 的呈现差异），Goose 则停在工具级自动补拍的最轻档。

---

## 4. 深度对比：动作注入

### 4.1 五条注入通道

| 通道 | 原理 | 优劣 | 使用者 |
|---|---|---|---|
| **AX 语义动作** | AXPress/AXValue/AXSelectedTextRange 等语义接口直接作用于元素 | 精确、可后台、不抢焦点；依赖目标暴露 AX（Electron 常需 `AXManualAccessibility`） | 本地执行系（ZCode/Codex/Claude/Cursor/MiniMax/Synara/Kimi/Qoder/Grok/MiMo）全部实现（主路径或兜底）；Devin 云 VM 内实现未公开；Goose 委托 Peekaboo |
| **CGEvent / HID 合成事件** | CoreGraphics 事件系统（或 Linux xdotool、Win SendInput）注入全局/窗口事件 | 通用（canvas 也能点）；抢焦点、人机打架 | Codex（+EventTap）、Claude display-scope、Synara foreground、MiniMax foreground、Cursor remote/云 worker（xdotool）、ZCode 兜底、Qoder（`CGEventPostToPid` 定向 + EventTap；与 Kimi postToPid 同思路，未见 SLS 认证封包符号）、Grok remote（CGEvent/AppKit + EventSequencer 全序号定序）、MiMo（per-pid CGEvent + 兜底 nut.js）、Goose（经 Peekaboo 内部 CGEvent） |
| **合成 DOM 事件** | 页面内 `el.click()` / PointerEvent / DragEvent + DataTransfer | 绕开焦点路由（Electron webview 嵌编辑器时 CDP Input 不可靠）；但 `isTrusted=false` 对严格站点失效 | Cursor BU（主通道，主进程**硬禁** CDP Input）、Kimi webbridge（`el.click()`/fill）、Claude 扩展（页面级事件）、Qoder（in-app 后端 webContents 合成；外部后端工具在扩展内执行） |
| **CDP（DevTools 协议）** | `Input.dispatchMouseEvent` 等域指令 | 能力上限最高（网络/存储/性能全开）；端口管理、作用域、凭据风险大 | MiniMax BU（主通道）、Synara（BetterWright + cua-driver CDP 家族）、Codex（tab 级受限能力 + origin 白名单）、Cursor/Kimi（逃生舱，配拒绝列表/直通规则）、Qoder/MiMo（tab 级 CDP **允许列表**——凭据/跨 target 方法封禁，语义与拒绝列表互逆）、Devin（云 VM 内 CDP :29229，Playwright 同状态附着）、Claude 与 ZCode 与 Grok 本地（无对外 CDP；Grok BU 全在云端） |
| **SkyLight/SLS 私有 API** | 私有窗口服务框架：事件路由、签名事件、空间管理 | 能做公开 API 做不到的后台定向投递；随 macOS 版本演化有失效风险 | Kimi（SignedKeyboard：`SLSEventAuthenticationMessage`+`SLEventPostToPid`，公开致谢 Cua AI）、Claude app-cu-helper（`SLSGetActiveSpace`/`SLPSPostEventRecordTo`/`SLPSSetFrontProcessWithOptions`/`CGSCopySpacesForWindows`）、ZCode（窗口相对派发 `CGEventSetWindowLocation`）、Synara patched driver（合成光标）、Qoder（`CGEventSetLocation/SetWindowLocation` 窗口定位合成）、Grok（`skylight-no-raise` 不抬升，遮挡窗口坐标可命中）、MiMo（SkyLight 私有 SPI 点击不抬窗 + activate-without-raise） |

### 4.2 后台定向输入（不抢焦点）的四条技术路线

这是 12 家投入最重、分化最大的能力（详见 [reusable/patterns.md §4](../reusable/patterns.md)）；Devin（全云端）与 Goose（透传 Peekaboo）不在此赛道自建：

1. **AX 写值/语义动作**（通用）：ZCode `set_value`、Cursor `computer_set_value`、MiniMax `set_value`、Kimi no-raise 后台替换、Qoder `setValue`（仅 AX `(settable, string)` 元素）、Grok `computer_set_value`（写后回读校验）、MiMo `set_value`（单行 AX SetValue 真免聚焦）。
2. **窗口路由合成事件**：ZCode 坐标点击归一为「pid + bundle_id + window_id + 窗口 bounds + 窗口内相对坐标」（日志实证）；Kimi `channel:auto|skylight|public` 双通道（WindowServer 补全窗口号 vs NSEvent 工厂事件 postToPid）；Qoder `CGEventPostToPid` 定向 + `BackgroundTextInputSession`（符号级证据，未达 SLS 认证封包强度）；Grok companion 档遮挡窗口坐标可命中 + `skylight-no-raise`；MiMo SkyLight 私有 SPI 免聚焦点击（不可用降级公开 `CGEventPostToPid`）。
3. **签名事件认证封包**：Kimi SignedKeyboard——对后台 Chromium 窗口发键不走全局 HID，构造带认证封包的 SkyLight 事件定向投给目标 pid，**窗口完全被遮挡也能落键**。
4. **私有框架窗口/空间操作**：Claude app-cu-helper（异 Space 窗口拉回、菜单遍历点击）与 Synara（activation shield、Space 指定）。

配套纪律也趋同：**永不移动真实光标 / 永不抢前台 / 永不用 HID**（Kimi 把三条写成产品边界），失败时「投递成功 ≠ 生效」单独上报（`delivery_unverified`/`focus_unverified`/`effect:"unverifiable"`）。

### 4.3 剪贴板与文本输入分层

- **setValue（AX 写值）优先**：不经过键盘、可后台、无自动纠错干扰——8 家全部提供（Qoder 限 AX `(settable, string)` 元素并警告 Monaco 编辑器「只能改 AX 镜像不改真实 buffer」的陷阱）。
- **paste（借还系统剪贴板）其次**：模拟 Cmd+V，事后恢复用户剪贴板（Codex mac、ZCode、Kimi、Qoder——后者为**条件恢复**：仅当剪贴板仍属该次粘贴，并告诫「粘贴≠编辑成功，须回读 app state 验证」；Cursor CLI 侧等）；本质是事件路径，后台 app 上会触发 `FOREGROUND_REQUIRED`（ZCode 实证）。
- **type（逐键合成）最后**：多行走剪贴板快速通道（Claude）、UTF-8 定向输入 + 回读验证（Kimi `type_text`）。
- 反向红线：MiniMax BU 明确「不读宿主 OS 剪贴板」、Synara 把 `computer_read_clipboard` 列为唯一必须审计的读工具。

---

## 5. 深度对比：安全模型

### 5.1 分层对照

| 层 | ZCode | Codex | Claude | Cursor | MiniMax | Synara | Kimi | Qoder | Grok | Devin | Goose | MiMo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **OS 权限** | TCC Accessibility + Screen Recording 只挂 Helper；权限被拒禁止换用 osascript 等绕过 | Accessibility + Screen Recording；未批进入「等待授权」重试循环 | TCC 双权限 + per-app 授权对话框 | TCC 双权限（helper 持有）+ 权限探测工具 | TCC 双权限；CUA 每次派发前向宿主校验 | accessibility/screenRecording/**inputMonitoring** 三件套 | TCC 双权限归 launchd 服务（CLI 上下文 TCC 不同） | TCC 双权限 + 自有授权窗；权限未就绪做成协议化重试 | TCC 全声明在助手 App；被动探测（`permissions/status`）与主动引导（`open-settings`）分离 | 云 VM 内 TCC 由平台方管理（macOS VM），与宿主无关 | TCC 一次性系统授权，归 Peekaboo（agent 不管理） | TCC 授权给选中的签名 App 身份；**MCP 不暴露任何权限工具**（引导只能由签名 App GUI 做） |
| **目标/范围审批** | app/窗口绑定 + 声明索引作用域 | `getAppPolicy` + AppApprovalStore（ALWAYS/ONCE/SESSION/TURN）+ MCP elicitation | 应用白名单 + tier 限权（浏览器→read、终端/IDE→click）+ 全屏接管独立确认 | origin allowlist + 禁 file:// + 管理员 browser_protection | 插件准入（Host Binding）+ interactive surface 限定 | `computer:control` 能力域 + 前台「可见使用」正则授权（多语言、防注入剥离） | approval_token（可选强制）+ observation_context 隔离 | per-app 审批 + URL 禁区 + 对端信任链（TeamID×2 + BundleID 14 项，含 `com.aliyun.lingma.ide`） | 门控 fail-closed（4 flags 默认关）+ `computer_use_supported` 会话握手上报 + cookie 逐 origin 人审（默认 deny） | 组织级 Computer use toggle（仅 admin）；无逐动作审批 | 无 CU 专用授权；通用三层正交叠加 | 插件门 fail-closed + CCU_SAFETY_MODE 四档（enforce 走 MCP elicitation；默认门控集含 click/drag/type_text/press_key/set_value 等） |
| **并发互斥** | 控制器租约 `CONTROLLER_BUSY`（永不重试、报 owner） | 无显式 lease；turn_ended 回收 + per-turn 停止 + 请求记账 | 独占锁（"Another Claude session is using the computer"）+ `app_release` | 输入租约 `computer_start/release_control`（remote）；Win 只控「屏上存在感」 | 单会话 lease（观察不占租约）+ TTL + generation fencing | 线程不得向子任务委托 computer:control | 单服务多客户端经 observation_context 隔离 | 无跨会话租约符号；SDK 单连接单在途请求（busy）+ Runtime 侧 RequestLimiter/Admission | `CURemoteControlLease`（活跃 remote 会话唯一）+ `CURemoteControlPermit` 在途输入即时撤销；云端 `desktop_lease_actor_id` | —（会话即边界；人接管同屏兜底） | 无（无 lease/generation；同步阻塞调用） | socket 注册表每 host 唯一 + 扩展侧 tab 租约 + 锁屏 1–20s 一次性租约 |
| **防重放** | `dispatch_status=possibly_sent` → `actionSent=true` → 只许先观察；`broker_response_ambiguous` 不可自动重试 | 动作 `Promise<void>`（无此语义）；错误内嵌新鲜 diff | 批内坐标参照批前截图；每步前台门控 | 「未产生真实动作才可原样重试」；refusal escalation 四档 | 空闲会话复活「绝不重放输入动作」；background 拒绝不升级 foreground | 动作在途推进 `nativeInputEpoch`；人接管后旧结果按「已派发-效果未知」上报 | 「已投递但效果未观察的点击绝不自动重发」 | 超时后 SDK **主动断链**——「结果可能已生效，先观察再决定是否重试」；错误即中止同一代码单元 | target 身份前置校验（"stale. No input was posted"——**未投递即失败，不做半截动作**）；超时警示缓存几何失真 | —（文档未披露云内实现） | 无会话模型（同步阻塞调用） | 动作 index/坐标一次性有效；被拒动作可能已投递——重试前必须先观察 |
| **验证回读** | `[effect_evidence unchanged]`、帧指纹、ActionSettler 300ms–5s | getAXState 内置稳定等待，禁模型手动 setTimeout | batch 每步门控 + 状态返回 | 动作后自动回新截图 | verify_state（1-8 谓词 AND + stable_samples）+ effect.verified | verify_state + 点击前截图 marker 取证（evidence.json） | verify_after 三态 + debug_tap 事件日志 | 动作自动回传 post-action 状态 + paste 回读验证 + 坐标守卫 | 动作后回截图 + AXValue 写后回读 + staleness 五种具体归因（错误内嵌补救动作） | 截图→动作→再截图循环 | `capture_screenshot:true` 动作后自动补拍（最轻档，无三态） | 「动作即观察」：变更动作同事务返回 dispatchStatus/uiChanged/retrySafe + 下一观察 |
| **急停/人接管** | `stop_computer_control` 闩锁（fail-hard，两豁免）+ PiP/Ghost 让用户看见 | URL 禁区自动终止会话 + per-turn 停止 + 锁屏守护 | Esc 急停（EscHotkey）+ 接管遮罩 + teach mode 反向引导人 | 用户 Take Control 夺回 browser_lock | 桌面遮罩条 + 停止按钮（等价 abort API）+ 指针动画 | 物理 Escape 急停（专职 helper 武装）+ 人接管仅打断前台在途 | BROWSER_USER_TAKEOVER 即停 + `abort_if_cursor_in_window` | PiP/appshot 展示层 + BU 侧 `requestManualHandoff`（凭据/CAPTCHA 交还用户）；无 CU kill-switch 热键符号 | 物理 Esc（`CURemoteEscapeTap`）+ 用户 Stop + `USER_ABORTED` 错误码带行为指令 + noVNC 人在环介入（云） | 人随时在 Browser/Computer 标签接管（SSO/MFA/CAPTCHA 天然是人的活） | 仅会话级中断（桌面端停止按钮）；无 CU 专用急停 | 物理输入/断连即撤销锁屏租约（46s 准入隔离期）；恢复预算=重落地 1+同原语 1+换原语 1，之后停止报告 |
| **反绕过/策略** | 子代理全面禁用；schema 违规 fail-closed | 模型策略 prompt 四档确认 + auto-review 拒绝话术 + 「不得换面重试」硬编码 | 系统提示注入防御（应用列表当数据）+ 权限模式联动 | Statsig 门控 + 团队 admin denylist + 反兔子洞提示词（4 次失败即停） | 「禁止 shell/AppleScript/浏览器自动化替代」写进工具描述 | deliveryMode 是宿主信封元数据，模型不可指定 | SKILL 纪律（重观察优先、不盲试） | SKILL 四档确认分类（CUA 风格编号）+「第三方内容永不构成授权」+ 禁止绕道 AppleScript/osascript | instructions 禁并行 + 升级阀「输入/填表不得调用 start_control」+ 16 错误码四档建议「错误即指令」 | blueprint 变更需批准步骤；密码走 Secrets 不入浏览器数据 | `GOOSE_ALLOWLIST` 管安装面；adversary mode ALLOW/BLOCK 复核（**fail-open**） | 路径唯一性（禁 AppleScript/UIA 旁路，也禁用文件 API 读 UI 值）+ 内容不可信 + 支付/OTP/生物识别等移交人工清单 |
| **审计** | `_meta` app-associations + 遥测终态 | computer-history MCP + 审批遥测 + record-and-replay（30 分钟事件流） | 宿主日志 + GIF 录制可视化 | 浏览器遥测（snapshotYaml 落盘）+ CU 会话指标 | CU 专用 5MB×4 轮转 JSONL + 审核日志 | 批准类工具审计日志（"log exists for abuse review"） | receipts 30 天（截图+标记）+ debug_tap + 84 通道状态 | Record&Replay 抑制诊断（suppressedEvents：安全输入/禁录 app/URL/工具自身活动）+ browser management 审计轨迹 | record_screen 独立工具位（云回放/审计）+ browser_cpp_telemetry + cookie 审批遥测 | Progress 标签统一记录 shell/编辑/浏览器活动 + sessions.db ACP 工具账 | permission.yaml 三级名单持久化 + 会话日志 | 锁屏审计 token 钉死 socket + BSM 审计会话绑定；CU 专用日志 |

### 5.2 独有设计

- **锁屏子系统的两种相反路线（Codex / MiMo，12 家中仅此两家）**：Codex LockScreenGuardian——锁屏时监控/暂停自动化、物理输入监测防人机打架、锁屏登录授权走独立受控通道；MiMo 反向而行——`CCULockUnlockAuthorizationPlugin`（装进 SecurityAgentPlugins）+ 内核审计 token 钉死 socket + 1–20 秒一次性授权租约，让 agent **在锁屏状态下解锁并操作**（显式 opt-in，物理输入/断连即时撤销重锁）。前者把锁屏当危险边界，后者把它变成可控能力。
- **Synara 前台可见使用授权引擎**：多语言正则族从用户消息判定「用户是否想看 agent 操作」，后台倾向短语可一票否决；授权只沿「例行继续」存续——把**授权生命周期绑定到对话语义**。
- **Claude teach mode**：不代替用户操作，而是全屏 tooltip 一步一步引导**用户自己**操作——人机角色的第三种安排（agent 操作 / 用户操作之外多了「agent 教学式伴随」）。
- **Qoder 扩展侧校验（无逐动作弹窗）**：浏览器控制不设逐动作权限弹窗——「当前可信 Turn 默认放行，扩展执行前仍校验绑定的标签/URL/target/凭据边界」；凭据类动作一律 `requestManualHandoff()` 交还用户、确认后目标变化即 fail-closed——把弹窗成本换成扩展侧边界校验（[Qoder BU §5](../agents/qoder/browser-use.md)）。
- **Grok Bot「错误即指令」协议**：16 个错误码静态映射到 retry / ask_user / use_different_tool / stop 四档行为建议，`structuredContent{code,message,escalation}` 随错误返回——失败信息本身就是给模型的下一步指令（[Grok CU §6–7](../agents/grok/computer-use.md)）。
- **Devin 把「人审批」浓缩成两层**：组织级开关（admin）+ 会话内同屏接管——没有逐动作审批队列，SSO/MFA/CAPTCHA 由人直接上手同一块屏（[Devin CU §2](../agents/devin/computer-use.md)）。

---

## 6. 谱系关系图

```
                         开源上游：Cua AI（trycua/cua，MIT，Rust cua-driver）
                         │
         ┌───────────────┼────────────────────────────┐
         │ vendored      │ 机制公开致谢                 │ 同一设计范式（独立 Helper + 权限中介）
         │ （直接内嵌）    ▼                            ▼
         │        Kimi KimiCU（Swift 独立实现         ZCode cua-helper（JS broker +
         │        SignedKeyboard，非 fork）           ax_native.node）◀── 平行实现，工具面趋同
         │
         ├──► MiniMax Code：cua-driver 0.22.1（Electron utility process 承载）
         │
         └──► Synara：cua-driver 0.28.2 patched（provenance.json：patched=true,
              nativeRevision=39；宿主 spawn --embedded；合成光标/握手校验为补丁内容）
              （另：Synara 内嵌 claude-agent-sdk 0.3.259 / pi / opencode SDK 编排多 agent）

    OpenAI Codex @oai/cua（tinyskyAlt，本机实装 0.2.5）
         │
         ├──────────────────────────────────────────────┐
         │ API 面逐字对齐（ZCode SDK 头注释自述基线 0.2.4；│ 明示清洁室复刻（MiMo 包自述
         │ R1 同名同签 / R2 附加能力只进选项袋 /           │ "inspired by Codex Desktop's sky
         │ R3 安全语义只藏不删）                           │ executor"，README 1638 行自带
         ▼                                              │ vs Codex 逐项比较；无 OpenAI
    ZCode computer-use SDK（自研加固：stateId/frameId     │ 二进制依赖）
    台账、possibly_sent 防重放、controller lease、        ▼
    kill switch——Codex 原始面均无对应物）             MiMo @mi/mimo-computer-use
                                                      （自研 sky-mac Swift 引擎；
    Anysphere（Cursor 母公司）computer-use-sidecar      「动作即观察」为自加呈现差异）
    产品线
         │ 整体代工/换牌（白牌供应链，谱系证据最硬：
         │ TeamID DCNK4UB866 双方一致、com.anysphere.sand、
         │ homepage cursor.com、CDN downloads.cursor.com、
         │ sand-cua 模型同名、JS 残留 CUCursorService）
         ▼
    Grok Bot 桌面端（xAI）——代际更新：编排下沉
    （16 工具 MCP catalog 嵌进 Swift 二进制，--mcp-stdio 直挂）

    执行层外包（Goose，12 家中唯一）：Rust 内核零 AX/CGEvent 代码，
    Computer Controller extension 把 computer_control 命令字符串
    纯透传给第三方 Peekaboo CLI（steipete/peekaboo，MIT，brew 自动安装）
         ◄── 平行路线对照：trycua cua-driver（宿主内嵌）vs Peekaboo（外部 CLI）

    Anthropic 官方 computer-use-demo（公开仓库，Docker+X11 单 computer 工具）
         │ 工具描述文本派生（action 文案几乎逐字一致，叠加 tabId/ref/zoom/scroll_to）
         ▼
    Claude 桌面端「浏览器版 computer」工具（Claude in Chrome 体系）

    Playwright MCP 风格动作词汇（browser_click/fill/snapshot…）
         │ 词汇同源（Chat UI 动作文案高度一致）
         ▼
    Cursor cursor-ide-browser 工具面（一方 MCP provider）

    Anthropic Messages 工具协议（tool_use/tool_result + image 块）
         ├──► MiniMax Code（pi 框架 + anthropic-messages，「Claude Code 工具协议兼容端」，
         │     自研运行时非 fork）
         ├──► Synara（内嵌 claude-agent-sdk 编排 Claude 会话）
         └──► MiMoCode 引擎（CC 工具协议同构端；LICENSE 致谢 opencode——
               opencode 系谱第二条实证，第一条是 MiniMax 的 legacy-opencode 迁移代码）

    node-repl「持久 cell + 内核」形态
         ├──► ZCode node_repl MCP（node-repl-host；上游未知，待查）
         ├──► KimiCU node-repl（自研实现，kernel-protocol v1）——同构平行实现
         └──► Qoder node_repl v0.1.4 ◄── 确证上游：阿里 qwen-code packages/qwen_node_repl
              （UPSTREAM.md 原文：Apache-2.0，commit b1ac3e29；CU SDK 注释自述与
               "qcum" 应用级快照契约一致；CU 信任链含 com.aliyun.lingma.ide）

    阿里系公共内核线索（qwen-code）
         │
         │  node_repl API 同构（nodeRepl.write/emitImage/wait/cancel/reset），
         │  Qoder 上游确证 = qwen-code；ZCode 上游未知 → 标注「疑同源」（推断）
         ├ ─ ─ ─ ► ZCode node-repl-host
         └ ─ ─ ─ ► Qoder（确证下游）
```

读法：**没有谁整体 fork 谁**；真实存在的是六种关系——(1) 直接内嵌开源驱动（MiniMax/Synara ← Cua AI）；(1b) 开源组件整段迁移并附 UPSTREAM.md 记录（Qoder node_repl ← qwen-code，Apache-2.0）；(2) 公开致谢的单点机制借鉴（Kimi ← Cua AI 的 SLS 签名事件）；(3) API 面逐字对齐 + 自研加固（ZCode ← Codex）；(4) 工具描述/schema 文本派生（Claude 桌面浏览器版 ← 官方 demo；Cursor ← Playwright MCP 风格）；(5) **整体代工/白牌**（Grok Bot ← Anysphere/Cursor 的 sidecar 产品线，签名/CDN/残留字符串三路实证）；(6) **明示清洁室复刻**（MiMo ← Codex sky：自述 inspired by、包内自带 vs Codex 对比文档、把 Codex 装机当只读基线）。加上执行层外包（Goose → Peekaboo）、协议层趋同（Anthropic Messages 成为准协议）与公共内核线索（qwen-code ↔ Qoder 确证、↔ ZCode 疑同源），整个赛道的「形」高度收敛，「骨」各自独立——且开始出现供应链分工。

---

## 7. 本机可用性一览（分析时点快照）

| Agent | CU | BU | 断点/备注 |
|---|---|---|---|
| ZCode | 可用 | 可用 | Helper 运行日志含真实 AXPress/坐标派发；browser 走 IAB |
| Codex | 可用 | 可用（extension/cdp 面未实测） | Sky 服务已装；用户审批策略整体调低（approval_policy=never） |
| Claude | 不可用 | 不可用 | CLI/桌面代码完整；Claude in Chrome 扩展未装、native host manifest 未注册、TCC 双权限未授予 |
| Cursor | 未启用 | 可用 | Statsig 门 `mac_computer_use`/`local_computer_use` 默认关；sidecar 目录不存在；`~/.cursor/browser-logs/` 有 2026-08/09 真实使用痕迹 |
| MiniMax | 可用 | 可用 | 官方插件缓存就位；headless provider 本机无启动代码（推断属 TUI/云端） |
| Synara | 可用 | 可用 | cua-driver 就位；BetterChromium 153 未下载（`browser-engine/` 为空）；device-helper 需用户 Xcode 现场编译 |
| Kimi | 可用 | 部分 | KimiCU 服务常驻（pid 实测）、TCC 双授权、UDS listening；webbridge daemon 分析时未运行（离线证据链完整）；桌面内嵌浏览器随 Desktop 使用 |
| Qoder | 未启用 | 可用（in-app 后端） | CU 完整载体在位（Runtime 已由 bundled-resources 校验装至 `~/.qoder/bin/`）但 `~/.qoder/ipc/` 为空、审批文件未生成、设置键从未打开；BU in-app 有 2026-10-05 会话 42 次调用实证；connector/Browser Agent API 未激活（`~/.qoder/browser-connector/` 不存在） |
| Grok | 未启用（桌面端） | 本地无；云端默认开 | CLI 无原生能力（非断链，是产品边界）；Grok Bot CU 门控全关（无 service.json/无安装目录/无进程，与 Cursor 本机状态同构）；云端 BU 无法静态验证 |
| Devin | 全云端 | 全云端 | 本机 CLI 与 Desktop 均已卸载：CLI 存 3 天运行日志/配置/sessions.db，Desktop 为 Windsurf 更名残留（悬挂 symlink + `~/.devin`）；CU/BU 证据来自官方文档 + 本机数据面交叉验证 |
| Goose | 不可用 | 不可用 | 本机已卸载（99 个断链 skills symlink 为曾安装痕迹）；分册按上游源码基线（v1.53.0 commit 5bd5e548）分析——新证据形态 |
| MiMo | **已启用**（env=1，stable 0.7.11 已选定，宿主技能已装，锁屏操作 opt-in） | 能力完整未启用（env=0、无 provider descriptor、无宿主技能、无 IAB——五面负证据） | |

> 「未启用」不等于「没有能力」：多家（Claude/Cursor/Kimi-webbridge/Qoder-CU/Grok/Devin/Goose/MiMo-BU）的结论都建立在负证据判定之上，方法见 [docs/methodology.md §9](../docs/methodology.md#9-负证据判定如何证明未启用)。

---

## 8. 矛盾与勘误注记

各 agent 分册间存在少量口径差异，横向引用时以本节为准：

1. **ZCode 工具数 14 vs 30**：30 是上一代 `zcode-cua` 0.5.12 的屏幕级 MCP 工具面；0.6.3 收敛为 14 个 app/窗口级工具（见 [ZCode CU §3.2](../agents/zcode/computer-use.md)）。Kimi/Codex 分册引用的「30（63 broker 方法）」是旧版观察，非当前面。
2. **@oai/cua 0.2.4 vs 0.2.5**：ZCode SDK 头注释自述逆向基线为 0.2.4；本机 Codex 实装 0.2.5，两版文档结构一致、未见 API 面差异（[Codex README §复用注意](../agents/codex/README.md)）。
3. **Kimi webbridge 状态**：「daemon 未运行」仅指分析时点的 webbridge 守护进程；KimiCU 服务本身在本机**常驻且已授权**（evidence §2 实测 listening）。
4. **Cursor「16+2」**：macOS companion CU 为 16 工具（含 2 个租约工具）；Windows 额外暴露 zoom/batch。BU 为 15 注册 + browser_lock = 16。
5. **Synara「33」**：指 gateway `computer_*` 工具（13 读 + 20 变更）；不含 `browser_*` 13 个与 `computer_browser_*` 10 个。
6. **ZCode 的 BU 入口形态**：Codex 分册 §9 对照表初稿曾把 ZCode 描述为「MCP 工具逐个暴露（browser_visit/snapshot/click…）+ ego lite 分立」——系分析者个人环境（用户级 ego-browser 工具）混入，非 ZCode 产品面；ZCode 本册（[browser-use.md](../agents/zcode/browser-use.md)）实证为**单一 `js` MCP 工具 + `agent.browsers` SDK 对象面 + IAB 后端**，且不存在 `browser_visit` 等工具名。该错误已于 2026-10-06 在 Codex 分册中更正（以 [ZCode 分册](../agents/zcode/browser-use.md)与 [evidence §2.20–2.21](../agents/zcode/evidence/inventory.md) 为准）。
7. **Qoder 确认分类的编号上限**：Qoder evidence C8 记「编号 [1]–[15] 四档确认分类」，但其 [computer-use.md §7](../agents/qoder/computer-use.md) 正文实际列出至 **[17]（医疗动作）**——横向引用以分册正文为准（编号面到 [17]）；另 Qoder 与 Codex 的确认分类同属「OpenAI CUA 风格编号分类法」，Qoder 分册为显式对照而非独立发明。
8. **Grok CLI 的负证据口径**：横向摘要曾引用「CLI 二进制 12 处 `computer` 命中全是 OpenAI Responses API 类型名」——该数字与「Responses API」归因**未见于 [Grok 分册](../agents/grok/browser-use.md)**；分册口径为：内置工具表 16 件无任何 computer/browser 类工具、二进制 93 处 `browser` 全部为 OAuth 登录文案、CHANGELOG 无 CU/BU 条目（[Grok BU §9](../agents/grok/browser-use.md)、[evidence §1.1](../agents/grok/evidence/inventory.md)）。以分册为准。
9. **新分册内部的「N 家」为写作时点口径**：grok 分册的「本仓库 9 家」「9 家分册中最完整的失败协议」、goose 分册的「9 个被逆向 agent 中唯一」、mimo 分册的「八家分册中把对标复刻做得最明示」——分母为各分册写作时点（前 8/9 家）。扩到 12 家后这些「唯一/最」结论经核对仍然成立（Goose 仍是唯一纯 CLI 透传、Grok Bot 仍是谱系证据最硬、MiMo 仍是最明示的对标复刻），但引用时请注明时点。
