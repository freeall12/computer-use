# Codex Computer Use（原生桌面控制）完整逆向

> 分析对象：本机 OpenAI Codex（CLI 0.155.1 + 桌面宿主 ChatGPT.app 26.930.31730 + Sky CUA 服务）。
> 所有证据出处见 [evidence/inventory.md](evidence/inventory.md)（下文以 §编号引用）。
> 标注：【实证】直接来自文件/二进制/文档；【推断】由旁证推导。

## 0. TL;DR

Codex 的桌面控制不是"模型直接发坐标"的 CUA，而是一条**四层流水线**：

```
模型 ──MCP(stdio)──> cua_repl / node_repl（持久 Node REPL，JS 编程面）
                         │ import("@oai/cua/tinyskyAlt")  → 全局 cua 对象
                         ▼
                    @oai/sky（JS 客户端，按平台分派）
                         │ JSON-RPC 2.0 / Unix socket / 4B 长度前缀帧
                         ▼
              SkyComputerUseService（Swift 原生服务，com.openai.sky.CUAService）
                         │ AX API（观察） + CGEvent（注入） + ScreenCaptureKit（截屏）
                         ▼
                       macOS 应用窗口
```

核心设计特征（与常见开源 CUA 框架的差异）：
1. **观察以 AX 树为主、截图为辅**，AX 树自动 diff（只回增/删/改元素），带行数预算上限。
2. **"Skyshot"是原子观察单元**：AX 文本 + 截图（+分类器）一次返回。
3. **mac 目标没有 launch/activate 原语**——`startApp` 一次调用完成"拉起会话 + 抓 key window 状态"。
4. 动作全部 `Promise<void>`：失败信息内嵌**新鲜 AX diff** 引导模型重新索引，而不是返回"可能已发送"标志。
5. 双重审批：模型侧策略 prompt（Rust 内嵌）+ 服务侧 `getAppPolicy`/`AppApprovalStore` 持久化审批。

---

## 1. 载体与版本

| 层 | 组件 | 版本 | 位置 |
|---|---|---|---|
| 编程面 | `@oai/cua`（tinyskyAlt globals） | 0.2.5 | `ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua` |
| REPL 服务 | `@oai/cua-repl`（MCP server） | 0.1.0 | 同上 `@oai/cua-repl` |
| 平台客户端 | `@oai/sky` | 0.7.5 | 同上 `@oai/sky` |
| 原生服务 | SkyComputerUseService（Swift） | 与 app 构建 26.930.31730 同期（2026-10-02 签名） | `~/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/` |
| 多路复用客户端 | SkyComputerUseClient（Swift） | 同上 | 同上 `Contents/SharedSupport/SkyComputerUseClient.app/` |
| CLI 侧策略 | codex 二进制内嵌 prompt/schema | 0.155.1 | npm 全局包（Rust，228MB） |

ZCode CUA SDK 注释称逆向基线为 `@oai/cua@0.2.4`，本机实装 0.2.5——两个版本文档面一致（docs 同名同构），差异未发现【实证+推断：未逐字节 diff 0.2.4】。

**为什么叫 "Sky"？** 目录树（`sky_js`）、socket 命名（`com.openai.sky.CUAService`）、env 前缀（`SKY_CUA_*`）、以及 ZCode 侧 `NODE_REPL_TRUSTED_SERVICES={"sky":"@oai/sky/service"}` 一致表明 "Sky" 是 OpenAI 桌面自动化运行时的内部代号【实证：命名一致；代号来源为推断】。

## 2. 运行时装配：cua_repl 如何被拉起

桌面端（Codex Desktop / ChatGPT.app）通过 `unified-computer-use` 插件声明 MCP server（§2.2 全文见 evidence）：

- 进程：`cua_node/bin/node @oai/cua-repl/bin/cua-repl.mjs`，stdio MCP
- 模型可见工具只有 3 个：`js`（执行 JS，`output_token_limit: 25000`）、`js_reset`（重置持久会话）、`turn_ended`（隐藏，宿主回调）
- 启动横幅（banner）就是一行 `await import("@oai/cua/tinyskyAlt");`——import 时读取 `nodeRepl.env`（冻结快照）决定装配哪些 provider，**不采集清单**，只吐出核心指令文档
- `CUA_REPL_ENABLED_SURFACES=browser,computer`：两个表面各自装配；`js_reset` 后 module cache 清空，banner 重新执行
- README 明言：`cua_repl` 目前假设 TinySky 形态（训练侧 `TinySkyMatrices` 同源），即同一套 API 同时服务产品与模型训练

