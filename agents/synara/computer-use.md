# Synara：Computer Use —— 打补丁的开源 cua-driver + 十层授权/接管安全模型

> 基线：`/Applications/Synara.app` 0.9.2 静态解包（/tmp/synara-analysis）。判定：**有完整桌面控制能力（截图观察 + 键鼠注入 + AX 语义读写），置信度高。**
> 33 网关工具全名单：[source/synara/schemas/gateway-computer-tools.json](../../source/synara/schemas/gateway-computer-tools.json)；证据：[evidence/inventory.md](evidence/inventory.md) §B。

## 速览

**引擎 = cua-driver v0.28.2（Rust，Cua AI MIT，`"patched": true`），被 Electron 主进程以 Unix socket RPC 托管；注入走 CGEvent，观察走 ScreenCaptureKit + AX；宿主在其上实现前台授权正则、人接管与急停。**

| 组件 | 事实 |
|---|---|
| 引擎 | `Contents/Resources/cua-driver/cua-driver`（arm64，33MB；provenance.json：nativeRevision 39，patchSha256 `e3fde7d0…`，上游 commit `7fe7c33f…`） |
| 宿主 | 主进程内嵌 `cuaDriverHostStandalone.js`（112KB）spawn 并托管 |
| 辅助进程 | `synara-appsnap-helper`（Swift）：预览帧流、物理 Escape 监听、按键释放 |
| 传输 | 随机命名 Unix socket `driver-<uuid>.sock`（Windows 命名管道）；请求 `{method:"call", name, args, modelObservation, deliveryMode, task}` |
| 版本强校验 | 启动 metadata 握手校验 `synara_native_revision`，不符拒绝使用（Synara 补丁版专用） |
| 孤儿清理 | 主进程启动扫描进程表，宿主 pid 已死的 `cua-driver serve --embedded` 一律 kill |
| 观察节奏 | 前台任务 100ms、后台 350ms 一帧（env 注入）；帧流经 appsnap-helper 供 UI 预览 |

## 架构一图

```
Electron 主进程 spawn：cua-driver serve --embedded --socket driver-<uuid>.sock
  env：CUA_DRIVER_EMBEDDED=1 · PERMISSION_MODE=standard · 遥测/自更新=0 · 节奏 100/350ms
   │  Unix socket RPC：{method:"call", name, args, deliveryMode, task}
   │  metadata 握手校验 synara_native_revision（补丁版专用，不符拒绝）
   ├─ cua-driver 0.28.2（patched Rust）→ CGEvent 注入 · ScreenCaptureKit 截屏 · AX 语义
   └─ appsnap-helper（Swift）：预览帧流 · 物理 Escape 监听 · 按键释放
  孤儿清理：主进程启动扫描，宿主 pid 已死的 embedded driver 一律 kill
```

## 工具面：33 个网关工具，读免批准、变更逐个批准

**宿主引擎侧为 14 读 + 18 动作 + 9 浏览器（浏览器见 browser-use.md）；暴露给 LLM 时做 `computer_` 前缀映射，动作面扩展为 20 项批准工具。**

### 读工具（13，免批准）

| 语义域 | 工具 |
|---|---|
| 应用/窗口/空间枚举 | computer_list_apps · computer_list_windows · computer_spaces |
| 像素观察 | computer_screenshot · computer_get_screen_size · computer_zoom（局部放大读图） |
| 状态观察 | computer_get_state · computer_get_accessibility_tree（完整 AX 树，元素带稳定引用） |
| 光标/等待/复核 | computer_get_cursor_position · computer_wait · computer_verify_state |
| 自省 | computer_inspect · computer_help |

变更侧的 `computer_read_clipboard` 是唯一能"读出隐私载荷"的工具，被强制写入审计日志（代码注释："the log exists for abuse review"）。

### 变更工具（20，全部需用户批准）

| 语义域 | 工具 |
|---|---|
| 键鼠注入 | computer_click · computer_move_cursor · computer_drag · computer_scroll |
| 文本 | computer_type_text · computer_paste · computer_perform_action · computer_select_text · computer_set_value |
| 按键 | computer_press_key |
| 剪贴板 | computer_read_clipboard · computer_write_clipboard |
| 进程/窗口管理 | computer_run · computer_launch_app · computer_activate_window · computer_set_window_frame · computer_invoke_menu · computer_kill_app · computer_set_window_minimized · computer_set_app_visibility |

## 观察机制：像素 + 结构双通道，动作前强制重验几何

