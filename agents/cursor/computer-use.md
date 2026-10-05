# Cursor Computer Use（桌面控制）完整逆向

> 分析对象：Cursor 3.22.12（macOS arm64）+ cursor-agent CLI 2026.09.23-86fc751。`cursor-computer-use` 内置扩展自带完整 TypeScript 源码（`src/`），本文大量结论直接引自源码并标注 `文件:行号`，可信度高于一般压缩包逆向。

## TL;DR

1. Cursor 的 computer use 是**内置扩展 `cursor-computer-use` + 平台原生 sidecar（helper 进程）**的架构：扩展只做工具编排，从不自己合成输入或截屏；一切动作由原生 helper 执行。
2. 向 agent 的暴露方式与浏览器控制同构：`vscode.cursor.registerMcpProvider` 注册一方 MCP server，id 为 **`cursor-computer-use`**（`src/mcp/tools.ts:76`）。
3. macOS 有两种互斥模式（`src/mcp/mac-mode.ts`）：
   - **companion**（本机 Glass 代理默认）：后台驱动**单个 macOS app**，走 Accessibility（AX）读写元素，不动真实鼠标、不抢屏幕；
   - **remote**（云端/私有 worker）：接管整个屏幕移动真实鼠标，先 `computer_start_control` 租约、后 `computer_release_control`。
4. 原生 helper：macOS 为 Swift 应用 `computer-use-sidecar`（CDN 按签名 manifest 下载安装），Unix socket + 行分隔 JSON-RPC；Windows 为 `cursor-cua-sidecar.exe`（命名管道 + launch token 握手）；Linux（云端 worker）由 CLI 内置 xdotool/ffmpeg 实现。
5. **本机现状：CU 未启用**——Statsig 门 `mac_computer_use`/`local_computer_use` 默认关，本机未出现 sidecar 安装目录（`~/.cursor/computer-use-sidecar/` 不存在），也未发现 macOS helper 进程痕迹。以下工具面为静态逆向所得，非本机实测会话。

## 1. 能力载体与进程拓扑

```
┌─────────────────────────────────────────────────────────────────┐
│ 模型侧（服务端）                                                  │
│  · agent.v1 protobuf: computer_use 工具(#66)/record_screen(#69)  │
│  · 专用模型 "sand-cua"（sand_computer_use_playwright_config）     │
└─────────────────────────┬───────────────────────────────────────┘
                          │ MCP tools/call（一方 provider）
┌─────────────────────────▼───────────────────────────────────────┐
│ Cursor 主窗口                                                    │
│  · 内置扩展 cursor-computer-use (extension host, extensionKind:ui)│
│     - tools.ts: 16 工具 descriptor + zod 校验 + 指令文案          │
│     - mac-mode.ts: companion/remote 指令选择                     │
│     - Statsig 门控: mac_computer_use / local_computer_use        │
│     - 权限路由: glass "computer-use-permissions" 模态             │
└──────────────┬──────────────────────────────────────────────────┘
               │ 平台传输（src/backends/）
   ┌───────────▼────────────┐        ┌──────────────────────────┐
   │ macOS: computer-use-   │        │ Windows: cursor-cua-     │
   │ sidecar.app (Swift)    │        │ sidecar.exe              │
   │  发现: ~/Library/      │        │  命名管道(按用户SID)      │
   │  Application Support/  │        │  launch token (0600)     │
   │  cursor-computer-use/  │        │  每 connection 握手       │
   │  service.json 会合文件  │        │                          │
   │  Unix socket + JSON-RPC│        │                          │
   │  AX + 屏幕录制 (TCC)    │        │  Win32 注入/截屏          │
   └────────────────────────┘        └──────────────────────────┘
   ┌────────────────────────────────────────────────────────────┐
   │ Linux（cursor-agent CLI 的云端 worker 路径）:                │
   │   xdotool (X11 DISPLAY=:1) + ffmpeg x11grab → WEBP 截屏     │
   └────────────────────────────────────────────────────────────┘
```

