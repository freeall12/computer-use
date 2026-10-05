# Qoder Computer Use（桌面控制）完整逆向

> 分析对象：Qoder 0.4.3 内置的 Computer Use 能力链。本机该能力**默认关闭且未启用**（设置键 `qoder.computer-control.computerUse.enabled=false`、`~/.qoder/ipc/` 为空、无 Runtime 运行痕迹），本文为**静态完整还原**；Runtime 原生应用本体已安装在本机，可直接检验。全部证据见 [evidence/inventory.md](evidence/inventory.md)。

## TL;DR

- 能力由内置 app-plugin **`qoder.computer-control`** 提供，macOS 子插件 `computerUse` v1.0.1 **不带 MCP server**，只注入一份 `SKILL.md`：指示 agent 全部桌面交互通过 `node_repl`（JS）里的内置 SDK `@qoder-space/computer-use-sdk` 完成，明确禁止绕道 AppleScript/osascript/CGEvent 自写脚本。
- SDK `ComputerUse.create()` → 读取注册表 `~/.qoder/ipc/computer-use-tools.json`（Unix socket 路径 + instanceId + ≥32 字符 token，0600/属主/非符号链接硬校验）→ 不在则 `/usr/bin/open -g` 拉起 **`Qoder Computer Use.app` 1.0.12** 并等 10s → UDS JSON 请求（方法名即 Swift IPC 类型名）。
- Runtime（Swift，`com.qoder.computeruse`）：AX 树序列化（elementIndex + diff）+ ScreenCaptureKit 截图 + CGEvent 合成输入；权限门 = TCC 双权限（Accessibility + Screen Recording）+ 自有授权窗口 + **per-app 审批**（`ComputerUseAppApprovals.json`）+ URL 禁区；Bridge（`com.qoder.computeruse.bridge`）是 stdio MCP 入口（Windows CU 与 Record & Replay 复用）。
- 附加两块：**Record & Replay**（录用户演示 → 生成可复用 Skill）与 **Windows CU**（16 工具 MCP，本机不适用）。

## 1. 能力载体与进程拓扑

| 组件 | 绝对路径 | 版本 / 标识 | 角色 |
|---|---|---|---|
| app-plugin | `/Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/` | id `qoder.computer-control` v1.0.0，`activationEvents:["onStartup"]`，permissions `chat.observeTurn`/`chat.continueSession` | 总装：配置项声明、四个 agent-sdk 子插件挂载、PiP native module 声明 |
| 子插件（mac CU） | `.../dist/cli/computerUse/` | v1.0.1，无 `mcpServers` 字段，有 `skills/` | 注入 SKILL.md；enablement=开关 true 且 macOS≥14 |
| 子插件（Win CU） | `.../dist/cli/computerUseWindows/` | v1.0.1，`.mcp.json` 声明 MCP server `computer-use`（stdio，timeout 120s） | Windows 走 MCP 工具面 |
| 子插件（录制） | `.../dist/cli/recordAndReplay/` | v1.0.2，MCP server `event-stream`（timeout 220s） | 事件流录制 |
| 子插件（BU） | `.../dist/cli/browserUse/` | v1.0.0 | 见 browser-use.md |
| 原生 CU 应用 | `~/.qoder/bin/qoder-computer-use/Qoder Computer Use.app/` | `com.qoder.computeruse` v1.0.12，LSUIElement，macOS≥14 | Runtime（AX/输入/截图）+ SharedSupport 里的 Bridge |
| Bridge | `.../Contents/SharedSupport/QoderComputerUseBridge.app/Contents/MacOS/QoderComputerUseBridge` | `com.qoder.computeruse.bridge` v1.0.12，1.98MB | stdio MCP 入口；Swift 模块 `ComputerUseMCP`（ComputerUseMCPServer/MCPToolGateway/MCPStdioRequestQueue） |
| 分发与校验 | `/Applications/Qoder.app/Contents/Resources/bundled-resources/manifest.json` | resource `qoder-computer-use` v1.0.12 rev 2026091401，zip sha256 + 逐文件 sha256 + maxEntries/maxExpandedBytes | 主进程按 manifest 校验解压到 `~/.qoder/bin/qoder-computer-use/` |
| node_repl 内核 | `/Applications/Qoder.app/Contents/Resources/node-repl/` | v0.1.4，UPSTREAM.md：迁自 qwen-code `packages/qwen_node_repl`（Apache-2.0，commit b1ac3e29） | CU/BU SDK 的运行容器 |
| CU/BU SDK | `.../node-repl/node_modules/@qoder-space/computer-use-sdk/` | index.js 257KB + `source/*.ts` 4 个源文件 + `third_party/{browser-use-sdk,browser-use-zxing}` + zxing_reader.wasm | `ComputerUse` 类与 `createBrowserAgent` |

