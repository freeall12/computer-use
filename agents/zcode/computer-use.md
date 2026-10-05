# ZCode Computer Use（原生桌面控制）完整逆向

> 逆向对象：ZCode 桌面 Agent 的 computer use 能力。分析基线：插件 0.6.3、node-repl-host 0.6.0、
> Helper 3.14.4（buildId pipeline-298526-10bbcea5）。所有引用均标注「路径:行号」或命令输出，
> 完整证据见 [evidence/inventory.md](evidence/inventory.md)。

## 0. TL;DR

ZCode 的桌面控制不是「一个 MCP 工具」，而是**五层结构**：

1. **模型可见面**：一个 skill（`SKILL.md`）+ 一份按需文档（`agent.documentation.get("computer-use")`），
   教模型在 `mcp__node_repl__js` 里 import 一个 SDK 并使用 `agent.computerUse.*` 绑定对象 API；
2. **SDK 层**（`computer-use-client.mjs`，1209 行）：把 14 个底层工具包装成与 Codex `@oai/cua@0.2.4`
   「逐字同构」的 `Target`/`App` 对象面，并承担所有安全语义（fail-closed、防重放、diff 基线台账）；
3. **共享宿主层**（`node-repl-host` 的 `dist/mcp/server.js`）：每次 `js` 调用一个全新 Node Worker，
   通过 `Symbol.for("zcode.node-repl.computer-use-bridge")` 注入桥接器；工具层在此维护
   state/frame/树台账/kill switch/动作后稳定等待等**跨调用会话状态**（Worker 不持有任何状态）；
4. **Helper 进程**（`ZCode Computer Use.app`，Node SEA）：常驻后台（LSUIElement），宿主会话状态的
   真身持有者，监听本地 socket 权限中介（broker），把工具调用翻译成 macOS 原生调用；
5. **macOS 原生层**（`ax_native.node`）：Accessibility（AXUIElement*）做观察与语义动作，
   CGEvent 做键盘/指针事件，ScreenCaptureKit 做窗口截屏；外加 PiP 画中画与 Ghost 合成光标两个
   可视化反馈子系统。

设计哲学一句话：**accessibility first，事件路径只是兜底；一切校验 fail-closed；
「可能已下发」优先于「重试一次」。**

---

## 1. 能力载体清单

| 组件 | 路径 | 版本 | 角色 |
|---|---|---|---|
| CUA 插件 | `~/.zcode/cli/plugins/cache/zcode-plugins-official/computer-use/0.6.3/` | 0.6.3 | SDK + skill + docs（声明「execution is provided by the shared node_repl host」，见其 package.json description） |
| CUA SDK | `.../computer-use/0.6.3/scripts/computer-use-client.mjs` | — | 1209 行；模型面 API 装配 |
| Skill 手册 | `.../computer-use/0.6.3/skills/computer-use/SKILL.md` | — | 模型常驻指引 |
| 参数级参考 | `.../computer-use/0.6.3/docs/computer-use.md` | — | `agent.documentation.get("computer-use")` 的返回体 |
| node_repl 宿主 | `~/.zcode/cli/plugins/cache/zcode-plugins-official/node-repl-host/0.6.0/dist/mcp/server.js` | 0.6.0 | `js` 工具 + CUA/Browser 桥接 + broker 转发 |
| CUA Helper | `/Applications/ZCode.app/Contents/Resources/cua-helper/ZCode Computer Use.app`（安装副本 `~/.zcode/computer-use/`） | 3.14.4 | 主二进制 111.7MB Node SEA，bundle id `dev.zcode.cua-helper`，TeamID `8A5X4JJ39T`，Hardened Runtime |
| 原生模块 | `.../ZCode Computer Use.app/Contents/Resources/ax_native.node` | — | 986KB NAPI 模块（AX/CGEvent/ScreenCaptureKit/PiP/Ghost） |
| 图像处理 | `.../computer-use/0.6.3/node_modules/sharp`（libvips 8.17.3）、`koffi` | — | 宿主侧栅格缩放/裁剪与 FFI |
| 上一代 | `~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-cua/0.5.12/dist/mcp/server.js` | 0.5.12 | 独立 25 工具 MCP server（对比用） |

工具进程：`zcode-node-repl-mcp`（node_repl MCP server）由桌面宿主按需拉起；
Helper 本身**懒启动**——首个 CUA 调用触发拉起，采样时未运行（evidence §1.3）。

---