CLI 侧（npm codex）等价物是 `node_repl` MCP server：Rust 二进制内嵌 `node_repl_policy` prompt 且插件 ID 表含 `cua_repl`，说明 **CLI 也能挂 cua_repl**（作为普通 MCP server），只是本机 CLI 配置未启用【推断：strings 见 §7.2，未见 CLI 侧实际配置】。

`js_reset` 语义（instructions/reset.md 原文）："All JavaScript bindings are discarded… **does not close browser tabs or native apps, or erase their state**" —— 重置的是模型的工作内存，不是世界状态。

## 3. `cua` 编程面（tinyskyAlt）完整还原

来源：`tinysky-alt-core-{node-repl,cua-repl}.md`（官方随包文档）+ `tinysky_alt/types.d.ts`。以下为接口全文摘要（字段名逐字核对）：

### 3.1 顶层对象

```ts
declare const cua: {
  initialize(): Promise<State>;          // node_repl 版；cua_repl 版文档只列 getState
  getState?(options?: ObservationOptions): Promise<State>;
  rewriteDocumentation?(): Promise<void>; // 上下文被压缩后重放全部已读文档
  getApp(target: string | { windowId: number }): Promise<App>;
  listApps(options?): Promise<AppInfo[]>;
  listWindows?(options?): Promise<WindowInfo[]>;   // Linux/Windows 限定
  browsers?: Browsers;                    // browser 半边，见 browser-use.md
  computer?: Computer;                    // sky 客户端逃逸口
  getBrowser? / createBrowserTab? / getTab? / listBrowsers? / listTabs?
};
type ObservationOptions = { emit?: boolean };      // 是否自动回显给模型
type StateOptions = ObservationOptions & { disableDiffing?: boolean };
```

`State = { apps: AppInfo[]; browsers: BrowserState[]; errors?: string[] }`——清单错误按条目隔离，单面失败不影响另一面。

### 3.2 Target 共享交互面（App 与 Tab 都实现）

```ts
interface Target {
  getAXState(options?: StateOptions): Promise<string>;          // AX 树（默认 diff）
  getScreenshot(options?: ObservationOptions): Promise<Uint8Array>;
  getAXStateAndScreenshot(options?): Promise<{ state: string; screenshot?: Uint8Array }>;
  click(target: number | Vec2, options?: ClickOptions): Promise<void>;   // 元素索引或坐标
  drag(from: Vec2, to: Vec2): Promise<void>;
  scroll(target: number | Vec2, direction: Direction, pages?: number): Promise<void>;
  selectText(elementIndex: number, text: string, options?: SelectTextOptions): Promise<void>;
  setValue(elementIndex: number, value: string): Promise<void>;
  performSecondaryAction(elementIndex: number, action: string): Promise<void>; // 触发 AX 副动作
}
```

- `ClickOptions = { mouseButton?: "left"|"right"|"middle"|"l"|"r"|"m"; clickCount?: number }`
- `SelectTextOptions = { prefix?; suffix?; selectionType?: "text"|"cursor_before"|"cursor_after" }`
- `Direction = "up"|"down"|"left"|"right"|"u"|"d"|"l"|"r"`

### 3.3 App（原生应用绑定）

```ts
interface App extends Target {
  scroll(target, direction, distance?: number | { pixels: number }): Promise<void>; // mac 收页数；Win 必须 {pixels} 且坐标目标
  paste(text: string, options?: PasteOptions): Promise<void>;  // {format: "text"|"md"|"html"}
  pressKey(key: string): Promise<void>;                        // xdotool 风格："super+c"、"KP_0"、"Return"
  typeText(text: string): Promise<void>;
}
```

mac 特性：`paste` 走系统剪贴板并**恢复用户原剪贴板内容**；`getApp("名字" | 完整路径 | bundle id)` 可后台拉起应用；显示名解析失败建议换 bundle id 重试。

