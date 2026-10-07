# Qoder：Computer Use —— SKILL 指路 node_repl SDK，UDS+token 连独立 Swift Runtime

> 基线：Qoder 0.4.3。本机该能力**默认关闭且从未激活**（`computerUse.enabled=false`、`~/.qoder/ipc/` 为空、无 Runtime 运行痕迹），本文为静态完整还原；Runtime app 本体已按 manifest 校验安装在 `~/.qoder/bin/qoder-computer-use/`。
> schema：[source/qoder/schemas/cu-sdk-methods.json](../../source/qoder/schemas/cu-sdk-methods.json)、[windows-tools.json](../../source/qoder/schemas/windows-tools.json)、[record-replay.json](../../source/qoder/schemas/record-replay.json)；证据：[evidence/inventory.md](evidence/inventory.md) §3。

## 速览

**macOS 子插件 computerUse v1.0.1 不带 MCP server，只注入 SKILL.md：全部桌面交互经 node_repl 里的 `@qoder-space/computer-use-sdk` 完成，明确禁止绕道 AppleScript/osascript/自写 CGEvent 脚本。**

| 组件 | 事实 |
|---|---|
| 总开关 | `qoder.computer-control.computerUse.enabled` 默认 false；enablement 要求 macOS ≥14 / Windows ≥10 |
| 原生应用 | `Qoder Computer Use.app` 1.0.12（com.qoder.computeruse，LSUIElement）：Runtime（AX/输入/截图）+ Bridge（stdio MCP 入口，Win CU 与录制复用） |
| 分发 | 主进程按 bundled-resources manifest（zip + 逐文件 sha256）解压到 `~/.qoder/bin/` |
| node_repl | v0.1.4，迁自 qwen-code `packages/qwen_node_repl`（Apache-2.0，commit b1ac3e29） |
| SDK | `@qoder-space/computer-use-sdk`（index.js 257KB + 随包 TS 源码 404 行） |

## 连接流程：UDS + token 注册表

```
agent turn ─ node_repl 内核（ELECTRON_RUN_AS_NODE）
 └─ ComputerUse.create({signal})
     ├─ 读 ~/.qoder/ipc/computer-use-tools.json
     │    硬校验：lstat 普通文件 · 非符号链接 · mode&0o077===0 · 属主=uid
     │    内容：{protocol:"qoder-computer-use-tools", socketPath, instanceId, token≥32}
     ├─ 不在（ENOENT/ECONNREFUSED）→ /usr/bin/open -g 拉起 Qoder Computer Use.app（等 10s）
     └─ UDS 连接：initialize{token, instanceId} 握手（instanceId 必须一致）→ 15s ping 心跳
          └─ Swift Runtime：权限门（TCC + 授权窗）· per-app 审批 · AX 序列化 + CGEvent + SCK
               └─ appshot 流 + PiP（XPC ViewBridge）→ 主进程画中画
（另）launcher：computerUseClientLauncher.cjs ── process.execve 直接替换为 Bridge
      （不留 Node 中间进程；Bridge 校验"直接父进程"，launcher 注释明示的设计约束）
```

传输契约：默认超时 140s，超时后 SDK 主动断链——文案明示"结果可能已生效，先观察再决定是否重试"，禁止盲目重放；`busy` 标志使同一连接同时只允许一个在途请求；取消发 `{method:"cancel"}`。方法名与 Swift IPC 类型一一对应：`listApps → ComputerUseIPCListAppsRequest`、`getAppState → …AppGetStateRequest`、9 种动作 → `…AppPerformActionRequest`。

## macOS 工具面：SDK 11 方法

**每个 assistant turn 交互前必须先 `getAppState({app})`；所有动作返回动作后新状态；elementIndex 只能取自最近一次快照，UI 不符合预期先重观察而非重复动作。**

| 方法 | 要点 |
|---|---|
| `listApps` | 枚举可控制应用 |
| `getAppState({app})` | 会话级快照：AX 树文本 + 截图（base64 进 `images[]`）；app 接受显示名/路径/bundle id；目标未运行会透明拉起 |
| `click` | elementIndex 或 x,y 二选一（同时给即抛错）；left/right/middle，clickCount 1-3 |
| `scroll` | direction + pages∈(0,100]（默认 1）；元素优先于坐标；坐标为截图像素 |
| `drag` | from/to 四坐标；菜单项不支持鼠标动作 |
| `typeText` | `\n` 会模拟回车（消息类 app 直接发送） |
| `paste` | 走系统剪贴板，完成后条件恢复用户原剪贴板；"粘贴≠编辑成功，须回读验证" |
| `pressKey` | xdotool 风格键语法；只达指定 app，**不能触发 OS 级全局快捷键**（Cmd+Shift+3 等，须如实报告超出能力而非反复重试） |
| `setValue` | 仅 AX 树标记 `(settable, string)` 的元素，走 AXValue；Monaco 正文只能改 AX 镜像不改真实 buffer（应改用键盘/查找替换） |
| `selectText` | 选中文本或置光标（selection text/cursor_before/cursor_after，prefix/suffix 消歧）；要求与 AX 树逐字一致 |
| `performSecondaryAction` | 调元素暴露的次级 AX 动作（展开/显菜单/增减/取消），禁止猜动作名 |