| 载体 | 路径 | 版本/说明 |
|---|---|---|
| 内置扩展 | `/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-computer-use/` | v1.0.0，publisher `cursor`，`enabledApiProposals:["cursor","cursorPublic"]`；`dist/`（272KB 主包 + 9 chunk + 2 个 webp 编码 wasm）+ **`src/` 全源码** |
| 内置扩展 ID | `cursor.cursor-computer-use` | 出现在启动扩展白名单 `zUr` |
| CLI | `~/.local/share/cursor-agent/versions/2026.09.23-86fc751/index.js` | `computer_use_tool_pb.js` import、xdotool 执行器、ffmpeg 截屏 |
| 沙盒 helper | `/Applications/Cursor.app/Contents/Resources/app/resources/helpers/cursorsandbox` | 命令沙盒（shell 层面，非 CU 专属） |

## 2. 激活与门控（扩展未启动时如何"藏住"）

`src/extension.ts:208-282`：

1. `onStartupFinished` 激活 → 按平台取门：darwin=`mac_computer_use`，其他=`local_computer_use`。
2. 门为开 → `registerComputerUse()` 注册 provider、输出通道 "Cursor Computer Use"、sidecar 解析。
3. 门为关 → 挂 `vscode.cursor.onDidChangeGates` 监听，Statsig 之后任一次刷新把门打开时**延迟注册**（作者注释：区分"门真的关"与"Statsig 未水合"交由实验服务完成）。
4. Windows 另有子门 `windows_computer_use_batch` 决定 `computer_batch` 是否出现在工具清单（每次 listing 与每次调用各自读取，"ship dark" 设计）。

相关 flags（默认值快照）：`local_computer_use:!1`、`mac_computer_use:!1`、`windows_computer_use_batch:!1`、`sand_computer_use_unicode_typing:!1`。Glass 侧权限入口命令 `openComputerUsePermissions`（标题 "Manage Accessibility and Screen Recording"）同样先查 `mac_computer_use` 门，关着就直接打印 "Computer Use is not enabled."（workbench.glass.main.js）。

## 3. 工具面完整清单（含 schema 与语义）

以下为 macOS companion 模式实际暴露的 16 个工具（`src/mcp/tools.ts:1533-2093` 的 descriptor 汇总；Windows 差异单列）。所有工具共同约束：**不许并行调用**（"they act on one machine and run one at a time" 写进指令），坐标一律相对最近一次截图画布（固定 canvas 尺寸，(0,0) 左上，y 向下）。

### 3.1 观察

| 工具 | 参数 | 语义/返回 |
|---|---|---|
| `computer_screenshot` | app 目标（可选） | 主屏或单 app 窗口截图；app 目标下快照仍新鲜会**复用 snapshot_id 而不重走 AX 树**（此时无需再调 app_state）；否则只回图 |
| `computer_app_state` | `target`*；`element_id`；`snapshot_id` | 读 AX 树为**纯文本**：每行 `[id] ROLE name=… value=… settable actions=…` 按深度缩进；末行是 snapshot_id；`(+N descendants omitted)` 的行可用 element_id+snapshot_id 展开 |
| `computer_apps` | 无 | 列运行中的 macOS app（frontmost 优先），给出 pid + target_id；Spotlight/通知中心/菜单栏 extras 不支持 |
| `computer_resolve_app` | `pid`/`bundle_id`/`app_path`/`app_name` 四选一 | 解析单个 app，**未运行则启动但不激活**，返回 pid+target_id |
| `computer_check_permissions` | 无 | 被动报告 Accessibility + Screen Recording 授权状态（仅 macOS） |
| `computer_wait` | `ms<=30000`（默认 1000） | 等待稳定；companion 模式**纯文本返回**（截屏会误抓主屏） |

### 3.2 动作（屏幕 scope，remote 模式/接管后）

