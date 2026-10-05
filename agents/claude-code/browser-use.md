# Claude Code / Claude 桌面端：Browser Use（浏览器控制）完整逆向

> 分析对象：Claude Code CLI 2.1.212、Claude 桌面端 1.44121.4（macOS）。
> 证据：打包 JS 字面量（asar 解包至 /tmp）、原生二进制字符串、Helper 二进制分析；汇总见 [evidence/inventory.md](evidence/inventory.md)。

## 1. 结论先行

Claude Code 与 Claude 桌面端的浏览器控制统一由 **Claude in Chrome** 体系提供：**Chrome 官方扩展 + native messaging 宿主 + 本地 MCP 服务器**三段式。它不是 CDP 直连浏览器调试端口，也不是 Playwright 式托管浏览器，而是扩展内完成观察（DOM/可访问性/截图）与动作（页面级事件），宿主进程只做协议桥接与权限协调。

```
Chrome 扩展 (Claude in Chrome)
  ID fcoeoabgfenejglbffodgkkbkcdhcgfn（安装入口 https://claude.ai/chrome）
        │  Chrome Native Messaging（stdio，allowed_origins 锁定扩展 origin）
        ▼
chrome-native-host（Rust；桌面端 Helper 二进制，或 claude --chrome-native-host）
  - 按自身 PID 开 unix socket：/tmp/claude-mcp-browser-bridge-<pid>（win32 用 \\.\pipe\...；目录权限强制 0700）
  - 消息：mcp_connected / mcp_disconnected / tool_request / permission_request / ping
  - 清理死 PID 残留 socket；日志写 "Claude Nest/Library/Logs"
        │  本地 socket（MCP 客户端连接）
        ▼
MCP 客户端
  - Claude Code CLI：claude --claude-in-chrome-mcp → runClaudeInChromeMcpServer()
    （服务器名 JE="claude-in-chrome"，工具名 mcp__claude-in-chrome__*）
  - Claude 桌面端：@ant/claude-for-chrome-mcp（进程内注册表在 asar index.chunk-Bam8dXW9.js 偏移 ~2886000-2920000）
```

关键证据：
- CLI manifest 写入器（二进制偏移 ~229166800）：`{name:"com.anthropic.claude_code_browser_extension", description:"Claude Code Browser Extension Native Host", path:<wrapper>, type:"stdio", allowed_origins:["chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/"]}`，写各浏览器 `NativeMessagingHosts/<name>.json`（Windows 写注册表 `reg add <...\com.anthropic.claude_code_browser_extension>`）；wrapper 脚本 `~/.claude/chrome/chrome-native-host` 内容为 `exec <claude 二进制路径>`。
- 支持浏览器列表（偏移 226191732 区域）：`chrome, brave, arc, edge, chromium, vivaldi, opera`。
- 断线重连页：`https://clau.de/chrome/reconnect`；首次安装检测后自动打开。
- CLI/桌面端也会**扫描** `/tmp/claude-mcp-browser-bridge-*` 连接已运行的宿主（二进制与 asar 均含该前缀 + "Insecure socket directory permissions (expected 0700)" 检查）。

## 2. 完整工具面（mcp__claude-in-chrome__*）

来源：桌面端 asar `index.chunk-Bam8dXW9.js`（偏移 2886000–2920000 一带的 `name/inputSchema` 字面量）与 CLI 二进制中同名工具引用（`mcp__claude-in-chrome__tabs_context_mcp/navigate/computer/read_page/read_console_messages/javascript_tool/gif_creator/tabs_create_mcp` 等，UTF-8/UTF-16 明文）。

### 2.1 标签页与导航

| 工具 | 关键参数 | 语义要点 |
|---|---|---|
| `tabs_context_mcp` | `createIfEmpty?` | 会话入口。返回 MCP **标签组**（tab group）内的全部 tab；组不存在且 createIfEmpty 时新开窗口+新组+空 tab。描述强制"先 context 再干活"、"每会话用新 tab，用完 tabs_close 清理" |
| `tabs_create_mcp` | —/`url` | 在组内新开空 tab |
| `tabs_select_mcp` | `tabId` | 切换组内活动 tab |
| `tabs_close_mcp` | `tabId` | 只能关本会话组内的 tab；关掉最后一个 tab 组自动消散 |
| `navigate` | `url`（"back"/"forward" 或任意 URL，缺省补 https://）、`tabId?` | 单独调用可省 tabId（自动 context+createIfEmpty 并把 tab 列表附加到结果）；`browser_batch` 内**必须**显式 tabId |
| `resize_window` | `width/height/tabId` | 窗口尺寸调整（响应式测试用） |

