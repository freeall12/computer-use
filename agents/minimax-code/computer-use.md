# MiniMax Code：Computer Use —— AX token 定位优先、截图像素兜底的双路由桌面控制

> 基线：`/Applications/MiniMax Code.app` app.asar（406 MB）解包至 `/tmp/mm-asar`，版本 3.1.0；以下相对路径以其为根。
> 17 工具完整 schema：[source/minimax-code/schemas/computer-tools.json](../../source/minimax-code/schemas/computer-tools.json)；证据映射：[evidence/inventory.md](evidence/inventory.md) §B。

## 速览

**CU = Electron 门面（`dist/main/modules/local-runtime/computer-use/`）+ 独立 utility process（`mavis-cua`）+ `@trycua/cua-driver` 0.22.1（开源 trycua/cua 的 Rust/UniFFI SDK，MIT）；云上只有 LLM，观察与动作全在本机。**

## 启用链：binding 门控三层，缺一层工具即不存在

```
模型（Anthropic Messages）
 └─ ① 插件准入 initialize.ts：官方插件 computer-use + hostCapabilities['computer-use']
     │    才 setEnabled(true)；插件吊销立即 setEnabled(false) 并 client.release()
     └─ ② 工具目录装配：先剔除全部 computer_*，仅当 computerUseActive（用户按会话选中 CU）
         │    且 client 就绪才重建回注 —— 未启用 = 模型根本看不到这些工具
         └─ ③ 执行复查 isComputerUseEnabled() + AbortController 全局注册表
                 （setEnabled(false) / /computer-use/abort 即时掐断在途 CUA 调用）
             └─ utility process mavis-cua ── MessagePort {version:1, requestId, generation}
                 └─ CuaDriver（Rust）→ AX/UIA · CGEvent HID · ScreenCaptureKit + TCC 双权限
```

binding 声明（`bindings/computer.binding.json`）：`hostCapability: computer.use v1`、`requiredSkills:["computer-use"]`、`allowedSurfaces:["interactive"]`——仅交互式会话可用，后台/cron 会话不可用；宿主适配器对 `computer_` 前缀工具原样透出（不改名）。完整 JSON 见 [schemas/bindings.json](../../source/minimax-code/schemas/bindings.json)。原生与 MCP 两条路径共用 `computer_` 前缀（canonical-tool-policy 明文）。

## 进程与租约

**每次重建 generation +1，旧进程/旧通道按 `computer_generation_mismatch` 拒绝串话。**

| 机制 | 事实 |
|---|---|
| utility 通道 | 首次激活 `utilityProcess.fork(cua-entry.js)` + MessageChannelMain；子进程 ready 30s 超时；macOS 下 `--message-loop-type-ui` |
| 驱动会话 | 每会话一个命名驱动会话，空闲过期自动复活但**绝不重放输入动作** |
| 请求信封 | `{version:1, requestId, kind, sessionId, turnId, generation, leaseId?, payload}`；取消 cua-cancel / 释放 cua-release / 关闭 cua-shutdown |
| lease | 变更类请求（除 6 个观察 kind）必须持有；单持有者（他者得 "Another conversation owns the computer control lease."）；带 TTL，显式释放或会话结束释放 |
| 宿主联动 | CU 活动期接电源管理防休眠；lease 释放时清指针/遮罩/预览 |

## 17 个 computer_* 工具

**双路由是主旋律：element_token（background，AX/UIA 注入不抢焦点，默认）与 x/y（foreground，HID+抢焦点，需公告）互斥，混用直接拒绝。**

| 工具 | kind → 驱动工具 | 语义 |
|---|---|---|
| `computer_app_list` | app_list → `list_apps` | 发现运行中/已安装应用；未运行应用返回 bundle_id 供直接 launch |
| `computer_window_list` | window_list → `list_windows` | 某进程原生窗口精确清单（pid 必填） |
| `computer_display_list` | display_list → 宿主自有 `host_display_list` | 显示器边界/工作区/缩放/光标坐标（Electron screen API，不走驱动） |
| `computer_window_set_frame` | window_set_frame → `set_window_frame` | 移动/缩放窗口；desktop 坐标而非截图像素 |
| `computer_desktop_state` | desktop_state → `get_desktop_state` | 主显示器截图（多显示器固定主屏，工具描述明示刻意门面） |
| `computer_app_launch` | app_launch → `launch_app` | 后台启动；macOS 可用 file:// URL 开文档 |
| `computer_app_activate` | app_activate → `bring_to_front` | 持久激活抢焦点；描述强制要求事先向用户说明 |
| `computer_app_state` | app_state → `get_window_state` | **核心观察**：AX/UIA 语义树 + 可选窗口截图 + element_token，query 支持语义过滤 |
| `computer_click` | click → `click` / `double_click` | token 或坐标定位（互斥，混用报 `computer_conflicting_input_target`） |
| `computer_drag` | drag → `drag` | macOS 0.22.1 **仅支持 foreground**（工具描述写死，防模型探测不可用路由） |
| `computer_type` | type → `type_text` | UTF-8 文本输入；明确禁止 shell/AppleScript 替代 |
| `computer_set_value` | set_value → `set_value` | 仅可访问性写值，无 delivery_mode；值变了≠输入处理器执行过 |
| `computer_select_text` | select_text → `hotkey [Cmd/Ctrl, a]` | 全选字段文本；foreground 坐标路由先点击聚焦 |
| `computer_key` | key → `press_key` / `hotkey` | 单键名 + 分离修饰键数组；foreground+坐标+修饰键时改派 `hotkey` |
| `computer_scroll` | scroll → `scroll` | amount 是滚轮格数（1-50）**不是像素** |
| `computer_secondary_action` | secondary_action → `invoke_menu` | 按完整菜单路径调用原生菜单；其余 AX 动作名 fail-closed |
| `computer_verify_state` | verify_state → `verify_state` | 结构化后置条件验证：1-8 谓词 AND、timeout ≤10s、stable_samples 1-5 |

