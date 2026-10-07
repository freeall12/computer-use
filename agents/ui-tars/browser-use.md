# UI-TARS：Browser Use（浏览器控制）逆向

> 基线：上游 commit `2ff41a9e`（2026-09-24，Apache-2.0）。浏览器能力集中在 **Agent TARS**（CLI）与桌面端 Browser Operator 两处。

## 1. 速览

**一条路线三种模式：dom（CDP）、visual-grounding（截图坐标）、hybrid（并存不仲裁）——同一问题给模型三条工具面。**

| 项 | 值 |
|---|---|
| 内核 | `@agent-tars/core` 0.3.0（extends `@tarko/mcp-agent`） |
| 浏览器底座 | `@agent-infra/browser`：BrowserFinder 找本机 Chrome/Edge → puppeteer-core CDP |
| 内置 MCP | browser / filesystem / commands 三 server **进程内**启动，`InMemoryTransport.createLinkedPair()` 对接连 agent |
| 外挂 MCP | CLI `--mcp` / 配置文件挂任意外部 server（stdio/HTTP） |
| 沙箱 | `aioSandbox` 选项 → 全工具改走 AIO Sandbox 隔离 Linux 容器 |

```
AgentTARS（@tarko/mcp-agent 内核）
 ├─ 直连 Tool：web_search（browser_search/bing/tavily/searxng/duckduckgo 五源）
 ├─ BrowserToolsManager（按 control 模式注册）：
 │    dom ──────────► MCP browser server（17 个 CDP 动作工具）
 │    visual-grounding ─► browser_vision_control（GUI Agent 坐标点击）+ 8 自实现工具
 │    hybrid（默认）───► 视觉工具 + DOM 动作工具并存
 ├─ filesystem MCP（11 工具，锁 workspace）
 └─ commands MCP（run_command / run_script）
```

## 2. 三种控制模式的工具面

**模式决定工具集，工具集决定接地方式。**

| 模式 | 接地 | 注册工具（出处 `browser-control-strategies/*.ts`） |
|---|---|---|
| dom | CDP DOM | 17 个 MCP 动作工具（navigate/back/forward/get_markdown/click/press_key/hover/scroll/form_input_fill/select/get_clickable_elements/read_links/tab_list/new_tab/close_tab/switch_tab/evaluate）+ screenshot = **18** |
| visual-grounding | VLM 坐标 | `browser_vision_control` + navigate/back/forward/refresh/get_markdown/get_url/get_title/screenshot = **9**（动作类全部自实现、不经 MCP DOM 工具） |
| hybrid（默认） | 双轨 | 视觉工具 + 导航/取文/截图 6 个 + DOM 动作 13 个 = **20**；**冲突不仲裁**（源码自述 without handling conflicts） |

`browser_vision_control` 参数面（`browser-gui-agent.ts:97-140`）：`thought`/`step`/`action` 三个字符串；
`action` 即动作空间文本（`click(point='<point>x1 y1</point>')`），服务端复用同一 ActionParser 解析后派发 CDP 鼠标事件。
模型 provider 不支持视觉时启动即校验拒绝（`browser-control-validator.ts`）。

## 3. MCP 混合面：进程内直连

**内置 server 不起子进程——MCP 协议跑在内存管道上。**

| 事实 | 出处 |
|---|---|
| `createMCPServers()` 内存创建 browser/filesystem/commands 三 server | `environments/local/index.ts:164-180` |
| 每个经 `InMemoryTransport.createLinkedPair()` 连 Client，再 `listTools()` 逐个注册为 Tool | 同文件 `:185-303` |
| filesystem `allowedDirectories=[workspace]`；`directory_tree` 被排除后用安全版重注册 | `filesystem-tools-manager.ts:35,141` |
| 外部 MCP：CLI 参数/配置文件声明，fail-closed——未配置 = 工具不存在 | `@tarko/agent-cli` |

这构成与 Goose 的镜像对照：**Goose 零内置纯外挂 MCP，Agent TARS 内置三 server 纯进程内 MCP**——两端之间是 Claude/Cursor 的一方 provider 光谱。

## 4. 桌面端浏览器 Operator

UI-TARS Desktop 的 BU 不走 MCP，直接换 Operator（`apps/ui-tars/src/main/services/runAgent.ts:128-165`）：

| Operator | 链路 |
|---|---|
| LocalBrowser | `BrowserFinder` 定位本机 Chrome → puppeteer-core CDP 启动；动作经 `BrowserOperator.executeInput` switch 派发（navigate/click/type/hotkey/scroll…同动作空间） |
| RemoteBrowser | 云端下发 CDP URL（OSS 构建 proxy host 置空，不可用） |
| 搜索引擎 | google/baidu/bing 三预设传给 Operator 内建搜索 |

浏览器不可用时启动检查直接报错（`browserCheck.ts`）——与 CU 的"截图总能拍"不同，BU 有硬前置。

## 5. 安全与边界

**BU 安全面 = workspace 文件锁 + provider 校验 + AIO 隔离，无逐动作门（与 CU 一致）。**

| 层 | 事实 |
|---|---|
| 文件 | filesystem MCP 锁 workspace 目录白名单 |
| 模式校验 | 非 VLM provider + visual-grounding → 启动期拒绝 |
| 沙箱 | `aioSandbox`：本地工具全禁，browser/computer 由容器内 AIO 提供（2025-11 v0.3.0 引入） |
| 遥测 | UTIO 事件含 `sendInstruction`（用户指令原文上报到 `utioBaseUrl`，OSS 默认空=关闭） |
| 系统提示 | DEFAULT_SYSTEM_PROMPT 自述 "Inspired and modified from Manus"；内含"敏感操作建议用户临时接管浏览器"条款 |

## 6. 与 12 家 BU 架构对照

| | 架构 | 接地 | 内置 MCP |
|---|---|---|---|
| **Agent TARS** | 进程内 MCP + 三模式切换 | 坐标（视觉）或 CDP DOM，**可切换** | 3 个（进程内） |
| ZCode | 内嵌 WebView（IAB） | 合成事件 + ref | 插件市场 |
| Codex | iab/扩展/云/mcpapps 四后端 | AX 混合 | mcpapps 挂载 |
| Goose | 零内置 | — | 5 个第三方外挂 |

**参考实现自测**：`node source/ui-tars/reference/test.mjs` → ALL PASSED (11 checks)。
