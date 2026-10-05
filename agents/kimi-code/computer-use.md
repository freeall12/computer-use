# Kimi Code Computer Use（KimiCU）完整逆向

> 对象：Moonshot AI Kimi Code 的 macOS 桌面控制子系统 KimiCU（v0.6.6，本机 2026-10-06 实测）。
> 方法：只读静态分析（otool/nm/strings/asar 解包）+ 只读探针（service-status/xpc-ping）+ 明文 JS 资源直读 + 会话实录比对。
> 证据编号 `(E#)` 对应 [evidence/inventory.md](evidence/inventory.md) 各节。

## TL;DR

KimiCU 是**独立签名的原生 Swift 常驻服务**（`/Applications/KimiCU.app`，bundle id `ai.kimi.cu`），由 launchd 按需拉起（Mach service `ai.kimi.cu.service`），独占持有 TCC「辅助功能 + 屏幕录制」权限。CLI（kimi）通过插件 `kimi-cu` 把它挂成 stdio MCP server（18 个 CU 工具 + `js`/`js_reset`），也可经 node-repl JS facade `@kimi/cu` 以代码模式批量调用。核心设计是**后台定向输入**：永不移动真实光标、永不抢前台、永不走 HID tap；观察 = 截图（ScreenCaptureKit）+ 收敛 AX 树（会话 diff），动作 = 经 SkyLight 窗口路由或 postToPid 的签名合成事件，投递后可做 AX/像素后验证。后台 Chromium 键盘注入采用了 Cua AI 公开的 `SLSEventAuthenticationMessage`+`SLEventPostToPid` 机制（THIRD_PARTY_NOTICES 明文致谢）。

## 1. 能力载体清单

| 组件 | 路径 | 说明 |
|---|---|---|
| 原生服务二进制 | `/Applications/KimiCU.app/Contents/MacOS/kimi-cu` | Swift arm64，6.2MB；同二进制多形态运行：`service`（launchd 常驻）/ `mcp`（stdio MCP server）/ 维护子命令 |
| LaunchAgent | `…/Contents/Library/LaunchAgents/ai.kimi.cu.service.plist` | `MachServices={ai.kimi.cu.service:true}`，`RunAtLoad=false` → 首个连接者触发拉起 (E1/E2) |
| UDS 运行时端点 | `~/Library/Application Support/KimiCU/runtime.sock` + `runtime.token` | 本机实测 listening (E2) |
| node-repl 运行时 | `…/Contents/Resources/node-repl/`（bin/node 112MB + kernel.mjs + trusted-worker.mjs + meriyah） | `js` 工具的沙箱内核 (E4) |
| CLI 插件 | `~/.kimi-code/plugins/managed/kimi-cu/`（v0.6.3） | `bin/kimi-cu-mcp` wrapper → `exec "$APP" mcp`；manifest 声明 `enabledTools` 白名单 (E1) |
| 遗留 MCP 注册 | `~/.kimi-code/mcp.json` → `kimi-cu mcp -s user` | capability 层会自动把这种 legacy 注册迁移到插件 (E7) |
| 视觉资源 | `kimi-cu_Overlay.bundle`（cursor.png / cursor_halo.png / click_glow.png）、`kimi-cu_Permissions.bundle`（Accessibility.png / Screenshots.png）、`kimi-cu_kimi-cu.bundle`（agent-kimi-code.png / agent-claude-code.png / agent-chatgpt.png / agent-gemini.png / agent-hermes.png） | 浮层动画素材；权限引导 UI；**按"哪个 agent 在控制"展示对应图标**（推断：权限/状态面板识别已安装的 agent 客户端，strings 见 `detectInstalledAgents`/`_installedAgents`）(E3) |

## 2. 架构分层