### 2.2 页面观察

| 工具 | 关键参数 | 语义要点 |
|---|---|---|
| `read_page` | `tabId`、`filter: "interactive"\|"all"`、`depth?`(默认15)、`ref_id?`、`max_chars?`(默认50000) | **可访问性树**表示；超限在行边界截断并注明全文尺寸；`ref_id` 聚焦子树 |
| `find` | `tabId`、查询 | 按语义找元素，返回 `ref_N` 引用（供 computer/form_input/scroll_to 使用） |
| `get_page_text` | `tabId` | 正文纯文本抽取（"prioritizing article content"，readability 式），无 HTML |
| `read_console_messages` | `tabId`、`onlyErrors?`、`clear?`、`pattern?`、`limit?`(默认100) | 控制台消息；描述强烈建议必须带 pattern 过滤 |
| `read_network_requests` | `tabId`、`urlPattern?`、`clear?`、`limit?` | XHR/Fetch/文档/图片请求；跨域可见；换域自动清空 |
| `computer action:"screenshot"` / `zoom` | `scale?`、`region?`、`save_to_disk?` | 截图/区域放大；旧版扩展不支持 scale 时回退全尺寸 |

### 2.3 页面动作

| 工具 | 关键参数 | 语义要点 |
|---|---|---|
| `computer`（浏览器版） | `action`、`coordinate?`、`text?`、`ref?`、`modifiers?`、`repeat?`、`duration?`、`scroll_direction/amount?`、`start_coordinate?`、`region?`、`scale?`、`tabId`(**必填**) | action 枚举：`left_click, right_click, type, screenshot, wait, scroll, key, left_click_drag, double_click, triple_click, zoom, scroll_to, hover`。`scroll_to` 用 ref 把元素滚入视野；点击可 `ref` 代替坐标；key 禁止页面缩放组合键（提示改用 zoom）；`repeat` 1-100 |
| `form_input` | `ref`、`value`、`tabId` | 按 ref 设表单值：checkbox 用布尔、select 用 option 值或文本、其余字符串/数字 |
| `javascript_tool`（注册名 `javascript_exec`） | `action:"javascript_exec"`、`text`（JS）、`tabId` | 页面上下文 REPL 求值：顶层 await 可用、末表达式自动返回、JSON 序列化 |
| `file_upload` | `paths[]`（宿主绝对路径）、`name?/mimeType?/contents?(base64)`、`tabId` | **由客户端读文件**："Populated by the client from `paths` after it reads them under its own file-read permissions; do not set this yourself"——扩展拿不到宿主文件系统，路径读取走宿主自身文件权限 |
| `upload_image` | `imageId`（此前截图）或 `coordinate`（拖放目标）、`tabId` | 把截图/用户图片传给 `<input type=file>`（含隐藏 input）或拖放到可见区域（如 Google Docs） |
| `gif_creator` | `action: start_recording/stop_recording/export/clear`、`options{showClickIndicators,showDragPaths,showActionLabels,showProgressBar,showWatermark,quality 1-30}`、`download?` | 录制操作过程导出带标注 GIF（点击橙圈/拖拽红箭头/动作标签/进度条/水印） |
| `browser_batch` | `actions:[{name,input}]` | 一次往返顺序执行多个上述工具，首错即停；**每项独立过权限检查**（无权限域的下一项失败停批）；不能嵌套；批内坐标参照批前截图 |

### 2.4 连接管理（多设备/多浏览器）

| 工具 | 语义 |
|---|---|
| `list_connected_browsers` | 列**当前账号**连接的所有 Chrome 实例（deviceId、名称、平台、是否本机） |
| `select_browser` | 按 deviceId 直连（配对广播不弹） |
| `switch_browser` | 向所有装了扩展的 Chrome 广播配对请求，等用户手动点"Connect"（最长 2 分钟） |

