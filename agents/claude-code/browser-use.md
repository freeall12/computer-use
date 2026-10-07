# Claude Browser Use（浏览器控制）· 扩展 + native messaging 三段式

> 分析对象：Claude Code CLI 2.1.212、Claude 桌面端 1.44121.4（macOS）。证据见 [evidence/inventory.md](evidence/inventory.md)。

> 一句话结论：**Claude in Chrome 体系：官方扩展做观察与动作（DOM/AX/截图/页面级事件），chrome-native-host 做协议桥接，本地 MCP server 做工具面——不是 CDP 直连，也不是托管浏览器。**

| 项 | 值 |
|---|---|
| 入口 | CLI `--claude-in-chrome-mcp` → `mcp__claude-in-chrome__*`；桌面端 `@ant/claude-for-chrome-mcp` |
| 链路 | Chrome 扩展 `fcoeo…` → Native Messaging（allowed_origins 锁定）→ chrome-native-host（Rust）→ unix socket `/tmp/claude-mcp-browser-bridge-<pid>`（0700） |
| 工具面 | 标签/观察/动作/连接管理/快捷指令约 30 个；`computer` 为浏览器版像素工具（tabId 必填 + ref 引用） |
| 观察扩展 | read_page 可访问性树（ref_N 稳定引用）· find 语义找元素 · 正文抽取 · console/network 采集 |
| 安全模型 | 会话级 chromePermissionMode 三档 + 域名白名单 + 逐动作 permission_request + tab 组沙箱 |
| 支持浏览器 | chrome, brave, arc, edge, chromium, vivaldi, opera |
| 本机可用 | ❌ 链路断：扩展未装、manifest 未注册、wrapper 目录不存在 |

## 链路一图

```
Chrome 扩展（Claude in Chrome，fcoeoabgfenejglbffodgkkbkcdhcgfn）
   │ Chrome Native Messaging（stdio；allowed_origins 锁定扩展 origin）
   ▼
chrome-native-host（Rust；桌面 Helper 二进制或 claude --chrome-native-host）
   · 按自身 PID 开 unix socket /tmp/claude-mcp-browser-bridge-<pid>（win32 命名管道；0700）
   · 消息：mcp_connected/disconnected · tool_request · permission_request · ping
   ▼ 本地 socket（MCP 客户端连接；也可扫描既有 bridge 连接已运行宿主）
MCP 客户端：claude --claude-in-chrome-mcp ｜ @ant/claude-for-chrome-mcp（进程内）
```

manifest 写入：`com.anthropic.claude_code_browser_extension` → 各浏览器 `NativeMessagingHosts/`（Windows 写注册表）；wrapper `~/.claude/chrome/chrome-native-host` 内容为 `exec <claude 二进制路径>`；扩展安装入口 `https://claude.ai/chrome`。

> 各工具完整 inputSchema 见 `source/claude-code/schemas/browser-tools.json`（含 desktopVariants）。

## 工具面（mcp__claude-in-chrome__*）

**标签与导航**

| 工具 | 语义 |
|---|---|
| `tabs_context_mcp` | 会话入口：返回本会话 MCP tab group 全部 tab；描述强制「先 context 再干活、用完 tabs_close 清理」 |
| `tabs_create_mcp` / `tabs_select_mcp` / `tabs_close_mcp` | 组内开/切/关（只能关本组 tab；关光最后一个组自动消散） |
| `navigate` | 单独调用可省 tabId（自动 context+createIfEmpty）；browser_batch 内**必须**显式 tabId |
| `resize_window` | 窗口尺寸（响应式测试） |

**页面观察**

| 工具 | 语义 |
|---|---|
| `read_page` | 可访问性树（filter interactive/all，超限行边界截断）；ref_id 聚焦子树 |
| `find` / `get_page_text` | 语义找元素返回 `ref_N` / 正文抽取（readability 式，无 HTML） |
| `read_console_messages` / `read_network_requests` | 控制台（强烈建议 pattern 过滤）/ 网络（跨域可见、换域清空） |
| `computer action:"screenshot"` / `zoom` | 截图/区域放大；旧版扩展不识别 scale 时回退全图（版本协商） |

**页面动作**

| 工具 | 语义 |
|---|---|
| `computer`（浏览器版） | action 13 枚举（含 zoom/scroll_to/hover）；点击可 ref 代替坐标；**tabId 必填**；key 禁页面缩放组合键（提示改用 zoom） |
| `form_input` / `javascript_tool` | 按 ref 设表单值（checkbox/select 分型）/ 页面上下文 JS REPL（顶层 await、末表达式自动返回） |
| `file_upload` / `upload_image` | **由宿主按自身文件权限读 paths 填充**（扩展拿不到宿主文件系统）/ 截图或拖放传给 file input |
| `gif_creator` / `browser_batch` | 操作过程导出带标注 GIF（点击橙圈/拖拽红箭头/水印）/ 多工具一次往返：每项独立过权限、首错停批、坐标参照批前截图 |

**连接与快捷指令**：`list_connected_browsers`（当前账号全部 Chrome 实例）· `select_browser`（按 deviceId 直连）· `switch_browser`（广播配对等用户点 Connect，≤2 分钟）· `shortcuts_list/execute`（扩展侧 workflow，立即返回不等待）。

## 权限模型

| 层 | 机制 |
|---|---|
| 会话模式 | chromePermissionMode ∈ ask / follow_a_plan / skip_all（仅 bypass 权限模式可达，经环境变量注入） |
| 域名白名单 | allowedDomains → allowed_domains；handle_permission_prompts 弹交互式授权 |
| 逐动作授权 | 扩展发 permission_request（tool_type/url/action_data/category）；「仅本次/本站总是允许/拒绝」；私有地址站点特殊类目 |
| tab 组沙箱 | 所有工具只能操作本会话 MCP tab group 内标签页 |
| 降级纪律 | 扩展未连接时提示安装，**禁止静默退化为整屏 CU** |
| 传输安全 | socket 0700 强制校验、死 PID socket 清理、allowed_origins 锁唯一扩展 ID |

## 桌面端专属变体

| 变体 | 内容 |
|---|---|
| Browser pane（应用内浏览器） | 同一套工具的**第二注册表**（14 个）；目标是内置面板而非用户 Chrome；navigate 自动开面板（"no dev server needed"） |
| preview_* 工具族 ×13 | Cowork 生成的 Web 应用预览：起停 dev server、日志、截图、DOM 检查、点击/填表/求值 |
| framebuffer_* ×13 | VNC 控制自建 VM/远程机屏幕；pixelGuard（像素比对不符拒点）、用户抢占检测、「未观察不许动」；与宿主桌面 CU 完全独立 |

## 与 computer-use-demo 的关系与本机状态

demo 无浏览器控制。本机浏览器版 `computer` schema 与官方 CU 工具描述同源（action 文本几乎逐字一致），叠加 tabId 必填、ref 引用、scroll_to/hover/zoom 与 batch 编排——「官方 CU 工具面在浏览器场景的领域特化版」。

本机不可用（负证据）：扩展 ID 不在 Chrome Extensions 目录；NativeMessagingHosts 只有第三方 host（Quark、小米 MiMo）；`~/.claude/chrome/` wrapper 不存在；`~/.claude.json` 无 chromePermissionMode 键；无 CDP 远程调试端口证据。