```
kimi CLI (Node SEA, agent-core-v2)
 │  capability 层 entries/kimiCu.ts：detect/install/健康探测 (E6)
 │  插件层 plugins/managed/kimi-cu：kimi.plugin.json → stdio MCP
 ▼
/Applications/KimiCU.app/Contents/MacOS/kimi-cu  mcp        ← MCP server 模式（MCPServer Swift 模块）
 │   tools: 18 CU 工具 + js/js_reset；snapshot_id 绑定观察上下文
 ├──（js 工具时）spawn Resources/node-repl：bin/node + trusted-worker.mjs(监督者)
 │        └─ kernel.mjs（每 cell 内核, NDJSON kernel-protocol v1）+ meriyah 静态检查
 │             └─ @kimi/cu facade → nodeRepl.rpc("kimi-cu") → UDS 会话（native_pipe）
 ▼
kimi-cu service（launchd, ai.kimi.cu.service）                ← 权限 owner
 │  UDS `~/Library/Application Support/KimiCU/runtime.sock`（token 认证, KimiCU-UDS-1 帧协议）(E4)
 │  hello 握手：token + protocol + observation_context + runtime_version（版本门）(E4)
 ▼
Swift 模块（nm 符号表聚类, E3）
 ├─ AXTree / AXAction / AXSnapshotLifecycle / ObservedSnapshotStore   ← 观察
 ├─ Screenshot（ScreenCaptureKit; meanAbsDiff/changedFraction 会话 diff）← 观察
 ├─ BackgroundInput / SignedKeyboard / KeyDSL / SkyLight              ← 动作
 ├─ Overlay（cursor/click_glow 浮层）                                 ← 用户可视反馈
 ├─ Permissions / Telemetry / Windows                                 ← 支撑
 ▼
macOS：AXRuntime（AXUIElement*/AXObserver*）、ScreenCaptureKit、
       SkyLight（私有）SLSEventAuthenticationMessage+SLEventPostToPid、
       CGEventPostToPid（public 回退）、Pasteboard（paste 工具临时剪贴板）
```

与同类的对照（详见 §9）：

| | KimiCU | ZCode cua-helper | Codex（本机痕迹） |
|---|---|---|---|
| Helper 形态 | 独立 .app + launchd Mach service 按需启动 | 独立 .app，host `open -n -g` 拉起 + 一次性 token | —— |
| 权限 owner | launchd Service（"CLI may lack accessibility permission; the launchd Service holds it for MCP"）(E3) | helper bundle id（peer 验签） | —— |
| 传输 | UDS + token + 帧协议 KimiCU-UDS-1 | NDJSON/UDS（随机路径 sock）；Windows 命名管道 | —— |
| 工具面 | 18 MCP 工具 + js/js_reset | 30 MCP 工具（63 broker 方法） | —— |
| 动作机制 | SkyLight 路由 / postToPid 签名事件，**不用 HID、不动真实光标** | ax_native.node 后台输入队列 + SkyLight 双加载器 | —— |

三者同构：**Agent(工具面) → 本地 IPC(鉴权) → 独立 Helper(持权限) → AX/CG 私有 API**。KimiCU 的独特处：(a) 服务常驻 + launchd 按需；(b) node-repl 代码模式（CU 调用可编程批量）；(c) `observation_context` 让 MCP 与 JS 两条链路共享观察缓存/快照绑定。

## 3. 完整工具面（18 + 2）

MCP server 名 `plugin-kimi-cu:mac`（会话实录 E10）。以下参数语义全部取自二进制内嵌 schema JSON (E3.4)，JS facade 侧约束取自 `tool-catalog.mjs`/`schema.mjs` (E4)。

### 3.1 观察

