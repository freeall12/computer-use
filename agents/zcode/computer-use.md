# ZCode Computer Use（桌面控制）· accessibility first，事件只兜底

> 逆向对象：ZCode 桌面 Agent 的 computer use。基线：插件 0.6.3 · node-repl-host 0.6.0 · Helper 3.14.4（buildId pipeline-298526-10bbcea5）。证据见 [evidence/inventory.md](evidence/inventory.md)。

> 一句话结论：**模型只见 skill + `agent.computerUse.*` SDK；14 个 app 级工具经 Worker→宿主 broker→Helper→AX 四跳执行；一切校验 fail-closed，「可能已下发」优先于重试。**

| 项 | 值 |
|---|---|
| 模型可见面 | SKILL.md + `agent.documentation.get("computer-use")` + SDK（`computer-use-client.mjs`，1209 行） |
| 底层工具面 | 14 个存活工具：READ_ONLY 4 · T1_INPUT 9 · SAFETY_CONTROL 1 |
| 执行链 | Worker → in-process broker（znrc-*.sock）→ Helper（Node SEA 111.7MB，懒启动）→ ax_native.node |
| 主观察 | AX 树 delta diff；双基线：Helper 管数据变没变，宿主管模型见没见过 |
| 主动作 / 兜底 | AX 语义动作（AXPress/AXValue…）/ CGEvent（要求目标已在前台，永不抢焦点） |
| 安全模型 | TCC 双权限挂 Helper · CONTROLLER_BUSY 租约 · possibly_sent 防重放 · kill switch · 子代理禁用 |
| 错误面 | 20 个错误码 × 三档重试语义（reobserve/retry/never） |
| 本机可用 | ✅ 日志实证 AX 动作与窗口相对坐标派发（2026-10-05） |

## 架构一图

```
模型 ── SKILL + docs，写 JS；每 cell 全新 Worker（const app 活不过本 cell）
 ▼ mcp__node_repl__js（Symbol.for("zcode.node-repl.computer-use-bridge")）
宿主工具层（node-repl-host 0.6.0）：AccessibilitySession（state/frame/树台账）
  FrameRegistry(16帧+32墓碑) · ActionSettler(300ms~5s) · KillSwitch · 控制器租约
 │ znrc-*.sock + token（请求 1MiB / 响应 32MiB）
 ▼
Helper「ZCode Computer Use.app」（LSUIElement，首次 CUA 调用拉起）
  权限中介 broker.sock（IPC v2，双向对端校验）· snapshotCache(pid,window) diff 基线
  索引→native token 冻结映射 · 合成焦点会话 · 剪贴板借还 · PiP/Ghost 反馈层
 │ NAPI
 ▼
ax_native.node：AX（观察+语义动作）· CGEvent（键盘/指针，窗口相对派发）
  ScreenCaptureKit(weak)+CoreMedia（窗口栅格 + 前后 surface 指纹）
```

## 载体清单

| 组件 | 版本 / 大小 | 角色 |
|---|---|---|
| CUA 插件 | 0.6.3 | SDK + skill + docs（execution 由共享 node_repl host 提供） |
| CUA SDK | computer-use-client.mjs，1209 行 | `agent.computerUse.*` 绑定对象装配 + 全部安全语义 |
| node_repl 宿主 | node-repl-host 0.6.0（server.js 5.0MB） | `js` 工具 + 桥接 + broker 转发 |
| CUA Helper | 3.14.4，主二进制 111.7MB | Node SEA 懒启动；TeamID 8A5X4JJ39T + Hardened Runtime |
| ax_native.node | 986KB | NAPI：AX / CGEvent / ScreenCaptureKit / PiP / Ghost |
| sharp + koffi | libvips 8.17.3 | 宿主侧栅格缩放/裁剪与 FFI |
| 上一代 | zcode-cua 0.5.12 | 独立 25 工具 MCP server（对比用） |

> 演进：0.5.12 屏幕级 25 工具（screenshot/mouse_move/open_application…）→ 0.6.3 app/窗口级 14 工具；`open_application` 2026-09-16 删除，启动并入 `get_app_state` 透明拉起。工具 schema 全文见 `source/zcode/schemas/computer-tools.json`。

## 工具面：14 个工具，三层分级

**推荐面是 SDK 绑定对象**（`getApp` 返回的 `App`：12 成员与 Codex `Target` 逐字同签 + 不可枚举的 `elements()` 逃逸口）；下表是低层工具面（`agent.computerUse.computer.*`），schema 严格（undeclared key 直接拒）。