进程链（启用后）：

```
agent turn（qodercli worker，本地 Runtime）
  └─ node_repl 内核子进程（Electron ELECTRON_RUN_AS_NODE + --experimental-vm-modules）
       └─ await import("@qoder-space/computer-use-sdk").ComputerUse.create({signal})
            ├─ 读 ~/.qoder/ipc/computer-use-tools.json（lstat: 非符号链接/0600/属主=uid）
            ├─ 失败(ENOENT/ECONNREFUSED) → /usr/bin/open -g "…/Qoder Computer Use.app"
            │    （app 路径由主进程经 env QODER_CU_RUNTIME_APP_PATH 注入内核）
            └─ UDS 连接 socketPath，initialize{token,instanceId} 握手，15s ping 心跳
                 └─ QoderComputerUseRuntime（Swift）
                      ├─ ComputerUseRuntimePermissionGate（TCC 探测/授权窗）
                      ├─ AppApprovalStore（per-app 审批持久化）
                      ├─ AX 序列化 + CGEvent 合成 + ScreenCaptureKit 截图
                      └─ appshot 流 + Remote Hosted PIP（XPC ViewBridge）→ 主进程画中画
  （另）qoder.computer-control/dist/cli/*/bin/computerUseClientLauncher.cjs
       └─ process.execve 直接替换为 Bridge 可执行（不留 Node 中间进程；
          Bridge 校验"直接父进程"，这是 launcher 注释明示的设计约束）
```

## 2. 激活与门控

- 设置键（app-plugin `contributes.configuration`，分组标题"电脑操控"）：`qoder.computer-control.computerUse.enabled`，**default false**，enablement 要求 darwin≥14 / win32≥10。渲染层设置页文案："电脑操控能力，包括前台应用截取和浏览器连接"；系统版本不足时有对应提示（含 Windows 10 文案）。
- 子插件挂载由 `contributes.qoderAgentSdk.plugins[].enablement` 声明：`{type:"configuration", key:…, equals:true}` 与操作系统版本 `allOf` 组合——开关不开，SKILL 与 MCP 均不进入 agent 工具面。
- 主进程按 bundled-resources manifest（sha256 链）把 `Qoder Computer Use.app` 解压安装到 `QODER_HOME/bin/qoder-computer-use/`（launcher `resolveExecutable()` 只消费"当前目录"，不扫版本子目录；开发态走 `.generated` + Dev Bridge，并要求 `$HOME/.qoder/dev/computer-use/`）。
- 本机状态：设置从未打开（`app_settings` 表为空、`qoder-data.v1.json` 无相关键）；`~/.qoder/ipc/` 存在但为空（2026-09-20 创建后无注册表文件）；即**完整载体在位、能力未激活**。

## 3. 传输协议（SDK ⇄ Runtime）

来源：`source/socketTransport.ts`、`source/runtimeBootstrap.ts`、`source/index.ts`（SDK 随包附带 TS 源码，共 404 行）。

