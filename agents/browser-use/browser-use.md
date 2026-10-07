# Browser Use（开源库）· 浏览器控制逆向：DOM 句柄模式的源头活水

> 一句话结论：**它是 BU 领域"文本 DOM + 索引句柄"路线的代表作——句柄不是截图标记，而是 CDP 三源合并后序列化进文本树的 `[index]`。**

| 项 | 值 |
|---|---|
| 载体 | Python 库 v0.13.11（`pip install browser-use`），commit `c75e8476`（2026-10-07 浅克隆基线） |
| 形态 | **被集成的库**（非终端产品）；也可反挂成 MCP server（`uvx browser-use --mcp`） |
| CU 工具面 | 0 个 —— 纯浏览器库，零桌面控制代码 |
| BU 工具面 | 24 个动作 · 架构「事件总线 + watchdog」 |
| 安全模型 | 占位符密钥 · 域白名单 · 白名单上传 |
| 本机可用 | ⚙️ 未安装（仅上游源码分析；`pip install` 即用） |

## 架构一图

```
用户任务 task + LLM（16 家适配器，ainvoke 协议）
 └─ Agent（service.py） step() 四阶段：CAPTCHA等待→组装状态→LLM→执行→后处理
     └─ AgentOutput{evaluation/memory/next_goal, action[]}  ← 结构化输出即动作计划
         └─ Tools/Registry（24 组 @registry.action（26 处注册，click/done 各两变体），<secret> 替换在此层）
             └─ BrowserSession.event_bus（bubus：动作=Event 派发）
                 ├─ DOMWatchdog      DOMSnapshot+DOM+AX 三源 → [index] 句柄台账
                 ├─ ScreenshotWatchdog Page.captureScreenshot（截图前抹高亮）
                 ├─ SecurityWatchdog 域白名单拦截（含重定向回 about:blank）
                 ├─ DefaultActionWatchdog 遮挡检查→Input.dispatchMouseEvent/Key
                 └─ DownloadsWatchdog  setDownloadBehavior+进度跟踪
                      └─ cdp-use 客户端 ←→ Chrome 子进程 --remote-debugging-port
```

> 演进：早期版本挂 Playwright 驱动 + 截图标注渲染器；0.13.x 已换自研 `cdp-use` 直连，标注截图函数 `create_highlighted_screenshot` 保留但主链路零调用（inventory D8）。

## 观察：[index] 句柄从哪来

**句柄 = 序列化器按文档序分配的 `selector_index`，台账是 `selector_map`。**

| 步骤 | 机制 | 出处 |
|---|---|---|
| 1. 采 | 并行拉三份 CDP 数据：`DOMSnapshot.captureSnapshot`（布局+实时输入值）、`DOM.getDocument`（树）、`Accessibility.getFullAXTree`（语义，逐 iframe） | `dom/service.py:379,571,583` |
| 2. 合 | 以 `backendDOMNodeId` 为键三表 join；INPUT/TEXTAREA 的 value/checked 从快照回填（修 JS/autofill 只写 property 的盲区） | `dom/service.py:780-850` |
| 3. 判 | `ClickableElementDetector.is_interactive`：表单控件 / role=button·link / onclick·tabindex / 类名启发式 | `dom/serializer/clickable_elements.py:6-177` |
| 4. 编 | 交互元素从 1 递增编 `selector_index`，写入 `_selector_map[index] → EnhancedDOMTreeNode` | `dom/serializer/serializer.py:753-761` |
| 5. 画 | 文本树喂 LLM：`[33]<div />` 缩进表、`*[38]`=本轮新出现、`\|SCROLL\|`、`\|SHADOW(open)\|` | `system_prompts/system_prompt.md:41-56` |

模型输出 `click(index=33)` → Registry 用**缓存的 selector_map** 直接 O(1) 取回节点，不需要重查 DOM（`browser/session.py:2459-2475`）。

### 与 set-of-marks 的关系（对照 12 家分册的关键）

| 模式 | browser-use 的实现位置 | 状态 |
|---|---|---|
| 经典 SoM（截图上画框+编号） | `python_highlights.py` `create_highlighted_screenshot`（bbox+索引号渲染器仍在） | **遗留**：主链路 0 调用 |
| DOM 文本句柄（本尊） | `[index]` 文本树 + selector_map 台账 | 主通道 |
| 截图辅助视觉 | 每步拍**干净截图**（无标注），`use_vision` 三档控制是否进消息：True 每步 / 'auto' 按动作请求 / False 永不 | 主通道二号 |
| 页面内 JS 高亮 | `dom_highlight_elements` 注入 bbox+index 覆盖层，**给人看**，截图前强制移除 | 演示用 |

系统提示仍写着"`<browser_vision>` 截图带 bbox 与索引号"——与实际干净截图存在文档-实现漂移（inventory D9）。

