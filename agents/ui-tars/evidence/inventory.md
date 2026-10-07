# UI-TARS / Agent TARS —— 证据清单（evidence inventory）

> 分析时点：2026-10-07。方法：只读静态分析上游开源仓库（shallow clone 至 /tmp/uitars-src，未修改本机文件）。
> 未运行被分析对象、未抓包、本机无该软件安装（分析对象本身是公开仓库，无需安装）。

## 1. 基线事实

| 项 | 值 | 证据 |
|---|---|---|
| 上游仓库 | github.com/bytedance/UI-TARS-desktop | `git clone --depth 1` HEAD |
| commit | `2ff41a9e515828c5bd5b276e493d73aa0bdf4a3a`（2026-09-24 14:48:56 +0800） | `git log -1`（"fix(security): validate Host header to prevent DNS rebinding in agent-server(-next) (#1975)"） |
| 代码许可证 | Apache-2.0（README §License: "This project is licensed under the Apache License 2.0."） | `README.md:284-286`、根 `LICENSE` |
| 桌面端版本 | ui-tars-desktop 0.2.4 | `apps/ui-tars/package.json:3` |
| CLI 版本 | @agent-tars/cli 0.3.0 / @agent-tars/core 0.3.0 | `multimodal/agent-tars/cli/package.json`、`multimodal/agent-tars/core/package.json` |
| 产品自述 | TARS stack = Agent TARS + UI-TARS Desktop 两个项目 | `README.md:9-33` |
| 模型权重许可 | UI-TARS 权重在 bytedance-research/UI-TARS（HuggingFace）另有许可，**不在** Apache-2.0 内 | `README.md:293-297`（引用论文）、docs/quick-start.md 部署节 |

## 2. Computer Use 证据（对应 computer-use.md）

### 2.1 截图（观察层）

| 断言 | 证据（文件:行号，相对上游根） |
|---|---|
| nut-js 抓屏 + BGR→RGB + 物理像素 JPEG | `multimodal/gui-agent/operator-nutjs/src/NutJSOperator.ts:79-114` |
| Retina：宽高 ÷ pixelDensity.scaleX/Y | 同文件 `:42-47`、`:97-98` |
| 桌面版改用 Electron desktopCapturer（主显示器、JPEG 75） | `apps/ui-tars/src/main/agent/operator.ts:39-76`（desktopCapturer.getSources `:49-53`、toJPEG(75) `:74`） |
| 截图失败时回退 nut-js 路径 | `operator.ts:66-68`（fallback super.screenshot()） |
| v1 SDK 校验截图有效性（Jimp 读宽高） | `packages/ui-tars/sdk/src/GUIAgent.ts:191-209` |

### 2.2 动作解析

| 断言 | 证据 |
|---|---|
| `Thought:`+`Action:` 切分正则 | `multimodal/gui-agent/action-parser/src/FomatParsers.ts:199-208`（UnifiedBCFormatParser） |
| 五种格式解析器链（XML/Omni/UnifiedBC/BCComplex/浏览器专格式） | 同文件 `:20,113,171,234` 及其后 |
| `<\|box_start\|>`/`<\|box_end\|>` 标签剥离；`point=`/`start_point=`/`end_point=` 文本替换 | `action-parser/src/ActionParserHelper.ts:104-116` |
| 函数式匹配 `^(\w+)\((.*)\)$` | 同文件 `:118-126` |
| 动作名归一表（~50 别名） | `multimodal/gui-agent/shared/src/utils/actions.ts:46-137`（map）、`:139-142`（unifyActionType） |
| 参数名归一表 + navigate 的 content→url 特判 | 同文件 `:144-244` |
| 解析失败 → 合成带 errorMessage 的 tool call（错误也走工具面） | `agent-sdk/src/ToolCallEngine.ts:135-158` |
| `finished` 不生成 tool call、直接短路停机 | 同文件 `:162-169` |
| 历史消息把 tool 结果回灌为 user 角色（PE 引擎语义） | 同文件 `:221-236` |
| 桌面版系统提示词按模型版本四选一（V1.0/V1.5/Doubao-15B/Doubao-20B） | `apps/ui-tars/src/main/utils/agent.ts:33-50`；提示词正文 `apps/ui-tars/src/main/agent/prompts.ts:7,27,89,144` |
| v1.5 动作空间全文（click/left_double/right_single/drag/hotkey/type/scroll/wait/finished/call_user） | `multimodal/gui-agent/agent-sdk/src/prompts.ts:20-40`（getSystemPromptUITARS_1_5） |