- 注册表 `computer-use-tools.json`：`{protocol:"qoder-computer-use-tools", version:1, socketPath, instanceId, token(≥32)}`；读取时强制 `lstat` 校验——普通文件、非符号链接、`mode & 0o077 === 0`、属主为当前 uid。
- 连接即握手：`initialize{}` 携带 `{token, instanceId}`，响应 `instanceId` 必须一致并返回 `sessionId`；此后 15s 一次 `ping` 心跳，失败即断链。
- 请求模型：`{id(UUID), method, params, hostContext:{sessionId,turnId}, …}`；默认超时 140s（1–600000ms 可配）；取消发 `{method:"cancel"}`；**超时后 SDK 主动断链**——文案明示"结果可能已生效，先观察再决定是否重试"，禁止盲目重放。
- 并发约束：`ComputerUse` 类内置 `busy` 标志，**同一连接同时只允许一个在途请求**（"Await the previous Computer Use action before starting another"）；Runtime 侧另有 `ComputerUseIPCRequestLimiter/RequestAdmission/RequestTimeoutState`。
- 方法名与 Swift IPC 类型一一对应（SDK `index.ts` 原文）：

| SDK 方法 | 传输 method | 语义 |
|---|---|---|
| `listApps` | `ComputerUseIPCListAppsRequest` | 枚举可控制应用 |
| `getAppState({app})` | `ComputerUseIPCAppGetStateRequest` | 会话级快照：截图 + AX 树 |
| 动作（9 种） | `ComputerUseIPCAppPerformActionRequest` | `action:{click|setValue|typeText|paste|pressKey|scroll|drag|performSecondaryAction|selectText:{_0:params}}` |

- 其余 Runtime IPC 面（strings 证据）：`ComputerUseIPCAppStartRequest`（隐式启动 app——`getAppState` 会后台拉起未运行的目标 app）、`AppStartFrontmostCapture`、`AppCancelCapture`、`AppUsage`、`Health`、`HostSessionObserve`、`CancellationKey/EarlyCancellationRegistry`、Appshot 系（`AppshotDisplay/Rect/Target/CaptureUpdate/UpdateEnvelope/AnimationTarget`）。

## 4. 工具面（agent 视角）

### 4.1 macOS（SKILL.md + SDK，11 方法）

`SKILL.md`（`dist/cli/computerUse/skills/computer-use/SKILL.md`）内嵌完整 TS 类型签名与工作流规则，要点：

- `getAppState({app})`：**每个 assistant turn 交互前必须先调**；返回 AX 树文本 + 按截图策略附带的截图（base64 于 `images[]`）；`app` 接受显示名/完整路径/bundle id；目标未运行会透明拉起。
- 观察/动作闭环：所有动作返回**动作后新状态**；elementIndex 只能取自最近一次快照；UI 不符合预期先重新 `getAppState` 而不是重复动作。
- 动作语义与参数校验（SDK 源码级）：
  - `click`：`elementIndex` 或 `x,y` 二选一（同时给即抛错）；`mouseButton left/right/middle`、`clickCount 1–3`。
  - `scroll`：`direction up/down/left/right` + `pages∈(0,100]`（默认 1）；元素优先于坐标；坐标为**截图像素坐标**。
  - `drag`：`fromX/fromY/toX/toY`；菜单项不支持鼠标动作（Runtime 文案）。
  - `typeText`：注意 `\n` 会模拟回车（消息类 app 会直接发送）。
  - `paste`：`format text/md/html`；走系统剪贴板，**完成后条件恢复用户原剪贴板**（仅当剪贴板仍属该次粘贴；保留期间用户的其他变更）；Runtime 文案："粘贴≠编辑成功，须回读 app state 验证"。
  - `pressKey`：xdotool 风格键语法（`"a"`/`"Return"`/`"super+c"`/`"KP_0"`）；目标为**指定 app 的合成键盘事件路径**，明确不能触发 OS 级全局快捷键（Cmd+Shift+3/5、Mission Control、Spotlight 等——Runtime 工具描述原文整段解释此边界并要求如实报告"超出 press_key 能力"而不是反复重试）。
  - `setValue`：仅限 AX 树标记 `(settable, string)` 的元素；走 AXValue，支持全 Unicode；特别警告 Monaco 编辑器正文"只能改 AX 镜像不改真实 buffer"，应改用键盘/查找替换（Runtime 工具描述原文）。
  - `selectText`：元素内选中文本或置光标（`selection: text/cursor_before/cursor_after`，`prefix/suffix` 消歧）；要求文本与 AX 树逐字一致（含 Markdown 符号）。
  - `performSecondaryAction`：调用元素暴露的**次级 AX 动作**（展开/显菜单/增减/取消），禁止猜动作名。
