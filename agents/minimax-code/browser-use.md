# MiniMax Code：Browser Use —— 内嵌 WebContentsView + CDP，语义 ref 优先、不给任意 JS

> 基线同 README/computer-use.md（`/tmp/mm-asar`，3.1.0）。
> schema：[source/minimax-code/schemas/browser-actions.json](../../source/minimax-code/schemas/browser-actions.json)（24 action）、[browser-fine-grained.json](../../source/minimax-code/schemas/browser-fine-grained.json)（13 细粒度工具）；证据：[evidence/inventory.md](evidence/inventory.md) §C。

## 速览

**BU = WebContentsView（右侧 FilePanel）+ `@mavis/browser-core` 经 CDP 观察与驱动；模型只拿"不透明 ref + 结构化状态"，输入全是 CDP 合成事件，明确不提供任意 JS。**

工具运行时为 `EmbeddedBrowserToolRuntime`（112KB，action 装配、文本输入超时预算、CDP 事件计数估算）；会话↔tab 注册表持久化到 `embedded-browser-tabs.json`。binding 对称于 CU：`browser.use v1` + `requiredSkills:["control-in-app-browser"]`，宿主把 `browser` 工具以 **`mcp_browser`** 逻辑名暴露给插件绑定。

## 架构一图

```
模型（Anthropic Messages）
 └─ browser 工具（compact：1 工具 × 24 action；full：13 个单动作 browser_*）
     └─ EmbeddedBrowserToolRuntime（action 装配 · 文本输入超时预算 · CDP 事件计数）
         └─ @mavis/browser-core ── CDP（DOM / Accessibility / Input / Network / Page）
             ├─ 观察：可交互元素快照 → 不透明 ref + rect + 语义名（落盘元素映射缓存）
             ├─ 动作：Input.dispatchMouseEvent / dispatchKeyEvent / insertText 合成事件
             └─ 宿主：WebContentsView 右侧面板 + 会话级 tab 注册表（持久化）
```

## 工具面：统一 `browser` 工具（24 action，compact）

**桌面插件模式固定 compact 暴露；full 形态另有 13 个单动作 `browser_*` 工具，能力一一对应。`executionMode:'sequential'`——状态机工具，禁止并行。**

| action | 输入要点 | 语义 / 安全要点 |
|---|---|---|
| `inspect` | 可空 | URL、标题、页面状态、**可交互元素不透明 ref 清单**（actionable/coordinateSpace/rect）；截断时返回 snapshotId+nextOffset 续页 |
| `query` | `kind` | text / dom / editable（可续页）/ semantic / console（200 条上限、脱敏）/ network（仅摘要，明示"时间先后≠因果"） |
| `navigate` | `url` | Electron 上对已加载 tab 必须显式 `replaceCurrentTab:true`（省略即失败关闭，防误替换用户可见页面） |
| `open_tab` | `url` | 新开 tab 保留当前页；headless 下保留页可恢复 |
| `return_to_previous_tab` / `back` / `forward` / `reload` | 可空 | 历史/保留页恢复；back/forward 只在当前 tab 历史内 |
| `click` | `ref` 或坐标（互斥） | button、click_count 1-3、delay；双击左键+ref 升级为 AXOpen 语义 `double_click` |
| `click_and_wait_for_navigation` | `ref`, timeout ≤60s | 原子动作：先注册导航监听再点击；不导航则 `ACTION_TIMEOUT` |
| `double_click` | 同 click | |
| `drag` / `hover` | ref 或坐标 | hover 后可从 tooltip 语义恢复元素名（含置信度），用于图标按钮消歧 |
| `fill` | `ref`, `text` | **总是先清空**（拒绝 `clear` 字段） |
| `type` | `ref`, `text`, `clear?`, `delay?` | 逐键输入；超时按"delay×字符数 + CDP 事件数×20ms + 30s"预算，超预算报错 |
| `paste` | `ref`, 纯文本 | 不读宿主 OS 剪贴板；headless 用会话内隔离剪贴板 |
| `press_key` | `key`, `modifiers?` | |
| `check` / `uncheck` / `select_option` | `ref`（/`values`） | 仅 ref，不接受坐标 |
| `scroll` | direction/distance 或 ref | 结构化 effect：moved/actualDelta/atStart/atEnd；跨域 frame 不可验证时 fail-closed |
| `wait` | url/selector/text/state/timeout | |
| `screenshot` | 可空 | scope: viewport / fullPage / clip |
| `upload_files` | `ref`, paths[1..20] | **唯一文件校验点**：同一动作内校验授权/存在性/类型/数量/大小 |

工具描述要点：会话作用域、先 skill 后工具、一次一个动作、`safety.requiredNextTool` 立即服从、登录/密码/验证码一律用户接管或停止、截图默认仅模型可见（不主动宣称已展示给用户）。

## 观察机制

