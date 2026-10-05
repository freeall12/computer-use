# Synara Computer Use（桌面控制）逆向

判定：**有完整桌面控制能力**（截图观察 + 键鼠注入 + Accessibility 语义读写），引擎为第三方开源 Cua AI 的 `cua-driver`（Synara 打补丁版），由 Electron 主进程作为特权宿主托管，其上覆盖了一套多层授权与"人接管"安全模型。置信度：高。

## 1. 引擎载体

| 项 | 值 | 证据 |
|---|---|---|
| 引擎 | cua-driver v0.28.2（Rust，arm64，33MB） | `Contents/Resources/cua-driver/cua-driver`；`provenance.json` |
| 上游 | Cua AI, Inc.（MIT，`Copyright (c) 2025 Cua AI, Inc.`） | `Contents/Resources/cua-driver/LICENSE.txt` |
| 补丁 | `"patched": true`，patchSha256 `e3fde7d0…`，`nativeRevision: 39`，上游 commit `7fe7c33f…` | `provenance.json:6-7` |
| 宿主进程 | Electron 主进程内嵌模块 `cuaDriverHostStandalone.js`（112KB，`#!/usr/bin/env bun`） | `apps/desktop/dist-electron/cuaDriverHostStandalone.js:1` |
| 辅助进程 | `Contents/Helpers/synara-appsnap-helper`（Swift，462KB）：预览帧流、物理 Escape 监听、按键释放 | 二进制 strings：`--computer-frames`、`--escape-monitor`、`--release-held-input` |

`cua-driver` 原生能力字符串（节选自二进制 strings，均为引擎自带）：

- 输入注入：`CGEvent::new failed`、`CGEvent::new_mouse_event(up/down) failed`、`CGEventCreateScrollWheelEvent2 failed`、`CGEventSetWindowLocation`、`cgevent_hid`
- 屏幕观察：`ScreenCaptureKitBridge`、`cua-sck-window-capture`、`ScreenCaptureKit capture already in flight`
- 语义层：`AXShowMenu`、`AXRole`、`ax_capability`、`tcc_accessibility`、`tcc_screen_recording`，以及跨平台对应物 `ax_capability (via UIA)`、`(via AT-SPI)`、`screen_capture_capability (via DXGI/X11)`
- 投递模式：`delivery_mode:"foreground"` / background；`type_text` 的 UIA 读回校验；点击前截图 marker 与 `evidence.json` 取证机制
- 守护进程：`com.trycua.driver`、`--permission-mode standard|bounded|unrestricted`

## 2. 进程与传输模型

主进程 spawn 引擎（main.js:1601-1636 节选）：

```
cua-driver serve --embedded --socket <dir>/driver-<uuid>.sock
  [--compact-cursor --idle-hide-ms <ms>]        # patched 版才追加
env: CUA_DRIVER_EMBEDDED=1
     CUA_DRIVER_HOST_BUNDLE_ID=com.emanueledipietro.synara
     CUA_DRIVER_PERMISSION_MODE=standard
     CUA_DRIVER_RS_TELEMETRY_ENABLED=0
     CUA_DRIVER_RS_UPDATE_CHECK=0
     CUA_DRIVER_PARENT_LIVENESS_STDIN=1
     CUA_DRIVER_EMBEDDED_HOST_PID=<主进程 pid>
     SYNARA_CUA_FOREGROUND_OBSERVATION_MS=100
     SYNARA_CUA_BACKGROUND_OBSERVATION_MS=350
```

- **传输**：本机 Unix domain socket（Windows 为命名管道 `\\.\pipe\synara-cua-driver-*`），请求形如 `{method:"call", name, args, modelObservation, deliveryMode, task}`（main.js:957、1122）。启动时经 `metadata` 握手校验 `synara_native_revision`（main.js:1691 附近），版本不符拒绝使用——这是"Synara 补丁版专用"的强校验。
- **孤儿清理**：主进程启动时扫描进程表，凡命令行匹配 `cua-driver serve --embedded` 且 `CUA_DRIVER_EMBEDDED_HOST_PID` 已死的一律 kill（main.js:652-674），防止残留的注入引擎悬空运行。
- **生命周期**：socket 路径每次随机 UUID；host 关闭/换代时 retire 整个 generation。
- **观测节奏**：前台任务 100ms、后台任务 350ms 一帧（环境变量见上），帧流经 appsnap-helper `--computer-frames` 供 UI 预览（"frame tap"绑定到任务窗口，main.js:276-279 注释）。

## 3. 工具面（宿主侧全集，main.js:233-307）