- 错误契约：失败抛 `ComputerUseError`，`error.result` 保留 text+images 供检查；错误即中止同一代码单元的后续动作（SKILL 明确禁止 catch 后继续跑完序列）；多处运行时文案强制"观察后再重试"（如坐标守卫："Screenshot coordinates require a current screenshot whose target window still belongs to the app and has unchanged geometry. Re-query get_app_state before retrying."）。
- 结果过滤：SKILL 允许在 JS 里对返回的完整 AX 文本做关键词/正则过滤再 `nodeRepl.write`，省上下文。

### 4.2 Windows（MCP，16 工具，本机不适用）

app-plugin `mcpToolPresentations` 完整列出 MCP server `computer-use` 的 16 工具（中英标题）：`list_apps`、`list_windows`、`get_window`、`launch_app`、`activate_window`、`get_app_state`、`get_window_state`、`click`、`perform_secondary_action`、`set_value`、`select_text`、`scroll`、`drag`、`press_key`、`type_text`、`run_steps`（批量动作序列，macOS SDK 无对应物）。launcher 与 macOS 同一份 `computerUseClientLauncher.cjs`（构建期物化），win32 分支：设 `QODER_CUA_LOG_MODE=ide` 等环境变量后 execve 到 `QoderComputerUse.exe`。

### 4.3 Record & Replay（macOS，3 工具）

MCP server `event-stream`：`event_stream_start` / `event_stream_status` / `event_stream_stop`。SKILL（`skills/record-and-replay/SKILL.md`）还原的产品语义：

- `start` 参数：`max_duration_seconds` 1–3600（默认 1800）；`screenshot_mode` 默认 `off`，可选 `window_changes`（窗口切换）或 `interaction_settled`（交互后视觉稳定帧）。启动时弹**原生审批窗**；悬浮控制条（`RecordReplayRecordingControlsWindow`）可停止并选择保留/丢弃。
- 产物：`events.jsonl`（主证据）+ `session.json`（生命周期：录制 id、起止、endReason）+ `suppressedEventsPath`（被抑制事件诊断：安全输入、禁录 app/URL、工具自身活动）。事件类型：`window.changed`、`selection.changed`、`mouse.click/drag/context_menu`、`keyboard.text_input/submit/shortcut`；AX 上下文为 `fullTree` 或 unified-diff 形态的 `diffFromPrevious`； secure text field 焦点时键盘输入被省略（Runtime 字符串证据）。
- 闭环：录制结束由 Qoder 自动唤醒原 ChatSession（固定话术 "I'm done recording." / "I've cancelled recording."）；agent 读事件流**推断可复用意图**（区分稳定步骤与偶发时序），生成 `~/.qoder/skills/<kebab-name>/SKILL.md`（格式同 Claude Code skills，重名会被目录剔除）；敏感值必须转成显式输入或占位符，禁止把录制工件路径与个人数据写进 Skill；回放指导："识别稳定 app/窗口/语义控件，避免纯坐标回放"。

## 5. 观察机制