- ScreenCaptureKit 按窗口捕获；`zoom` 局部放大、`verify_state` 动作后复核。引擎内置点击取证：坐标输入前留 `click_source.png`，回填 `evidence.json` 记录 `click.source_image`。
- AX 树元素带稳定引用，供 set_value/select_text/元素寻址点击做语义目标；每次动作前重验窗口/元素几何（`stale_geometry`、`the ref's frame identity cannot be re-proven`）。
- `check_permissions` 区分 accessibility / screenRecording / bundle_identity，并能识别 ad-hoc 签名（TCC 授权随 cdhash 失效）与 Developer ID 签名。

## 动作机制：前台 CGEvent / 后台 AX，模型不可自选路由

| 规则 | 事实 |
|---|---|
| 前台投递 | 真实 CGEvent 键鼠（占系统光标/键盘）；点击前对窗口做 marker 渲染+帧比对确认落点 |
| 后台投递 | AX 通路（AXPress / 语义 set_value / select_text），不抢焦点、不打扰人 |
| deliveryMode 归属 | **宿主信封元数据**，原文 "never a native argument or a model-supplied override"——模型无法自行声明前台模式，只能由服务端用户意图分析授予 |
| 不可取消窗口操作 | launch_app/bring_to_front/set_window_frame/invoke_menu 标记 UNCANCELLABLE，输入中断/暂停期间拒绝派发 |
| 在途即 epoch | 每次原生输入派发推进 `nativeInputEpoch`；人接管/暂停后旧在途结果按"已派发-效果未知"上报 |

## 安全模型：十层

| # | 层 | 机制 |
|---|---|---|
| 1 | 能力域闸门 | 需 `computer:control` 能力；线程不得把桌面控制下放给自己派生的子任务 |
| 2 | OS 授权三件套 | accessibility + screenRecording + inputMonitoring（物理 Escape 与接管监听） |
| 3 | 前台可见使用授权 | `computerVisibleUse` 正则引擎（见下） |
| 4 | Space 指定 | 任务固定到指定 macOS 空间需用户整句写出 `use the space id N for this task`；布局/引号示例/provider 输出一律无效 |
| 5 | 人接管 | 物理键鼠仅在 Agent 前台动作在途时打断；后台控制刻意不受人输入影响；打断后须重新观察确认状态新鲜再恢复 |
| 6 | 物理 Escape 急停 | appsnap-helper `--escape-monitor` 专职进程（仅活跃 generation 时武装）；触发急停 + 输入冷却窗；用户 Stop 撤销本轮授权但不撤销 OS 授权 |
| 7 | activation shield | 前台动作前可在目标窗口矩形盖"激活护盾"面板（engage/release/release_all），防误点窗口下的系统 UI；panel 由 helper 进程持有 |
| 8 | Agent 光标 | patched 驱动 `--compact-cursor --idle-hide-ms` 合成光标标记操作位置，空闲自动隐藏 |
| 9 | 审批与审计 | 20 变更工具逐个批准；审计日志记录全部批准类调用 + computer_read_clipboard |
| 10 | Linux 准入降级 | 后台键鼠/窗口管理/浏览器变更在 Linux 一律结构化拒绝（无法保证取消清理）——安全模型以 macOS 为准入基准 |

**前台授权（第 3 层）怎么给**：用户消息须显式出现"可见使用"意图（英/意正则族，如 `show me…`、`take over my screen`，代码块/引号内文本先剥离防注入）；后台倾向短语（`don't show…`）直接否决；助手追问 + 肯定回答或批准卡亦可授予；授权只沿"例行继续"存续，新指令/拒绝/非人来源即屏障；未授权拒绝码 `foreground_not_requested`，用户 2 秒内操作过桌面则 `foreground_user_interaction`。

## 引擎自带而 Synara 未走的面

cua-driver 二进制还带独立 CLI、自带 MCP server、守护授权模式（standard|bounded|unrestricted）、加密 Computer History、面向 claude/codex/cursor/zcode 等的 skill pack 安装器；Synara 仅用 `--embedded` 工具调用面，遥测与自更新被 env 关闭（`CUA_DRIVER_RS_TELEMETRY_ENABLED=0`）。

## 置信度

高：引擎身份、工具全集、传输、授权/接管模型（解包 JS 直读）。低：activation shield 渲染形态、帧流协议细节（仅协议/strings 证据）。中低：补丁具体差异未逐条复原（至少涉及合成光标、`synara_native_revision` 握手、浏览器取消清理）。
