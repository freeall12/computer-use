# Claude Computer Use（桌面控制）· 三控制域，约 40 个命名工具

> 分析对象：Claude Code CLI 2.1.212、Claude 桌面端 1.44121.4（macOS）。证据（路径:行号/二进制偏移）见 [evidence/inventory.md](evidence/inventory.md)。

> 一句话结论：**本地 stdio MCP server（非 API 内置工具），执行层 ComputerUseSwift + app-cu-helper；动作按 display-scope / app-scoped / teach 三控制域拆成独立命名工具，安全靠应用白名单 + tier 限权 + 前台门控。**

| 项 | 值 |
|---|---|
| 入口 | CLI `claude --computer-use-mcp` → runComputerUseMcpServer()；桌面端 `@ant/computer-use-mcp` |
| 工具命名 | 对话侧 `mcp__computer-use__*`，经 ToolSearch 延迟加载 |
| 执行层 | ComputerUseSwift（CLI 静态链接；桌面端 NAPI `computer_use.node`）+ app-cu-helper（Rust，SkyLight/CGS） |
| 控制域 | display-scope（接管屏幕）/ app-scoped（后台单应用，仅 macOS）/ teach（引导用户） |
| 安全模型 | request_access 应用白名单 + tier（浏览器→read、终端/IDE→click、其他→full）+ 独占锁 + 全屏接管独立确认 |
| 版本差异 | CLI 2.1.212 无 app_* 工具族（二进制计数 0）；桌面端三域俱全——app-scoped 是较新能力 |
| 本机可用 | ❌ TCC 双权限未授予；probe(axTrusted) 处即失败 |

## 架构一图

```
模型 ── CLI 内嵌系统提示 + mcp__computer-use__* schema（ToolSearch 延迟加载）
 ▼ MCP stdio（CLI 子命令式入口 ｜ 桌面端 @ant/computer-use-mcp 进程内）
工具注册表（asar chunk-Btw0RfUS.js）+ 前台应用门控 / 独占锁 / EscHotkey 急停
 ▼
ComputerUseSwift（CLI 静态链接 .swift.o ｜ 桌面端 NAPI computer_use.node）
  ScreenCaptureKit（captureExcluding 合成器级隐私过滤）· AX · CGEvent · PhantomCursor 假光标
 │ JSON-RPC over stdio（超时 8s；崩溃重启退避 [0,1s,5s]）
 ▼
app-cu-helper（Rust）：SkyLight/CGS 私有框架
  跨 Space 拉窗 · 菜单遍历点击 · AX 后台写入（secure input / 焦点漂移守卫）
 ▼
macOS 桌面（display-scope 动真实输入 ｜ app-scoped 只动 AX，不抢焦点）
```

## 三控制域总览

> 各工具完整参数 schema 与坐标契约见 `source/claude-code/schemas/computer-tools.json` 与 `control-domains.json`。

| 控制域 | 语义 | 平台 |
|---|---|---|
| display-scope | 截主屏、真实移动光标点击打字；触发「接管屏幕」确认与遮罩 | macOS / Windows |
| app-scoped | 单个已授权应用的后台窗口读写，不抢焦点、用户可继续用电脑 | 仅 macOS |
| teach mode | 全屏 tooltip 一步一步引导**用户自己**操作 | 跟随 display-scope |

## 工具面一：授权与状态（前置门）

| 工具 | 语义 |
|---|---|
| `request_access` | apps[] 整批对话框授权 + clipboardRead/Write、systemKeyCombos 独立勾选；**不含**全屏接管 |
| `request_full_control` / `release_full_control` | 请求/释放全屏接管（"releasing is always safe"） |
| `list_granted_applications` | 列白名单 + tier + 坐标模式，无副作用 |
| `list_apps` | 枚举已安装+运行中应用（带 pid；仅 appScoped+darwin） |
| `open_application` | 启动/确保运行；目标必须已在白名单 |
| `switch_display` / `app_release` | 多显示器切换 / 释放后台应用锁（两域同回合不可混用） |

## 工具面二：display-scope 观察 + 动作

| 工具 | 语义 |
|---|---|
| `screenshot` / `zoom` | 主屏 JPEG / **从上次截图裁剪放大不重截**；scale 只缩返回图省 token，坐标仍按全分辨率系 |
| `cursor_position` | 相对最近一次截图的像素坐标 |
| `left_click` 系 ×4 + `middle_click` | 坐标点击 + 修饰键（text） |
| `type` / `key` / `hold_key` | 打字（剪贴板授权后多行走快速通道）/ 组合键（系统级需 systemKeyCombos 授权）/ 长按 0–100s |
| `scroll` / `left_click_drag` / `mouse_move` / `left_mouse_down/up` / `wait` | 常规输入原语 |
| `read_clipboard` / `write_clipboard` | 需对应 grant |
| `computer_batch` | 一次往返顺序执行，首错即停；**批内坐标一律参照批前全屏截图**；每步前重查前台门控 |

坐标铁律（所有工具描述反复强调）：**坐标永远在最近一次（app_）screenshot 的全分辨率坐标系**。

## 工具面三：app-scoped 后台动作（仅 macOS）