- **AX 树文本**（主通道）：Runtime 把目标 app key window 序列化为带 `elementIndex` 的行（SKILL 的过滤示例暴露行格式：行首整数索引 + `Description: <控制描述>,` + `Value: 0|1` 等字段；Bridge 内嵌工具描述另有 `settable`/动作列表语义）。重复读取默认输出紧凑 diff；AX 构建超时返回部分树并明示；序列化失败时降级 role-level 兜底树并警告"元素可能无名/无动作"。
- **截图**（辅助通道）：ScreenCaptureKit（二进制符号 `ScreenCaptureKit`/`ScreenCapturePermissionProbe*`）；按 capture policy 附着于结果；坐标动作要求截图新鲜且窗口几何未变（§4.1）；"Screenshot reused from an earlier capture; the accessibility state is newer" 这类文案说明 AX 与截图双通道带新鲜度仲裁。
- **appshot 流 + PiP**：Runtime 持续向主进程供 appshot 帧流（IPC Appshot 系类型 + `Resources/bin/hosted_presentation_host.node` 对应插件声明的 native module `picture-in-picture-host`，resourceId `qoder-computer-use-presentation-provider`）；Runtime 内有 `RemoteHostedPIPHost/ProducerXPCProtocol`（XPC ViewBridge）与 `SoftwareCursor/MenuBarCursor` 资源——受控 app 以画中画形式浮在会话旁，agent 动作自动跟随（对照 browser-use.md 的 PiP 设计，两能力共用"让用户看见 agent 在操作什么"的展示层）。
- 不提供 Cursor 式 `snapshot_id`/stale 双引用，也不提供全屏 desktop 域——**能力域就是"单个 app 的 key window"**（`get_window_state`/多窗口仅存在于 Windows 面）。

## 6. 动作机制

- 双轨：AX 语义动作优先（`set_value`/`select_text`/`perform_secondary_action` 纯 AX；`click(elementIndex)` 命中元素AXAction），坐标与键盘走 **CGEvent 合成**（二进制符号：`CGEventPostToPid`、`CGEventSetIntegerValueField/SetLocation/SetTimestamp/SetWindowLocation`、`ComputerUseUserInteractionEventTap`）——`postToPid` 路径与 Kimi 分册的"签名事件直达进程"同思路，支持不抢焦点的定向注入；`BackgroundTextInputSession` 符号表明存在后台文本输入会话。
- 目标定位由 app 标识驱动（显示名/路径/bundle id），Runtime 用 Spotlight 解析（`spotlight_cold_start_timeout` 等错误码）。
- 剪贴板：`PasteboardTransaction/PasteDataProvider`（Swift 符号）+ `native_clipboard.node`（主进程侧），实现"粘贴-恢复"事务。

## 7. 安全模型

