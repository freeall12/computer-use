# Fellou 逆向证据清单

> 分析对象：Fellou（Fellou AI，fellou.ai）"Agentic Browser" macOS arm64 **安装包未获得**（官方分发链已死，
> 判定见 §1）；替代基线 = 厂商自家开源 agent 框架 **FellouAI/eko** v4.1.3（Fellou 浏览器的 Browser-use
> 基础设施，厂商官方口径见 §8.3）+ Wayback 存档的产品页声明（§8）。
> 方法：只读静态分析 + web 存档取证；未运行任何安装器、未触碰凭据。
> 本地分析副本：`/Volumes/YANG/apps-re/fellou/eko`（git clone，commit `c3de315af2c178826f8b1682b52638d18131252d`，2026-03-03）。

## 1. 「未拿到包」判定书

**结论：官方安装包在所有可达渠道均已死亡，判定未获得包；不做任何编造。** 最后已知发行版为
**Fellou-CE 1.0.18（产品版本 2.5.18，构建时间 2025-11-09）**，此后官方下载 API 仍指向同一死链。

| # | 渠道 | 尝试 | 结果 |
|---|---|---|---|
| 1 | fellou.ai/download 页 JS（DownloadProvider，chunk `app/layout-37dbf4713181bb1c.js` 模块 75194） | 提取硬编码直链 | `https://fellou.s3.us-west-1.amazonaws.com/FellouPC/mac/Fellou-CE-1.0.12-2.5.12-2025-09-29-1902-arm64.dmg`（旧版，已死） |
| 2 | fellou.ai 运行时 API `GET /api/download`（200，2026-10-08 实测） | 官方最新直链 | `.../Fellou-CE-1.0.18-2.5.18-2025-11-09-2107-arm64.dmg`（version:"2.5.18"）；Windows 2.5.15 `isEnabled:false` |
| 3 | 该 S3 对象（us-west-1 虚拟主机式） | `curl -r 0-200` | **301 PermanentRedirect**，响应头 `x-amz-bucket-region: us-east-1`，body 要求改用 `s3.amazonaws.com` 端点 |
| 4 | us-east-1 三种端点形态（`fellou.s3.us-east-1.amazonaws.com`、`s3.us-east-1.amazonaws.com/fellou/`、`fellou.s3.amazonaws.com`） | 新旧两代对象各测 | 全部 **403 AllAccessDisabled**（"All access to this object has been disabled"——AWS 账户级停用特征）；bucket 根 `GET /` 亦 403 |
| 5 | Homebrew | `brew info --cask fellou` | 无此 cask |
| 6 | GitHub（org=FellouAI 全仓 + releases） | API 枚举 | 仅 eko/eko-docs/eko-cli/fellou-blog 等；**无浏览器二进制 release** |
| 7 | Wayback Machine | CDX：`fellou.s3.us-west-1.amazonaws.com*`（922 条捕获）与三枚已知 DMG key 精确查询 | **0 条 DMG 捕获**（只有视频/图片）；`/api/download` 的历史 JSON（2025-04→07）同样只含同 S3 直链 |
| 8 | archive.org 全站 / HuggingFace / MacUpdate / xclient | 搜索 | 无 Fellou DMG |
| 9 | fellou.ai 自身 | sitemap 全枚举、`/api/download_v2` `/api/version` `/api/latest`、备选域名 download/dl/cdn.fellou.ai、fellou.com | 无替代分发；cdn.fellou.ai 连接失败；fellou.com 为停放页；blog/eko-docs 返回 503（源站部分瘫痪） |

复现：

```bash
curl -s https://fellou.ai/api/download | jq -r '.list[].resource[].url'   # 死链 S3 直链
curl -s -D - -o /dev/null "https://fellou.s3.us-west-1.amazonaws.com/FellouPC/mac/Fellou-CE-1.0.18-2.5.18-2025-11-09-2107-arm64.dmg" | grep -iE "^HTTP|x-amz-bucket-region"
curl -s "https://fellou.s3.us-east-1.amazonaws.com/FellouPC/mac/Fellou-CE-1.0.18-2.5.18-2025-11-09-2107-arm64.dmg"   # 403 AllAccessDisabled
```

