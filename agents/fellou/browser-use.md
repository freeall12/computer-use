# Fellou 的 Browser Use：Eko 开源框架逆向 —— SoM 派三运行时 + XML 工作流编排

> 结论先行：**Fellou 的 Browser Use 有完整开源实证——就是厂商自家的 Eko 框架：一个基类（BaseBrowserLabelsAgent）落三个运行时（Chrome 扩展 / Node Playwright / 页面内），观察靠"标注截图 + 元素索引"，编排靠 NL→XML 工作流。**
> 官方口径："The key to Fellou 2.0's success — Eko 2.0, a crucial open-source Browser-use infrastructure"（[evidence §8.3](evidence/inventory.md#83-官方博客)）。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| BU 工具面 | **13 个**内置工具（v4.1.3 实测；旧文档口径 15） |
| 架构 | 单基类三运行时 + 远端 MCP 回传执行 + ChatAgent 四工具门面 |
| 目标域 | 用户自己的浏览器（扩展/已登录 profile）；Node 可 CDP 附着已开 Chrome |
| 观察机制 | SoM 变体：彩色标注框截图 + `[33]:<button>` 元素索引，互相对齐 |
| 动作机制 | 页内 DOM 事件（扩展 chrome.scripting）/ Playwright 语义动作（Node） |
| 安全模型 | 计划级确认门 + human_interact 四型 + 求助移交 |
| 本机可用 | ⚙️ 框架开源可自行运行；Fellou 浏览器本体不可得 |

## 架构一图

```
ChatAgent（eko-core/chat，产品聊天门面）
 ├─ deepAction ────→ new Eko()（本地编排）或云端 Javis（产品部署，见 computer-use.md）
 ├─ webpageQa（只读页面问答）/ webSearch / variableStorage
 └─ Eko 引擎
     ├─ Planner：NL → XML 工作流
     │    <agent name="Browser" id="1" dependsOn="0">…<node input=/output=>…<forEach>…<watch event="dom">
     ├─ Chain 执行器：依赖图并行（agentParallel）+ 变量传递 + task_snapshot 暂停恢复
     └─ BrowserAgent（BaseBrowserLabelsAgent 三个实现）
         ├─ eko-extension：chrome.tabs.captureVisibleTab(jpeg 60) + chrome.scripting.executeScript（MV3）
         ├─ eko-nodejs：playwright-extra + StealthPlugin；setCdpWsEndpoint 附着已开浏览器；setCookies 导登录态
         └─ eko-web：html2canvas + history.pushState（跨站抛错，仅当前站点）
 工具执行可下沉远端 MCP：请求带 extInfo{environment:"browser",browser_url}；
 响应若带 extInfo.javascript → 页内 ${script};execute(args)（云端下发脚本回传执行）
```

## 三运行时对照

| 维度 | eko-extension | eko-nodejs | eko-web |
|---|---|---|---|
| 截图 | captureVisibleTab（jpeg q60，失败重试 1s） | page.screenshot（jpeg q60，animations:"disabled"） | html2canvas 页内自绘 |
| 脚本注入 | chrome.scripting.executeScript | Playwright API | 页内直接执行 |
| 导航 | chrome.tabs.create + waitForTabComplete(8s) | page.goto | pushState，**仅限同站点** |
| 多标签 | tabs.query by windowId | pageMap LRU（tabId 自 1000 起分配） | 无 |
| 登录态 | 宿主浏览器原生 | setCookies / userDataDir / CDP attach | 当前页原生 |
| 反检测 | 无 | playwright-extra + **StealthPlugin**（自述用 browserscan.net 验指纹） | 无 |
| 典型宿主 | **Fellou 浏览器**（MV3 侧栏扩展形态） | 服务器/桌面自动化 | 任意网页嵌 Eko |

## 13 工具面（BaseBrowserLabelsAgent，v4.1.3 实测）

| 工具 | 参数要点 | 一句话语义 |
|---|---|---|
| navigate_to | url | 开新页并等待 complete（8s 上限） |
| current_page | — | 当前 url/title |
| go_back | — | navigation.back → history.back → 回退标签三级兜底 |
| input_text | index, text, enter | 按索引定位输入 |
| click_element | index, num_clicks(默认1), button(left/right/middle) | 按索引点击 |
| scroll_mouse_wheel | amount | 原位滚轮（scroll_to_element 在 v4.1.3 降为 protected 方法，旧文档列为工具） |
| hover_to_element | index | 悬停 |
| extract_page_content | variable_name? | 全文抽取，可存工作流变量 |
| get_select_options / select_option | index | 原生 `<select>` 读取/选择 |
| get_all_tabs / switch_tab | — / tabId | 标签管理 |
| wait | duration | 等待加载 |

## 观察：SoM 标注 + 元素索引（浏览器内 agent 的主流共识）

- 页内 `run_build_dom_tree` 遍历可交互元素，产出 `element_str`（`[33]:<button>Submit</button>`，非交互 `[]:` 只作上下文）+ `selector_map` + `area_map`（坐标框）。
- 截图上按 area_map 画**同色框 + 右上角标签**（`mark_screenshot_highlight_elements`，OffscreenCanvas）；元素定位兜底 `[eko-user-highlight-id="eko-highlight-N"]`。
- 纪律派防漂移：提示词明令 "Use the latest element index, do not rely on historical outdated element indexes"——**无 snapshot_id 绑定、无动作后回读**，比 ZCode/Kimi 的收据派弱一档。
- 观察只覆盖可视视口；全文走 `extract_page_content`。
- `watch_trigger` 监听节点：**VLM 双帧对比**判变更，阻塞至变更/超时——产品"监听 Gmail/Slack/网页变化、无限步长"的实现。

## 动作与失败语义

- 动作全部落在 DOM 层：扩展运行时页内函数按索引 `window.clickable_elements[i]` 取元素派发事件；Node 运行时走 Playwright；**均无 isTrusted 真实输入**。
- MCP 回传执行是隐藏大招：远端工具可返回 `extInfo.javascript`，宿主在页面内拼接 `${script};execute(${params})` 执行——**工具逻辑可在服务端热更新**（也是 Fellou 云端"深度动作"下沉的通道）。
- 失败处理靠提示词纪律："If stuck, try alternative approaches, don't refuse tasks"；弹窗/cookie 横幅自行处理；登录/验证码/支付必须 `request_help`。

## 编排：NL → XML 工作流（Fellou 的真差异化）

| 机制 | 事实 |
|---|---|
| Planner | 独立 LLM 调用，输出 XML：多 agent `dependsOn` 依赖图（0→1→(2∥3)→4 式并行）、node 级 `input/output` 变量、`forEach` 循环、`<watch event="dom" loop>` 监听触发 |
| 生成与执行分离 | `eko.generate()` 产出可审阅工作流 →（可选 workflow_confirm）→ `eko.execute()`；支持 `modify()` 重规划、abort/pause/resume（task_snapshot 存档续跑） |
| 人机四型 | confirm（危险操作）/ input / select / request_help（request_login、request_assistance） |
| 记忆 | 会话内 EkoMemory（默认 15 条/64k token，超限压缩）；跨会话 `chatService.memoryRecall` 槽位注入 `<retrieved_memories>`——**Agentic Memory 本体在闭源 app** |
| 上限 | maxReactNum 500、maxOutputTokens 16000、maxRetryNum 3；A2A 仅 8 行占位接口 |

## 安全模型（BU 视角）

| 层 | 机制 | 备注 |
|---|---|---|
| 确认门 | workflow_confirm 计划级 | **默认关**（`config.workflowConfirm:false`），产品层是否打开未知 |
| 移交 | request_help 把登录/CAPTCHA/SMS/QR/支付交还人 | 与官网"AI 可模拟人类行为解 CAPTCHA"宣称自相矛盾——框架纪律与产品话术两张皮 |
| 隔离 | eko-web 限同站；扩展看宿主权限面（MV3 manifest 声明 tabs/scripting/storage/downloads 等） | Shadow Workspace 窗口级隔离无开源实证 |
| 凭据 | Node setCookies 显式导 Cookie；无剪贴板/按键钩子 | 无本仓库意义上的 CU 红线问题 |

## 与同类对照（BU 视角）

| 产品 | BU 架构 | 与 Fellou/Eko 差异 |
|---|---|---|
| Fellou（eko） | 单基类三运行时 + SoM 索引 + XML 工作流 | 唯一把编排 DSL 当产品卖点的 |
| Dia | 内嵌 Claude SDK + 单 REPL + Playwright/CDP | Dia 靠 SDK 现成编排；Eko 是自研 DSL |
| ZCode | 内嵌 WebView + `js` REPL | 同"一个入口"，ZCode 有私 broker，Eko 走标准 chrome API |
| browser-use（开源） | Playwright + DOM 标注（build-dom-tree 同源思路） | Eko 观察层与其同范式（SoM + 元素列表） |
| Devin | 云 VM Chromium + 本地投影 | Fellou 云端委派方向类似，但沙箱不透明 |
| comet* / atlas* | 浏览器内侧栏助手（公开信息） | 同底座形态；编排面未公开 |

\* 公开渠道信息，非静态基线。

## 快速复核入口

```bash
R=/Volumes/YANG/apps-re/fellou/eko
grep -n "name: \"" $R/packages/eko-core/src/agent/browser/browser-labels.ts | wc -l   # 13 工具
grep -n "StealthPlugin" $R/packages/eko-nodejs/src/browser.ts                          # L2,L358
grep -n "extInfo\[\"javascript\"\]" $R/packages/eko-core/src/agent/browser/browser-base.ts  # L130
grep -n "memoryRecall" $R/packages/eko-core/src/chat/chat-agent.ts                     # L147
grep -n "workflowConfirm" $R/packages/eko-core/src/config/index.ts                     # 默认 false
```
