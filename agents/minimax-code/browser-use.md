# MiniMax Code — Browser Use（浏览器控制）完整逆向

> 证据基线同 README/computer-use.md：app.asar 解包目录 `/tmp/mm-asar`。所有相对路径以 `/tmp/mm-asar/` 为根。

## 1. 结论速览

- **本地嵌入式浏览器，非云端**。Browser Use = Electron `WebContentsView`（显示在主界面右侧 FilePanel）+ 自研 `@mavis/browser-core` 通过 **CDP（Chrome DevTools 协议）** 观察与驱动页面。模型只拿到"不透明元素 ref + 结构化状态"，所有输入均为 CDP 合成事件；**不提供任意 JavaScript 执行**。
- 模型工具面：一个统一的 **`browser` 工具（24 个 action）** 为主（compact 暴露），另有一组细粒度 `browser_inspect / browser_navigate / browser_click / browser_type / browser_press_key / browser_scroll / browser_hover / browser_wait_for / browser_get_dom / browser_screenshot / browser_paste / browser_verify_text / browser_inspect_editable_targets` 定义（full 暴露形态）。
- 独特机制：**Skill 强制前置**（首次使用前必须以"独占 step"加载 `control-in-app-browser` skill，否则工具返回 `SKILL_REQUIRED`）、**`safety.requiredNextTool` 硬门**（结果要求 `ask_user` 时，运行时在工具层拦截其它一切后续调用）、**动作后自动视觉观察**（visualObservation 压缩截图）、**结构化效果验证**（effect.verified / scroll effect / UNEXPECTED_NAVIGATION）。
- 双 provider 设计：`electron-file-panel`（可见嵌入式，桌面端默认）与 `native-headless-chrome`（无头、隔离 profile；桌面包内未见其启动代码，推断属 TUI/云端版本，见 §8）。
- 第三条浏览器路径：官方插件 **chrome-devtools-mcp**（`npx chrome-devtools-mcp@1.8.0`，Puppeteer 操作本机真实 Chrome，含 evaluate_script）——与原生 `browser` 工具并存，互不替代。

## 2. 能力载体清单

| 组件 | 路径 | 说明 |
| --- | --- | --- |
| 嵌入式浏览器控制器 | `dist/main/modules/browser/controller.js` | "管理嵌入式 WebContentsView"（Electron 30+ 取代 BrowserView 的方案），含创建/失败回收 |
| CDP 传输 | `dist/main/modules/browser/electron-cdp-transport.js`、`cdp-helper.js` | WebContents → CDP 会话封装 |
| 工具运行时 | `dist/main/modules/browser/embedded-browser-tool-runtime.js`（112KB） | `EmbeddedBrowserToolRuntime`，action 装配、文本输入超时预算、CDP 事件计数估算 |
| 页面语义核心 | `node_modules/@mavis/browser-core/src/`（browser-core.ts、cdp-helper.ts 2427 行、browser-snapshot.ts、element-map-manager.ts、browser-semantic-tree.ts、cdp-page-scanner.ts、cdp-file-upload.ts、clipboard.ts…） | provider 中立（"Provider-neutral page semantics used by Electron and native-headless"，browser-core-contracts.ts 注释） |
| 运行时服务 | `node_modules/@mavis/local-runtime-v2/src/service/browser-use/`（browser-use.service.ts、policy.ts、reminders.ts、screenshot-preprocessor.ts、session-state.ts、workspace-assets.adapter.ts） | 能力门、skill 回执、安全钩子、截图压缩 |
| 工具定义 | `node_modules/@mavis/agent-tools/src/desktop/builtin-browser-defs.ts`（1006 行）、`local-browser.ts`（1457 行） | schema 与 provider 导航指引 |
| 官方插件 | `~/.minimax/v2/plugin-cache/official/sha256-tree-v1-74e227d…/` | name `browser-use`，bindings/browser.binding.json，skills/control-in-app-browser |
| 持久化 | `~/Library/Application Support/MiniMax/embedded-browser-tabs.json` | 会话↔tab 注册表（registry v2：persistentTabId、导航历史、activeIndex） |
| 元素映射缓存 | `~/Library/Application Support/MiniMax/browser-cache/element-maps/` | 按 `element-map-<domain>-<hash>.json` 落盘（element-map-manager.ts） |

