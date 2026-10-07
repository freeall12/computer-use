# Cursor Computer Use（桌面控制）· 扩展只编排，sidecar 动手

> 分析对象：Cursor 3.22.12（macOS arm64）+ cursor-agent CLI 2026.09.23-86fc751。`cursor-computer-use` 扩展自带完整 TS 源码，本文结论直接引自源码并标注 `文件:行号`。证据见 [evidence/inventory.md](evidence/inventory.md)。

> 一句话结论：**内置扩展只做工具编排（16 工具 + zod + 指令），一切动作由平台原生 sidecar 执行；macOS 双模式互斥——companion 后台驱动单 app（AX），remote 接管全屏动真鼠标（需租约）。本机未启用，全貌来自随包源码。**

| 项 | 值 |
|---|---|
| 提供方 | 内置扩展 `cursor-computer-use` v1.0.0（`enabledApiProposals:["cursor","cursorPublic"]`，附完整 src/） |
| provider id | `cursor-computer-use`（src/mcp/tools.ts:76） |
| 工具面 | macOS companion 16 工具；Windows 加 zoom/batch（子门控） |
| 执行链 | Unix socket + 行分隔 JSON-RPC（service.json 会合）→ Swift sidecar（CDN 签名分发） |
| 双模式 | companion：后台单 app、AX 读写、不动真鼠标 ｜ remote：接管全屏、真实输入、先 start_control 租约 |
| 安全模型 | TCC 双权限 + check_permissions 探测 + 自动弹窗路由 · 租约门控 · 分发链签名互证 |
| 本机可用 | ⚙️ 未启用：门默认关、sidecar 目录不存在——以下为静态还原，非实测 |

## 架构一图

```
模型侧（服务端）：agent.v1 protobuf computer_use(#66) / record_screen(#69)；专用模型 "sand-cua"
 ▼ MCP tools/call（一方 provider；Statsig 门 mac_computer_use 默认关）
内置扩展 cursor-computer-use（extension host）
  tools.ts 16 工具 descriptor + zod 校验 + 指令文案 · mac-mode.ts 双模式指令
 │ 平台传输（src/backends/）
 ├─ macOS：computer-use-sidecar.app（Swift）
 │    发现：~/Library/Application Support/cursor-computer-use/service.json 会合
 │    Unix socket + JSON-RPC · Accessibility + Screen Recording（TCC）
 ├─ Windows：cursor-cua-sidecar.exe（Rust）：命名管道（按用户 SID）+ launch token(0600) 握手
 └─ Linux（cursor-agent CLI 云 worker）：xdotool + ffmpeg x11grab → WEBP
```

## 门控：扩展未启用时如何「藏住」

> 16 工具完整 zod schema 与参数约束见 `source/cursor/schemas/computer-tools.json`。

`src/extension.ts:208-282`：onStartupFinished 激活 → 按平台取门（darwin=`mac_computer_use`，其他=`local_computer_use`）→ 门开则注册 provider；门关则挂 `onDidChangeGates` 延迟注册（区分「门真关」与「Statsig 未水合」）。Windows 子门 `windows_computer_use_batch` 决定 `computer_batch` 是否出现在工具清单（listing 与调用各自读取，"ship dark"）。

## 工具面：16 个工具（companion 实际暴露）

**共同约束：不许并行调用**；坐标一律相对最近一次截图画布（固定 canvas，(0,0) 左上，y 向下）。

| 工具 | scope | 语义 |
|---|---|---|
| `computer_screenshot` | 观察 | 主屏或单 app 截图；app 快照新鲜时**复用 snapshot_id 不重走 AX** |
| `computer_app_state` | 观察 | AX 树纯文本 `[id] ROLE name= value= settable actions=`；末行 snapshot_id；`(+N descendants omitted)` 可用双引用展开 |
| `computer_apps` / `computer_resolve_app` | 观察 | 列运行中 app（frontmost 优先）/ 四选一解析（未运行则启动**不激活**） |
| `computer_check_permissions` | 观察 | 被动报告 TCC 双权限状态（仅 macOS） |
| `computer_wait` | 观察 | ≤30s 等待；companion **纯文本返回**（截屏会误抓主屏） |
| `computer_click` | 屏幕 | 坐标点击（button/count 1..3/modifier_keys）；每动作返回新截图（"look before you click"） |
| `computer_move` / `computer_drag` | 屏幕 | 悬停揭示 hover UI / 按下-拖动-释放（Win >2 点路径限起始窗口内） |
| `computer_scroll` / `computer_key` / `computer_type` | 屏幕 | 滚轮（amount 1..20）/ 键和弦（"cmd+l"）/ 键入 1–4000 字符 |
| `computer_type`（app 目标） | app | 有 element_id 走 AX 写入；**点错目标直接拒绝**；屏幕 scope typing 拒绝；不动真实光标 |
| `computer_set_value` | app | AX 直接替换 settable 元素值，**不敲键盘**；树未变 snapshot 持续有效（可连续填多字段） |
| `computer_app_action` | app | AX 动作：press 或元素 actions= 列表动作（show-menu 等）；指令要求**优先于坐标点击** |
| `computer_start_control` / `computer_release_control` | 租约 | companion 仅「用户要求接管显示」的升级路径；remote 首个输入前必调，收尾必调 |