## 2. 架构分层与调用链

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 模型（GLM）                                                             │
│   读 SKILL.md + docs/computer-use.md，写 JS 代码                        │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ mcp__node_repl__js({code, title, timeout_ms})
               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ L2 共享宿主  zcode-node-repl-mcp（node-repl-host 0.6.0 dist/mcp/server.js）│
│   • 每次调用 fork 全新 Worker（kind:"zcode-node-repl-call"）             │
│   • Worker 全局注入 Symbol.for("zcode.node-repl.computer-use-bridge")    │
│   • 工具层会话状态：AccessibilitySession（state/frame/树台账）、          │
│     FrameRegistry、ActionSettler、KillSwitch、InputHoldRegistry          │
│   • in-process CUA broker（/tmp/.../znrc-<uuid>.sock + token）转发请求    │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ L1 工具调用（get_app_state/left_click/...，严格 schema）
               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ L3 权限中介 + 会话真身  ZCode Computer Use.app（Node SEA，懒启动）        │
│   • 权限 broker socket：/tmp/zcode-cua-<uid>/broker.sock（IPC v2）       │
│   • Helper 冷启动契约：CUA_NOT_READY 信封（可/不可重试分流）              │
│   • 观察缓存 snapshotCache(pid,window)、diff 基线、元素索引→native token  │
│   • 合成焦点会话（background input）、剪贴板借还、PiP/Ghost 反馈层        │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ NAPI 调用 ax_native.node
               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ L4 macOS 原生层                                                          │
│   AX: AXUIElementCopyAttributeValue/AXPress/AXValue…（观察+语义动作）    │
│   CGEvent: ZCodePostKeyboardEventToWindow / click_to_window（事件兜底）  │
│   ScreenCaptureKit(weak)+CoreMedia：窗口栅格（前后 surface 指纹）        │
└─────────────────────────────────────────────────────────────────────────┘
```

要点：

- **模型永远看不到 frame_id / state_id 的搬运**。SDK 头注释明确：「坐标用当前 frameId，
  模型永远不需要碰 frame_id」（`computer-use-client.mjs:310`）。
- **绑定不跨 cell**：node_repl 每个 `js` 调用都是全新 Worker，`const app` 活不过当前 cell；
  但 UI 状态与会话状态在宿主/Helper 里存活，下一 cell 重新 `getApp` 是「重新绑定」而非
  「重新观察」（`SKILL.md:19-22`，`computer-use-client.mjs:15-18`）。
- **两跳 socket**：Worker → node_repl 宿主的 in-process broker（`znrc-*.sock`，带 token）
  → Helper 的权限 broker（`broker.sock`，IPC v2， authenticate 行先行）。

### 2.1 Worker 生命周期（server.js 证据）

```
tools/call "js"
  → parseToolInput(jsInputSchema)         # {code, timeout_ms≤120000, title?}
  → serialized(sessionKey, ...)           # 同 session 串行
  → executeJsInWorker({code, requestMeta, signal, syncTimeoutMs, cuaBroker})
      → new Worker(new URL(import.meta.url), {workerData})
      → createInProcessNodeReplExecutor() # Worker 内
      → session.run(code) → postMessage(result)
  → finally: worker.terminate()           # 用完即毁
```
（`server.js:117703-117768`）。超时三路合并：
`AbortSignal.any([mcpReq.signal, callController.signal, AbortSignal.timeout(timeoutMs)])`。
默认 60s，最大 120s（`MAX_SYNC_TIMEOUT_MS = 12e4`）。

### 2.2 桥接器注入

`createInProcessNodeReplExecutor` 把两个 bridge 挂到 Worker 全局（`server.js:117732-117748`）：

```js
injectedGlobals: () => ({
  ...createBrowserBridgeGlobals({...}),   // Symbol.for("zcode.node-repl.browser-control-bridge")
  ...createComputerUseBridgeGlobals({     // Symbol.for("zcode.node-repl.computer-use-bridge")
    broker: input.cuaBroker, generation, getActiveCall, session, documentationRoot })
})
```
SDK 侧读取（`computer-use-client.mjs:28`、`:888-896`）：
`const bridge = globals[BRIDGE_SYMBOL]; if (!bridge?.call) throw ...`。
`assertAvailable()` 双重校验：generation 匹配（防 kernel 复用旧绑定）+ `runtime_scope !== "subagent"`
（子代理直接禁用，消息 "Computer Use is not available in subagent"，`server.js:117074`）。

### 2.3 请求上下文（session/workspace/trace）

Worker → broker 的每次调用都携带 `context`（`server.js:117136-117160`）：

```json
{ "runtimeScope": "main|subagent", "sessionId": "sess_...", "workspacePath": "...",
  "workspaceKey": "...", "turnId": "turn_...", "clientMode": "desktop-continuous",
  "deliveryKind": "...", "trace": {"traceId": "...", "spanId": "..."} }