| 工具 | 参数 | 语义 |
|---|---|---|
| `computer_click` | `x,y`*；`button:["left","right","middle"]`；`count:1..3`；`modifier_keys` | 坐标点击；每次动作**返回动作后的新截图**（"look before you click" 原则） |
| `computer_move` | `x,y`* | 悬停移动（揭示 hover UI） |
| `computer_drag` | `from,to` 或 `path`(2–64 点，Win)；`button`；`modifier_keys` | 按下-拖动-释放；Win 侧 >2 点路径被限制在起始窗口内，越窗拒绝 |
| `computer_scroll` | `x,y`*；`direction:["up","down","left","right"]`；`amount:1..20`（macOS 默认 3 ticks，Win 10） | 滚轮滚动 |
| `computer_key` | `key<=100 字符` | 按键/和弦（`"Return"`、`"cmd+l"`；Win 侧 `win+r`、裸 `"alt"`=KeyTips） |
| `computer_type` | `text:1..4000` | 键入文本（换行=回车、制表=Tab，指令要求不要重复补发） |

### 3.3 动作（app scope，companion 专属，走 AX）

| 工具 | 参数 | 语义 |
|---|---|---|
| `computer_type`(app 目标) | `text` + `element_id`/`snapshot_id` | 有 element_id 走 AX 写入；无则插入"点击选中的字段"或焦点字段；**点错目标直接拒绝**；屏幕 scope typing 拒绝；不动真实光标 |
| `computer_set_value` | `target,element_id,snapshot_id,value`* | 通过 AX 直接替换 settable 元素的值，**不敲键盘**；树未变则 snapshot_id 持续有效，可连续填多个字段 |
| `computer_app_action` | `target,element_id,snapshot_id,action`* | AX 动作：`"press"`（隐含支持按钮/链接/菜单项/复选框/标签页）或元素 `actions=` 列表中的动作（如 `show-menu`、`scroll-to-visible`）；指令要求元素在树中时**优先于坐标点击** |

### 3.4 控制租约（remote 语义核心）

| 工具 | companion 语义 | remote 语义 |
|---|---|---|
| `computer_start_control` | **仅升级路径**："take over the display and move the real cursor"，用户要求接管屏幕时才允许；app 目标无需 session | 首个输入动作前必须调用；用户停止/helper 重启后需重新调用 |
| `computer_release_control` | 屏幕级操作结束后调用 | 收尾清理必调 |

源码注释（tools.ts:127-135）解释了 Windows 为何不暴露这两个工具：Win 侧租约只控制"屏上存在感"（真实光标 overlay 生命周期）不做输入门控，挂着反而多花模型轮次（实测一次会话浪费约 13 秒）。

### 3.5 Windows 专属（本机不适用，静态逆向）

- `computer_zoom {x1,y1,x2,y2}`：把最近截图的局部按原生分辨率（至多 N 倍放大）回传，返回 `zoom_id`；后续动作的 x/y 可以是 zoom 图坐标。源码注释记录了设计动机：一次 Paint 会话审计里 21 次点击失败源于目标只有几个 canvas 像素宽。
- `computer_batch {steps:[{name,arguments,expect_change}],allow_destructive}`：批量原子执行（步骤内是 sidecar 原生词汇 `computer_click/computer_key/...`）。
- action-result inset：点击/拖动/键入的返回自带 2× 局部放大图（省一次 zoom 往返）。
- 结构化 refusal 契约只对 Windows 模型陈述（macOS 指令不含 refusal 表）。

### 3.6 错误处理契约

`refusalResult()`（tools.ts:2120-2138）：错误结果 = `isError:true` + 文本（含 `Refusal code` 与推荐下一步）+ `structuredContent {code,message,escalation:{recommended,reason}}`。escalation 四档及模型预期行为（tools.ts:192-200）：