**读工具（CUA_READ_TOOLS，14 项）**：`check_permissions`、`check_input_ready`、`list_windows`、`list_spaces`、`list_apps`、`get_window_state`、`get_screen_size`、`get_desktop_state`、`get_accessibility_tree`、`get_agent_cursor_state`、`get_cursor_position`、`verify_state`、`wait_for_settle`、`zoom`

**动作工具（CUA_ACTION_TOOLS，18 项）**：`click`、`move_cursor`、`drag`、`scroll`、`type_text`、`press_key`、`hotkey`、`set_value`、`select_text`、`clipboard_read`、`clipboard_write`、`launch_app`、`bring_to_front`、`invoke_menu`、`set_window_frame`、`set_window_minimized`、`set_app_visibility`、`kill_app`

**浏览器工具（CUA_BROWSER_TOOLS，9 项，见 browser-use.md）**

暴露给 LLM 的网关工具名做了 `computer_` 前缀映射（server index.mjs），且动作全集扩展为 20 项批准工具（index.mjs:19635-19656）：`computer_click`、`computer_move_cursor`、`computer_drag`、`computer_scroll`、`computer_type_text`、`computer_press_key`、`computer_paste`、`computer_perform_action`、`computer_select_text`、`computer_set_value`、`computer_read_clipboard`、`computer_write_clipboard`、`computer_run`、`computer_launch_app`、`computer_activate_window`、`computer_set_window_frame`、`computer_invoke_menu`、`computer_kill_app`、`computer_set_window_minimized`、`computer_set_app_visibility`。读侧另有 `computer_get_state / computer_list_windows / computer_list_apps / computer_screenshot / computer_get_screen_size / computer_get_accessibility_tree / computer_get_cursor_position / computer_verify_state / computer_wait / computer_zoom / computer_spaces / computer_inspect / computer_help`。

## 4. 观察机制

- **像素观察**：ScreenCaptureKit 按窗口捕获（`cua-sck-window-capture`），支持 `zoom`（局部放大读图）与 `verify_state`（动作后状态复核）。引擎内置点击取证：派发坐标输入前留 `click_source.png`，回填 `evidence.json` 记录 `click.source_image`（cua-driver strings）。
- **结构观察**：完整 Accessibility 树（`get_accessibility_tree`），元素带稳定引用，供 `set_value`/`select_text`/元素寻址点击做"语义目标"。命中校验严格：字符串如 `Logical coordinates require exact finite window bounds…`、`stale_geometry`、`the ref's frame identity cannot be re-proven`（cua-driver strings）表明每次动作前都重验窗口/元素几何。
- **权限探针**：`check_permissions` 区分 `bundle_identity, tcc_accessibility, tcc_screen_recording`，并能区分 ad-hoc 签名（TCC 授权随 cdhash 失效）与 Developer ID 签名（main.js:14937 附近注释，签名类型决定"陈旧授权"提示是否可信）。

## 5. 动作机制与投递模式

- **前台（foreground）投递**：真实 CGEvent 键鼠（占用系统光标/键盘），`type_text` 前台模式不支持部分字符；引擎会在点击前对窗口做"marker 渲染 + 帧比对"确认点击落点。
- **后台（background）投递**：走 Accessibility 通路（AXPress / 语义 set_value / select_text），不抢焦点、不打扰人。关键约束（main.js:334-337 注释原文）："`deliveryMode` is trusted host-envelope metadata from the server's existing visible-use authorizer, never a native argument or a model-supplied override"——**模型无法自行声明前台模式**，只能由服务端的用户意图分析授予。
- **不可取消窗口操作**单列：`launch_app`、`bring_to_front`、`set_window_frame`、`invoke_menu` 被标记为 UNCANCELLABLE_WINDOW_TOOLS（main.js:316-321），在输入中断/暂停期间拒绝派发，避免"停不下来的窗口操作"。
- **动作在途即 epoch**：每次原生输入派发推进 `nativeInputEpoch`，人接管或暂停后 epoch 变化，旧在途结果按"已派发-效果未知"上报（main.js:298-307 对浏览器同型设计）。

## 6. 安全模型（多层）

