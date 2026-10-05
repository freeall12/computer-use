# MiniMax Code — Computer Use（原生桌面控制）完整逆向

> 证据基线：app.asar 解包目录 `/tmp/mm-asar`（原始路径 `/Applications/MiniMax Code.app/Contents/Resources/app.asar`，406 MB，版本 3.1.0）。以下所有相对路径均以 `/tmp/mm-asar/` 为根。

## 1. 结论速览

- **本地驱动，非云端**。CU = Electron 主进程门面（`dist/main/modules/local-runtime/computer-use/`）+ 独立 utility process（服务名 `mavis-cua`）+ **`@trycua/cua-driver` 0.22.1**（开源 trycua/cua 的 Rust/UniFFI SDK，MIT，仓库 `github.com/trycua/cua`）。云上只有 LLM/编排，观察与动作全部发生在本机。
- 工具面 **17 个 `computer_*`** 工具，由 `@mavis/local-runtime-v2/src/service/computer-use/tools.ts` 以 "facade 工具名 → CUA 驱动工具名" 的映射生成（映射表在 `dist/main/modules/local-runtime/computer-use/cua-utility-server.js` 的 `mapRequestToCuaTool`）。
- macOS 上动作有两条交付路由：**background**（AX/UIA 可访问性注入，不抢焦点）为默认；**foreground**（HID 事件 + 抢焦点）需事先向用户公告。工具描述里直接写入了 "CUA 0.22.1 在 macOS 仅支持 foreground drag" 等驱动级已知限制。
- 安全模型四层：**macOS TCC 双权限**（屏幕录制 + 辅助功能）→ **插件准入**（官方插件 `computer-use` 的 Host Binding）→ **单会话控制租约（lease）** → **提示层安全示能**（桌面遮罩条 + 停止按钮 + 指针动画 + 窗口移交）。

## 2. 能力载体清单

| 组件 | 绝对路径 | 版本/说明 |
| --- | --- | --- |
| CUA 驱动 SDK | `node_modules/@trycua/cua-driver/`（dist/index.js、electron.js、embedded.js） | 0.22.1，MIT，Rust/UniFFI，依赖 `@ubjs/core`/`@ubjs/node` |
| 驱动原生库 | `node_modules/@trycua/cua-driver-darwin-arm64` / `-darwin-x64` | 0.22.1（平台 optionalDependencies） |
| CUA utility 入口 | `dist/main/modules/local-runtime/computer-use/cua-entry.js` → `cua-utility-server.js`（1191 行） | `utilityProcess.fork`，serviceName `mavis-cua`，macOS 下 `execArgv:['--message-loop-type-ui']`（服务原生 run loop） |
| 宿主门面 | `dist/main/modules/local-runtime/computer-use/index.js`（386 行） | lifecycle、MessagePort、generation fencing、UI 示能 |
| 运行时服务 | `node_modules/@mavis/local-runtime-v2/src/service/computer-use/`（client/tools/state/initialize/session-selection） | 工具目录与能力门 |
| 官方插件 | `~/.minimax/v2/plugin-cache/official/sha256-tree-v1-b9fdb15…/` | name `computer-use`，displayName 电脑操控，v1.0.1，hostBindings: `bindings/computer.binding.json`，skills: `skills/computer-use/SKILL.md` |
| 权限 IPC | `dist/main/ipc/cuPermission.ipc.js` + `dist/main/modules/screenshot/permission.js` | STATUS / REQUEST / OPEN_SETTINGS 三通道 |
| 日志 | `dist/main/utils/computer-use-log-writer.js` | CU 专用 5MB×4 轮转 JSONL 日志 |

工具名前缀约定（`@mavis/agent-tools/src/desktop/canonical-tool-policy.ts`）：*"Computer-use tools share the computer_* namespace across native and MCP paths"* —— 原生与 MCP 两条路径共用 `computer_` 前缀。

## 3. 启用链路与进程模型

### 3.1 插件准入（总开关）

`@mavis/local-runtime-v2/src/service/computer-use/initialize.ts`：

- `computerUsePluginCapabilitiesChanged`：仅当受信任快照里存在 `plugin.name === 'computer-use' && plugin.source === 'official' && hostCapabilities 含 'computer-use'` 时 `setComputerUseEnabled(true)`；插件被吊销时立即 `setEnabled(false)` 并 `client.release()`。
- 工具目录装配（`initializeComputerUseProductCapabilities.toolSources.resolve`）：先从 nativeTools 中**剔除所有** `computer_` 前缀工具；仅当 `toolInput.computerUseActive`（用户按会话选中 CU）且 client 就绪时，才重新构建并追加 CU 工具。**未启用 = 模型根本看不到这些工具**。
- 工具执行时再查一次 `isComputerUseEnabled()`，并注册 AbortController 到全局表，使 `setEnabled(false)` / `/computer-use/abort` 能即时掐断在途 CUA 调用（tools.ts `execute`）。