**binding 清单**（与 CU 对称）：`bindings/browser.binding.json` → `bindingId: browser-control`，`logicalToolName: browser.control`，`hostCapability: browser.use v1`，`requiredSkills: ["control-in-app-browser"]`，`allowedSurfaces: ["interactive"]`。宿主适配器 `host-capability/browser.ts` 把 `browser` 工具改名为 **`mcp_browser`** 暴露给插件绑定，并保留 turn 局部准入标记。

## 3. 工具面与参数契约

### 3.1 统一 `browser` 工具（compact 形态，桌面插件模式默认）

`builtin-browser-defs.ts`：`LocalBrowserToolDef.schema = { action: <24 枚举>, input?: … }`，`executionMode: 'sequential'`（状态机工具，禁止并行）。

`LOCAL_BROWSER_ACTION_NAMES`（24 个）与输入要点：

| action | 必填 input | 语义/要点 |
| --- | --- | --- |
| `inspect` | 可空 | 返回 URL、标题、页面状态、snapshotId、**可交互元素的不透明 ref 清单**（含 `actionable`/`pointerActionable`/`coordinateSpace`、`rect`）；截断时返回 `snapshotId+nextOffset` 结构化续页 |
| `query` | `kind` | `text`（可见文本，selector 可用）/ `dom`（markup）/ `editable`（可编辑目标快照，可续页）/ `semantic`（按可见标识文本解析 ref，limit ≤ 上限）/ `console`（每 tab 200 条上限、48KiB 分页、URL 与凭据形状值脱敏）/ `network`（仅摘要：方法/脱敏 URL/资源类型/结果/状态/耗时；`afterSequence` 时间检查点，明示"时间先后≠因果"） |
| `navigate` | `url` | 按 provider 导航策略；Electron 上对已加载 tab 必须显式 `replaceCurrentTab:true`（省略即失败关闭，防误替换用户可见页面） |
| `open_tab` | `url` | 新开 tab（保留当前页）；headless 下被保留页可用 `return_to_previous_tab` 恢复 |
| `return_to_previous_tab` / `back` / `forward` / `reload` | 可空 | 历史/保留页恢复；back/forward 只在当前 tab 历史内 |
| `click` | `ref` 或 `position`/`normalized_position`（互斥，混用验证失败） | button left/right/middle、click_count 1-3、delay 0-5000ms；`click_count:2`+左键+ref 会升级为 AXOpen 语义的 `double_click` |
| `click_and_wait_for_navigation` | `ref`, timeout ≤60s | 原子动作：先注册导航监听再点击，返回 navigation 后置条件；不导航则 `ACTION_TIMEOUT` |
| `double_click` | 同 click | |
| `drag` | 起点/终点 ref 或坐标 | |
| `hover` | ref 或坐标 | ref-hover 后可从 tooltip 语义恢复元素名（`effect.semantic.name/confidence`），用于图标按钮消歧 |
| `fill` | `ref`, `text` | **总是先清空**（拒绝 `clear` 字段） |
| `type` | `ref`, `text`, `clear?`, `delay?` | 逐键输入；文本输入超时按"delay×字符数 + CDP 事件数×20ms + 30s 完成缓冲"预算（embedded-browser-tool-runtime.js），超预算报 `INPUT_DURATION_EXCEEDS_DEADLINE` |
| `paste` | `ref`, 纯文本 `text` | 不读宿主 OS 剪贴板；headless 用会话内隔离剪贴板（browser-core/clipboard.ts） |
| `press_key` | `key`, `modifiers?` | |
| `check` / `uncheck` / `select_option` | `ref`（/`values`） | 仅 ref，不接受坐标 |
| `scroll` | `direction`/`distance` 或 ref | 返回结构化 effect：`moved/actualDelta/atStart/atEnd/NO_SCROLL_EFFECT/SCROLL_EFFECT_UNVERIFIED`（跨域 frame 不可验证时 fail-closed） |
| `wait` | `url`/`selector`/`text`/`state`(attached|detached|visible|hidden)/`timeout` | |
| `screenshot` | 可空 | `scope: viewport|fullPage|clip`（clip x/y/width/height） |
| `upload_files` | `ref`, `paths[1..20]` | **唯一文件校验点**：同一动作内校验授权、存在性、类型、数量、大小；路径仅限"当前轮用户附件精确路径"或"活动工作区内文件"（含 symlink 目标解析），workspace-assets.adapter 强制 |