> 佐证（账户级瘫痪）：fellou.ai/blog 与 eko.fellou.ai 2026-10-08 实测 503；首页 YouTube 视频同 bucket 同样 301。
> 判定：**非 waitlist/账号受阻，是发行基础设施整体死亡**；产品 2025-11 后未见新构建。

## 2. 替代基线：FellouAI/eko 仓库

| 项 | 值 |
|---|---|
| 上游 | https://github.com/FellouAI/eko（MIT LICENSE） |
| 分析修订 | commit `c3de315af2c178826f8b1682b52638d18131252d`（tag v4.1.3，2026-03-03） |
| 包版本 | `@eko-ai/eko` 4.1.3（packages/eko-core/package.json）；npm dist-tags latest=4.1.3 |
| 定位 | README："unified interface for running agents in both **computer and browser environments**"；org 描述指向 eko.fellou.ai |
| 结构 | pnpm monorepo：eko-core（agent/prompt/tools/memory/chat/mcp/llm）+ eko-extension（Chrome 扩展运行时）+ eko-nodejs（Playwright 运行时）+ eko-web（页面内运行时）；example/{extension,nodejs,web} |
| 演进 | 官方 News：2025-05 Eko 2.0（Online-Mind2web 31%→80%）→ 2025-09 3.0（依赖感知并行）→ 2025-11 4.0（chat 会话 + task_snapshot 恢复）；本仓库 4.1.3 |

## 3. 浏览器 agent：三个运行时同一基类

| 运行时 | 文件 | 截图 | 动作/脚本注入 | 导航/标签 |
|---|---|---|---|---|
| Chrome 扩展 | `packages/eko-extension/src/browser.ts`（239 行） | `chrome.tabs.captureVisibleTab(windowId,{format:"jpeg",quality:60})`（L10-26） | `chrome.scripting.executeScript({target:{tabId},func})`（L139-151） | `chrome.tabs.create/update/query`（L28-87） |
| Node.js | `packages/eko-nodejs/src/browser.ts`（491 行） | `page.screenshot({type:"jpeg",quality:60,animations:"disabled"})`（L48-59） | Playwright API + ElementHandle | Playwright `Browser`/`BrowserContext`，支持 `setCdpWsEndpoint`（附着已开浏览器）、`setCookies`、`initUserDataDir`、headless 开关（L13-45） |
| Web 页面内 | `packages/eko-web/src/browser.ts` | `html2canvas(document.documentElement)`（L1-24） | 页面内直接操作 DOM | `history.pushState` **仅限当前站点子页**，跨站抛错（L26-50） |

Node.js 运行时反检测：`import { chromium } from "playwright-extra"` + `StealthPlugin`（`puppeteer-extra-plugin-stealth`），L358 `chromium.use(StealthPlugin())`；L357 注释自述用 browserscan.net 验证指纹。

## 4. 观察机制：SoM 标注截图 + 元素索引（非纯 AX/DOM）

- 基类：`BaseBrowserLabelsAgent`（`packages/eko-core/src/agent/browser/browser-labels.ts`，1059 行），三运行时全部继承。
- 观察返回 = **标注截图 + 简化交互元素列表**，索引互相对应。系统提示原文要点（L22-45）：
  - "labeled bounding boxes corresponding to element indexes. Each bounding box and its label share the same color, with labels typically positioned in the top-right corner of the box."
  - 元素序列化格式 `[33]:<button>Submit</button>`；非交互元素 `[]:` 仅供上下文。
  - "Use the latest element index, do not rely on historical outdated element indexes"——**防索引漂移靠纪律，无运行时校验**（Codex 同派）。