### 防句柄漂移（对照 12 家五级光谱：中上位）

- 静态短路：navigate/search/go_back/switch 标 `terminates_sequence=True`，后队列作废（`agent/service.py:2730-2740`）。
- 运行时守卫：multi_act 每动作前后比对 URL + 焦点 target，变了就中止剩余队列。
- 失效兜底：状态采集超时 → 清空 selector_map，返回"索引均不可用"错误态，宁空勿错（`browser/session.py:1630-1666`）。

## 动作：CDP 派发面（24 个动作）

| 动作 | 参数要点 | 一句话语义 |
|---|---|---|
| click | index 或 coordinate_x/y（按模型自动开坐标） | 遮挡检查→CDP 鼠标三连；checkbox 回读校验，未翻转则 JS 兜底 |
| input | index, text, clear | 元素级打字；回读 actual_value，页面重格式化时给 LLM 警告 |
| navigate / search | url, new_tab / engine | new_tab 兼起新建标签页（无独立 new_tab 动作） |
| switch / close | tab_id（target_id 后 4 位） | 标签页切换/关闭，失败保留 stale tab_id 具体原因 |
| upload_file | path, index | path 必须在白名单（用户文件∪会话下载∪FileSystem），走 `DOM.setFileInputFiles` |
| dropdown_options / select_dropdown | index | `<select>` 禁点击，专用枚举+选择 |
| scroll / find_text | down, pages / text | CDP 滚轮手势；可对容器 index 滚动 |
| extract / search_page / find_elements | query / pattern / selector | LLM 抽取 + 两个零成本页面检索（grep/CSS） |
| send_keys / wait / screenshot / save_as_pdf | keys / s / file_name | CDP 键盘、PDF 直存（打印按钮自动改走 PDF） |
| write_file / read_file / replace_file | — | 内置 FileSystem 沙箱目录 |
| evaluate | js | IIFE 建议式 JS 执行 |
| done | success, data(files_to_display) | 终态：结构化输出 + 自动附会话下载清单 |

点击、打字、键盘、滚动全部落在 `DefaultActionWatchdog` 的 CDP 调用上（`Input.dispatchMouseEvent/dispatchKeyEvent` + `Runtime.callFunctionOn`），文件上传/下载见 inventory E6-E7。

## 安全：占位符协议 + 导航围栏

| 机制 | 做法 | 出处 |
|---|---|---|
| 敏感数据 | LLM 只见键名，输出 `<secret>x</secret>`，Registry 执行前正则替换；日志回显 `Typed <sensitive>`；支持按域作用域 | `tools/registry/service.py:434-480` |
| 域白名单 | `allowed_domains`(glob) / `prohibited_domains` / `block_ip_addresses`（防内网） | `browser/profile.py:628-642` |
| 强制执行 | SecurityWatchdog 在导航前后双拦截，命中即跳 about:blank | `security_watchdog.py:35-73` |
| 会话隔离 | 每 Agent 一 Session；强制非默认 `--user-data-dir`；节点反查键 `(session_id, backend_node_id)` 限本会话 | `local_browser_watchdog.py:113-118` |
| 超时护栏 | 单动作 180s / 状态采集 30s，防 CDP WebSocket 挂死 | `tools/service.py:2244-2306` |

## 使用形态：被集成的事实标准

- 12 家分册里的 BU 多是"产品内嵌"：browser-use 反过来，**本身是被包进去的那一层**——`Agent(task, llm, browser_session)` 四参数起步，90+ 可调参数。
- LLM 面 16 家（openai/anthropic/google/azure/aws/groq/ollama/mistral/deepseek/cerebras/openrouter/litellm/oci/vercel/orcarouter + 自家 browser-use），协议仅一个 `ainvoke(messages, output_format)`（`llm/base.py:33-55`）——结构化输出进协议本身。
- 无独立 Planner-Executor 双 Agent：规划是输出字段 `plan_update`/`current_plan_item`，连续 3 次失败注入重规划提示。
- 也能挂成 MCP server 供 Claude Desktop 等使用（`mcp/server.py:1-24`）。

## 与 12 家分册的一行对照

| 对照维度 | browser-use | 12 家多数 |
|---|---|---|
| 句柄形态 | 文本 DOM `[index]`（CDP 三源合并） | AX 树 / 截图 ref / SoM 变体 |
| 执行通道 | CDP 直连（自研 cdp-use） | WebView 注入 / 扩展 / 云端 |
| 密钥 | 占位符 `<secret>` 协议 | 多为环境变量/凭据柜 |
| 架构骨架 | 事件总线 + watchdog 解耦 | 单体工具函数 |

> 证据全集见 [evidence/inventory.md](evidence/inventory.md)；vendor 源码见 [source/browser-use/vendor](../../source/browser-use/vendor/)（MIT）；cleanroom 复刻见 [source/browser-use/reference](../../source/browser-use/reference/)。