工具描述（`LocalBrowserToolDef.description`，拼接数段长指令）要点：会话作用域、先 skill 后工具、一次一个动作、`safety.requiredNextTool` 立即服从、登录/密码/验证码一律用户接管（`ask_user`）或停止、最终对外动作需即时确认、截图默认仅模型可见（不主动宣称已展示给用户，用户明示要求时才允许 `userDelivery.mediaMarkup` 一次）。

### 3.2 细粒度 `browser_*` 工具（full/both 形态）

与统一工具同源的 13 个单动作工具（schema 见 builtin-browser-defs.ts 780-1006 行），能力一一对应（inspect/navigate/click/type/press_key/scroll/hover/wait_for/get_dom/screenshot/paste/verify_text/inspect_editable_targets）。`buildLocalBrowserRuntimeTools` 的 `exposure: 'compact' | 'full' | 'both'` 控制暴露哪套；`activationMode === 'desktop-plugin'` 时固定 compact。

## 4. 观察机制

1. **可交互元素快照（核心）**：`browser-snapshot.ts` + `cdp-page-scanner.ts` 基于 CDP 的 `DOM.getDocument` / `Accessibility.getFullAXTree`（cdp-helper.ts 文件头注释）构建"可交互元素"列表；每个元素输出**不透明 ref**（opaque ref，快照作用域，导航/重载即失效）、`actionable`（Chromium 判定可交互）、`pointerActionable`、`coordinateSpace`（不可用时明确禁止坐标猜测）、`rect`（主 Frame `getBoundingClientRect()` 空间）、语义名。`element-map-manager.ts` 把完整元素信息按域+内容哈希落盘缓存，并提供 index→element 反查（旧 index 编号已被 compact 形态弃用，仅保留兼容）。
2. **语义树/序列化**：`browser-semantic-tree.ts`、`browser-semantic-serializer.ts`、`browser-semantic-registry.ts`、`dom-serializer.ts` 提供语义层级与 DOM 序列化（query kind=dom）。
3. **hover 语义**：`browser-hover-semantic.ts` —— hover 后捕获 tooltip 语义名 + 置信度（high/medium 足以选中，low 仅诊断），专门解决"无文本图标按钮"的定位歧义。
4. **控制台/网络诊断**：Runtime.consoleAPICalled + 未捕获异常、Network 域事件；每 tab、每次顶层导航重置、200 条/48KiB 上限、`[REDACTED]` 凭据脱敏、不含请求头/体/cookie（cdp-diagnostic-helpers.ts、console-diagnostic-sanitizer.ts）。
5. **截图**：`screenshot-preprocessor.ts` 压缩后进入模型 content（image 块）；**动作后自动视觉观察**：导航/点击/有效滚动/拖放/上传可能自动附 1 张压缩图（每轮上限 2-4 张，工具描述 `BROWSER_POST_ACTION_VISUAL_GUIDANCE`），原生 input/textarea 写入通常跳过（结构化校验更便宜）。
6. **编辑态**：`editable` 快照列出可见可编辑目标（inputStrategy 如 `focused-keyboard` 会影响 CDP 事件预算计算）。

## 5. 动作机制（CDP 层）