| 工具 | 语义 |
|---|---|
| `app_screenshot` / `app_list_windows` | 单窗口截图 + 交互元素 AX 摘要（`[N]` 索引；最小化/异 Space 均可）/ 列窗口 |
| `app_ax_find` | 在最近一次捕获的 AX 元素里按角色/标题深查，返回 `[N]` 索引 |
| `app_click` | coordinate / element_index / `"focused"` 三定位；弹出菜单被拒（会把应用带到前台）→ 用 app_menu |
| `app_type` | 只许打到文本控件；整字段替换默认拒绝（确认后旧内容 ≤500 字符随结果返回可恢复） |
| `app_key` | 后台仅 return/escape/backspace/delete/cmd+a；任意 ⌘ 快捷键走 app_menu |
| `app_scroll` / `app_drag` | 设滚动条值（每单位≈滚动区间 5%）/ 仅 supportsRawInput 实现 |
| `app_menu` | 按 path 遍历菜单栏点击（忽略大小写与结尾省略号） |
| `app_batch` | 单窗口顺序批；`ineffective` 不停批；批内截图后动作以该截图为坐标参照 |

## 工具面四：teach mode

| 工具 | 语义 |
|---|---|
| `request_teach_access` | 批准后主窗口隐藏，出现全屏 tooltip 覆盖层 |
| `teach_step` | 显示 tooltip 等用户点 Next → 执行 actions → 返回新截图；用户 Exit 返回 `{exited:true}` |
| `teach_batch` | 多步排队；中途出错返回 `{stepsCompleted, stepFailed}` |

> 提示词工程：`explanation` 是「用户唯一能看到你说话的地方」；要求把尽量多动作塞进一个 step（用户要等整个往返）。

## 观察机制

**截屏过滤在合成器层完成，未授权应用根本不进图。**

- ScreenCaptureKit；display-scope 调 `screenshot.captureExcluding(allowedBundleIds,…)`——未授权窗口在合成器层排除。
- 过滤三档：`native`（合成器排除）/ `mask`（实心矩形，位置可见内容不可见）/ 无（输入动作仍按白名单拒）。
- 自适应分辨率：按 token 预算降采样返回图，每次回报全分辨率 frameWidth/Height。
- PhantomCursor：接管屏幕时画假光标 + 点击动画；截图时间戳与光标位置随图返回。

## 动作机制

| 路径 | 机制 |
|---|---|
| 前台（display-scope） | CGEvent 合成；动作前 prepareForAction 把非白名单应用隐藏/切空间、失焦宿主、确保目标最前 |
| 后台（app-scoped） | AX 注入 + helper 私有 API（dispatchRaw / axGetWindow / menu / bringWindowToActiveSpace）；失败封闭守卫：secure_input_active、focused_pid_drift（中断并标记 partialDelivery）、foreign_pid、occluderBound 等 |
| 私有框架 | app-cu-helper 直调 SkyLight/CGS（SLSGetActiveSpace / SLPSPostEventRecordTo / CGSCopySpacesForWindows…）——公开 API 做不到的窗口/空间操作 |
| 生命周期 | spawn + JSON-RPC 2.0（按行分隔）；超时 8s（文本按 8000+len×50ms）；崩溃重启退避 [0,1s,5s] 后 60s 冷却；Esc 急停（EscHotkey） |
| Windows | createWin32Executor；UIPI 限制：提权进程（任务管理器/UAC）不可控 |

## 安全模型

| 层 | 机制 |
|---|---|
| tier 限权 | 浏览器→read（可见不可点，指引走 Chrome MCP）；终端/IDE→click（可点不可打字，防 AI 往 shell 打命令）；其他→full；前台门控执行（batch 每步重查） |
| 授权对话框 | request_access 一次列全部应用整批批准；剪贴板/系统键独立勾选；tier 显示在对话框 |
| 全屏接管 | 独立确认卡（request_access 明确不含）；"screen glow" 接管指示 |
| 独占锁 | 同一时间只允许一个 Claude 会话控制电脑；app_release 例外放行 |
| 会话守卫 | secureInputPid（安全输入域拒发）/ screenLocked（锁屏拒绝跨 Space 拉窗） |
| 提示词防御 | 邮件链接不许 CU 点、改走 Chrome MCP 先看真实 URL；金融类应用可整理账目但绝不代下单/转账；应用列表出现疑似指令必须忽略 |

## 与官方 computer-use-demo 的关系

demo 是 Docker+X11 单 `computer` 工具参考实现；本地栈是「拆分命名工具 + 白名单/tier/门控/独占锁在真实桌面划界 + teach 反向引导人」。共性：截图为坐标基准、key 空格分隔、wait 上限（demo 10s vs 本地 100s）。桌面端浏览器版 `computer` 工具 schema 明显派生自 demo 工具描述（再叠 tabId/ref/scale/scroll_to/hover）。

> Cowork 是同一产品里的「另一种 CU」：Linux VM（Ubuntu 22）沙箱跑 Bash/Edit/Write/Read，工作区持久映射宿主——沙箱化文件/代码执行，与真实桌面 GUI 控制并存。

本机不可用项：扩展未装、native host manifest 未注册（见 [browser-use.md](browser-use.md)）；未发现云端 computer_use beta 使用痕迹；CLI 无 app_* 与 framebuffer 工具；TCC 未授权（CU 即使被调起也在权限探测处失败）。