| escalation | 指令文案（意译） |
|---|---|
| `retry` | 原样重试并修正提示的参数；未产生任何真实动作 |
| `ask_user` | 停下转告用户；只有机器前的人能解除 |
| `use_different_tool` | 先执行提示的工具（通常是 screenshot）再重复动作 |
| `stop` | 结束本轮 computer use，不再调用任何输入/控制工具 |

sidecar 安装失败码：`offline/proxy_blocked/cdn_error/download_corrupt/signature_unverifiable/install_locked/install_failed`（含签名验证失败、安装锁冲突）。

## 4. 观察机制：截图 + AX 双通道

- **像素通道**：sidecar 截屏 → webp 编码（dist 下有 `webp_enc.wasm`/`webp_enc_simd.wasm`；CLI 侧用 ffmpeg libwebp `-lossless 1`）→ base64 作为 MCP image content 返回。画布固定（指令明示 canvas 尺寸与坐标范围），多分辨率屏缩放到统一 API 坐标。
- **结构通道**：macOS companion 的 `computer_app_state` 把 AX 树序列化为带 id 的文本行；`settable` 标记告诉模型哪些字段可 `computer_set_value`；`actions=` 列表告诉模型可用的 AX 动作。ref 一致性由 `element_id + snapshot_id` 双引用维护：树未变 snapshot 复用，树变则报 stale 要求重新观察。
- 对比浏览器侧：CU 的 observe-act 循环同样基于"快照引用"，但引用粒度是 **AX 元素 id**，而非浏览器注入的 DOM 属性。

## 5. 动作机制：谁在真正动鼠标键盘

| 平台 | 注入层 | 具体技术 | 证据 |
|---|---|---|---|
| macOS | Swift sidecar | 未在本机获得 helper 二进制（未安装），静态信息仅到 RPC 面（动作 RPC 名 `computer_use_click/scroll/mouse_move/mouse_button/drag/typing/press_key` 等）；companion 走 AX、remote 走 CGEvent 级注入为**推断**（源码注明 "send real mouse and keyboard input"、权限需求为 Accessibility+Screen Recording） | src/mcp/tools.ts:15、mac-mode.ts:16 |
| Windows | `cursor-cua-sidecar.exe`（Rust，源码注释引用 `windows/src/zoom.rs/batch.rs/drag_path.rs/keymap.rs/presence/lifecycle.rs`） | Win32 注入 + per-window 屏上光标 overlay | tools.ts 注释 |
| Linux(云) | CLI 内置执行器 | **xdotool**：`mousemove --sync`、`mousedown/up`、`click --repeat N --delay 50`、`key --`、`keydown/keyup`、`getmouselocation --shell`；中止时 `releaseHeldInput` 释放全部按住的修饰键与鼠标键 | CLI index.js 偏移 ~5620000 |

CLI 执行器细节（值得复用的工程细节）：

- 坐标缩放：模型 API 坐标 ↔ 显示器坐标双向映射（`scaler.apiToDisplay/displayToApi`）。
- 截屏：`ffmpeg -f x11grab -video_size WxH -i :1 -frames:v 1 [-vf scale=...] -c:v libwebp -preset text -lossless 1 -f webp pipe:1`，对 RIFF/WEBP 头做长度字段修补后 base64。
- 修饰键：click/drag/scroll 前逐个 `keydown`、动作后逆序 `keyup`。

## 6. 安全模型