| 工具 | 层 | 语义要点 |
|---|---|---|
| `list_apps` | READ_ONLY | 运行中 app 清单（pid/name/bundle_id/active） |
| `list_windows` | READ_ONLY | 每窗口 window_id/title/subrole/text_preview/bounds（bounds 仅供诊断，禁止当坐标） |
| `get_app_state` | READ_ONLY | **核心观察**：`{state_id, elements[], text}` + 可选截图（`image_ref` 四键固定文本块）；默认 diff，`disable_diffing` 取整树 |
| `left_click` | T1_INPUT | target 二选一：元素 index 或 `{x,y,frame_id}`；`app_ref` 声明索引作用域 |
| `left_click_drag` | T1_INPUT | 双端 target |
| `scroll` | T1_INPUT | 方向 up/down/left/right；amount 页数 clamp 0–100 |
| `type` | T1_INPUT | 键入文本，可带 target 定位焦点 |
| `set_value` | T1_INPUT | AX 直接设值，优先于打字/粘贴 |
| `select_text` | T1_INPUT | `text_range=[start,length]`；SDK 按内容匹配算 range，多义抛 NOT_SELECTABLE |
| `key` | T1_INPUT | 键/和弦（"Control_L+a"）；repeat 代替循环；hold 上限 30s |
| `paste` | T1_INPUT | 借系统剪贴板 + Cmd+V，**事后还原用户剪贴板**；无 app 读取 → 超时而非假成功 |
| `perform_action` | T1_INPUT | action 只能是元素 `actions` 列表广告过的名字，禁止猜测 |
| `request_access` | READ_ONLY | 返回 accessibility/screenRecording 授权态 |
| `stop_computer_control` | SAFETY | kill switch 闩锁 |

`App` 绑定面成员：`getAXState / getScreenshot / getAXStateAndScreenshot / click / drag / pressKey / scroll / selectText / setValue / typeText / performSecondaryAction / paste` + 不可枚举 `elements()`（静默观察，强制下次整树）。命名空间：`getState / getApp / listApps / computer（逃逸口，freeze）/ requestAccess / stop`；窗口绑定入口 `getWindow` 未文档化。

**绑定流程（getApp）**：① 名字按 bundle id 启发式猜字段，猜错换字段重试一次 → ② 绑定即观察一次（整树但**不展示**、不进台账）→ ③ 用观察结果把 appRef 收敛为 `{pid, bundle_id}`（本地化名只在第一跳解决）→ ④ Helper 静默降级窗口时抛 `STALE_STATE` → ⑤ 挂 `elements()`。

> 事故：getApp 曾照抄 Codex「绑定即展示」，实测 8 cell 中 36% 输出是被作废的前序树（2026-09-13）→ 改为静默绑定。

## 观察：两条基线，各管一件事

**增量观察的正确性靠「数据基线」与「台账基线」分离。**

| 机制 | 归属 | 语义 |
|---|---|---|
| snapshotCache diff 基线 | Helper | 该 pid+窗口的上次捕获；回答「数据有没有变」 |
| `tree_shown_to_model` 台账 | 宿主 | 只登记真正给模型看过的树；增量只相对「见过的树」 |
| `state_id` | 宿主 | 观察收据强校验凭证；元素索引失效判定在 Helper（token 冻结映射） |
| FrameRegistry | 宿主 | 每会话 16 帧 + 32 墓碑；坐标绑定最新 actionable 栅格，过期 fail-closed |
| effect_evidence 寄存 | 宿主 | 动作前指纹 vs 下次观察；`[effect_evidence unchanged]` = AX 受理但界面未变 |
| 树渲染 | SDK | 单层 `index kind name value 旗标 actions`；**bounds 故意不渲染**（防当坐标）；被裁剪索引可从 `elements()` 拿回 |

动作后观察走 ActionSettler：300ms 起步，树指纹连续两次一致或撞 5s 上限才返回；模型主动观察只捕获一次。

> 事故：Helper 的 diff 基线不区分发起者，「模型没见过的树」也能当增量基线——飞书 930 元素只吐 8 行抖动（2026-09-13 会话）→ 补 `tree_shown_to_model` 台账。

## 动作：AX 语义优先，event 兜底且不抢焦点

| 路径 | 行为 |
|---|---|
| `strategy:"auto"`（默认） | 元素语义动作（AXPress/AXValue/AXSelectedTextRange…）：语义精确、后台可用、不抢焦点 |
| `strategy:"event"` | CGEvent 合成事件，**要求目标已在前台**，否则拒 `FOREGROUND_REQUIRED` 且什么都不发 |
| 坐标点击 | Helper 内归一为「窗口相对派发」：pid + bundle_id + window_id + 窗口 bounds + 窗口内坐标（日志实证），非全局屏幕点击 |
| 后台键盘 | `*_to_app` 走合成焦点会话；焦点设置失败不影响动作受理上报（受理与生效分离） |
| paste | 系统剪贴板借还；本质是事件路径，后台 app 触发 FOREGROUND_REQUIRED |

已知失效模式：某些 app 忽略合成事件坐标、按真实指针位置响应——观察以 `[effect_evidence unchanged]` 标注，纪律是**禁止重复同一坐标**，改走元素/键盘。