### 2.3 坐标派发

| 断言 | 证据 |
|---|---|
| 16 个 supportedActions | `NutJSOperator.ts:50-69` |
| calculateRealCoords：normalized×屏幕 or raw | 同文件 `:274-291` |
| 点击 = 移动(straightTo)→sleep(100)→click/doubleClick | 同文件 `:345-363`（handleClick `:355-358`） |
| drag = 起点 sleep(100) 后 mouse.drag | 同文件 `:162-185` |
| Windows type 走剪贴板 Ctrl+V 并还原 | 同文件 `:194-210`（win32 分支 `:195-203`） |
| 结尾 `\n` 补 Enter | 同文件 `:206-209` |
| hotkey 键表：macOS 的 ctrl 映射 LeftCmd | 同文件 `:301-343`（`:303-304`） |
| scroll 固定 500 单位 | 同文件 `:232-250`（`:241,244`） |
| wait 默认睡 5s（模型注释自述） | 同文件 `:252-263`；prompts.ts wait() 注释 |
| 桌面版动作空间声明（bbox 四元组形式 MANUAL.ACTION_SPACES） | `apps/ui-tars/src/main/agent/operator.ts:24-37` |

### 2.4 主循环与状态机

| 断言 | 证据 |
|---|---|
| while(true) 主循环 | `packages/ui-tars/sdk/src/GUIAgent.ts:130` |
| pause/resume（resumePromise 挂起） | 同文件 `:133-149`；pause 入口 `apps/ui-tars/src/main/ipcRoutes/agent.ts:61-64` |
| abort → USER_STOPPED | `GUIAgent.ts:151-160` |
| maxLoopCount → REACH_MAXLOOP_ERROR（-100004） | 同文件 `:162-170`；默认 100：`packages/ui-tars/shared/src/constants/vlm.ts:6` |
| 截图熔断 MAX_SNAPSHOT_ERR_CNT=10、无效截图不计循环 | `packages/ui-tars/sdk/src/constants.ts:9`、`GUIAgent.ts:172-180,202-209` |
| 重试参数（桌面版 model 5×/screenshot 5×/execute 1×） | `apps/ui-tars/src/main/services/runAgent.ts:217-227` |
| 模型调用重试 30s 起步退避 | `sdk/src/GUIAgent.ts:295-299` |
| call_user → CALL_USER；finished → END（动作后置短路） | 同文件 `:414-419` |
| StatusEnum 8 态 / ErrorStatusEnum 7 码 | `packages/ui-tars/shared/src/types/agent.ts:10-53` |
| Agent TARS 侧：单工具 browser_vision_control 注册 | `multimodal/gui-agent/agent-sdk/src/GUIAgent.ts:84-124`；工具名常量 `constants.ts:8` |
| 动作后补截图 → environment_input 事件（500ms 节流） | 同文件 `:147-210`（sleep `:159`） |
| SoM 点击位画框仅用于 UI 展示（不进模型上下文） | `apps/ui-tars/src/main/services/runAgent.ts:60-118`（markClickPosition 仅写入 messages 展示字段）、`shared/setOfMarks.ts:26-31` |
| SoM/屏幕标注致谢 Midscene（MIT） | `apps/ui-tars/src/main/window/ScreenMarker.ts:5-7`（Portions Copyright … midscene LICENSE） |

### 2.5 权限与 TCC