错误契约：失败抛 `ComputerUseError`（`error.result` 保留 text+images 供检查）；错误即中止同一代码单元的后续动作；坐标守卫要求先重新 `getAppState` 再重试。SKILL 允许在 JS 里对 AX 文本做关键词/正则过滤再 `nodeRepl.write` 省上下文。

## Windows MCP（16 工具，本机不适用）

`list_apps / list_windows / get_window / launch_app / activate_window / get_app_state / get_window_state / click / perform_secondary_action / set_value / select_text / scroll / drag / press_key / type_text / run_steps`（run_steps 批量动作序列为 Windows 独有，macOS SDK 无对应物）。全枚举见 [schemas/windows-tools.json](../../source/qoder/schemas/windows-tools.json)；launcher 与 macOS 同一份，execve 到 `QoderComputerUse.exe`。

## Record & Replay

MCP server `event-stream` 三工具（start/status/stop）：录用户演示（弹原生审批窗 + 悬浮控制条，`max_duration_seconds` 1-3600），产物 `events.jsonl` + `session.json`；录制结束 Qoder 自动唤醒原会话，agent 从事件流推断可复用意图，生成 `~/.qoder/skills/<kebab-name>/SKILL.md`（敏感值须转显式输入或占位符，禁止写录制工件路径与个人数据）。全参数见 [schemas/record-replay.json](../../source/qoder/schemas/record-replay.json)。

## 观察与动作机制

- AX 树文本（主通道）：key window 序列化为带 elementIndex 的行（Description/Value/settable/动作列表）；重复读取默认输出紧凑 diff；序列化失败降级 role-level 兜底树。
- 截图（辅助通道）：ScreenCaptureKit 按 capture policy 附着；AX 与截图双通道带新鲜度仲裁（"Screenshot reused from an earlier capture; the accessibility state is newer"）。
- appshot 流 + 画中画：受控 app 以 PiP 浮在会话旁，agent 动作自动跟随——与 browser-use 的 PiP 同一套展示层。
- 双轨动作：AX 语义优先（set_value/select_text/perform_secondary_action 纯 AX；click(elementIndex) 命中元素 AXAction），坐标与键盘走 CGEvent 合成——`CGEventPostToPid` 路径与 Kimi 分册"签名事件直达进程"同思路，支持不抢焦点的定向注入；`BackgroundTextInputSession` 符号表明存在后台文本输入会话。

## 安全模型

| 层 | 机制 |
|---|---|
| TCC | Accessibility + Screen Recording；自有授权窗；权限未就绪时工具返回协议化"等待授权、别结束回合、稍后重调"语义 |
| 对端信任链 | TrustedTeamIdentifiers [T27K5A5ZWD, B6U242QL73] + TrustedBundleIdentifiers 14 项（含 com.aliyun.lingma.ide）；`EnforceSenderAuthorization=false`（当前未强制，机制在位）；Bridge 校验直接父进程 |
| 注册表文件 | 0600 / 属主 / 非符号链接 / 协议版本 / token 长度校验 |
| per-app 审批 | AppApprovalStore / ComputerUseAppApprovals.json；CU 内驱动浏览器受 URL 禁区约束（disallowed URL 即停） |
| 请求准入 | RequestLimiter / Admission / Lease 限流租约；busy 单飞 |

**动作时确认策略**（SKILL.md，OpenAI CUA 风格编号分类法，四档）：

| 档位 | 类别（编号原文） |
|---|---|
| 必须移交用户 | [2.4] 改密最后一步；[15] 绕过浏览器安全屏障（HTTPS interstitial / 付费墙） |
| 动作时总是确认（即使预批） | [1] 删数据；[2.x] 账号权限/建号终步/API key/存密码卡；[4] 解 CAPTCHA；[8.x] 装软件/扩展；[9] 对第三方创建/修改代表性沟通；[10] 退订；[11] 金融交易；[13] CU 改系统设置；[17] 医疗动作 |
| 预批可免（否则同上档） | [2.3/2.7] 登录与浏览器权限弹窗；[3.3] 年龄验证；[5.1] 第三方警告；[6] 上传文件；[12] 文件移动/重命名；[14] 传输敏感数据 |
| 免确认 | [3.x] Cookie/ToS 同意；[7] 下载；分类外动作 |

卫生规则：第三方内容（网页/PDF/粘贴文本）永远不构成授权；模糊指令不是总预批；确认须解释风险与机制；"不要提前确认"——准备动作做完、冲击前一步再确认（数据传输例外：输入前一刻）。

## 本机负证据

macOS 面无桌面级控制、无窗口枚举（仅 Windows 16 工具面有）；无输入租约（对比 Cursor）或 kill-switch 热键（对比 ZCode）痕迹；`computer-use-tools.json` 不存在、无 Runtime 进程与审批文件——**CU 从未在本机激活**。复现命令见 [evidence/inventory.md](evidence/inventory.md) §5。