桌面端登录态切换时执行 `resetLocalPairingIdentity/syncProactivePairing`（`claude-in-chrome-local-pairing`，asar 偏移 2582166）——本地配对身份与账号绑定。

### 2.5 Shortcuts

`shortcuts_list` / `shortcuts_execute`：枚举/执行扩展侧的快捷指令（workflow），在新 sidepanel 里对当前 tab 运行，立即返回不等待完成（如 `/debug`、`/summarize`）。

## 3. 观察与动作机制

1. **观察**：`read_page`/`find` 返回扩展构造的**可访问性树**（含 `ref_N` 稳定引用）；`get_page_text` 做正文抽取；截图来自扩展侧（截图经宿主回传，桌面端落地目录前缀 `claude-chrome-screenshots-`）。控制台/网络日志由扩展 inspector 权限采集。
2. **动作**：点击/键入由扩展在页面上下文合成（`computer` 的坐标点击描述要求"先截图确认元素中心再移光标"，光标尖端对准目标中心），DOM 层操作（form_input/javascript_tool/file_upload）走扩展内容脚本能力。宿主与 CLI 均不含浏览器自动化引擎——CLI 二进制无 playwright/puppeteer 运行时依赖（`mcp__puppeteer__` 仅出现在示例文本中）。
3. **截屏坐标系**：浏览器版 computer 的截图返回 `tabId` 对应视口图像，坐标为视口像素；`scale` 缩放返回图省 token 但坐标保持全分辨率框架，且注明**旧版扩展不识别 scale 会回退全图**——扩展与宿主存在版本协商。
4. **批量语义**：browser_batch 的"每项独立权限检查 + 首错停批 + 坐标引用批前截图"与 CU 的 computer_batch 完全同构，属同一套 batch 抽象。

## 4. 权限模型

1. **会话级模式**：`chromePermissionMode ∈ {ask, follow_a_plan, skip_all_permission_checks}`（枚举顺序 `ask:0, follow_a_plan:1, skip_all_permission_checks:2`），随会话状态持久化（`chromePermissionMode/chromeAllowedDomains` 键，asar 偏移 ~4781719）。`skip_all` 仅在 bypass 权限模式下由 CLI 注入 `CLAUDE_CHROME_PERMISSION_MODE` 环境变量。
2. **域名白名单**：`allowedDomains`（宿主侧 24 处引用）→ 传给 MCP 服务器为 `allowed_domains`；`handle_permission_prompts: true` 表示宿主会弹交互式授权。
3. **逐动作授权**：扩展对每次敏感动作发 `permission_request`（chrome-native-host strings），载荷含 `tool_type/url/action_data/category`；`action_data` 内部字段 `_perActionOnly`（仅本次）、`_privateHostReadAlwaysOffer/_privateHostReadAlways`（私有地址站点总是可读）——对应扩展 UI 的"仅本次/本站总是允许/拒绝"。拒绝消息 `{msg:"refuse", code}`。
4. **tab 组沙箱**：所有工具只能操作本会话 MCP tab group 内的标签页，天然限制波及面。
5. **提示词层**：CLI 系统提示规定"扩展里可以点链接，但陌生 URL 仍须向用户确认"、"Chrome 扩展未连接时应请用户安装而非退化到像素级 CU"。
6. **传输安全**：socket 目录 0700 强制校验、死 PID socket 清理、`allowed_origins` 把 native messaging 锁定到唯一扩展 ID。

## 5. 桌面端专属变体

### 5.1 应用内 Browser pane（in_app_browser / "Claude Browser" surface）

同一套工具的**第二注册表**（asar 偏移 5606766 一带）：`read_page/computer/form_input/navigate/find/get_page_text/javascript_tool/read_console_messages/read_network_requests/resize_window/tabs_context/tabs_create/tabs_select/tabs_close`。差异：
- 目标是桌面端内置的 "Browser pane"（应用内浏览器面板），不是用户 Chrome；
- `computer` 描述改为 "Mouse/keyboard automation in the Browser pane"，坐标基于面板截图或 `ref`；
- `navigate` 未开面板时会自动打开（"no dev server needed"）——服务于 Cowork/Code 会话中让 Claude 自主浏览网页。
- 内部 surface UUID 表含 `"Claude Browser"` 与 `"Claude Preview"` 同 UUID，`inAppBrowser:"in_app_browser"`、`browserSurfaces:"browser_surfaces"` 系统提示分区。