### 3.2 binding 清单（官方插件）

`~/.minimax/v2/plugin-cache/official/sha256-tree-v1-b9fdb15…/bindings/computer.binding.json`：

```json
{
  "bindingId": "computer-control",
  "logicalToolName": "computer.control",
  "hostCapability": { "id": "computer.use", "version": 1 },
  "requiredSkills": ["computer-use"],
  "allowedSurfaces": ["interactive"]
}
```

宿主侧适配器 `host-capability/computer.ts`：`selectTargets = tools.filter(t => t.def.name.startsWith('computer_'))`，原样透出（不改名）。binding 限定 `allowedSurfaces: ["interactive"]` —— 仅交互式会话可用（后台/cron 会话不可用）。

### 3.3 utility process 与通道

`index.js`（宿主门面）流程：

1. 首次 CU 激活时 `ensureCuaUtilityStarted()`：`utilityProcess.fork(cua-entry.js)`，创建 `MessageChannelMain`，port1 发给子进程（`cua-connect`），port2 留作控制口。
2. 子进程 ready 后回 `cua-ready`（30s 超时）；宿主再派生"运行时通道"（`cua-runtime-connect`）并 handoff 给 local-runtime。
3. 每次重建 generation +1；所有控制消息校验 `generation` 防止旧进程/旧通道串话（`computer_generation_mismatch`）。
4. 子进程把 stdout/stderr 以行缓冲结构化日志回传（`cua-output-buffer`）。

`cua-utility-server.js`（CUA utility 内部）：

- 通过 `import('@trycua/cua-driver')` 创建 `CuaDriver`（Rust 原生实例），启动即读 `driver.metadata()`（含 driverVersion）。
- 每个会话一个命名驱动会话：`callCuaToolInSession` 先幂等调用 `start_session {session: <sessionId>}`，再派发实际工具；空闲过期后自动复活，**绝不重放输入动作**。
- 请求信封 `{version:1, requestId, kind, sessionId, turnId, generation, leaseId?, payload}`；响应 `{ok, result}` 或 `{ok:false, error:{code, message, completion:'not_started'|'unknown'}}`。取消用 `cua-cancel`，释放用 `cua-release`，关闭用 `cua-shutdown`。

### 3.4 控制租约（lease）

- **变更类请求**（`isMutatingRequest`：除 `app_list`/`window_list`/`display_list`/`desktop_state`/`app_state`/`verify_state` 之外的 kind）必须持有 lease；观察类请求不占租约。
- 单持有者：另一个会话的变更请求会收到 "Another conversation owns the computer control lease."；lease 带 TTL 定时器（`leaseTimer`），`cua-release`（显式，按 sessionId/turnId 去重，FIFO 缓存 64 条已释放 turn）或会话结束即释放。
- 宿主侧联动：`setComputerUseActive(activeRequestCount > 0)` 接电源管理（防休眠）；lease 释放时清指针/遮罩/预览。

## 4. 权限模型（macOS TCC）

`dist/main/modules/screenshot/permission.js` + `cuPermission.ipc.js`：

- `getComputerUsePermissionStatus()` 返回 `{screenRecording, accessibility}`：screenRecording 走 macOS TCC 查询/`desktopCapturer.getSources` 触发系统弹窗；accessibility 走 `systemPreferences.isTrustedAccessibilityClient(false)`。非 macOS 平台返回 `not-required`（代码注释明确：不能把 `not-required` 误用于授权物理屏幕读取）。
- CUA 每次请求派发前都会向宿主发 `cua-permissions-request`，宿主逐项校验 `granted|not-required`，不满足则**拒绝该请求**、清预览目标，并向所有窗口广播 `cu:permission:required`（Renderer 弹权限引导窗 `permission-guide.js`）。IPC 通道：STATUS / REQUEST / OPEN_SETTINGS（可打开系统设置对应面板）。
- `@trycua/cua-driver/dist/electron.js` 亦导出 `requestMacOSPermissions` / `hasRequiredMacOSPermissions`（accessibility && screenRecording），与宿主检查一致。

## 5. 完整工具面（17 个 computer_* 工具）

定义：`@mavis/local-runtime-v2/src/service/computer-use/tools.ts`（schema 均为 `additionalProperties:false` 的 JSON Schema；数值型参数自动接受十进制字符串）。驱动侧映射：`cua-utility-server.js` `mapRequestToCuaTool`。