1. **能力域闸门**：计算机控制要求 `computer:control` 能力；"Threads cannot delegate computer control to tasks they create."（index.mjs:7181-7182）——主线程不能把桌面控制权下放给自己派生的子任务。
2. **OS 授权三件套**：`accessibility`（输入+语义读）、`screenRecording`（图像）、`inputMonitoring`（物理 Escape 与接管监听）（main.js:14918-14927）。Info.plist 对应声明：`NSAccessibilityUsageDescription = "Synara controls the windows you authorize for Computer use."`、`NSScreenCaptureUsageDescription = "Synara captures the windows you authorize for Computer use."`
3. **可见使用授权（foreground consent）**：index.mjs:2820-2964 `computerVisibleUse.ts`。要点：
   - 用户消息必须显式出现"可见使用"意图（英文+意大利语正则族，如 `show me…`、`let me watch you…`、`bring … to the front`、`take over my screen/desktop/computer`），引用块/代码块/引号内文本先剥离，防止页面注入文本骗授权；
   - 后台倾向短语（`don't show…`、`keep … background`）直接否决前台；
   - 助手提问 + 用户肯定回答（yes/sì/…）或结构化批准卡答案亦可授予；
   - 授权只沿"例行继续"（continue/keep going 等）存续，任何新指令、拒绝或非人来源消息都是授权屏障（"a later 'continue' cannot recover consent from an unrelated historical task"）；
   - 未授权时的拒绝码：`foreground_not_requested`；用户 2 秒内操作过桌面则 `foreground_user_interaction`（index.mjs:2835）。
4. **Space 指定**：把任务固定到指定 macOS 空间需用户整句显式写出 `use the space id N for this task`（index.mjs:2967-2987），Mission Control 布局、引号示例、provider 输出一律无效。
5. **人接管（human takeover）**：输入监听（Input Monitoring）检测到物理键鼠时——仅当 Agent 正有前台动作在途才打断它；后台控制刻意不被人输入打断（main.js:2037-2043 注释："Background control shares the Mac with the human: their typing, clicks and app switches never pause it"）。打断后置 `takeoverTargets`，要求重新观察并确认状态新鲜后才恢复派发。
6. **物理 Escape 急停**：appsnap-helper `--escape-monitor` 专职进程，仅在存在活跃 driver generation 时武装（main.js:2083-2094）；触发 `emergency interrupt` + 输入冷却窗（`ESCAPE_INPUT_COOLDOWN_MS`）。用户 Stop 撤销本轮授权但不撤销 OS 授权（main.js:2098）。
7. **activation shield**：前台动作前可在目标窗口矩形上盖一层"激活护盾"面板（`{method:"shield", action:"engage|release|release_all", frame, window_id, pid}`，cuaDriverHostStandalone.js:29-70、main.js:1138-1180），engage 本身受准入门控（桌面暂停时拒绝），用于防止 Agent 误点到目标窗口下的系统 UI；panel 由 helper 进程持有（main.js:1142 注释 "the helper owns the panels"）。
8. **Agent 光标**：patched 驱动提供 `--compact-cursor --idle-hide-ms`（合成光标标记 Agent 正在操作的位置，空闲自动隐藏），相关 stderr 事件 `synara_cua_overlay_init` / `synara_cua_focus_restore`（main.js:1653-1661）。
9. **审批与审计**：上述 20 个变更类工具全部要求用户批准；本地审计日志记录所有批准类工具调用 + `computer_read_clipboard`（唯一能"读出隐私载荷"的读工具，index.mjs:19660 附近注释："the log exists for abuse review"）。
10. **Linux 准入降级**：同构代码里对 Linux 平台大量保留路由（后台键鼠、窗口管理、浏览器变更等一律结构化拒绝，main.js:339-361），理由是"无法保证取消清理/不打扰人"——侧面说明安全模型以 macOS 实现为准入基准。

## 7. 引擎自带而 Synara 未走的面（记录用）

cua-driver 二进制还包含：独立 CLI（`mcp/list-tools/call/serve/stop/revoke/status/config/telemetry/recording/doctor/permissions/autostart/skills/channel/sessions/history`）、自带 MCP server、`standard|bounded|unrestricted` 守护授权模式、加密"Computer History"预览、以及面向 `claude, codex, cursor, hermes, antigravity, openclaw, opencode, pi, prime-agent, qwen, droid, zcode` 等 CLI 的 skill pack 安装器。Synara 以 `--embedded` 模式只用其工具调用面，遥测与自更新被环境变量关闭；这些外部面是否可用未验证（推断：embedded 模式下不暴露守护进程，无 socket 时 `call` 会失败）。

## 8. 置信度与待复核

- 引擎身份、工具全集、传输方式、授权/接管模型：**高**（直接来自解包 JS 与随包文件）。
- activation shield 的实际渲染形态（浮窗/遮罩视觉）：**低**——只有协议证据，未运行验证。
- `--computer-frames` 帧流协议细节：**低**（helper 二进制 strings 有入口，未逆向帧格式）。
- cua-driver 补丁内容（相对上游改了什么）：**中低**——有 patchSha256 与 nativeRevision 校验机制，但补丁本身未逐条复原；从宿主逻辑看补丁至少涉及合成光标（`--compact-cursor`）、`synara_native_revision` 握手与 `browser_input_control` 取消清理。