1. **OS 权限门（macOS TCC）**：helper 需要 Accessibility + Screen Recording。模型侧第一指令就是先调 `computer_check_permissions` 并等待结果；扩展监听权限状态广播，缺权限时自动弹 Glass 模态（`glass.openComputerUsePermissions`，标题 "Manage Accessibility and Screen Recording"）引导去系统设置。Windows 无 per-app 权限，探测工具直接返回 granted（故不暴露）。
2. **companion 最小权限面**：默认只驱动单个 app、不碰真实鼠标、不抢屏幕；`computer_start_control`（全屏接管）在指令里被明确降级为"仅用户要求接管显示时"的升级路径；屏幕级 typing 直接拒绝。
3. **租约（lease）**：macOS 侧输入被租约门控；`user_aborted` 后续动作不会静默恢复控制；用户随时 Stop。
4. **分发链安全**：sidecar 安装包强制 manifest URL 与内容身份互证（lane/cursorVersion/40 位 sha 路径校验）、sha256 校验、codesign 锚定 Apple 公根 + TeamID `DCNK4UB866`、`pinnedSignerSubjects:["Anysphere, Inc."]`、跨进程安装锁、损坏/不可验证即拒绝（`signature_unverifiable`）。
5. **进程间安全（Windows）**：launch token 64 位 hex、文件 mode 0600、拒绝写入畸形 token；每连接握手验证（`SidecarHandshakeDeniedError`）。
6. **上游开关**：Statsig 门默认全关（`mac_computer_use`/`local_computer_use`/`windows_computer_use_batch`），团队侧 `TeamSettings` 有 `sandboxing_controls`、`mcp_tool_allowlist`、`admin_command_denylist` 等管理员策略字段。
7. **通用 agent 层**（与 CU/BU 共用）：YOLO/Run Everything 需显式开启且有警告弹窗；`yoloOutsideWorkspaceDisabled` 默认 true；删除文件保护、MCP 工具保护、Smart Auto（服务端分类器自动放行安全调用）详见 README 与 inventory §5。

## 7. agent 协议中的 CU（跨端契约）

- `agent.v1.MouseButton` 枚举：`UNSPECIFIED/LEFT/RIGHT/MIDDLE/BACK/FORWARD`（workbench.desktop.main.js）。
- `ClientSideToolV2Call` oneof 共 49 个客户端工具位，`computer_use_params` 为 **#66**、`record_screen_params` **#69**、`write_shell_stdin_params` **#43**（CLI index.js 偏移 ~8299486 的 static $() 反射表）。
- 会话 bootstrap 携带 `computer_use_supported`（bool）与 `computer_use_coordinate_mode`（string）——服务端据此决定是否下发 CU 工具及坐标模式（推断：可能对应 canvas/缩放策略）。
- protobuf 消息四件套：`computer_use_args/result/stream/tool_call` 与 `record_screen_*` 并列，说明"录屏"是独立工具位（云端会话回放用，本机未见对应 UI）。

## 8. 本机未发现的能力（明确排除）

- macOS helper 二进制：`~/.cursor/computer-use-sidecar/` 不存在；`~/Library/Application Support/cursor-computer-use/service.json` 不存在；app 包内也未内嵌（`resources/helpers/` 只有 crepectl/cursor-update-supervisor/cursorsandbox/node）。**即本机从未完成 CU helper 安装**，与门默认关一致。
- 未发现任何"截屏当前桌面给聊天模型"的常驻 UI 开关；CU 的截图只能由上述工具调用产生。
- `workbench.anysphere-ui-automations.js` 与 CU **无关**（是 cron 定时代理任务 "Automations" 的 UI 包，文件名误导，已验证 `cron`×75/`schedule`×49）。

## 9. 复现实操（只读）

```bash
# 扩展源码（直接可读）
ls /Applications/Cursor.app/Contents/Resources/app/extensions/cursor-computer-use/src/
sed -n '1533,2093p' .../cursor-computer-use/src/mcp/tools.ts   # 工具定义
cat .../cursor-computer-use/src/mcp/mac-mode.ts                # macOS 双模式

# 本机 CU 状态
ls ~/.cursor/computer-use-sidecar/ 2>/dev/null   # 本机为空 → 未安装
ls ~/Library/Application\ Support/cursor-computer-use/ 2>/dev/null

# CLI 侧 xdotool/ffmpeg 证据
grep -c xdotool ~/.local/share/cursor-agent/versions/*/index.js
grep -o 'ffmpeg[^"]*x11grab[^"]*' ~/.local/share/cursor-agent/versions/*/index.js | head -1
```