- DOM 树构建：`build-dom-tree.ts`（789 行，页内函数 `run_build_dom_tree`），产出 `{element_str, client_rect, selector_map, area_map}`；高亮定位 `[eko-user-highlight-id="eko-highlight-${index}"]`（L52-54），`window.clickable_elements[highlightIndex]` 兜底。
- 标注绘制：`mark_screenshot_highlight_elements`（`utils.ts` L388+）用 OffscreenCanvas/createImageBitmap 把 area_map 框画上截图（`config.markImageMode:"draw"`）。
- 默认只看可视视口；`extract_page_content` 拿全文。

工具面（`browser-labels.ts` L296-640，**13 个内置工具，v4.1.3 实测**）：`navigate_to / current_page / go_back / input_text / click_element(index,num_clicks,button) / scroll_mouse_wheel / hover_to_element / extract_page_content / get_select_options / select_option / get_all_tabs / switch_tab / wait`。`scroll_to_element` 仅存为 protected 方法（L96）未暴露成工具；官方文档（旧版）口径 15 个——以源码 13 为准。

## 5. 动作机制：DOM 语义层，无 OS 原语

- 扩展运行时：`chrome.scripting.executeScript` 注入页内函数；点击/输入由页内脚本按索引取元素后派发 DOM 事件。
- Node 运行时：Playwright 语义动作。
- **无 OS 级输入**：全仓库 grep `AXUIElement|CGEvent|SendInput|xdotool` = 0 命中；`computer_use|ComputerAgent|desktop` = 0 命中（仅 README 对比表提及 "Browser-use" 一词）。
- 抽象边界：`BaseBrowserAgent`（browser-base.ts）只定义 screenshot/navigate_to/get_all_tabs/switch_tab/execute_script 五个抽象方法——**框架的能力上限就是浏览器**。

## 6. deepAction 与「Javis」：CU 归属云端的关键证据（本文最重要发现）

| 证据 | 位置 | 内容 |
|---|---|---|
| E1 | `packages/eko-core/src/prompt/chat.ts` L21-23 | 系统提示：`deep_action`: "This tool is used to execute tasks, **delegate to Javis AI assistant with full computer control**." |
| E2 | `packages/eko-core/src/chat/tools/deep-action.ts` L19-20 | 工具描述："Delegate tasks to a **Javis AI assistant**... has full control over both **networked computers**, browser agent, and multiple specialized agents ({agentNames})"，并列 deliverables（报告/表/图/音乐/视频/网站/deepSearch/程序）与操作型任务（批量关注等），"Supports parallel execution of multiple tasks." |
| E3 | 同文件 L127-145 | `config.workflowConfirm && callback` 时弹 `workflow_confirm` 回调（计划级确认门），用户 cancel 则不执行——对应官网"plan first, acts second / review, approve, edit before execution" |
| E4 | 同文件 L105-180 | OSS 实现里 deepAction = 本地 `new Eko(...)` 生成 XML workflow 并执行；`{agentNames}` 由宿主注册的 agents 注入——**开源框架本身不含"full computer control"的执行体，能力来自宿主部署注入的 agent 集** |
| E5 | 官方博客（Wayback 2026-05-08 捕获 fellou-v2-launch） | "By offering a diverse range of agents (such as Browser Agent, Coding Agent, File Agent, **Shell Agent, Computer-use Agent**, etc.)"——产品宣称的 agent 家族，其中 Computer-use Agent 等**不在开源仓库** |

**判读（CU 形态）**：产品级 Computer Use 由闭源侧「Javis 云端助手 + 宿主注入 agent」承担；开源客户端只有委派入口与工作流编排。与官网 2025-11 首页"Computer Use transforms Fellou into a true system-level agent. Grant this AI Browser permission to operate local apps and manage files"（用户授权面在本地）合并判读：**授权/编排在本地，执行体高度疑似云端（"networked computers"/Javis 命名），本机 AX/CGEvent 层无任何开源实证**。置信度：中（无二进制可验）。

## 7. 编排、人机协作与记忆（eko 源码）

