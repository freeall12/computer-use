# 证据清单（Evidence Inventory）—— browser-use

> 对象特殊性：browser-use **本身是开源库而非终端产品**，无"本机安装"痕迹可考；全部证据来自上游源码只读分析。
> 克隆位置 `/tmp/browser-use-src`（shallow，只读，未运行），commit `c75e8476e26d18b7617643bc2ae082fae8eae431`（2026-10-07 09:39 UTC-7），版本 0.13.11。
> 除非另注，路径均相对 `/tmp/browser-use-src/`。仓库内搬运子集见 `source/browser-use/vendor/`（MIT，附 PROVENANCE）。

## A. 上游基线

| # | 结论 | 证据 |
|---|---|---|
| A1 | 仓库 `github.com/browser-use/browser-use`，版本 **0.13.11**，语言 Python（≥3.11），构建后端 uv/hatchling | `pyproject.toml:5`（`version = "0.13.11"`）、`pyproject.toml` requires-python |
| A2 | 许可证 **MIT**（Copyright (c) 2024 Gregor Zunic） | `LICENSE` 全文 |
| A3 | 顶层包结构：agent / browser / dom / tools / llm / mcp / beta / cloud / sandbox / filesystem / sync / telemetry | `ls browser_use/` |
| A4 | 依赖里 **没有 Playwright**：浏览器直连走自研 CDP 客户端 `cdp-use==1.4.5` + 事件总线 `bubus==1.5.6`（同作者库）；Playwright 仅作子进程调用来装浏览器二进制 | `pyproject.toml` dependencies（`cdp-use==1.4.5`、`bubus==1.5.6`）；`browser/watchdogs/local_browser_watchdog.py:361-371`（`_install_browser_with_playwright` 子进程） |
| A5 | 主入口 `Agent(task, llm, browser_session, tools, ...)`，约 90 个可选参数 | `browser_use/agent/service.py:134-236` |

## B. 架构分层（Agent / Tools / BrowserSession / CDP）

| # | 结论 | 证据（文件:行号） |
|---|---|---|
| B1 | **step() 四阶段**：Phase 0 CAPTCHA 等待 → Phase 1 `_prepare_context`（取状态+组装消息）→ Phase 2 `_get_next_action`（LLM）+ `_execute_actions` → Phase 3 `_post_process`；全部异常收口 `_handle_step_error`，finally `_finalize` | `agent/service.py:1035-1084` |
| B2 | `run()` = take_step 循环 + max_failures（默认 5）+ 最终 done 强制；`step_timeout` 默认 180s | `agent/service.py:2503`（run 签名）、`:203-236`（参数默认值） |
| B3 | 每步观察 `get_browser_state_summary(include_screenshot=True)` —— **截图每步都拍**（供云同步/历史），但仅 `use_vision=True` 时进 LLM 消息 | `agent/service.py:1087-1104`（prepare_context 注释 "always capture even if use_vision=False"）；`agent/message_manager/service.py:461-478` |
| B4 | **无独立 Planner-Executor 双 Agent**：规划是单模型输出字段 `current_plan_item` / `plan_update`（默认 enable_planning=True，`planning_replan_on_stall=3` 次失败触发重规划提示注入，`planning_exploration_limit=5`）；flash_mode 剥掉 plan 字段 | `agent/service.py:203-205,241-243`；`agent/views.py:388-397`（AgentOutput 字段）；`agent/service.py:1417-1450`（_update_plan_from_model_output） |
| B5 | 判分器 judge：`use_judge=True` 默认开，`agent/judge.py` 用截图+trace 给任务成功性打分（独立于执行 LLM，可用 judge_llm） | `agent/service.py:1593-1668`（_judge_trace/_judge_and_log）；`agent/judge.py:1-10` |
| B6 | **Tools（Controller）= 动作注册表**：`Registry.action()` 装饰器 + Pydantic param_model；`Tools.act()` 单动作 180s 超时（防 CDP WebSocket 挂死） | `tools/service.py:45-448`；`tools/service.py:2245-2320`（act + asyncio.wait_for） |
| B7 | **事件总线架构**：BrowserSession 内嵌 `ResilientEventBus`（bubus 库），动作全部转成 Event 派发，15 个 watchdog 各自挂 handler 消费——控制流与执行解耦 | `browser/session.py:549`（`event_bus: EventBus = Field(default_factory=ResilientEventBus)`）；`browser/session.py:1700-1740`（attach_all_watchdogs 清单） |
| B8 | 15 个 watchdog：DOM / Screenshot / LocalBrowser / DefaultAction / Downloads / Security / Popups / Permissions / Recording / StorageState / HarRecording / Captcha / AboutBlank / Crash(注释掉) 等 | `browser/session.py:1704-1722`（import 清单）；`ls browser_use/browser/watchdogs/` |
| B9 | 输出模型 `AgentOutput{thinking, evaluation_previous_goal, memory, next_goal, current_plan_item, plan_update, action[]}`，action 数组 `min_items:1`，可 `type_with_custom_actions` 泛型扩展；结构化输出走 `output_model_schema` → `StructuredOutputAction[T]` | `agent/views.py:381-433`；`tools/service.py:2008-2092` |