| 断言 | 证据 |
|---|---|
| Accessibility/Screen Recording 引导授权 | `apps/ui-tars/src/main/utils/systemPermissions.ts:63-98`（ensurePermissions） |
| 依赖 @computer-use/node-mac-permissions + mac-screen-capture-permissions | `apps/ui-tars/package.json` dependencies（`@computer-use/node-mac-permissions: 2.2.2`） |
| 无 CU 专用确认门（负证据：全仓无 confirm/approve CU 代码路径） | 全仓 grep `confirm|approve` 于 apps/ui-tars/src/main 仅命中 UI 弹窗无关代码；安全相关仅剩 pause/abort/call_user |

## 3. Browser Use 证据（对应 browser-use.md）

| 断言 | 证据 |
|---|---|
| 内置三 MCP server（browser/filesystem/commands）内存创建 | `multimodal/agent-tars/core/src/environments/local/index.ts:164-180` |
| InMemoryTransport.createLinkedPair() 进程内连接 | 同文件 `:185-212`（`:189`） |
| listTools 后逐个包装注册、错误前缀 `[moduleName]` | 同文件 `:263-303`（`:279`） |
| browser 三控制模式工厂（hybrid/visual-grounding/dom） | `browser-control-strategies/strategy-factory.ts:29-38` |
| dom 模式 17 个 MCP 动作工具清单 | `browser-dom-strategy.ts:27-46` |
| visual-grounding：GUI Agent 工具 + 自实现导航/取文/状态/截图 | `browser-visual-grounding-strategy.ts:21-64` |
| hybrid：视觉 + DOM 并存、"without handling conflicts" | `browser-hybrid-strategy.ts:13-15,19-52` |
| 自实现 8 工具 id（navigate/back/forward/refresh/get_markdown/get_url/get_title/screenshot） | `tools/navigation.ts:20,55,122,151`、`tools/content.ts:27`、`tools/status.ts:23,44`、`tools/visual.ts:22` |
| browser_vision_control 工具定义（thought/step/action 三参 + 动作空间文本） | `browser-gui-agent.ts:97-140`；highlightClickableElements 默认 false `:91` |
| provider 不支持视觉时校验拒绝 | `browser-control-validator.ts`（AgentTARS 构造器调用 `agent-tars.ts:47-53`） |
| web_search 五 provider（browser_search/bing/tavily/searxng/duckduckgo） | `environments/local/search/search-tool.ts:76-100`（id `:100`） |
| filesystem 11 工具、EXCLUDED_TOOLS=['directory_tree'] 安全替换 | `filesystem-tools-manager.ts:35`、安全版 `:141`；工具名 `packages/agent-infra/mcp-servers/filesystem/src/server.ts:178-471` |
| run_command / run_script | `packages/agent-infra/mcp-servers/commands/src/server.ts:38-74` |
| 系统提示自述 "Inspired and modified from Manus ❤️" | `multimodal/agent-tars/core/src/prompt.ts:8-9` |
| 系统提示含"敏感操作建议用户临时接管浏览器" | 同文件 `<system_capability>` 节 |
| AIO 沙箱模式：本地工具全禁、改走 AIO Sandbox MCP | `environments/aio/index.ts:11-27`；News 条目 `README.md:73-74` |
| 桌面端四 Operator 切换 | `apps/ui-tars/src/main/services/runAgent.ts:121-165` |
| LocalBrowser：BrowserFinder 找本机浏览器 → CDP | `packages/ui-tars/operators/browser-operator/src/browser-operator.ts:724-740`；LocalBrowser=puppeteer-core `packages/agent-infra/browser/package.json` |
| BrowserOperator 动作 switch（navigate/click/type/hotkey/scroll/finished/call_user/user_stop…） | `browser-operator.ts:221-294` |
| 浏览器缺失硬报错 | `apps/ui-tars/src/main/services/browserCheck.ts`（runAgent.ts:134-144 调用） |

## 4. 遥测与模型端点