### 5.2 preview_* 工具族（Claude Preview）

`preview_start/stop/list/logs/console_logs/screenshot/snapshot/inspect/click/fill/eval/network/resize`——面向 Cowork 生成的 Web 应用预览：起/停 dev server、抓日志、截图快照、DOM 检查、点击/填表/求值、网络与视口控制。与 Browser pane 共用面板基础设施（`browser-preview-` 前缀字符串）。

### 5.3 framebuffer_*（VNC 客机屏幕控制）

asar `index.chunk-DKLskb6i.js`：13 个工具 `framebuffer_list/attach/screenshot/zoom/cursor_position/click/type/key/scroll/drag/move/hold_key/batch`。

- 配置：`.claude/launch.json` 的 `configurations[]` 或 `.claude/launch.d/*.json`：`{"name","type":"framebuffer","vncUrl":"vnc://[:pw@]host:port","serverFlavor":"standard"|"vz","ownerPid"}`（`vz` 针对 Apple Virtualization.framework 宿主修正 Cmd/Option keysym；`ownerPid` 让孤儿条目自动消失）。
- 安全设计（工具返回的错误文案即文档）：
  - `pixelGuard`：点击/拖拽前比对目标像素与上次截图，不一致拒绝——`"[framebuffer:pixelGuard] refusing click (compare failed)"`；
  - 用户抢占检测：`"The user is controlling the screen — wait..."` / `"The user interacted with the screen — take a new framebuffer_screenshot"`；
  - 未观察不许动：`"No screenshot for this session yet. Call framebuffer_screenshot first — input is refused until you have observed the current screen."`；
  - 连接断开/输入暂停（预览面板未附着）时拒发；输入台账（framebuffer-ledgers）留审计痕迹。
- 这是 Cowork 让 Claude 控制自建 VM/远程机器屏幕的通道，与宿主桌面 CU（ComputerUseSwift）完全独立。

## 6. 权限与安全小结（浏览器侧）

| 层 | 机制 |
|---|---|
| 安装 | 扩展仅接受指定 native host（allowed_origins）；host 仅接受唯一扩展 ID |
| 传输 | 每实例独立 unix socket（PID 后缀）、0700 目录、跨平台 named pipe |
| 会话 | MCP tab group 隔离；tab 用完即清的提示词纪律 |
| 域名 | allowedDomains 白名单 + 逐动作 permission_request（ask/always/never）+ 私有网络特殊类目 |
| 模式 | ask → follow_a_plan → skip_all（仅 bypass 模式可达） |
| 降级 | 扩展未连接时提示安装，禁止静默退化为整屏 CU |
| 审计 | 宿主日志（Claude Nest/Library/Logs）、GIF 录制可视化（点击标记/水印） |

## 7. 与 computer-use-demo 的关系

官方 demo 无浏览器控制（其沙箱里只有 Firefox 可截屏点击）。本机这套浏览器工具中，`computer` 的 schema 与官方 CU 工具描述同源（action 描述文本几乎逐字一致），但：多了 `tabId` 必填、`ref` 元素引用、`scroll_to/hover/zoom`、`modifiers/repeat`；单工具拆分 + batch 编排；权限模型从"无"变为"域名+动作+tab 组"三层。可视为"官方 CU 工具面在浏览器场景的领域特化版"。

## 8. 本机未发现 / 不可用项

- 扩展 `fcoeoabgfenejglbffodgkkbkcdhcgfn` 未安装（Chrome `Default/Extensions/` 无该目录）。
- `com.anthropic.claude_code_browser_extension.json` 未注册到任何浏览器的 NativeMessagingHosts（该目录只有 Quark 与小米 MiMo 的第三方 host）。
- `~/.claude/chrome/` wrapper 目录不存在 → CLI 的三条 CU/BU 链路均未完成首次 setup。
- 用户设置中无 `chromePermissionMode/chromeAllowedDomains` 痕迹（`~/.claude.json` 无相关键）。
- 未发现 CDP 远程调试端口的使用（无 `--remote-debugging-port` 相关配置或监听证据）；控制路径为扩展 native messaging，非 CDP。