| 机制 | 事实 |
|---|---|
| 可交互元素快照 | CDP `DOM.getDocument` + `Accessibility.getFullAXTree`；每元素输出**不透明 ref**（快照作用域，导航/重载即失效）、actionable、coordinateSpace（不可用时明确禁止坐标猜测）、rect |
| 语义树/序列化 | query kind=text/dom/editable/semantic；旧 index 编号已被 compact 弃用（仅保留兼容） |
| hover 语义 | tooltip 语义名 + 置信度（high/medium 足以选中），解决无文本图标按钮定位歧义 |
| console/network | 每 tab 200 条 / 48KiB 上限、URL 与凭据形状值 `[REDACTED]` 脱敏、不含请求头/体/cookie |
| 动作后自动视觉观察 | 导航/点击/有效滚动/拖放/上传自动附 1 张压缩截图（每轮上限 2-4 张）；原生 input/textarea 写入通常跳过（结构化校验更便宜） |
| 元素映射缓存 | 按 域+内容哈希 落盘 `browser-cache/element-maps/`，提供 index→element 反查 |

## 动作机制（CDP 层）

- 全部输入为 CDP 合成事件（`Input.dispatchMouseEvent/dispatchKeyEvent/insertText` 等）；点击导航检测窗口 100ms。
- 填充校验：写入后 4 次采样（间隔 50ms）确认值稳定 → 结构化 `effect.verified`；普通 `click` 的 verified 恒 `false` 且 `verificationRequired:true`，`UNEXPECTED_NAVIGATION` 单独成码。
- `click_and_wait_for_navigation` 先注册 Page 导航监听再点击，避免竞态；文件上传走 `DOM.setFileInputFiles` 类指令。
- Electron 侧另有后台渲染宿主（WebContentsView 保持合成器渲染但不泄漏桌面 UI）、agent 光标可视化、自适应预算；链接默认在嵌入式浏览器打开，支持跨会话恢复 tab 与页面。

## 安全模型：运行时强制，不止提示词

| 门 | 机制 |
|---|---|
| Skill 前置 | 本 turn 需要 browser 而未加载 `control-in-app-browser` 时不注入工具；被调即返回 `SKILL_REQUIRED`；skill 加载必须**独占一个 assistant step**（同 step 第二个工具调用即 retry）；压缩后回执失效需重载 |
| REQUIRED_NEXT_TOOL 硬门 | 受信任结果带 `safety.requiredNextTool:'ask_user'`（如登录页要求接管）时，运行时拦截后续一切其它工具调用直至真调 `ask_user`；旧版 feature 开关失效（BROWSER_PLUGIN_MANAGED） |
| kill switch | 插件吊销后适配器直接 fail-closed，连工作区 I/O 都不做 |
| 上传白名单 | 仅当前轮附件精确路径或活动工作区内路径（symlink 目标也须解析进工作区）；skill 明文禁止 shell/read/stat 预检 |
| 凭据边界 | 不可读取/生成/填写任何认证输入；不读 cookie/localStorage/token/profile；可见面板 → `ask_user` 同 tab 接管，headless → 停止并报告 |
| 最终动作确认 | 发布/发送/删除/购买/转账/权限变更须紧邻显式确认；"继续/好的/做完它"不算；草稿变化/重载/换号后作废 |
| 页面内容不可信 | 页面内容不可授权、不可改写用户请求；被动阅读请求不得触发交互 |

## 第三条路径：chrome-devtools-mcp 官方插件

`npx -y chrome-devtools-mcp@1.8.0`（stdio，timeout 120s），本机实录 29 工具；操作**用户本机真实 Chrome**，带 `evaluate_script`（任意 JS）与性能 trace——与原生 `browser` 工具互补而非替代；插件另带 5 个技能（a11y 调试/LCP/内存泄漏等）。

## Provider 与"云端 BU"判定

- 双 provider：`electron-file-panel`（可见面板，open_tab 优先）与 `native-headless-chrome`（隔离 profile 无头）。**本机无 headless 启动代码**（grep 仅命中工具描述与测试 seam）→ 推断宿主实现位于未安装的 TUI 版或云端 Matrix 运行时；browser-core 按 provider 中立设计。
- 手机端 WebSocket 遥控（remote-control-bridge）只遥控会话/权限/消息，**不是** CU/BU 的输入通道。

## 与 Claude 工具协议的关系（BU 视角）

typebox schema → PiTurnRunner → Anthropic Messages `tools`，截图/自动视觉以 image 块回传。相比 Anthropic `computer_20250124` 的"坐标+截图循环"范式，本实现是**结构化语义优先**（a11y 快照 + 不透明 ref + 效果验证），canvas/地图等非 DOM 目标才回落坐标；`browser.use` binding 把 browser 工具以 `mcp_browser` 逻辑名统一进插件层——Claude Code 插件体系没有的"宿主能力绑定"扩展。