## C. LLM 抽象

| # | 结论 | 证据 |
|---|---|---|
| C1 | 自研轻量协议 `BaseChatModel(Protocol)`：唯一方法 `ainvoke(messages, output_format, **kwargs) -> ChatInvokeCompletion[T]`（结构化输出原生进协议，不走 JSON 修补） | `llm/base.py:33-55` |
| C2 | 内置适配器 **16 家**：openai / anthropic / google / azure / aws（bedrock）/ groq / ollama / mistral / deepseek / cerebras / openrouter / litellm（万能网关）/ oci_raw / vercel / orcarouter / browser-use（自家模型） | `ls browser_use/llm/`（目录清单） |
| C3 | 便捷注册表 `llm.openai_gpt_5` / `llm.google_gemini_2_5_pro` / `bu_2_0` 等模块级单例 + `get_llm_by_name()` | `llm/models.py:1-88` |
| C4 | 默认 LLM：`CONFIG.DEFAULT_LLM` 未设时 fallback `ChatBrowserUse()`；provider=='browser-use' 自动开 flash_mode | `agent/service.py:219-240` |
| C5 | 坐标点击按模型自动启用：claude-sonnet-4-5 / claude-opus-4-5 / gemini-3-pro / browser-use/* 模型注册 click 时带 coordinate_x/y | `tools/service.py:2160-2170`（set_coordinate_clicking docstring） |

## D. 观察机制：DOM 序列化 + 索引句柄（核心亮点）

| # | 结论 | 证据 |
|---|---|---|
| D1 | **三 CDP 源合一**：`DOMSnapshot.captureSnapshot`（布局/坐标/输入值）+ `DOM.getDocument`（树结构）+ `Accessibility.getFullAXTree`（语义，含 iframe 逐 frame 拉取） | `dom/service.py:379`（getFullAXTree）、`:571`（captureSnapshot）、`:583`（DOM.getDocument）、`:703-760`（get_dom_tree 合并流程） |
| D2 | 合并键是 `backendDOMNodeId`：AX 树建 `{backendDOMNodeId: ax_node}` lookup，快照建 `snapshot_lookup`，递归 `_construct_enhanced_node` 产出 `EnhancedDOMTreeNode`；INPUT/TEXTAREA 的**实时 value/checked 从快照回填属性**（修 #5647：JS/autofill 只写 property 不写 attribute） | `dom/service.py:780-786`（ax_tree_lookup）、`:838-850`（input value 回填） |
| D3 | iframe 递归：`iframe_depth` 防无限递归，跨源 target 用 `visited_cross_origin_targets` 去重，坐标带累计偏移 `total_frame_offset` | `dom/service.py:703-737`（get_dom_tree 参数与文档串） |
| D4 | **selector_map 即句柄台账**：`DOMTreeSerializer._assign_interactive_indices_and_mark_new_nodes` 给每个可交互元素分配从 1 递增的 `selector_index`，写入 `_selector_map[index] = EnhancedDOMTreeNode`；序列化后回填 `session.update_cached_selector_map`（含 `(session_id, backend_node_id)→index` 反查表） | `dom/serializer/serializer.py:753-761`；`browser/session.py:2488-2500` |
| D5 | 可交互判定 `ClickableElementDetector.is_interactive`：表单控件、role=button/link/combobox、onclick/tabindex 属性、类名启发式（搜索指示词）等 | `dom/serializer/clickable_elements.py:6-177` |
| D6 | 序列化文本格式（喂给 LLM 的权威定义在系统提示）：`[33]<div />` 缩进树、`*[38]` 星号=新出现元素、`|SCROLL|` 滚动容器、`|SHADOW(open/closed)|` | `agent/system_prompts/system_prompt.md:41-56`；`dom/serializer/serializer.py:1015-1021`（svg 折叠里的 `[index]` 拼接） |
| D7 | **与 SoM 的关系**：LLM 的主观察通道是文本 DOM（[index] 句柄）+ **干净截图**（无标注）并行获取（30s 预算内并行两个 task）；截图进消息与否由 use_vision 控制：True=每步带图 / 'auto'=仅动作显式请求时 / False=从不 | `browser/watchdogs/dom_watchdog.py:359-407`（dom_task 与 screenshot_task 并行）；`agent/message_manager/service.py:461-472`（三档 use_vision） |
| D8 | 视觉辅助两处保留 SoM 基因：① `dom_highlight_elements` 往页面注入 JS 高亮框（含 element_index）——**给人看**，截图前强制移除；② `python_highlights.py` 的 `create_highlighted_screenshot`（在截图上画 bbox+索引号，经典 SoM 渲染）在 0.13.11 主链路**无调用方**（grep 全仓 0 命中，playground 外）——是旧版"截图标注模式"的遗留工具 | `browser/session.py:3187-3240`（add_highlights）；`browser/watchdogs/screenshot_watchdog.py:57-61`（"Remove highlights BEFORE taking the screenshot"）；`browser/python_highlights.py:407`；`grep -rn create_highlighted_screenshot`（无主链路命中） |
| D9 | 系统提示仍宣称 `<browser_vision>` 截图带 bbox+索引号（GROUND TRUTH 措辞）——与 D8 实际干净截图**存在文档-实现漂移**，判断为提示文案滞后于渲染管线重构 | `agent/system_prompts/system_prompt.md:57-61` vs D7/D8 源码 |
| D10 | 状态异常兜底：BrowserStateRequestEvent 超时 → 返回 `selector_map={}` 空态 + state_error 文案（"no element indices are safe to use"），并清空缓存 map——防旧页句柄串页 | `browser/session.py:1630-1666` |
| D11 | 防句柄漂移手段：multi_act 执行每个动作前后比对 URL+agent_focus_target_id，变化即中止剩余队列；navigate/search/go_back/switch 标 `terminates_sequence=True` 静态短路 | `agent/service.py:2730-2740`（docstring 两层保护）、`:2789-2795`（pre_action_url 比对）；`tools/service.py:583,1004`（terminates_sequence） |

## E. 动作机制（CDP 派发面）

| # | 结论 | 证据 |
|---|---|---|
| E1 | **点击 = 纯 CDP**：`DOM.scrollIntoViewIfNeeded` → 遮挡检查（`document.elementFromPoint` + label-input 关联白名单）→ `Input.dispatchMouseEvent` mouseMoved/mousePressed/mouseReleased（带 3s/5s 超时）→ checkbox/radio 点击后回读 checked，未翻转则 JS `element.click()` 兜底 | `browser/watchdogs/default_action_watchdog.py:338-388`（on_ClickElementEvent）、`:703`（_click_element_node_impl）、`:906-955`（鼠标序列）、`:958+`（toggle 回读） |
| E2 | 文件输入禁点：click 遇 `input[type=file]` 返回 validation_error 并提示改用 upload_file；`<select>` 禁点，提示用 dropdown_options | `browser/watchdogs/default_action_watchdog.py:350-357,713-720` |
| E3 | 打字 = `TypeTextEvent`（element 级，非全局键盘）；执行后回读 actual_value，与输入不符则给 LLM 追加警告（页面自动格式化场景）；autocomplete 字段提示"等建议出现再点，别按 Enter" | `tools/service.py:786-844`（input 动作体） |
| E4 | 键盘 = `Input.dispatchKeyEvent`（send_keys）；滚动 = CDP 手势 `Input.dispatchMouseEvent`(wheel)（_scroll_with_cdp_gesture） | `browser/watchdogs/default_action_watchdog.py:1161-1207,540-565` |
| E5 | **new_tab**：无独立动作，`navigate(url, new_tab=True)` 承担；**switch/close tab** 是独立动作，tab_id 为 target_id 后 4 字符；switch 失败保留具体原因（如 stale tab_id）上抛 BrowserError | `tools/views.py:60-62`（NavigateAction.new_tab）；`tools/service.py:502-546`（navigate new_tab 分支）、`:1004-1066`（switch/close） |
| E6 | 文件上传：`upload_file(path, index)` —— path 必须在 `available_file_paths`（用户白名单 ∪ 本会话下载文件 ∪ FileSystem 托管文件）内，否则拒绝；执行走 `DOM.setFileInputFiles` | `tools/service.py:860-912`（白名单校验，含远程会话 basename 防碰撞注释）；`browser/watchdogs/default_action_watchdog.py:2718`（setFileInputFiles） |
| E7 | 文件下载：`Browser.setDownloadBehavior`（allow=false 拦截改为受控）+ `Browser.downloadProgress` 事件跟踪，落盘 `downloads_path`（默认临时目录 `browser-use-downloads-<uuid>`）；点击触发下载自动等待完成；done 动作自动附上会话下载清单 | `browser/watchdogs/downloads_watchdog.py:507-517`、`:311-319`；`tools/service.py:657-705`（_check_and_update_downloads）、`:2030-2037`（done 附件） |
| E8 | 下拉框：`dropdown_options(index)` 枚举 + `select_dropdown(index, option)`；用 CDP 解析而非模拟点击 option | `tools/service.py:1679-1750` |
| E9 | 零 LLM 成本三件套：`search_page`（页面 grep，正则/大小写/作用域）、`find_elements`（CSS 查询）、`extract`（LLM 抽取但可分页续读）；另有 `evaluate`（JS 执行，IIFE 建议）、`screenshot`、`save_as_pdf`、`wait`、`find_text`（滚动到文本，服务函数名即动作名，service.py:1504） | `tools/service.py:1067-1069,1307-1309,1344-1346,1524-1567,1833` |
| E10 | 抽象层命名空间是动作字段：`AgentOutput.action[]` 每项形如 `{"click": {...}}`，registry 按 key 路由 | `tools/service.py:2299-2312`（act 里 model_dump 遍历） |

## F. 安全护栏

| # | 结论 | 证据 |
|---|---|---|
| F1 | **敏感数据 = 占位符协议**：`sensitive_data={'x': 'pw123'}` 只把键名给 LLM，要求输出 `<secret>x</secret>`；registry 执行前正则替换真实值——**明文永不过模型**；支持按域作用域 `{'*.example.com': {'k': v}}`（当前页不匹配则占位符不可用） | `agent/message_manager/service.py:391-420`（_get_sensitive_data_description）；`tools/registry/service.py:434-480`（secret_pattern 替换）；`utils.py:91-121`（redact） |
| F2 | 敏感值回显防护：input 动作日志 `Typed <sensitive>`；`redact_sensitive_string` 把历史里的真实值换回 `<secret>键</secret>` | `tools/service.py:818-825`；`utils.py:108-121` |
| F3 | **域白名单**：`allowed_domains`（glob 如 `*.google.com`）/`prohibited_domains`（allowed 优先）/`block_ip_addresses`（防内网 SSRF） | `browser/profile.py:628-642` |
| F4 | 强制执行点在 SecurityWatchdog：NavigateToUrlEvent 前置拦截 + NavigationCompleteEvent 捕获重定向落网（跳回 about:blank）+ TabCreatedEvent 检查 | `browser/watchdogs/security_watchdog.py:35-73` |
| F5 | `disable_security`（Chromium 关安全特性开关）默认 False；`enable_default_extensions`（uBlock/ClearURLs）env 可关；CAPTCHA watchdog 默认 True 但仅在云浏览器发 CDP 事件时激活 | `browser/profile.py:646-678` |
| F6 | 会话隔离：每个 Agent 一个 BrowserSession（可共享），每次启动断言 `--user-data-dir` 非默认路径（否则 Chrome 拒绝 CDP attach），临时 profile 用后清理；多 Agent 并发=各自 BrowserSession/CDP 连接，节点反查按 `(session_id, backend_node_id)` 键限定本会话 | `browser/watchdogs/local_browser_watchdog.py:113-118`（assert user-data-dir）、`:87-97`（temp_dirs_to_cleanup）；`browser/session.py:2483-2487`（_get_cached_node_by_backend_id） |
| F7 | 动作超时护栏：act 单动作 180s wait_for；BrowserStateRequestEvent 30s 预算；截图嵌套事件共享预算防饿死 DOM | `tools/service.py:2244-2247,2288-2306`；`browser/watchdogs/dom_watchdog.py:399-406` |
| F8 | 遥测：ANONYMIZED_TELEMETRY 默认 true（posthog），云同步默认跟随遥测开关 | `config.py:59-63` |

## G. 使用形态：被集成的事实标准

| # | 结论 | 证据 |
|---|---|---|
| G1 | **形态=Python 库**：`Agent(task="...", llm=ChatOpenAI(...)).run()`；与 12 家分册的"产品内嵌 CU/BU"相对——browser-use 是被无数产品/框架**包进去**的执行与编排层 | `README.md`（Quick Start 代码块）；`browser_use/__init__.py` 导出面 |
| G2 | 也能反向外挂成 MCP server：`uvx browser-use --mcp`（run_task / 直接控制 / 抽取 / 文件系统四组工具），可被 Claude Desktop 等 MCP 宿主挂载 | `browser_use/mcp/server.py:1-24`（docstring）；`ls browser_use/mcp/` |
| G3 | 自带 CLI（`browser-use` 命令）与 demo_mode 侧边栏（浏览器窗口内实时日志） | `browser_use/cli.py:1-30`；`browser/demo_mode.py:1-30` |
| G4 | 云侧延伸：`browser_use/cloud/`（云浏览器）、`sync/`（账号）、`browser/cloud/`（CloudBrowserParams）——开源库与商业云同一代码库分层 | `ls browser_use/cloud browser_use/sync`；`browser/profile.py:620-624`（cloud_browser_params） |
| G5 | 已知集成方（上游 README 宣称）：本仓库 12 家分册中多篇提及的 agent 框架引用其 DOM/句柄设计；上游 README「Used by」列有先进桌面/浏览器 agent 产品 | `README.md`（Used by 段落） |

## H. 方法与合规

| # | 结论 |
|---|---|
| H1 | clone/分析均在 /tmp 只读进行；未运行上游代码、未提供任何 API key、未触碰网络侧服务。 |
| H2 | vendor 子集为 MIT 原样拷贝（零修改），sha256 与上游核对一致，LICENSE 全文随附（见 source/browser-use/vendor/PROVENANCE.md §3-4）。 |
| H3 | reference/ 为 cleanroom 重写（TypeScript），仅复现行为规格，非上游代码转写；机制出处逐条注释指向本清单编号。 |