通用参数机制：定位参数允许显式 `null`（抑制弱模型乱填 0 值坐标）；`desktop` scope 仅对 click/key/type 开放且不接受坐标；窗口类错误由宿主翻译成"刷新 app_list → window_list → 用观察到的 window_ref → 禁止猜相邻窗口、禁止改用 Bash/AppleScript"的修复指令返回给模型。

## 结果信封与反幻觉

- `content` 首块为文本摘要 + `type:'image'` 截图块（上限 7MB，畸形格式不注入，fail-closed）；结构化 JSON 进 `details.structuredJson` 供 UI 用（LLM 不读）。
- `app_state` 若窗口 AX 未解析（`ax_window_unresolved`）**丢弃全部图片**并标 isError（防闭窗裁剪画面串入其他应用内容）。
- 反幻觉注入：无截图观察提示"别把上一张图当当前状态"；点击无 effect 元数据时提示"回执不证明效果，先读新状态"。

## 动作机制：background 拒绝不升级

| 规则 | 事实 |
|---|---|
| foreground 判定 | app_activate/app_launch/secondary_action、`delivery_mode:'foreground'`、desktop 目标一律 foreground，并触发桌面遮罩 + 窗口移交 |
| 拒绝不升级 | background 被应用拒绝时**绝不**自动改发 foreground；已知不可靠场景直接返回结构化错误（`shouldAvoidNativeBackgroundClick`），升级决定留给模型+用户 |
| hotkey 规避 | foreground 快捷键的坐标路由改用 `hotkey`（带焦点点击+标志位 HID 事件），避开 macOS 14 修饰键和弦丢失 |
| UI 示能 | 半透明遮罩条（图标+文案+**停止按钮**，等价 POST abort）、54px 指针动画（`setContentProtection`，不出现在截图，不读不动真实光标）、窗口级预览、抢焦点前后主窗口交还 |
| 可观测性 | action_dispatch/mapped/result 结构化日志 + CU 专用 5MB×4 轮转日志；`MAVIS_CUA_DIAGNOSTICS=1` 出 AX/后台键盘诊断 |
| 附加联动 | `app_launch` 后专门的窗口观察步骤验证新窗口出现 |

## 权限模型（macOS TCC）

**权限缺失即 fail-closed，且每次派发前都复查。** screenRecording 走 TCC 查询 / `desktopCapturer` 触发系统弹窗，accessibility 走 `isTrustedAccessibilityClient`；CUA 每次请求派发前发 `cua-permissions-request`，宿主逐项校验 `granted|not-required`，不满足则拒绝该请求、清预览目标并向所有窗口广播权限引导（STATUS/REQUEST/OPEN_SETTINGS 三通道）。非 macOS 返回 `not-required`（代码注释明确不得误用于物理屏幕读取）。

## 安全模型六层

| 层 | 机制 |
|---|---|
| OS | 屏幕录制 + 辅助功能 TCC 双授权，缺失即拒绝请求 |
| 准入 | 官方插件 + Host Binding + 会话级选择（interactive surface only） |
| 并发 | 单租约互斥 + generation fencing + AbortController 注册表 |
| 提示 | background 优先 / foreground 公告义务 / 禁止 shell·AppleScript·浏览器自动化替代 / verify_state 合同 / 禁止猜窗口与凭据（17 工具描述 + 插件内 SKILL.md） |
| 展示 | 桌面遮罩 + 一键停止 + 指针可视化 + 窗口移交 + 活动期防休眠 |
| 审计 | CU 专用轮转日志 + 诊断模式 |

## 与 Claude 工具协议的关系（CU 视角）

**不是 Anthropic computer-use beta（未见 `computer_20250124` 或 beta header），而是自建 17 工具面借 Anthropic Messages 协议承载。** 长指令式 description + JSON Schema（typebox 包装）经 PiTurnRunner → pi-ai 编码进 `tools` 字段；截图以标准 `content:[{type:'image',…}]` 块回传，与 Claude 工具结果的 image 契约一致。