| 机制 | 位置 | 事实 |
|---|---|---|
| Workflow DSL | `prompt/plan.ts` L11-80 | Planner（LLM）输出 XML：`<agent name id dependsOn>` 并行依赖图、`<node input=/output=>` 变量传递、`<forEach>`、`<watch event="dom" loop=>` 监听触发 |
| 主循环 | `agent/eko.ts` | `generate()`（计划）→ `execute()`（执行）分离；`modify()`/replan；AbortController 中止；`stopReason:"abort"` |
| 确认门 | `tools/human-interact.ts` L14-78 | `human_interact` 工具四型：`confirm`（危险操作 Yes/No）/ `input` / `select` / `request_help`（helpType=`request_login`/`request_assistance`，场景枚举原文："login required, CAPTCHA verification, SMS verification code, QR code scanning, payment operations"） |
| 监听触发 | `tools/watch-trigger.ts` L14-40 | `watch_trigger`：**VLM 判图**（两帧对比任务描述是否发生），阻塞监听直到变更/超时——产品"监听 Gmail/Slack/网页变化、无限步长"的实现 |
| 任务恢复 | `memory/snapshot.ts` | `task_snapshot` 工具：把完成节点 ID + 关键上下文存档，供暂停/恢复后续跑（2025-09 官方 News"pause, resume, and interrupt controls"） |
| 会话记忆 | `memory/memory.ts` + `config/index.ts` L21-28 | `EkoMemory`：默认 maxMessageNum 15 / maxInputTokens 64000 / 压缩开启（阈值 10 条、截断 6000 字符）；token 估算中文按 1 字 1 token |
| **Agentic Memory 钩子** | `chat/chat-agent.ts` L147 | `_memory = await global.chatService.memoryRecall(...)` 注入系统提示 `<retrieved_memories>{{memory}}</retrieved_memories>`（chat.ts L35-42）——跨会话记忆由宿主（闭源 app）提供 chatService 实现，**开源侧只有注入槽位** |
| MCP 通道 | `agent/browser/browser-base.ts` L111-163 | 工具可由远端 MCP server 执行：请求携带 `extInfo{environment:"browser", browser_url,...}`；若响应 `extInfo["javascript"]` 非空，则在页面内执行 `${script};execute(${params})`——**云端下发页面脚本**的回传执行协议 |
| A2A | `agent/a2a.ts`（8 行） | 仅 `listAgents(taskPrompt): Promise<Agent[]>` 接口 + TODO 注释——A2A 是占位，未实现 |
| 配置默认 | `config/index.ts` | `maxReactNum:500`、`workflowConfirm:false`（默认无确认门！）、`agentParallel:false`、`toolResultMultimodal:true` |

## 8. Wayback 产品声明（官方口径，带时间戳）

### 8.1 首页 2025-09-02（web.archive.org/web/20250902152844）

- "Virtual workspace for Agent: **Executing tasks in a shadow window**, without disrupting your workflow."
- 对比 Dia 栏目："Virtual workspace for Agent — **Shadow everything: Window, OS, Application**"；对手栏写 Dia "Simple workflow & disturb users"。
- "Act on private sites: Top security and stability with your own login, device, and no password leaks."
- "automates multi-step workflows across **50+ platforms**—no coding needed, just drag-and-drop logic."

### 8.2 首页 2025-11-03（web.archive.org/web/20251103113233）

- "Computer Use transforms Fellou into a true **system-level agent**. Grant this AI Browser permission to operate local apps and manage files."
- "Browser Use gives our Agentic AI Browser power to automate entire workflows."
- "Agentic Memory **securely learns from your browser history and notes**... instantly recall past information."
- "From Intent to Action Plan... You can review, approve and edit this plan before execution."（= E3 的 workflow_confirm）
- "@ Google Notion Reddit X + **shadow workspace** 💻 Deep Action"；"Running Tasks: Competitor pricing / Feature comparison / Market positioning / Report compilation"（并行任务墙）。
- FAQ："Deep action: Fellou independently plan and execute complex **web and desktop based tasks** across multiple apps"；"Dynamic Multitasking: Fellou runs multiple tasks simultaneously in its **back-end workspace**"；"**Agentic memory**: connecting browser history, chat history, contextual page data, and personal knowledge base"；登录/CAPTCHA："designed to handle logins, authentication, and even CAPTCHA challenges. Advanced AI can solve CAPTCHAs with high accuracy by **simulating human behavior**"；"Intervene at Any Step"（实时介入/暂停/修改）；定时任务（"+New Schedule"）。