```
缺 `session_id` / `workspaceKey` 直接抛错——Helper 侧的租约、PiP 会话、树缓存都以这些键隔离。

---

## 3. 完整工具面

### 3.1 双层 API 的关系

- **高层绑定对象 API**（`agent.computerUse.getApp(...)` 返回的 `App`）：12 个与 Codex `Target`
  逐字同签的成员 + `elements()`（不可枚举的具名逃逸口）。**推荐面。**
- **低层工具面**（`agent.computerUse.computer.<tool>(args)`）：存活的 14 个工具，参数 schema 严格
  （undeclared key → `unrecognized_keys` 拒绝）。**逃逸口**，用于绑定 API 不表达的场景
  （窗口枚举、key repeat、同调用回读状态）。

### 3.2 14 个工具（wire 名 → 语义）

| 工具 | 分层 | 关键参数 | 语义要点 |
|---|---|---|---|
| `list_apps({})` | READ_ONLY | — | 运行中 app 清单 `{apps:[{pid,name,bundle_id,active}]}`；envelope 是裸 JSON 数组（历史 bug 见 `computer-use-client.mjs:147-152`） |
| `list_windows({app_ref})` | READ_ONLY | `app_ref` | 每窗口一行：`window_id`（稳定整数）、`title`（`""`=AXTitle 为空 / `null`=读不到或 CG 合并行）、`subrole`（区分真 AX 窗口与 CoreGraphics 残留 surface）、`text_preview`（无标题窗口的内容提示，**绝非标识符**）、`bounds`（诊断用全局点，禁止当坐标）、`main`/`focused`/`onscreen`/`index` |
| `get_app_state({app_ref, include_screenshot?=false, disable_diffing?=false, tree_shown_to_model?})` | READ_ONLY | — | **核心观察**。返回结构化 `{state_id, app, window, elements[], text}` + 可选图像块；默认按 diff（delta）返回；`force_full`（由 `disable_diffing` 翻译）取整树；带截图时另发 `image_ref` 文本块（`{image_ref:{frame_id,width,height,actionable:true}}`，四键固定） |
| `left_click({target, mouse_button?="left", click_count?=1, modifiers?="", strategy?="auto", app_ref?, return_state?="none"})` | T1_INPUT | `target` | `target` 二选一：`{type:"element",index}` 或 `{type:"coordinate",x,y,frame_id?}`；`app_ref` 声明索引作用域（防止多 app 时索引退化为全局最近观察） |
| `left_click_drag({from_target, to, modifiers?="", app_ref?, return_state?})` | T1_INPUT | — | 双端都是 target |
| `scroll({target, scroll_direction, scroll_amount, strategy?, app_ref?, return_state?})` | T1_INPUT | — | `scroll_direction: up|down|left|right`；`scroll_amount` 页数，clamp 0–100 |
| `type({text, target?, app_ref?, strategy?, return_state?})` | T1_INPUT | — | 键入文本；可带 target 定位焦点 |
| `set_value({target, value, strategy?, app_ref?, return_state?})` | T1_INPUT | — | AX 直接设值，优先于打字/粘贴 |
| `select_text({target, text_range?, app_ref?, return_state?})` | T1_INPUT | — | `text_range=[start,length]`；缺省选全值。SDK 侧由内容匹配本地算 range（`resolveTextRange`），多义匹配抛 `NOT_SELECTABLE` 并报候选数 |
| `key({text, repeat?, hold_seconds?, app_ref?, strategy?, return_state?})` | T1_INPUT | — | 键/和弦（`"Control_L+a"`）；`repeat` 代替循环；`hold_seconds` 长按（上限 30s，`MAX_HOLD_DURATION`） |
| `paste({text, format?="text", app_ref?, return_state?})` | T1_INPUT | — | 借系统剪贴板 + 模拟 Cmd+V，**事后恢复用户剪贴板**；无 app 读取粘贴内容 → 超时而非假成功 |
| `perform_action({target, action, app_ref?, return_state?})` | T1_INPUT | — | `action` 只能是元素 `actions` 列表里广告过的名字，禁止猜测 |
| `request_access({capabilities?})` | READ_ONLY | — | 返回 `{ready, accessibility, screenRecording, message?}`，granted/denied/unknown |
| `stop_computer_control({reason?})` | SAFETY_CONTROL | — | kill switch 闩锁；之后所有工具（除两豁免）fail-hard |

分层依据：`node-repl-host/0.6.0/dist/mcp/server.js:111255-111282`（TIER_TABLE + 自检断言）。
MCP annotations：READ_ONLY/SAFETY_CONTROL → `{readOnlyHint:true, destructiveHint:false}`；
T1_INPUT → `{readOnlyHint:false, destructiveHint:true}`。

**已删除面**（对比 zcode-cua 0.5.12 的 25 工具）：`screenshot`、`cursor_position`、`mouse_move`、
`left/right/middle_click`、`left_mouse_down/up`、`double_click`、`hold_key`（并入 key 的 hold_seconds）、
`open_application`（2026-09-16 整体删除，启动并入 `get_app_state` 的透明拉起，
`computer-use-client.mjs:52-56`）、`list_displays`、`switch_display`、`read_clipboard`。
设计含义：**工具面从「屏幕中心」收缩到「app/窗口中心」**——没有全局屏幕截图，只有窗口捕获。

### 3.3 高层绑定对象（Target 12 成员）

`computer-use-client.mjs:583-809`：

| 方法 | 对应工具 | 备注 |
|---|---|---|
| `getAXState(options?)` | get_app_state | 返回树文本并**自行展示**（emitText）；附带 producer 告知块（`[effect_evidence unchanged]`、`[screenshot_blank]`，见 `advisoryTextOf`） |
| `getScreenshot(options?)` | get_app_state(include_screenshot) | 返回 Uint8Array；失败时错误信息**带原因**并禁止模型去抢焦点（「Do not activate the app」） |
| `getAXStateAndScreenshot(options?)` | 同上（两开） | 失图时附 `[screenshot unavailable: <原因>]` 静默丢图修复 |
| `elements()` | get_app_state（静默） | 返回元素表（含被裁剪行）；不可枚举成员；观察不展示 → 强制下次整树 |
| `click(target, opts?)` | left_click | `mouseButton/clickCount/modifiers/strategy` |
| `drag(from, to, opts?)` | left_click_drag | |
| `pressKey(key, opts?)` | key | keysym 别名归一（`normalizeKeyChord`：`enter→return`、`super→cmd/win/super`、`Control_L→ctrl`…） |
| `scroll(target, dir, pages?, opts?)` | scroll | `dir` 接受 `u/d/l/r` 缩写 |
| `selectText(idx, text, opts?)` | select_text | `prefix/suffix` 消歧、`selectionType: text|cursor_before|cursor_after`；多义即抛 `NOT_SELECTABLE` |
| `setValue(idx, value)` | set_value | |
| `typeText(text)` | type | |
| `performSecondaryAction(idx, action)` | perform_action | action 不在元素广告列表 → 直接本地抛 `ACTION_UNAVAILABLE` |
| `paste(text, opts?)` | paste | `format: text|md|html` |

`agent.computerUse` 命名空间成员：`getState`（=list_apps 展示版）、`getApp(target)`、`listApps`、
`computer`（14 工具逃逸口，freeze）、`requestAccess`、`stop(reason)`；
**不可枚举**：`getWindow(target, windowId)`（窗口绑定入口）。
入口命名是有意分歧：Codex 用裸 `cua` 全局，ZCode 统一挂 `agent.*`（`computer-use-client.mjs:1181-1184`）。

### 3.4 绑定流程（getApp 内部）

`computer-use-client.mjs:943-1092`：

1. 字符串参数按 `looksLikeBundleId`（含点且无空格/斜杠）猜字段；猜错时用 `alternateAppRef`
   换字段重试一次（触发条件是错误文本匹配语义核心 `/target app is not running/u`——
   producer 改过一次文案导致备用查询死码的事故见 `:397-410` 注释）。
2. 绑定即观察一次：`get_app_state` + `disable_diffing:true` + **`tree_shown_to_model:false`**
   （全量但不展示；不进台账、不占 diff 基线）。getApp 不再展示这棵树（2026-09-13 起，
   实测 8 cell 中 36% 输出是被作废的前序树）。
3. 身份收敛：用观察结果里的 `state.app.pid/bundle_id` 重写 appRef——本地化名/模糊名只在第一跳解决。
4. 窗口钉住校验：`window_id_fallback === true` → 抛 `STALE_STATE`（防「静默降级到最前窗口」）。
5. 挂 `elements()`（不可枚举）。

---

## 4. 观察机制

### 4.1 AX 树增量 diff

- Helper 按 `(pid, window)` 缓存上次捕获（snapshotCache），diff 基线是**上次捕获**；
  工具层另有 `tree_shown_to_model` 台账：增量只允许相对「模型看过的树」。
  两者职责：Helper 管「数据有没有变」，宿主管「模型有没有见过」。
- SDK 不变量（`computer-use-client.mjs:594-612`）：
  - 本 cell 还没给模型看过树 → 强制 `disable_diffing`（拿整树）；
  - 只截图的观察（`yieldsTree=false`）不发树文本 → 显式 `tree_shown_to_model:false`
    （不能把自己算成基线）；
  - `elements()` 静默观察同理，并清 `binding.treeSeen`。
- 树文本渲染为单层：`index + kind + name + value + 能力旗标(pressable/editable/has_menu/focused) + actions`。
  **元素 bounds 故意不渲染**（诊断性全局点，防止被当坐标）。
- 大树按优先级裁剪（祖先保留），头部声明 `indices are sparse`；被裁掉的索引可从 `elements()` 拿回。
  另一种截断是容器只上报部分子节点（`showing A-B of N items`），`elements()` 也救不回，
  只能滚动容器后再观察。

### 4.2 状态与帧的台账（宿主侧 AccessibilitySession）

- `state_id`：观察收据的强校验凭证。SDK 在每次观察后记录到 `binding.stateId`；
  元素索引目标**不再**携带 state_id（对齐 codex），由 Helper 侧原生 token 冻结映射判定失效
  （`computer-use-client.mjs:623-642` 注释：客户端「动作后置空 stateId」的守卫已删除——
  真正知道元素是否还在的是 Helper，且元素消失本来就 fail-closed）。
- `FrameRegistry`（`server.js:110495+`）：每会话最多 16 帧 + 32 墓碑；
  `latestActionableFrameId` 支持省略 frame_id 的坐标绑定（implicit 路径）；
  帧过期/被替换/非可动作 → fail-closed（FrameRegistryError）。
- `recordModelVisibleTree`：只登记**真正给模型看过**的树；每个元素存指纹 + 原样标题。
  动作后的索引位移校验拿「当前树 vs 台账树」比对：重取歧义/失败时报
  「refetch couldn't be started」（锚点从一开始就不唯一）或 `ELEMENT_UNAVAILABLE`。
- 效果证据寄存：`return_state=none` 的动作把动作前观察指纹寄存，下一次观察取出比较，
  以 `[effect_evidence unchanged]` 告知「AX 受理了但界面逐字节未变」（修复了模型对
  「点了没反应」零感知、连点三次失效路径的事故，`server.js:111133` 段注释）。

### 4.3 截图栅格绑定

- 窗口捕获产生栅格 + `image_ref` 文本块：`{"image_ref":{"frame_id","width","height","actionable":true}}`
  （四键固定，`server.js:111985-111995` 的 `parseFrameImageRefTextLocal` 白名单校验）。
- 坐标契约：模型给的 x/y 必须是**最新返回栅格**内的整数像素；SDK 把坐标与 `binding.frameId`
  绑定后上报，宿主 `bindFramePixelTarget` 做 explicit/implicit 两条解析路；
  app/window bounds（全局屏幕点）与 `screenshot_display.bounds` 被明确禁止作为坐标来源。
- 隐藏（⌘H）窗口：macOS 不渲染隐藏窗口 → 前后 surface 指纹不一致 → 栅格 fail-closed
  （`non_actionable_reason`）。AX 树不受影响——错误信息引导模型改走元素路径。
- 观察前会等待 UI settle：动作后 `postActionMs=300ms` 起步，树指纹连续两次一致或撞 5s 上限
  才返回（ActionSettler，`server.js:110330-110412`）；模型自己发起的观察只捕获一次不额外等。

---

## 5. 动作机制

### 5.1 双路径：a11y vs event

- `strategy: "auto"`（默认）优先 accessibility：元素语义动作（AXPress/AXValue/AXSelectedTextRange…）
  语义精确、后台可用、不抢焦点。
- `strategy: "event"` 强制合成事件（CGEvent 全局输入），**要求目标 app 已在最前**——
  永不主动激活，后台 app 直接拒 `FOREGROUND_REQUIRED` 且什么都不发。
- 坐标点击在 Helper 内被归一为「窗口相对派发」而非全局屏幕点击——日志实证：
  `native_args:"[65178,\"com.minimax.hub\",8613,[116,33,1280,800],581.5,433.5,\"left\",1,null]"`
  （pid + bundle_id + window_id + 窗口 bounds + 窗口内坐标）。
- 指针合成的一个已知失效模式：某些 app 忽略合成事件携带的坐标、按真实指针位置响应——
  观察以 `[effect_evidence unchanged]` 标注，纪律是**禁止重复同一坐标**，改走元素/键盘。

### 5.2 后台键盘与合成焦点会话

- 键盘路径分 `press_key` / `press_key_to_app`（含 `type_text_to_app`、`hold_key_to_app`）两条；
  `_to_app` 面向「绑定了 window_id 的后台窗口」使用合成焦点会话（ax_native 的
  `RegisterBackgroundInput` / `background_input_ms_since_focus_end_for_pid`）。
- 日志实证焦点 guard（`cua.element_press_focus` 事件）：
  `guardEngaged:true`、按压前后采样 `frontmostPid` / `axFocusedPid` / `elementSelected`，
  焦点设置失败（`focusSetStatus:"invalid_element"`）不影响 `ax_ok:true` 的动作受理——
  受理与生效分离上报。
- 身份收敛的动机即在于此：键盘路径按活动应用**严格**匹配，观察路径（透明拉起走 LaunchServices）
  **宽容**；不收敛会导致「绑得上、按不了」。

### 5.3 paste 与剪贴板还原

- `ZCodeCuaPasteDataProvider`（ObjC 类，ax_native 导出）：把粘贴内容交给系统 pasteboard，
  模拟 Cmd+V，**完成后恢复用户原剪贴板**；`CuaCopyWindowAcceptsLeftMouseDown` 参与
  「接受左键按下」的判定。
- 「粘贴没有 app 读取」→ 超时报错而不是成功（`docs/computer-use.md:445-447`）。
- paste 在后台 app 上会触发 `FOREGROUND_REQUIRED`（`docs/computer-use.md:382-385`）——
  剪贴板粘贴路径本质是事件路径。

---

## 6. 安全模型

### 6.1 TCC 权限

- 两个 TCC 能力：**Accessibility** 与 **Screen Recording**（`requestAccess` 返回二者的
  granted/denied/unknown）。
- Helper 以 `NSAppleEventsUsageDescription` 声明 AppleEvents 用途（激活 app 用）；
  Hardened Runtime + TeamID `8A5X4JJ39T` 签名，宿主安装时硬校验（拒绝未钉 TeamID/BuildId 的安装）。
- 权限刷新协议：宿主原子发布 `ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER`（wx+rename），
  Helper 刷新 broker 期间工具返回 `permission_refresh_in_progress`（可重试）/`_invalid`（不可重试）。
- 纪律：权限被拒后**禁止换用其他 UI 自动化技术**（osascript 等）——写在 skill 与文档两处。

### 6.2 socket 信任与对端校验

- 连接 Helper broker 前做 socket stat：uid 必须是自身 euid 或 0，且不可 world-writable
  （`untrusted_socket`）；win32 管道名白名单正则。
- Helper 侧亦有对端校验（日志实证：`cua broker rejected connection: peer verification failed`）；
  ax_native 导出 `PeerCodeSigningSummary`（读取对端代码签名摘要）。
- 放行开关是双环境变量 AND：`ZCODE_CUA_BROKER_ALLOW_ANY_PEER` + `ZCODE_CUA_ALLOW_DEV_BROKER`
  （仅 dev）。宿主还会**剔除**没有 broker env 的可疑 CUA MCP server（`omitUnbrokeredZCodeCuaAgentMcpServers`）。

### 6.3 租约（CONTROLLER_BUSY）与动作防重放

- 另一个活跃的 ZCode Computer Use 会话拥有输入租约时，动作返回 `CONTROLLER_BUSY`：
  **永不重试**，错误 `details.owner` 携带占用者，要求模型报告并请用户关闭该会话。
- `dispatch_status`（收据字段）：`sent` / `possibly_sent` / `not_sent`。
  `possibly_sent` ⇒ `ComputerUseError.actionSent=true` ⇒ `retry:"reobserve"`——
  非幂等动作只有 `actionSent===false` 才允许重放。
- broker 响应丢失被显式建模为 `broker_response_ambiguous`（"The Helper may have accepted this
  action, but its response was lost. Do not replay it automatically"），且 `retryable=false`。

### 6.4 kill switch 与分层熔断

- `stop_computer_control` / `stop()` → `KillSwitch.stop(reason)` 闩锁（保留第一个 reason）；
  此后每个工具入口 `ensureRunning()` 抛 `ControlStopped`，在任何 backend 读取**之前**生效。
- `request_access` 与 `stop_computer_control` 豁免预检（否则无法报告状态/停止）。
- 遥测终态含 `kill_switch_latched` / `controller_busy` / `subagent_unavailable`。

### 6.5 fail-closed 校验清单

| 校验 | 失败行为 |
|---|---|
| 观察收据缺 `state_id/elements/app/window` 任一 | `STRUCTURED_STATE_UNAVAILABLE`，消息列明缺哪些字段（禁止从散文猜 state_id） |
| 元素索引解析时无新鲜观察 | `STALE_STATE`（要求先 getAXState） |
| 消失的元素 | `ELEMENT_UNAVAILABLE`（fail-closed，不静默） |
| 帧过期/被替换/非可动作 | FrameRegistryError（`action_sent=false`） |
| app_ref 与帧真实 owner 不一致 | `frame_dispatch_identity_mismatch` |
| window_id 无法解析而 Helper 降级 | SDK 抛 `STALE_STATE`（不信 note） |
| 参数 schema | `unrecognized_keys` / 类型拒绝（boolean 冒充 number 有专门错误文案） |
| 一次栅格都没有 | "no actionable frame is available in this transport" |

### 6.6 子代理禁用

`runtime_scope === "subagent"` 的请求在桥接层直接抛错（Browser/CUA 同），工具层再兜一道
（`SUBAGENT_COMPUTER_USE_UNAVAILABLE`）——对应 SKILL 的「Main agent only. Never delegate
Computer Use to a subagent.」

---

## 7. 错误码全景

SDK 错误码（`ERROR_CODE_BY_BROKER` 映射 + 本地判定，`computer-use-client.mjs:77-131`）：

```
PERMISSION_DENIED   NOT_AUTHORIZED    APP_NOT_FOUND     AMBIGUOUS_APP
LAUNCH_FAILED       INVALID_APP       ELEMENT_UNAVAILABLE  STALE_STATE
NOT_SETTABLE        NOT_SELECTABLE    ACTION_UNAVAILABLE   FOREGROUND_REQUIRED
CONTROLLER_BUSY     CONTROL_STOPPED   SCREEN_LOCKED     HELPER_UNAVAILABLE
VERSION_MISMATCH    TIMEOUT           STRUCTURED_STATE_UNAVAILABLE  INTERNAL
```

值得注意的映射细节：`invalid_request→INVALID_APP`、`stale_socket→HELPER_UNAVAILABLE`、
`unimplemented→ACTION_UNAVAILABLE`、`method_not_found→INTERNAL`；未知 broker 码一律 `INTERNAL`
（绝不静默成功）。`HELPER_UNAVAILABLE` 还承载「Helper 未装好/签名不符」类安装故障。

`ComputerUseError` 附加字段：`actionSent`（bool，默认 false——保守方向）、`dispatchStatus`、
`details`（frozen，含 method/brokerCode/owner…）、`retry`（"reobserve"/"retry"/"never"）。

Helper not-ready 重试表（SDK 侧）：退避 `[250,500,750,1000,1500]ms`，最多 6 次尝试。

---

## 8. 与 Codex @oai/cua@0.2.4（tinysky_alt）的对齐关系

依据 SDK 头注释自述（`computer-use-client.mjs:1-23`）与各处对齐注释：

**逐字同构（R1）**
- `Target` 12 成员的名字、位置参数序、选项键名、返回类型；
- `cua.computer` 逃逸口角色与 14 工具入参 schema；
- 观察/动作的展示契约（观察自行展示、动作静默 void）；
- `getApp` 绑定即观察（含不展示树的行为差异，见下）。

**有意分歧**
1. **命名空间**：Codex 裸 `cua` 全局 → ZCode `agent.computerUse`（与 `agent.browsers`/
   `agent.documentation` 并列）。
2. **Worker 短命**：Codex kernel 持久、`const app` 跨 cell；ZCode 每 cell 重建绑定，
   state/frame/diff 基线由 shared host 会话持有。getApp「绑定即展示」的行为照抄了 Codex
   但前提不成立，已在 2026-09-13 改为不展示（注释详述 token 浪费与索引漂移事故）。
3. **actionSent 语义**：Codex 动作全是 `Promise<void>`（丢失「可能已下发」信息）；
   ZCode 失败抛 `ComputerUseError` 携带 `actionSent`，事故驱动设计。
4. **窗口寻址**：Codex 按平台分裂（macOS 无窗口寻址、Windows 有 window2 面）；
   ZCode 三平台统一，窗口寻址放逃逸口 `list_windows` + 未文档化 `getWindow`。
5. **不融合 Browser**：`Target` 只被 App 实现；`State` 没有 `browsers` 键。
6. **附加能力只进选项袋**（R2）：如 `tree_shown_to_model`、`disable_diffing`、`return_state`、
   `selectText` 的 prefix/suffix 消歧；`Target` 可枚举附加成员数必须为 0
   （`elements()` 以 `enumerable:false` 存在）。

**保留的安全语义（R3）**：state_id 强校验、frame 精确栅格、possibly_sent 防重放、
controller lease、kill switch——全部保留，改为内部字段或类型化错误。

---

## 9. 可视化反馈子系统（ax_native 里的 PiP 与 Ghost）

从符号表与日志推断的两个非必配子系统（对模型面不可见，属用户体验层）：

- **PiP（画中画）**：`ZcPipController/ZcPipImageView/ZcPipCloseButtonView/ZcPipCompletionBadgeView` +
  `PipStart/PipBeginTurn/PipTaskCompleted/PipFreezeGroup/...` 约 30 个导出。日志事件
  `PiP presentation turn reset applied`（按 sessionId/turnId 复位、`supersededCapture` 标志）表明
  它按会话/回合展示「agent 正在操作的窗口」的画面，任务完成有 badge。含一整套
  `PipSimulate*` 故障注入钩子（`PipSimulateSyntheticAdmissionTimeoutFencing` 等）与
  `PipStartVerified*`（启动前 hit-surface 校验：`PipVerifyInitialHitSurface`、
  `PipSampleInteractionOwnershipAtPoint`）。
- **Ghost 合成光标**：`GhostInit/Show/Hide/Move/ClickRipple/RenderPng/...` + 数据符号
  `_ghost_cursor_move_to` 等——在屏幕上绘制一个「代理光标」与点击涟漪，让用户看清 agent
  在点哪里；`GhostSetCapture` 提示它与截屏管线有交互（合成光标要不要进栅格）。

---

## 10. 实操样例（依据 SKILL/docs 的完整用法）

```js
// 每个 cell 都必须先 bootstrap（与动作同 cell）
const root = process.env.ZCODE_CUA_PLUGIN_ROOT ?? process.env.ZCODE_PLUGIN_ROOT
           ?? process.env.CLAUDE_PLUGIN_ROOT;
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupComputerUseRuntime } = await import(
  pathToFileURL(join(root, "scripts", "computer-use-client.mjs")).href);