| 工具 | 必填 | 关键参数 | 语义 |
|---|---|---|---|
| `list_apps` | — | `running_only` | 可定位 app（name/bundle_id/pid/is_running/**has_cef/has_chromium_input_surface**）；false 时还扫描已安装用户 app（pid=0=未运行），过滤内部 helper/后台服务 |
| `list_windows` | — | `app`/`pid` | 屏上可定位窗口（window_id、title） |
| `get_window` | `window_id` | app/pid | Window2 句柄 → app/pid/id/title；窗口已关则报错 |
| `get_app_state` | app 或 pid | `mode:"full"\|"image"\|"ax"`、`ax_filter`、`rect{x,y,width,height}`、`screenshot_detail:"standard"\|"high"`、`disable_diff`、`additional_window_ids`(≤3)、`window_id` | **主观察工具**：截图 + 收敛 AX 树，scope 到主窗口；diff 模式只回增量（`disable_diff` 回全树）；`rect` 用窗口内点坐标且原生分辨率裁剪；输出 `is_electron/has_cef/has_chromium_input_surface` 供路由判断；index 操作的快照随 AX 输出缓存 |
| `get_window_state` | window_id | `include_screenshot`/`include_text`/`rect` | 按窗口号定点观察 |
| `launch_app` | `app` | — | 启动已安装 app 但**不激活** |
| `activate_window` | 目标四选一 | — | 显式抬窗；"Use only when a task requires visible interaction" |

观察关键机制：

- **snapshot_id 绑定**：`get_app_state` 产生 AX snapshot 身份，后续 `click(type:"index")`/`set_value`/`scroll`/`select_text`/`perform_secondary_action` 携带的 `snapshot_id` "stale or other-context IDs are rejected" —— 跨观察上下文复用索引直接拒绝 (E3.4)。
- **坐标纪律**（官方 skill 明文, E1 skills/kimi-cu/SKILL.md）：x/y 是"所用截图的像素坐标"不是屏幕坐标；mode:"ax" 的 bbox 是窗口内点坐标不能直接当截图像素用；浮窗必须用浮窗自己的 `screenshots[]` 条目 + 其 `window_id` + `screenshot_id`。
- **会话 diff**：AX 树 + 截图都做增量（Swift 侧 `meanAbsDiff`/`changedFraction`/`regionDiffRatio`/`isBlankImage`, E3.2）；JS 侧读 `tree_diff`/`state_diff` 时须检查 `mode` 与基准，首次观察/新窗口/纯图观察无增量 (E1)。

### 3.2 动作

| 工具 | 定位方式 | 语义要点 |
|---|---|---|
| `click` | `index` 或 `x,y`（截图像素） | 后台定向点击；`button/mouse_button: left\|right\|middle`；`count:1..3`；`hold_ms`（按下保持）、`hover_ms`（按下前悬停）；`channel:auto\|skylight\|public`（见 §5.1）；`allow_foreground_fallback`（默认 never-front，false 强禁）；`verify_after`（AX/像素后验证，未观察到效果 → `ok:true, verified:false, verification_required`）；"A delivered click with an unobserved effect is never automatically repeated"；**"It never uses a HID tap or moves the real pointer"** |
| `type_text` | 可选 `index`/`x,y` 聚焦，否则注入当前焦点 | 后台输入 Unicode 文本；`clear:true`（先全选删除=替换）、`submit:true`（打完回车；定向输入先做回读验证再回车）；失败恢复可经 AX 重建字段，"A failed recovery does not clear the field or automatically activate the app"；Electron 无 AX 回读 → `verified:false, verification_required:"screenshot"`；`activate:true` 强制前台路径（报 `used_backend=foreground_targeted`） |
| `press_key` | — | xdotool 风格 DSL（`"return"`、`"cmd+a"`、`"cmd+shift+t"`；空格分隔批量 `"cmd+a backspace"`；空格键拼 `space`）；默认后台投递，"lands even when the target window is fully covered by other windows (verified for native apps on macOS 26)"；`activate:true` 时短暂抬窗冲刷输入（可见闪烁） |
| `paste` | 当前焦点 | 临时剪贴板投递并在事后恢复；`format: text\|md\|html`（富文本） |
| `scroll` | `index` 或 `x,y` | `page` 优先（正=向上，绝对值=页数）、`dx/dy` 为 legacy 行级滚轮；"Returns ok:false when no movement is detected or the target is already at the end"；cursor-safe |
| `set_value` | `index` + `value` | 原生控件走 AXValue；Electron/Web 文本控件走"no-raise 后台替换路径"（清空而非追加）；数值控件收数字字符串；`autosubmit:true`（AXSearchField 验证写入后后台回车提交）；无法确认投递时返回 `verified:false` |
| `perform_secondary_action` | `index` | 元素二级 AX 动作（默认 `AXShowMenu` = 右键菜单），`action` 可显式指定 |
| `select_text` | `index` | 按 `start+length` 精确偏移或按可见文本（`prefix/suffix` 消歧）选择；`selection: text\|cursor_before\|cursor_after`；内容选择回显 `selected_text` |
| `drag` | `from_x,from_y → to_x,to_y`（截图像素） | `hold_ms`（按下保持，时间线编辑器区分移动/框选）、`step_ms`（插值点间隔）、`steps`；"Cursor-safe; unreliable on Chromium"；**标题栏起点拖动 = 经验证的 AXPosition 写入移动窗口**（"synthetic events cannot engage the WindowServer move session"） |
| `drag_paths` | `paths[1..500]` × `{points[2..1024], steps?, hold_ms?, step_ms?}` | 同窗口批量笔画（绘画/手势）；须显式 `window_id`；`abort_if_cursor_in_window:true` 用户光标守卫；非事务——返回 `results/delivered/total`，中断可从首个 false 续作 |

### 3.3 调试与代码模式

| 工具 | 说明 |
|---|---|
| `debug_tap` | 在服务内对某 pid 起带注解的 event tap N 秒（默认 30），把投递到该 pid 的每个事件记录到 `/tmp/kimicu-pidtap-<pid>.log`；只读 |
| `js` / `js_reset` | node-repl 代码模式（见 §6）；插件 manifest `enabledTools` 白名单显式包含二者 (E1) |

参数双轨：schema 层同时接受 snake_case 与 camelCase 别名（`window_id/windowId/id`、`screenshot_id/screenshotId`、`index/element_index`、`keys/key`、`selection/selection_type`、`autosubmit/autosubmit_search_fields`、`from_x/fromX`…），校验严格拒绝未知字段（错误码 `KIMI_CU_UNKNOWN_FIELD`）后统一翻译为原生 ToolRouter 字段 (E4 tool-catalog/schema)。

## 4. 观察机制

1. **截图**：ScreenCaptureKit（链接库 E3.1；`Screenshot` 模块 `CaptureMode`/`Detail{standard,high}`/`captureWindowRegionPixels`/`sampledRectInWindow`，E3.2）。权限缺失时有 `triggerRecordingPrompt` 主动拉起 TCC 授权。多窗口/浮层以 `screenshots[]` 返回（每张带 `window_id`/`id`）。
2. **AX 树**：AXUIElement/AXObserver 全家（E3.3 strings），`AXObserverAddNotificationAndCheckRemote` 暗示远端元素通知监测；"convergent Accessibility tree"（收敛 = 与截图几何对齐并编号 index）；AX 文本一行一元素，UI 内换行显示为字面 `\n` (E3.4)。
3. **增量 diff**：会话级 diff 基准（ObservedSnapshotStore/AXSnapshotLifecycle）；`disableDiff` 用于"missed or invalid diff base"后回全树。
4. **无 set-of-marks 式编号叠加**：未在本机 CU 链路发现 SoM 视觉标记（桌面内嵌浏览器有 annotation 但那是 browser-use 链路）。元素定位靠 AX index + 截图像素双轨。
5. **Chromium 判别**：`is_electron/has_cef/has_chromium_input_surface` 决定输入路由（§5）。

## 5. 动作机制（KimiCU 的核心黑科技）

### 5.1 点击通道（channel）

来自 click 工具 schema 原文 (E3.4)：

- `auto`（默认）：**SkyLight 窗口路由通道** —— "the WindowServer stage enriches events with window number/local coords"，事件由 WindowServer 补全窗口号与窗口局部坐标后送达目标进程。
- `public`：整段序列（hover → primer → down/up）以 **NSEvent 工厂事件携带窗口号经 postToPid 投递**；在"长时间遮挡、已被节流的 Chromium 渲染进程"上，SkyLight 阶段可能停滞或分钟级延迟，而 public 保持完整 hover/焦点/导航语义。**无自动跨通道重试**：被吞事件可能分钟级后才落地，盲目重发同一坐标可能双击。
- `skylight`：强制仅路由通道（A/B 用）。

### 5.2 后台键盘（SignedKeyboard）

`THIRD_PARTY_NOTICES.md` 原文（≤10 行引用, E3.3）：

> Background-Chromium keyboard delivery in KimiCU uses an authentication-envelope
> mechanism (`SLSEventAuthenticationMessage` + `SLEventPostToPid`) that was
> publicly documented and implemented by Cua AI, Inc. in the MIT-licensed
> cua-driver. KimiCU's implementation in `Sources/SignedKeyboard/` is
> independently written

即：对后台 Chromium 窗口发键时，不走全局 HID，而是构造带认证封包的 SkyLight 事件定向投给目标 pid —— 窗口完全被遮挡也能落键（press_key schema 的 "verified for native apps on macOS 26"）。strings 另见回退路径 `bg-input falls back to public CGEventPostToPid` (E3.3)。

### 5.3 兜底阶梯与不做什么

- set_value/type_text 的兜底：AX 写值 / 编辑命令 / AX 聚焦，全部后台；`activate:true` 才短暂抬窗（报 `used_backend=foreground_targeted`）。
- 前台回退受双重门：`allow_foreground_fallback`（调用方）× 服务策略（默认 `never-front`）。
- **永不**：HID tap、移动真实光标、拦截用户真实输入、未经授权激活 app（官方 skill「操作边界」, E1）。
- 拖动窗口标题栏 = AXPosition 写入（合成事件参与不了 WindowServer 移动会话）。
- paste = 临时剪贴板写入 + 目标粘贴 + 剪贴板恢复。

### 5.4 投递验证（delivery verification）

错误/状态 strings（E3.5）：`delivery_unverified`（事件已发但 AX 回读未见文本）、`focus_unverified`（目标无 AX 回读面，投递完成但未确认）、`effect:"unverifiable"` + `verified:false`（遮挡窗口/CEF 原生 chrome 目标）。原则：**投递成功 ≠ 生效**；`verify_after` 开启 AX/像素后验证；未观察到效果的点击绝不自动重发。重试验证规则在官方 SKILL 有成体系的操作纪律（重观察优先、不盲试、不换动作绕过失败）。

## 6. `js` 工具与 node-repl 沙箱

`js` 是 KimiCU MCP 提供的代码模式入口（KimiCU 自带运行时，不是系统 node）：

```
Resources/node-repl/
  bin/node                ← 随包 Node（112MB）
  runtime/kernel.mjs      ← 每 cell 用户代码内核
  runtime/trusted-worker.mjs ← 监督者（trusted 协议）
  runtime/cell-compiler.mjs  ← cell 编译（meriyah 静态解析）
  runtime/kernel-protocol.mjs ← NDJSON 协议 v1：EXEC/CANCEL_EXEC/EXEC_RESULT/…
  packages/kimi-cu/public/index.mjs  ← @kimi/cu facade（18 方法）
  packages/kimi-cu/trusted-service/* ← UDS 客户端 + schema/校验/版本门
```

要点：

- facade 用法（官方 SKILL 示例, E1）：`var { kimiCU } = await import("@kimi/cu"); nodeRepl.write(await kimiCU.list_apps({running_only:true}));`
- 顶层变量跨 cell 持久；`nodeRepl.write()` 才有输出；观察产生的图片作为 image content 返回（attachments 经 `emitImage` 注入，JSON 内替换为占位符 "[provided as MCP image content]"，E4 service.mjs）。
- facade 与 MCP 工具参数**有差异**（例：JS `press_key` 用 `key`，MCP 用 `keys`；窗口可写 `window:{app,id,title}`；`index` 可写 `element_index`），facade 有独立校验与别名表。
- 安全链：cell 内代码不直接持有 UDS —— 经 `native_pipe.createExecConnection(endpoint)` 取 exec 作用域连接；每 exec 懒建会话、exec 结束即弃；hello 后跑 `assertRuntimeCompatible` 版本门（低于 `minimum_runtime_version=0.6.6` 报 `KIMI_CU_RUNTIME_TOO_OLD` 并给出升级 URL）；`approval_token`（可选，env `KIMICU_RUNTIME_REQUIRE_APPROVAL_TOKEN`/`KIMICU_RUNTIME_APPROVAL_TOKEN_FILE`）随 invoke 下发，缺失/无效报 `approval_token is invalid or missing` (E3.5/E4)。
- `js_reset`：清空 REPL 变量并重建内核；不清理 app 内草稿/撤销；升级后须 reset + 重连 MCP。

## 7. 安全模型

1. **TCC 权限归属服务**：辅助功能 + 屏幕录制授权给 KimiCU（launchd Service 持有；CLI/终端上下文 TCC 不同——`doctor` 输出明示 "this `doctor` runs from your terminal, whose TCC grants differ"）。授权引导 UI：`request-permissions --ax --screen` 弹 Permissions bundle 的图解窗口（"Drag KimiCU into the Accessibility list above…"）。本机实测 `accessibility=true screenRecording=true` (E2)。
2. **UDS 认证**：`runtime.token` 文件 + hello 握手；peer 身份校验（`rejected peer identity` / `rejected peer uid=` / `service: rejected untrusted peer pid=`）；认证失败即断链不留毒连接（uds-client.mjs 注释）。
3. **审批门**：`approval_token` 机制（服务端可强制要求；`approval_required`/`requires_approval_token`）——推断用于敏感操作二次授权，本机未观察到实际弹审批的实录（未在本机发现强制开启）。
4. **观察上下文隔离**：`observation_context`（client 随机 UUID）在 hello 中回显校验，快照/坐标缓存跨上下文不可复用 —— 防止多客户端串话。
5. **用户守卫**：`abort_if_cursor_in_window`（用户光标在窗口内移动/按住时拒投或中止笔画）；点击不动真实光标，天然不与用户抢输入。
6. **发送/付款类动作**由 SKILL 约束为"用户已明确授权的目标和范围内；缺少必要信息时再问"（模型纪律，非服务强制）。
7. **kill switch**：`kimi-cu uninstall` + `launchctl bootout gui/$uid/ai.kimi.cu.service` + `pkill -f '…kimi-cu (service|overlay)'`（capability 安装器反向操作, E6）。未发现运行时全局急停开关（未在本机发现）。

## 8. 安装 / 升级 / 运维

- 一键安装（官方推荐，compatibility.mjs `UPGRADE_URL`）：`curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash`。
- CLI capability 层安装流（E6）：装插件 zip → 下载 `KimiCU.app.zip`（ditto 解压）→ 停旧进程 → ditto 入 /Applications（失败 osascript 提权）→ 去 quarantine → `kimi-cu install`（SMAppService 注册，status=1=enabled）→ 权限缺失时 `request-permissions --ax --screen`。Windows x64 有平行实现（PowerShell 安装器 + `%LOCALAPPDATA%\KimiCU\kimi-cu.exe`，doctor 输出 `mcp=true&helper=embedded`）。
- 升级注意（SKILL）：服务升级**不会**自动替换长寿的 MCP 桥与 NodeRepl 内核；升级后须客户端重连 MCP + `js_reset`。
- 诊断：`kimi-cu doctor`（调用者上下文）、`service-status`（SMAppService 状态）、`xpc-ping`（权限 + runtimeSocket listening）、`probe <app>`、`tap-pid <pid>`、`keywin-probe --pid <pid>`。

## 9. 谱系判定：与 Claude Code / ZCode / Codex 的关系

- **与 Claude Code 无协议兼容**：Kimi CLI 的工具/插件/技能体系是自研（agent-core-v2 包树 + `kimi.plugin.json` + managed plugins CDN），MCP 是标准协议层。未发现 ANTHROPIC_BASE_URL 类兼容端（config providers 为 `type=openai`/`type=kimi`）。
- **CU 架构与 ZCode cua-helper 同构、实现独立**：两者都是「独立原生 Helper 持 TCC 权限 + 本地 IPC 鉴权 + 工具面绝不碰原生 API」。差异：KimiCU 用 Swift 写服务（ZCode helper 是 JS broker + ax_native.node）、KimiCU 经 launchd 按需常驻（ZCode host 每会话拉起）、KimiCU 面向"后台操作不抢电脑"的产品化更激进（overlay 光效、abort_if_cursor_in_window、never-front 策略）。工具名高度趋同（ZCode 30 工具 vs KimiCU 18+2，get_app_state/click/type_text/press_key/scroll/set_value/select_text/drag_paths 几乎一一对应），属同一设计范式的平行实现，而非代码 fork。
- **承认借鉴 Cua AI（trycua/cua）**：SignedKeyboard 的认证封包机制明确署名来源（THIRD_PARTY_NOTICES, E3.3）——这是唯一一处官方声明的第三方技术输入。
- **node-repl 形态与 ZCode node_repl MCP 同构**（cell 编译/内核/trusted worker/emitImage），KimiCU 侧为自研实现（自有工具目录生成器 `scripts/generate-tool-catalog.py`、自有协议名 KimiCU-UDS-1）。
- **webbridge 与 Codex 的浏览器扩展路线部分同构**：Codex 本机有 `chrome-native-hosts-v2.json`（native messaging 痕迹），Kimi webbridge 用 WebSocket（ws://127.0.0.1:10086/ws）而非 native messaging 连扩展（推断：MV3 扩展 + WS daemon，日志与 SKILL 证据）；两者都不是 CDP-over-DevToolsPort，但 webbridge 提供 `cdp` 工具作为 `chrome.debugger` 直通逃生舱。

## 10. 置信度与待复核

- 高置信（文件/符号/schema/实录四重印证）：§1–§3 工具面、§5.1–5.3 动作机制、§6 沙箱结构、§7.1–7.2 安全主链。
- 中置信（strings + 逻辑推断，标注推断）：Overlay 浮层何时渲染（有 cursor/click_glow 资源与 Overlay 模块，但触发条件未动态验证）；`agent-*.png` 的用途；`keywin-probe` 细节；Windows 链路（本机为 macOS，仅静态证据）。
- 未在本机发现：审批 token 的实际强制场景；全局 kill switch；CU 对 iOS/跨设备的任何扩展。