1. **TCC 双权限 + 自有授权窗**：Accessibility + Screen Recording（Info.plist 无 NSAccessibilityUsageDescription——AX 权限走 TCC 手动授权；Runtime 有 `ComputerUseRuntimePermissionsWindow/PermissionCardView`，文案 "Grant the permissions below so Qoder can perceive and operate apps on your behalf."）。权限未就绪时工具返回特定文案："authorization window is open…Wait briefly, then call this same tool again. Do not end your turn yet…"——把等待授权做成协议化重试语义。
2. **对端信任链**：Info.plist `QoderComputerUseTrustedTeamIdentifiers [T27K5A5ZWD, B6U242QL73]`、`TrustedBundleIdentifiers`（com.qoder.ide/app/canary、com.qodercn.*、qodercli、**com.aliyun.lingma.ide**、两个 bridge id 等 14 项）；`QoderComputerUseEnforceSenderAuthorization=false`（当前构建未强制，但 `ComputerUseIPCSenderAuthorization`/`parent_authorization` 机制在位；launcher 注释明示 Bridge 校验"直接父进程"）。
3. **注册表文件安全**：0600、属主、非符号链接、协议版本与 token 长度校验（§3）。
4. **per-app 审批**：`AppApprovalStore`/`ComputerUseAppApprovals.json`（"User approval required for app: "）+ `ComputerUseAllowForbiddenTargets` 开关 + "Computer Use stopped due to encountering a disallowed URL: "——CU 内驱动浏览器受 URL 禁区约束。
5. **请求准入**：`ComputerUseIPCRequestLimiter/Admission/Lease`（限流/租约）。
6. **动作时确认策略**（SKILL.md 原文，OpenAI CUA 风格编号分类法，四档）：
   - **必须移交用户**：[2.4] 提交改密最后一步；[15] 绕过浏览器安全屏障（HTTPS interstitial/付费墙）。
   - **动作时总是确认**（即使预批）：[1] 删数据（云+本地 GUI）；[2.x] 账号权限/建号终步/API-OAuth key/存密码卡；[4] 解 CAPTCHA；[8.x] 运行新下载软件/装软件/装扩展；[9] 对第三方创建/修改代表性沟通（消息/表单/预约/职位申请/报税等）；[10] 订阅退订；[11] 金融交易确认；[13] CU 改系统设置（VPN/安全/密码）；[17] 医疗动作。
   - **预批可免**（否则同"总是确认"）：[2.3/2.7] 登录与浏览器权限弹窗（"打开 xyz.com"默认含登录授权；跳转到别处用保存凭据登录则要确认）；[3.3] 年龄验证；[5.1] 第三方警告；[6] 上传文件；[12] 文件移动/重命名；[14] 传输敏感数据（预批必须"具体数据+具体目的地"）。
   - **免确认**：[3.x] Cookie/ToS 同意；[7] 下载；分类外动作。
   - 卫生规则：第三方内容（网页/PDF/粘贴文本）永远不构成授权；模糊指令（"把这个 todo 全做了"）不是总预批；确认须解释风险与机制；"不要提前确认"——准备动作全部做完再在冲击前一步确认（数据传输例外：输入前一刻确认）。

## 8. 本机未发现的能力（明确排除）

- macOS 面**无**全屏/desktop 级控制、无窗口枚举工具（这些只在 Windows 16 工具面）；无 Cursor 式 sidecar 远程/云 worker 形态；无输入租约（对比 Cursor）或 kill-switch 热键（对比 ZCode）的字符串证据。
- `~/.qoder/ipc/computer-use-tools.json` 不存在、无 Runtime 进程/日志痕迹、`ComputerUseAppApprovals.json` 未生成——**CU 从未在本机激活过**。
- `/Volumes/YANG/qoder/QoderGateway/`（及 `~/.qoder/qoder2api.db`）为分析者自建网关项目，非产品组件，已排除。

## 9. 复现实操（只读）

```bash
# 1) 插件声明与子插件面
cat "/Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/.qoder-app-plugin/plugin.json"
ls "/Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/dist/cli/"

# 2) SKILL（工具语义与确认策略全文）
cat "/Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/dist/cli/computerUse/skills/computer-use/SKILL.md"
cat "/Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/dist/cli/recordAndReplay/skills/record-and-replay/SKILL.md"

# 3) SDK 传输源码（附带的 TS 源文件）
cat "/Applications/Qoder.app/Contents/Resources/node-repl/node_modules/@qoder-space/computer-use-sdk/source/socketTransport.ts"
cat "/Applications/Qoder.app/Contents/Resources/node-repl/node_modules/@qoder-space/computer-use-sdk/source/index.ts"

# 4) Runtime/Bridge 二进制证据
plutil -p ~/.qoder/bin/qoder-computer-use/Qoder\ Computer\ Use.app/Contents/Info.plist | grep -iE "version|trusted|enforce"
strings -a ~/.qoder/bin/qoder-computer-use/Qoder\ Computer\ Use.app/Contents/MacOS/QoderComputerUseRuntime | grep -m5 ComputerUseIPC
strings -a ~/.qoder/bin/qoder-computer-use/Qoder\ Computer\ Use.app/Contents/SharedSupport/QoderComputerUseBridge.app/Contents/MacOS/QoderComputerUseBridge | grep -m3 ComputerUseMCP

# 5) 本机未启用负证据
ls -la ~/.qoder/ipc/    # 空
```