### 3.4 Computer（sky 逃逸口，按平台收缩）

`cua.computer` 的类型就是 `typeof sky`（types.d.ts：`export type Computer = typeof sky`）。mac 上暴露的原始方法（snake_case，与 `WindowComputerUseClient.d.ts` 一致）：

```
click, drag, get_app_state, list_apps, paste, perform_secondary_action,
press_key, scroll, select_text, set_value, type_text,
start_audio_recording?, stop_audio_recording?
```

Linux（full-desktop）额外有 `activate_window, move, move_relative, key_down, key_up, clipboard_read/write/release, drag_handle, launch_app, get_window_state, list_windows, get_screenshot`。**mac 没有这些**——文档明言 Linux "Sky sends it without activating that window or moving the desktop pointer"，而 "Windows input activates the selected window"。

### 3.5 与 ZCode 14 工具面的对照

| 维度 | Codex（本机实证） | ZCode CUA SDK（对照样本） |
|---|---|---|
| 暴露形态 | `cua.*` JS 对象（MCP 工具仅 js/js_reset） | 30 个 MCP 工具（0.5.x）→ 14 方法 `cua.computer` 面（0.6.x） |
| 方法命名 | `click/drag/scroll/selectText/setValue/performSecondaryAction`（camelCase）+ `cua.computer` 下 snake_case 原生面 | `left_click/left_click_drag/type/key/perform_action` 等 snake_case 工具 |
| 启动/激活 | mac 无原语（startApp 隐式拉起） | `open_application` 2026-09 起整体删除，"与 codex 一致" |
| 截图 | `getScreenshot` 返回 Uint8Array，`emit` 自动回显 | `screenshot` 独立工具 |
| 观察刷新 | AX diff 默认开启，`disableDiffing` 关闭 | state_id 强校验 + diff 基线由 shared host 持有 |
| 错误语义 | 动作 `Promise<void>`，失败时错误信息内嵌新鲜 AX diff | 抛 `ComputerUseError` 带 `actionSent`（possibly_sent 防重放）——**ZCode 自有**，R3 注释承认 Codex 无此语义 |
| 安全原语 | 服务端审批（getAppPolicy/AppApprovalStore）+ URL 禁区 + 锁屏守护 | controller lease / kill switch（自有实现） |

结论：ZCode 的 `stateId/frameId/possibly_sent/controller lease` 在 Codex 原始面**没有对应物**，属 ZCode 的事故驱动自研加固；Codex 对 stale 索引的对策是"错误内嵌新 diff + 指令强制每动作后重新 getAXState"【实证：两边源码/文档直接对比】。

## 4. 观察机制

### 4.1 AX 树与 diff
服务端（Swift）符号：`axTreeDiffing`、`axTreeDiffingRemovedElementIDRanges`（删除以 ID 区间表达）、`enableAXDiffing/isAXTreeDiffingEnabled`、`UIElementRenderDifference(Buffer)`、`AccessibilityDifferenceLineBudgetExceeded`——diff 有**行数预算**，超限即报错（推测此时客户端会退回全量树）【推断：超限后的回退策略未见代码】。

`get_app_state` 入参 `{ app, disableDiff? }`，返回 `AppState { app, screenshot|null, text }`，`text` "prefixed with app-specific guidance on first access when available"（首次访问前缀应用专属指引——`appSpecificInstructions` 字段）。`AXManualAccessibility` 符号表明服务会对未开启 AX 的应用（典型：Electron）触发手工启用流程【推断：具体为 AXManualAccessibility SPI 调用】。

指令层的硬约束（官方文档原文）：**每个动作后必须 `getAXState()` 再决策**；元素索引必须从最新 AX 文本重新推导，禁止复用；screenshot-only 观察后索引视为失效，需再取全树。这是把 stale-index 问题转化为流程纪律而非运行时校验。

### 4.2 Skyshot（观察原子）
服务端符号：`Skyshot / SkyshotAXTree / SkyshotCapture / SkyshotOperation / SkyshotRequest / SkyshotResult / SkyshotAttachment / SkyshotClassifier / skyshotImageFiles`。即截图与 AX 树打包成一个 "skyshot" 结果对象（`MacWindowSkyshot { text, screenshot {url, mimeType} }`），并有一个分类器组件（用途未证实，可能用于截图内容审计/敏感内容检测）【推断】。