await setupComputerUseRuntime({ globals: globalThis });

// 绑定（名字逐字复制用户说法；本地化名会被身份收敛兜住）
const app = await agent.computerUse.getApp({ name: "备忘录" });

// 观察 → 动作 → 观察，批量在一个 cell
await app.getAXState();                    // 整树（绑定后首个观察强制整树）
await app.click(42);                       // 元素索引来自最新观察
await app.setValue(42, "hello");
await app.pressKey("Return");
await app.getAXState();                    // 确认结果可见
```

逃逸口示例：

```js
const wins = await agent.computerUse.computer.list_windows({ app_ref: { name: "Notes" } });
// 单 text block 的 envelope 已被 unwrapEnvelope 解封 → 直接拿裸数组
const app2 = await agent.computerUse.getApp({ pid: wins[1].owner_pid, window_id: wins[1].window_id });
```

错误处理范式（docs 原文）：

```js
try {
  await app.performSecondaryAction(7, "Show Menu");
} catch (e) {
  if (e.code === "ACTION_UNAVAILABLE") await app.getAXState({ disableDiffing: true });
  else if (e.code === "CONTROLLER_BUSY") /* 报告 e.details.owner，停止 */;
  else if (e.actionSent) await app.getAXState();   // 可能已生效，先看
  else throw e;
}
```

---

## 11. 遗留与观察

- `PLATFORM_EXCLUDED_METHODS` 目前为空表但机制保留（注释：下一个平台专属工具直接往里加）。
- `computer.target`（`"mac"|"windows"|"linux"`）表明 SDK 已预备跨平台，但本机只有 darwin
  原生模块；ax_native 的 `ZCodePostKeyboardEventToWindow`、窗口相对点击归一都是 macOS 专属。
- `_meta` 里的 `zcode.cua/app-associations-v1`（上限 384KB）在宿主侧聚合「这次请求碰过的 app」，
  `attachAppAssociationsMeta` 按 `APP_ASSOCIATION_MODE_BY_TOOL` 决定是否附加；NodeReplSession
  的 `recordCuaAppIdentity` 记录主 app 身份——构成 UI 展示「正在操作哪个 app」的数据源。
- `get_app_state` 还支持 `capture_surfaces`（多 surface：attached_dialog / open_panel /
  save_panel / popover，`asSurfaceKind` 白名单），对应对话框/文件面板的复合捕获。