> Windows 专属（静态还原）：`computer_zoom`（局部原生分辨率回传；源码注释：一次 Paint 审计 21 次点击失败源于目标只有几个 canvas 像素宽）+ `computer_batch`（allow_destructive）+ action-result 自带 2× 局部放大。Win 不暴露租约的原因（tools.ts:127-135）：Win 租约只控「屏上存在感」不做输入门控，挂着浪费模型轮次（实测约 13 秒）。

## companion / remote 双模式对照

| 维度 | companion（本机 Glass 代理默认） | remote（云端/私有 worker） |
|---|---|---|
| 目标 | 后台驱动**单个 macOS app** | 接管**整个屏幕** |
| 输入 | AX 读写（不动真实鼠标、不抢屏幕） | 真实鼠标键盘（CGEvent 级）【推断】 |
| 租约 | app 目标无需 session；start_control 仅升级路径 | 首个输入动作前必须调用；用户停止/helper 重启后重新调用 |
| typing | 屏幕 scope typing 直接拒绝 | 允许 |

## 错误契约与观察/动作机制

**结构化 refusal**（tools.ts:2120-2138）：`{code,message,escalation:{recommended,reason}}`；escalation 四档——`retry`（修正参数原样重试）/ `ask_user`（停下转告用户，只有机器前的人能解除）/ `use_different_tool`（通常先 screenshot 再重复动作）/ `stop`（结束本轮 CU）。sidecar 安装失败码：offline / proxy_blocked / cdn_error / download_corrupt / signature_unverifiable / install_locked / install_failed。

- **像素通道**：sidecar 截屏 → webp 编码（wasm）→ base64 image content；画布固定，多分辨率缩放到统一 API 坐标。
- **结构通道**：`element_id + snapshot_id` 双引用——树未变 snapshot 复用，树变报 stale 要求重新观察。
- **平台注入**：mac Swift sidecar（RPC 名 computer_use_click/typing/press_key…；companion 走 AX、remote 走 CGEvent 级注入为**推断**）；Win Win32 注入 + 光标 overlay；Linux xdotool（修饰键逐个 keydown、动作后逆序 keyup；ffmpeg x11grab 截屏修 RIFF 头后 base64）。

## 安全模型

| 层 | 机制 |
|---|---|
| OS 权限 | TCC 双权限；模型第一指令先调 check_permissions 并等结果；缺权限自动弹 Glass 模态引导系统设置 |
| 最小权限面 | companion 默认单 app、不碰真鼠标；start_control 指令明确降级为「仅用户要求接管显示时」 |
| 租约 | macOS 输入被租约门控；user_aborted 后不静默恢复控制 |
| 分发链 | manifest URL 与内容身份互证（lane/cursorVersion/40 位 sha 路径）+ sha256 + codesign 锚定 Apple 根 + TeamID `DCNK4UB866` + 跨进程安装锁 |
| 进程间（Win） | launch token 64 位 hex、0600、每连接握手（SidecarHandshakeDeniedError） |
| 上游开关 | Statsig 三门默认关；团队侧 sandboxing_controls / mcp_tool_allowlist / admin_command_denylist |

## agent 协议与本机排除项

- protobuf：`ClientSideToolV2Call` 49 个工具位中 computer_use=#66、record_screen=#69；会话 bootstrap 带 `computer_use_supported` + `computer_use_coordinate_mode`（服务端据此下发 CU 工具与坐标模式）。
- 本机明确排除：sidecar 目录与 service.json 不存在、app 包未内嵌 helper——**从未完成安装**，与门默认关一致；`workbench.anysphere-ui-automations.js` 与 CU 无关（是 cron Automations 的 UI 包，文件名误导，已验证）。

```bash
ls /Applications/Cursor.app/Contents/Resources/app/extensions/cursor-computer-use/src/
sed -n '1533,2093p' .../src/mcp/tools.ts        # 16 工具定义
ls ~/.cursor/computer-use-sidecar/ 2>/dev/null  # 本机为空 → 未安装
```