截屏走 **ScreenCaptureKit（SCStream）**；`requestAccessForEntityType` 符号对应 macOS 屏幕录制/辅助功能权限申请。权限未批时客户端有专门话术（"permissions are still pending… Do not end your turn yet, just call this tool again"）——用**重试循环**等用户在设置窗口里点授权。

### 4.3 自动等待
`getAXState/getScreenshot/getAXStateAndScreenshot` 内置稳定等待（文档："automatically wait an appropriate amount of time before capturing new state… don't pause or delay"），明确禁止模型手动 `setTimeout`。Linux 端有 `action_settler` 与 `post_action_sleep_ms`（默认 100ms）配置，mac 等价物未见配置面【推断：mac 端等待策略硬编码于服务】。

## 5. 动作机制

### 5.1 输入注入
服务端符号 `CGEvent / CGEventType / CGEventRef / CGEventFlags / CGEventTap(Placement|Options|Location)` + `VirtualCursor`：键盘与指针事件走 CoreGraphics 事件系统，并安装事件 taps（用于拖拽续持 `dragContinuation`、点击监听 `clickEventTap`、滚动观察 `scrollObserver`）。

浏览器 tab 的输入包装（typeText/paste/pressKey 带 elementIndex）先 **250ms 内建立并验证焦点**再发送；失败则不发输入、错误附新鲜 AX diff。传 `null` 表示"用当前焦点，不校验"。

### 5.2 派发路径（JS → 服务）
`MacNativePipeTransport`（§3.3 evidence）：
- socket：`~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`（env 可覆盖）
- 帧：4B UInt32LE 长度 + JSON，≤8MiB
- `ping {clientApiVersion}` 严格校验 `serverApiVersion`（不匹配即 `incompatibleClientVersion` 硬失败）
- `request {clientApiVersion, codexTurnMetadata, deadlineUnixMilliseconds, requestType, request}`——**每个请求都带会话/轮次元数据与截止时间**，服务端可据此做策略判定与审计（`ComputerUseJSONRPCCodexTurnMetadata` 符号）
- 服务未起时的三级自愈：host services 管道 `ensureService {service:"computer-use"}` → `launchServices.openApplication(路径或 bundle id)` → 重连。全程要求运行在"受信任的 nodeRepl 运行时"（`globalThis.nodeRepl.nativePipe.createConnection` 存在），**普通 Node 进程跑不了这套客户端**——JS 客户端故意依赖宿主提供的原生管道能力。

### 5.3 startApp：隐式拉起
`startApp(appOrArgs) → MacWindowAppState`，描述即工具文案："Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. **This must be called once per assistant turn before interacting with the app**"。mac 上没有独立 launch/activate 工具；`getApp` 也接受名字/路径/bundle id 并后台拉起。这是把"激活窗口"这个易被滥用的原语（抢焦点、点确认弹窗）收编进受审批的观察动作里【推断：设计动机】。

应用名歧义处理（客户端二进制文案）："Ambiguous app identifier '…'. Multiple apps share this bundle identifier: … Use an app name or full app path instead."

## 6. 安全模型

### 6.1 四层防线
1. **权限层（OS）**：Accessibility + Screen Recording 权限，未批则进入"等待用户授权"重试循环；安装由 `Codex Computer Use Installer.app` + `CodexComputerUseAuthorizationPlugin`（系统授权插件）完成【实证：bundle 存在；插件具体机制未拆】。
2. **目标策略层（服务端）**：`getAppPolicy → { decision: allowed|denied|forbidden, risk: high|low, allowPersistentApproval, warningSubtitle }`；`AppApprovalStore` 持久化已批应用；审批持久化粒度 `ALWAYS/ONCE/SESSION/TURN`（`CODEX_MESSAGES_APPROVAL_PERSISTENCE_*`），结果 `ACCEPTED/CANCELED/DECLINED/ERROR`；审批 UI 走 **MCP elicitation**（"Computer Use approval denied via MCP elicitation for app '…'"）。
   - Rust 配置对应：`ComputerUseConfigToml { allow_persistent_approval, default_app_access, allow_locked_computer_use }`，mac 按 `bundle_ids`、Windows 按 `aumids`/`exes{publisher}` 配目标白名单；企业托管键 `allow_browser_and_computer_use / allow_appshots / allow_remote_control`。