### 8.3 官方博客

| 文 | 捕获 | 关键原文 |
|---|---|---|
| fellou-v2-launch（2025-06-03 发布） | 2026-05-08 | "The key to Fellou 2.0's success — **Eko 2.0, a crucial open-source Browser-use infrastructure**"；"Browser + Workflow + Agent architecture"；并行任务 Alpha；监控型任务"unlimited step length" |
| eko20-launch（2025-05-23） | 2026-03-08 | Online-Mind2web：总 80%（对手 56-61%）、Easy 95%、Hard 70%；多 agent 协作、DOM 实时监听、MCP、A2A"coming soon" |
| fellou-introduction（2025-04-10） | 2025-12-05 | 早期形态：tag-group 异步协作（agent 跑任务时用户切标签组继续干活）＝shadow space 前身；跨页操作（购物/日历/邮件/发帖） |

### 8.4 分发与身份侧字段

- `GET /api/download`（2026-10-08 实测）：mac_arm 2.5.18 enabled；windows 2.5.15 **disabled**——产品末期收缩。
- fellou.ai 前端登录/身份依赖 `https://fellou.us.authing.co`（Authing，身份云）——布局于 layout chunk，静态可见。
- 交付物域：`chat.fellou.ai/sites/...`（任务产物网站托管，v2 博客示例链接）。

## 9. 形态判定速查（供正文引用）

| 判据 | 事实 | 指向 |
|---|---|---|
| 浏览器内 agent | eko 全部执行原语止步 chrome.scripting/Playwright/DOM；无 OS 原语 | 浏览器内操作员（开源侧） |
| 跨桌面 agent | 产品宣称 Computer Use/shadow everything: Window, OS, Application；eko chat 层 deepAction="delegate to Javis (cloud) with full computer control" | 宣称跨桌面，开源实证为零，云端委派中置信 |
| Shadow Browser | 官网两代口径（shadow window → shadow workspace/back-end workspace；并行任务墙）；eko `agentParallel` + dependsOn 并行图；产品并行任务 Alpha（v2 博客自述） | 本地隔离窗口实现无二进制证据（低置信）；编排并行有源码实证 |
| 确认门 | workflowConfirm 计划级确认（默认关）+ human_interact 四型 + request_help 交还登录/CAPTCHA/支付 | 三层：计划级→动作级→求助移交 |

## 10. Logo

`site/assets/logos/fellou.png` ← GitHub Org FellouAI 头像 `https://avatars.githubusercontent.com/u/186783626?v=4`（image/png，59547 B），sips 缩放至 256×256（与站内其他 logo 规格一致，dia.png 同为 256×256 RGBA PNG）。

## 11. 快速复核入口

```bash
R=/Volumes/YANG/apps-re/fellou/eko
cd "$R" && git log -1 --format=%H                       # c3de315…
grep -n "Javis" packages/eko-core/src/prompt/chat.ts packages/eko-core/src/chat/tools/deep-action.ts
grep -rn "AXUIElement\|CGEvent\|SendInput\|xdotool" packages/*/src | wc -l   # 0
grep -c "chrome.scripting.executeScript" packages/eko-extension/src/browser.ts
curl -s https://fellou.ai/api/download | jq -r '.list[].resource[] | "\(.platform) \(.version) \(.url)"'
curl -s "http://web.archive.org/web/20251103113233/https://fellou.ai/" | grep -o "Computer Use transforms[^<]*"
```