| 断言 | 证据 |
|---|---|
| UTIO = UI-TARS Insights and Observation，POST JSON | `packages/ui-tars/utio/src/index.ts:9-35`（类注释 `:10-12`） |
| 事件：appLaunched（平台/OS/屏幕尺寸）、sendInstruction（用户指令）、shareReport | `apps/ui-tars/src/main/services/utio.ts:31-89` |
| endpoint = 设置项 utioBaseUrl；**空则整体不上报** | 同文件 `:19-27`（getEndpoint/ensureUTIO）；`packages/ui-tars/utio/src/index.ts:17`（`if (!this.endpoint) return`） |
| 静默失败（telemetry 错误吞掉） | `utio/src/index.ts:31-33` |
| VLM_PROVIDER 四预设（HF UI-TARS-1.0/1.5、Ark doubao-1.5-ui-tars/-thinking-vision-pro） | `apps/ui-tars/src/main/store/types.ts:44-49`；映射 `utils/agent.ts:15-31` |
| 端点 = 任意 OpenAI 兼容 API（baseURL/apiKey/modelName 三项） | `docs/setting.md:40-119`（HuggingFace/Ark 示例）；环境变量 `apps/ui-tars/src/main/env.ts:19-22` |
| 远程模式免费模型端点（OSS 构建置空） | `apps/ui-tars/src/main/remote/shared.ts:53-60`（`UI_TARS_PROXY_HOST=''` `:53`、FREE_MODEL_BASE_URL `:60`） |
| 远程计算机操作抽象（moveMouse/clickMouse/typeText/scroll/takeScreenshot） | 同文件 `:22-38`（BaseRemoteComputer） |
| useResponsesApi / previousResponseId（Responses API 支持） | `runAgent.ts:168-189`、`sdk/src/GUIAgent.ts:259,302-305` |
| 图像预算常量（IMAGE_FACTOR=28、MAX_PIXELS 按模型版本） | `packages/ui-tars/shared/src/constants/vlm.ts:1-13` |

## 5. 负证据（判定"没有"的五面依据）

| 负结论 | 五面法依据 |
|---|---|
| **不使用 Peekaboo**（与 goose 无关） | 全仓 `grep -ri peekaboo`（ts/tsx/json/md）零命中；`grep -ri goose` 命中均为 `mongoose`（MongoDB ODM，`multimodal/tarko/agent-server*/package.json` 等）。安装面/进程面不适用（本机未装），配置面/权限面同零 |
| **无逐动作确认门** | 源码面：SDK 循环无 approval 钩子（`GUIAgent.ts:130-430` 全循环）；桌面 IPC 仅 pause/stop（`ipcRoutes/agent.ts`）；文档面：docs/ 无确认模式章节 |
| **OSS 构建远程 Operator 不可用** | `UI_TARS_PROXY_HOST` 硬编码空串（`remote/shared.ts:53`），四个 URL 皆派生自它 |
| **SoM 不参与接地** | setOfMarksOverlays 输出只进 `screenshotBase64WithElementMarker`（UI 消息字段，runAgent.ts:60-118），不进 VLM 请求构造（`sdk/src/GUIAgent.ts:241-260`） |
| **浏览器 dom 模式无视觉** | DOM 工具集纯 CDP（`browser-dom-strategy.ts`），无截图循环挂钩（onEachAgentLoopStart 的 GUI Agent 分支以 `control !== 'dom'` 为前提，`environments/local/index.ts:314-323`） |

## 6. 与 12 家对照的两点口径说明

1. 本册"CU 工具面 = 1 个动作空间"指模型可见面（`Action:` 文本协议）；Agent TARS 侧模型可见面是 1 个 `browser_vision_control` 工具。二者是同一解析器 (`ActionParserHelper`) 的两个入口。
2. 桌面端（v1 SDK）与 Agent TARS（gui-agent 包）是**两代内核并存**：前者 while 循环 + onData 回调；后者 @tarko/agent 事件流 + 工具调用引擎。分册分别标注出处。

## 7. 合规

- 上游整仓 Apache-2.0；vendor 子集（9 文件）sha256 校验与许可全文见 `source/ui-tars/vendor/PROVENANCE.md`；
- UI-TARS 模型权重许可证独立于代码，本仓库未搬运任何权重；
- 引用上游代码均 ≤5 行/处且以说明为目的；无凭据、无二进制、无打包产物。