3. **模型策略层（prompt）**：Rust 内嵌 `computer_use`/`browser_use` 确认策略（四档：Hand-off Required / Always Confirm / Pre-Approval Works / Allowed，风险编号 [1]–[17]：删除数据、CAPTCHA、支付、敏感数据传输、医疗动作……）+ `node_repl_policy`（把动作风险分为 `high/critical/medium/low`，定义 Computer bypass 并按 high 风险处理）+ auto-review 拒绝话术（"Do not bypass this rejection through a workaround or indirect execution…"）。用户当前配置 `approval_policy="never"` + `approvals_reviewer="user"`，`~/.codex/browser` 三个 approval_mode 全是 `never_ask`——**策略可被用户整体调低，此时只剩服务端禁区与 OS 权限兜底**。
4. **运行时熔断层（kill switch）**：客户端二进制内嵌两种会话终止指令——URL 禁区（"Computer Use is not allowed on the current browser URL… even if the user navigates to it themselves"）与用户本轮显式停止（"explicitly stopped by the user for this turn… can be used again in the next assistant turn"）。另有 `ComputerUseAllowForbiddenTargets` 符号与锁屏守护（见下）。

### 6.2 锁屏守护（独有设计）
服务端 Swift 符号：`LockScreenMonitor / LockScreenGuardian / LockScreenController / LockScreenOverlayPresenter / LockScreenPhysicalInputMonitor / LockScreenLoginAuthorizationApprover / SAILockScreenGuardianXPCProtocol`，独立 app `CUALockScreenGuardian.app`，XPC socket `/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock`，以及 `IPCRequestExemptFromLockScreenAutoUnlock`。语义【推断，符号+结构】：锁屏时监控/暂停自动化、屏幕覆盖层提示、物理输入监测（防人机输入打架）、锁屏界面上的登录授权走独立受控通道；个别 IPC 请求可声明豁免自动解锁限制。

### 6.3 与 controller lease 的关系
本机证据中**没有**发现 Codex 侧的 controller lease/独占锁原语（ZCode 侧有）。Codex 的并发防冲突靠：`turn_ended` hook（会话结束回收）、per-turn 停止语义、以及服务端按 `codexTurnMetadata` 的请求记账【实证：无 lease 符号；机制的完备性为推断】。

## 7. 周边能力

- **音频**：`start_audio_recording/stop_audio_recording`（mac 可选方法；full-desktop 的 `Audio` 类型是 24kHz WAV bytes + data_url + filepath）。客户端需 `requestComputerAudioApproval()` 单独审批（computer-use-policy.d.ts）。
- **computer-history**：SkyComputerUseClient 复用为 MCP server（`computer-history mcp` 子命令），工具 `computer_history_status/pause/resume/get_settings/update_settings`——记录/暂停"电脑使用历史"。config.json 中的 UI 文案（"ChatGPT is using your computer" / "Esc to cancel"）是屏幕覆盖层提示。
- **record-and-replay**：事件流录制（点击/键入/窗口内容，最长 30 分钟），开始需审批（`CodexRecordAndReplayRecordingStartApprovalRequested`），`stop` 返回 metadata + events 路径。
- **通知钩子**：config.toml `notify = [SkyComputerUseClient路径, "turn-ended"]`——每轮结束由宿主回调该二进制（弹系统通知），这也是它被注册为 Login/notify helper 的原因。

## 8. 本机不可见边界

- SkyComputerUseService 为 Swift 编译产物，无源码/符号表级细节；动作 RPC 的完整 method 名表（服务端 switch）未逐个还原，客户端方法名（click/drag/paste/...）即请求类型名的强证据【推断】。
- 训练侧（TinySky）与云端执行面不在本机。
- `relaxed` 构建变体（@oai/sky publishConfig 中 bin/mac/relaxed）与 normal 的差异未验证【推断：审批门槛更低的内测变体】。