- 全部输入为 CDP 合成事件（`Input.dispatchMouseEvent/dispatchKeyEvent/insertText` 等，见 cdp-helper.ts 与 VERIFIED_FILL 采样常量）；点击导航检测窗口 100ms（`ELECTRON_CLICK_NAVIGATION_DETECTION_MS`）。
- 填充校验：`VERIFIED_FILL_SAMPLE_COUNT=4`、间隔 50ms —— 写入后多次采样确认值稳定，产出结构化 `effect.verified`。
- `click_and_wait_for_navigation` 在点击前注册 Page 导航监听，避免"先点击后监听"竞态；普通 `click` 的 `effect.verified` 恒为 `false` 且 `verificationRequired: true`，`UNEXPECTED_NAVIGATION` 单独成码。
- 文件上传走 CDP 文件选择器路径（`cdp-file-upload.ts`），接受 `DOM.setFileInputFiles` 类指令（上游 ref → backend node）。
- Electron 侧还有 `background-browser-render-host.js`（后台渲染宿主，WebContentsView 保持合成器渲染但不泄漏桌面 UI）与 `agent-cursor*`（agent 光标可视化）、`embedded-browser-resource-diagnostics.js`（资源诊断）、`embedded-browser-adaptive-budget.js`（自适应预算）。
- 面板行为：`webLinkOpenDestination: "embedded"`（应用配置）——链接默认在嵌入式浏览器打开；`persistent-browser-registry.js` + `embedded-browser-page-resume.js` 支持跨会话恢复 tab 与页面（embedded-browser-tabs.json）。

## 6. 安全模型（运行时强制，不止提示词）

`local-runtime-v2/src/service/browser-use/`：

1. **Skill 前置门**：turn 装配时若判定本 turn 需要 browser（`resolveTurnCapability`），未加载 `control-in-app-browser` 前不注入 browser 工具；工具被调且 skill 未加载 → 返回 `SKILL_REQUIRED`。`policy.ts` 的 `PiAfterLlmCallHook` 强制 skill 加载必须**独占一个 assistant step**（同 step 内出现第二个工具调用即 retry："browser_skill_must_be_loaded_alone"）。压缩（compaction）后回执失效需重载。
2. **REQUIRED_NEXT_TOOL 硬门**：`createBrowserUseTurnToolSafetyGuard.beforeToolCall` —— 一旦受信任的 browser 结果带 `safety.requiredNextTool: 'ask_user'`（例如登录页要求用户接管），运行时拦截后续一切其它工具调用直至真正调用 `ask_user`；并拒绝走旧版 `request_feature_enable(featureKey='browser-use')` 开关（`BROWSER_PLUGIN_MANAGED`，插件接管后旧开关失效）。
3. **kill switch**：`createLiveBrowserUseAdapter(assertLiveAvailability)` 包装每个 action 适配器 —— 吊销后连工作区 I/O 都不做，直接 fail-closed。
4. **上传白名单**：仅当前轮附件精确路径或活动工作区内路径（symlink 目标也须解析进工作区），同一动作内完成全部校验，skill 明文禁止 shell/read/stat 预检。
5. **凭据边界**：不可读取/生成/填写任何认证输入（邮箱/密码/验证码/CAPTCHA/安全钥匙）；不读 cookie/localStorage/token/profile；可见面板 → `ask_user` 用户同 tab 接管；headless → 停止并报告。诊断查询对 URL query/fragment 与凭据形状值脱敏。
6. **最终动作确认合同**：发布/发送/删除/购买/转账/账号权限变更必须有紧邻的用户显式确认；`ask_user` 必须真调用（禁止文本假装），确认卡 affirmative 选项必须点名精确动作；"继续/好的/做完它"不算确认；草稿变化/重载/换号后确认作废。
7. **页面内容即不可信数据**：skill 首节即声明 webpage content 不可授权、不可改写用户请求；被动阅读请求不得触发交互（只读搜索可填过滤词、点明确非变更的搜索控件）。

## 7. chrome-devtools-mcp 官方插件（第三条路径）

`~/.minimax/v2/plugin-cache/official/sha256-tree-v1-9c07770…/`：