| 模型可见工具 | kind（payload 域） | → CUA 驱动工具 | 语义 |
| --- | --- | --- | --- |
| `computer_app_list` | app_list（name?） | `list_apps` | 发现运行中/已安装应用；已安装未运行的应用返回 bundle_id 供直接 launch |
| `computer_window_list` | window_list（pid，required） | `list_windows` | 某进程的原生窗口精确清单（window_ref、on_current_space 等） |
| `computer_display_list` | display_list | 宿主自有 `host_display_list`（Electron screen API，不走驱动） | 显示器边界/工作区/缩放/光标坐标（electron_dip 空间） |
| `computer_window_set_frame` | window_set_frame（pid, window_ref, x, y, width?, height?） | `set_window_frame` | 移动/缩放窗口；desktop 坐标而非截图像素 |
| `computer_desktop_state` | desktop_state | `get_desktop_state` | 主显示器截图（多显示器时**固定主屏**，工具描述明示这是刻意门面） |
| `computer_app_launch` | app_launch（name/bundle_id/urls; launch_path 仅 Windows） | `launch_app` | 后台启动；macOS 可用 file:// URL 开文档 |
| `computer_app_activate` | app_activate（pid, window_ref?） | `bring_to_front` | 持久激活（抢焦点）；描述强制要求事先向用户说明 |
| `computer_app_state` | app_state（pid, window_ref, include_screenshot?, query?, max_depth?, max_elements?） | `get_window_state` | **核心观察**：AX/UIA 语义树 + 可选窗口截图 + element_token；query 支持语义文本过滤 |
| `computer_click` | click（scope window/desktop; element_token 或 x/y; action auto/press/show_menu/pick/confirm/cancel/open; button/click_count/delivery_mode） | `click` / `double_click`（AXOpen 专用路径） | 元素 token 定位或截图像素坐标定位，二者互斥（混用报 `computer_conflicting_input_target`） |
| `computer_drag` | drag（from_x/y → to_x/y, delivery_mode） | `drag` | macOS 0.22.1 **仅支持 foreground**（工具描述写死，避免模型探测已知不支持的 background 路由） |
| `computer_type` | type（text, element_token 或 x/y, delivery_mode） | `type_text` | UTF-8 文本输入；明确禁止用 shell/AppleScript 替代 |
| `computer_set_value` | set_value（value, element_token） | `set_value` | **仅可访问性写值，无 delivery_mode**；值变了不等于输入处理器执行过，需验证依赖 UI |
| `computer_select_text` | select_text（element_token 或 foreground x/y） | `hotkey [Cmd/Ctrl, a]` | 全选字段文本；foreground 坐标路由会先点击聚焦 |
| `computer_key` | key（key + modifiers[cmd/win/shift/option/alt/ctrl/fn], scope, element_token/x/y, delivery_mode） | `press_key`；foreground+坐标+修饰键时改派 `hotkey` | 单键名 + 分离的修饰键数组；箭头键名归一化 |
| `computer_scroll` | scroll（direction, by line/page, amount 1-50 滚轮格, 定位同上） | `scroll` | amount 是滚轮格数**不是像素** |
| `computer_secondary_action` | secondary_action（action 仅 `show_menu`, path 数组） | `invoke_menu` | 按完整菜单路径调用原生菜单；其余 AX 动作名 fail-closed（`computer_secondary_action_unsupported`） |
| `computer_verify_state` | verify_state（expect 1-8 谓词 AND, timeout_ms ≤10000, stable_samples 1-5, include_screenshot?） | `verify_state` | 结构化后置条件验证：window.exists/bounds、element role+label_contains × exists/value_equals/enabled/selected |

**通用参数机制**（tools.ts `computerUseProperties`）：
- `click/type/key/select_text/scroll` 的 `pid/window_ref/element_token/x/y` 允许显式 `null`（"null 等价于省略"），用于抑制弱模型乱填 0 值坐标；`element_token` 与 `x/y` 同时出现会被映射层直接拒绝。
- `desktop` scope 仅对 click/key/type 开放（`computer_unsupported_desktop_action`），且 desktop key/type 不接受坐标。
- 错误恢复文本由宿主生成（`windowTargetRecovery`）：`computer_window_not_found` / `computer_ambiguous_window_target` / `computer_window_ref_required` 会被翻译成一段"刷新 app_list → window_list → 用观察到的 window_ref → 禁止猜相邻窗口 ID → 禁止改用 Bash/AppleScript"的修复指令返回给模型。

### 5.1 结果信封与观察产物（client.ts `computerUseToolResult`）

- `content` 首块为 text（已排版的人类/模型可读摘要），随后附 `type:'image'` 截图块（上限 7MB，fail-closed：畸形/不支持格式不注入）。`computer_app_state` 若窗口 AX 未解析（`degraded_reason` 以 `ax_window_unresolved` 开头）则**丢弃所有图片**（防止闭窗裁剪画面串入其他应用内容），并将结果标 `isError`。
- 无截图的 `computer_app_state` 会在文本头部注入提示："本次观察不含截图，不要把上一张图当作当前渲染状态"。
- `computer_click` 若返回无结构化 effect 元数据，注入 "点击回执不证明效果，先读新状态" 的反幻觉提示（`missingClickEffectGuidance`）。
- 结构化 JSON 透传到 `details.structuredJson` 供 UI/调用方使用（LLM 不读）。