## 安全：五道闸 + fail-closed 清单

| 闸 | 机制 |
|---|---|
| TCC 权限 | Accessibility + Screen Recording 只挂 Helper；权限刷新期间返回可重试错误；被拒后**禁止换用** osascript 等其他 UI 自动化（skill 与文档两处写明） |
| socket 信任 | stat 校验 uid=euid/0 且不可 world-writable；Helper 侧对端校验（日志有拒绝记录）；放行需 `ZCODE_CUA_BROKER_ALLOW_ANY_PEER` + `ZCODE_CUA_ALLOW_DEV_BROKER` 双 env AND |
| 控制器租约 | 另一会话占用输入 → `CONTROLLER_BUSY` 永不重试，`details.owner` 要求报告用户 |
| 防重放 | `dispatch_status=possibly_sent` → `actionSent=true` → 只许「先观察再决定」；broker 响应丢失 = `broker_response_ambiguous`（不可自动重试） |
| kill switch | `stop_computer_control` 闩锁后所有工具入口 fail-hard；仅 `request_access` 与其自身豁免预检 |

fail-closed 校验清单（失败一律报错，不静默、不猜测）：

| 失败 | 错误 |
|---|---|
| 观察收据缺 state_id/elements/app/window | STRUCTURED_STATE_UNAVAILABLE |
| 元素索引无新鲜观察 / 元素已消失 | STALE_STATE / ELEMENT_UNAVAILABLE |
| 帧过期·被替换·非可动作 | FrameRegistryError（`action_sent=false`） |
| app_ref 与帧真实 owner 不一致 | frame_dispatch_identity_mismatch |
| Helper 降级窗口 / 参数 schema 违规 | STALE_STATE / unrecognized_keys |
| 一次栅格都没有 | "no actionable frame …" |

## 错误码与重试

**20 个错误码，未知 broker 码一律 `INTERNAL`（绝不静默成功）。** 重试三档：REOBSERVE（ELEMENT_UNAVAILABLE/STALE_STATE/STRUCTURED_STATE_UNAVAILABLE）、NEVER_RETRY（CONTROLLER_BUSY/CONTROL_STOPPED/PERMISSION_DENIED 等 8 码）、其余 retry。`ComputerUseError` 附带 `actionSent`（默认 false，故意保守）与 `retry` 字段。Helper 冷启动 `CUA_NOT_READY` 退避 [250,500,750,1000,1500]ms，最多 6 次。

## 与 Codex @oai/cua@0.2.4 的关系

| 维度 | 结论 |
|---|---|
| 逐字同构（R1） | Target 12 成员名/参数序/选项键；`cua.computer` 逃逸口与 14 工具 schema；观察自行展示、动作静默 void |
| 有意分歧 | 命名空间 `cua`→`agent.computerUse`；Worker 短命（Codex kernel 持久）；动作带 `actionSent`（Codex 是 Promise<void>）；窗口寻址三平台统一；不融合 Browser；附加能力只进选项袋（R2） |
| 安全语义（R3） | state_id 强校验、帧精确栅格、possibly_sent 防重放、controller lease、kill switch——全部保留，改为内部字段或类型化错误 |

原始面对照见 [codex 分册 computer-use.md](../codex/computer-use.md)。

> ax_native 另含 PiP 画中画与 Ghost 合成光标两个可视化子系统：按 session/turn 复位，让用户看清 agent 在点哪里；触发策略未见源码（符号表 evidence §2.14）。

## 实操样例

```js
// 每 cell 先 bootstrap（与动作同 cell）
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupComputerUseRuntime } = await import(pathToFileURL(
  join(process.env.ZCODE_PLUGIN_ROOT, "scripts", "computer-use-client.mjs")).href);
await setupComputerUseRuntime({ globals: globalThis });

const app = await agent.computerUse.getApp({ name: "备忘录" }); // 名字逐字复制用户说法
await app.getAXState();      // 绑定后首个观察强制整树
await app.click(42);         // 元素索引来自最新观察
await app.setValue(42, "hello");
await app.pressKey("Return");
await app.getAXState();      // 确认结果

// 错误处理范式（docs 原文）
try { await app.performSecondaryAction(7, "Show Menu"); }
catch (e) {
  if (e.code === "ACTION_UNAVAILABLE") await app.getAXState({ disableDiffing: true });
  else if (e.code === "CONTROLLER_BUSY") /* 报告 e.details.owner，停止 */;
  else if (e.actionSent) await app.getAXState();  // 可能已生效，先看
  else throw e;
}
```

> 遗留：`PLATFORM_EXCLUDED_METHODS` 空表但机制保留；`computer.target` 已备跨平台但本机仅 darwin 原生模块；`get_app_state` 支持 `capture_surfaces` 复合捕获（attached_dialog/open_panel/save_panel/popover）。