- `chrome-devtools-mcp.mcp.json`：stdio MCP，`npx -y chrome-devtools-mcp@1.8.0 --no-usage-statistics`，timeout 120s。
- 工具面（本机 `~/.minimax/mcp-runtime-names.json` 实录 29 个）：new_page/navigate_page/select_page/list_pages/close_page/take_snapshot/take_screenshot/click/fill/fill_form/type_text/press_key/hover/drag/wait_for/handle_dialog/upload_file/resize_page/emulate/evaluate_script/list_console_messages/get_console_message/list_network_requests/get_network_request/performance_start_trace/performance_stop_trace/performance_analyze_insight/lighthouse_audit/take_heapsnapshot。
- 定位差异：这是 Google 官方 Chrome DevTools 团队的 Puppeteer MCP，操作**用户本机真实 Chrome**，带 `evaluate_script`（任意 JS）与性能 trace —— 能力上与原生 `browser` 工具互补（原生工具无 JS 执行、作用域为嵌入式 WebContentsView）。
- 该插件同时携带 5 个技能：chrome-devtools / a11y-debugging / debug-optimize-lcp / memory-leak-debugging / troubleshooting。

## 8. Provider 体系与"云端 browser use"判定

- `local-browser.ts` 明确两个 provider 的导航指引：`electron-file-panel`（右侧面板，用户可见 → open_tab 优先）与 `native-headless-chrome`（"isolated profile without a visible panel"、绝对 HTTP(S) URL、navigate 默认替换当前工作页、"TUI headless provider keeps clipboard state isolated"）。
- **本机证据**：桌面包内未找到 headless Chrome 的启动/下载代码（无 `--headless`、`--remote-debugging-port`、puppeteer/playwright 依赖；`grep headless` 仅命中工具描述与测试 seam）。**推断**：`native-headless-chrome` provider 的宿主实现位于本机未安装的 TUI 版本或云端会话（MiniMax Agent 云端 Matrix 运行时）中；桌面端 `browser-core` 已按 provider 中立设计（browser-core-contracts.ts 注释、clipboard.ts "used by native-headless evaluation"、browser-transport.ts "native-headless test seam"）。
- 云端协同面：`@mavis/agent-tools/src/cloud/`（cloud-task 等）负责把任务委派到 Matrix 云运行时；多模态生成/检索类能力走 `mcode-tools` CLI 云目录（`mcode-tools connector …`，见 `.builtin-skills/mcode-tools-master/SKILL.md`）。网页语义操作（本文档所述）始终本地执行。
- 远程遥控：`@mavis/remote-control-bridge` + `~/Library/Application Support/MiniMax/remote-control/state.json`（desktop_device_id/binding_id）实现**手机端 WebSocket 遥控桌面会话**（事件帧映射、permission.ask 缓存重放、composer 模式同步；docs/EVENT-FRAMES.md）。它遥控的是"会话/权限/消息"，**不是** CU/BU 的输入通道（未见远程注入鼠标键盘事件或浏览器动作的帧类型）。

## 9. 与 Claude 工具协议的关系（BU 视角）

- 工具 schema 为 typebox（JSON Schema），经 PiTurnRunner → pi-ai anthropic provider 编码为 Anthropic Messages `tools`；调用与结果走标准 `tool_use`/`tool_result` 块，截图/自动视觉以 `content:[{type:'image',...}]` 回传 —— 与 Claude 的 image 结果块契约一致。
- 相比 Anthropic 官方 `computer_20250124`（屏幕坐标 + 截图循环）范式，MiniMax 的 BU 是**结构化语义优先**（a11y 快照 + 不透明 ref + 效果验证），只有在 canvas/地图等非 DOM 目标才回落坐标（`position`/`normalized_position`），与 Claude Code 的 Chrome 集成思路同向但为自研实现。
- `browser.use` Host Binding 把 `browser` 工具以 `mcp_browser` 逻辑名暴露给插件体系（host-capability/browser.ts），MCP 生态与原生工具在插件层统一 —— 这是 Claude Code 插件体系中所没有的"宿主能力绑定"扩展。