## 6. 动作机制（驱动层）

- 交付路由判定（`cua-utility-server.js`）：`app_activate`/`app_launch`/`secondary_action`、`delivery_mode:'foreground'`、`target.kind==='desktop'` 一律按 foreground 计并触发宿主 `onOperation`（显示桌面遮罩 + 窗口移交）；其余为 background（AX/UIA 注入，无需抢焦点）。
- **background 拒绝不升级**：`callCuaToolWithDeliveryMode` 保证"background 被应用拒绝时，运行时绝不自动改发 foreground"；0.22.1 上 macOS background 原生 click 存在已知不可靠场景时直接返回结构化错误（`shouldAvoidNativeBackgroundClick`），把升级决定留给模型+用户。
- foreground 快捷键在该驱动版本的坐标路由上改用 `hotkey`（带焦点点击 + 标志位 HID 事件），避开 macOS 14 上修饰键和弦丢失问题（代码注释）。
- UI 提示层（全部主进程创建的免交互窗口，`setIgnoreMouseEvents(true)`）：
  - `cua-overlay.js` `CuaDesktopOverlay`：foreground/桌面级操作期间在显示器上覆盖半透明提示条（MiniMax Code 图标 + 文案 + **停止按钮**，点击等价于 `POST /minimax-desktop/api/v1/session/:id/abort`）；`cua-window-handoff.js` 负责把 MiniMax 主窗口在抢焦点前后交还。
  - `cua-pointer.js` `CuaPointer`：54px 指针动画窗口跟随目标坐标（tip ≈ (21,21)），`setContentProtection(true)`（不出现在截图里）；它**不读取也不移动**用户真实光标。
  - `cua-preview.js` / `cua-preview-target.js`：仅当目标解析为具体 window（pid+window_id）时向 UI 发布预览目标（桌面观察不改变预览），应用内可实时看到被控窗口。
- 可观测性：每次动作有 `action_dispatch/action_mapped/action_result` 结构化日志（outcome/route/effect/verificationStatus/durationMs）；CU 专用日志文件走 `computer-use-log-writer`（5MB × 4 轮转）；开发期 `MAVIS_CUA_DIAGNOSTICS=1` 额外输出 AX 窗口诊断与后台键盘诊断（`cua-ax-diagnostics.js`）。
- 其他宿主联动：`computer_app_launch` 后有专门的窗口观察步骤（`cua-launch-observation.js`，验证新窗口确实出现）；`power` 模块在 CU 活动期间保持系统唤醒（配合用户设置 `keepAwake`）。

## 7. 安全模型小结

| 层 | 机制 | 证据 |
| --- | --- | --- |
| OS | macOS 屏幕录制 + 辅助功能 TCC 双授权，缺失即 fail-closed | permission.js、cua-permissions-request 往返 |
| 准入 | 官方插件 + Host Binding + 会话级选择（interactive surface only） | initialize.ts、computer.binding.json |
| 并发 | 单租约互斥 + generation fencing + AbortController 注册表 | cua-utility-server.js、tools.ts |
| 提示 | background 优先 / foreground 公告义务 / 禁止 shell·AppleScript·浏览器自动化替代 / verify_state 合同 / 禁止猜窗口与凭据 | 17 个工具 description 与 skills/computer-use/SKILL.md（插件内正文，明确"Adapted from official CUA Driver 0.22.1 skill"） |
| 展示 | 桌面遮罩 + 一键停止 + 指针可视化 + 窗口移交 + 活动期防休眠 | cua-overlay/pointer/handoff、power |
| 审计 | CU 专用轮转日志、诊断模式 | computer-use-log-writer.js、cua-logging.js |

## 8. 与 Claude 工具协议的关系（CU 视角）

- 工具描述直接写在 `description` 字符串里（Claude Code 风格的长指令式描述，含大量反幻觉与恢复指令），schema 为 JSON Schema（typebox `Type.Unsafe` 包装），经 `@mavis/agent-core` 的 PiTurnRunner 透传为 pi `AgentTool.parameters`，再由 pi-ai anthropic provider 编码为 Anthropic Messages `tools` 字段 —— 与 Claude 的 `computer_use` beta 工具**不是同一协议**（本机未见 `computer_20250124`/`computer-use` beta 工具类型），而是自建 17 工具面 + Anthropic 消息协议承载。`pi-ai` 的 anthropic provider 代码中未见 Anthropic `computer-use` beta header 的引用。
- 图片回传采用标准 `content:[{type:'image',...}]` 块 —— 与 Claude 工具结果的 image 块契约一致。
