# PROVENANCE —— vendor/ 搬运来源与合规声明

## 1. 上游标识

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/browser-use/browser-use |
| 修订 | commit `c75e8476e26d18b7617643bc2ae082fae8eae431`（2026-10-07 09:39 UTC-7，shallow clone HEAD） |
| 版本 | 0.13.11（`pyproject.toml` version 字段） |
| 上游许可证 | **MIT**（Copyright (c) 2024 Gregor Zunic，全文逐字节见本目录 [`LICENSE-mit.txt`](LICENSE-mit.txt)） |
| 搬运方式 | `cp` 原样拷贝，零修改；保留上游包目录结构（`browser_use/...`），仅一处文件平铺（`agent/message_manager/service.py` → `agent/message_manager_service.py`，避免建空 `__init__.py` 目录） |
| 完整性 | 逐文件 SHA-256 见 §3；复验命令 `git clone --depth 1 https://github.com/browser-use/browser-use && shasum -a 256 <file>` |

## 2. 文件清单（21 个文件，约 2.6 万行）

| 本仓库路径 | 上游路径（相对仓库根） | 行数 | 入选理由（对应分册机制） |
|---|---|---|---|
| `LICENSE-mit.txt` | `LICENSE` | 21 | MIT 全文，再分发保留 |
| `browser_use/agent/service.py` | 同名 | 4163 | **Agent 主循环**：step() 四阶段、multi_act 页面变更守卫、rerun/judge/planning |
| `browser_use/agent/views.py` | 同名 | 997 | `AgentOutput`/`AgentBrain`/`ActionResult` 输出 schema 与结构化输出 |
| `browser_use/agent/prompts.py` | 同名 | 600 | 系统提示装载与 flash/no_thinking 变体选择 |
| `browser_use/agent/system_prompts/system_prompt.md` | 同名 | 270 | 给 LLM 的完整系统提示（`[index]<tag>` DOM 格式权威定义） |
| `browser_use/agent/message_manager_service.py` | `agent/message_manager/service.py` | 600 | 消息管理：`<secret>` 占位符注入、截图 include 策略、压缩 |
| `browser_use/dom/service.py` | 同名 | 1245 | **DOM 树构建**：DOMSnapshot+DOM+AX 三源合并、iframe 递归 |
| `browser_use/dom/views.py` | 同名 | 1047 | `EnhancedDOMTreeNode`/`SerializedDOMState` 数据模型与 `llm_representation` |
| `browser_use/dom/serializer/serializer.py` | 同名 | 1406 | **DOMTreeSerializer**：交互判定、selector_index 分配、文本树输出 |
| `browser_use/dom/serializer/clickable_elements.py` | 同名 | 246 | `ClickableElementDetector` 交互元素判定规则 |
| `browser_use/tools/service.py` | 同名 | 2327 | **Tools（Controller）**：24 个运行时动作（26 处注册，click/done 各两变体） |
| `browser_use/tools/views.py` | 同名 | 205 | 每个动作的 Pydantic 参数模型（schema 权威来源） |
| `browser_use/tools/registry/service.py` | 同名 | 613 | Registry 注册/执行 + `<secret>占位符</secret>` 运行时替换 |
| `browser_use/browser/session.py` | 同名 | 4155 | **BrowserSession**：事件分发、selector_map 缓存、状态摘要 |
| `browser_use/browser/profile.py` | 同名 | 1300 | BrowserProfile：`allowed_domains`/`prohibited_domains`/`block_ip_addresses` |
| `browser_use/browser/watchdogs/dom_watchdog.py` | 同名 | 877 | DOM/截图并行构建、浏览器侧高亮 |
| `browser_use/browser/watchdogs/local_browser_watchdog.py` | 同名 | 535 | Chrome 子进程启动（`--remote-debugging-port`，非 Playwright 托管） |
| `browser_use/browser/watchdogs/screenshot_watchdog.py` | 同名 | 88 | `Page.captureScreenshot`，截图前移除高亮 |
| `browser_use/browser/watchdogs/security_watchdog.py` | 同名 | 296 | 导航域白名单/黑名单强制执行（含重定向回 `about:blank`） |
| `browser_use/browser/watchdogs/downloads_watchdog.py` | 同名 | 1503 | `Browser.setDownloadBehavior` + 下载进度跟踪 |
| `browser_use/browser/watchdogs/default_action_watchdog.py` | 同名 | 1900+ | **动作执行层**：遮挡检查、`Input.dispatchMouseEvent/KeyEvent`、JS 兜底 |

**未搬运**（超出机制演示需要）：`llm/`（16 个模型商适配器）、`mcp/`（browser-use 自身 MCP server）、`beta/`、`cloud/`、`sandbox/`、`telemetry/`、`cli.py`、tests/examples。需要时回上游 commit 自取。

## 3. 完整性校验（SHA-256，2026-10-08 对 upstream commit `c75e8476` 核对一致）

| 文件 | SHA-256 |
|---|---|
| `LICENSE-mit.txt` | `135c57671b0ee957669b05a0ca00cc06f645496d351e2e732832c6e276da9a5e` |
| `browser_use/agent/service.py` | `10f7c14458ed7089c49f34a06ad7b3ce12212a589d9d000c5cf4d9cc7ddd8479` |
| `browser_use/agent/views.py` | `f08c9e96df9e346ba87c0cd3ceb79a7d3a6c1f7764083a367ca8e10bb65c43ce` |
| `browser_use/agent/prompts.py` | `ea7958d556babb3805efb2fb9baa8b7be65153be946be43870a892c7cd187b28` |
| `browser_use/agent/system_prompts/system_prompt.md` | `680a833b3ebbcf47ffc6c5a0de7133587948114ace94c5236fa79e0425518bcd` |
| `browser_use/agent/message_manager_service.py` | `b9a9ccc6e0c039f18d18ca20477022aa450286576c9c57adbc7ddebf1aa08a56` |
| `browser_use/dom/service.py` | `43f8e087754ea9a67da21d9576c3485cab53e9f9cf41ebb45d2f03d0107889c3` |
| `browser_use/dom/views.py` | `01866ed2d9aa77ee6a8be5f9c707dbe403c4802acaf9680975766dd93d7a48b5` |
| `browser_use/dom/serializer/serializer.py` | `6d523ff457d1f0c99152eeb5cc86a96d6ed6a59bf2636aceae871549afdce91f` |
| `browser_use/dom/serializer/clickable_elements.py` | `6ca88febd5662db8bbada787316c8767e636af769d5ff9bb59783d3e3647eeea` |
| `browser_use/tools/service.py` | `25746ddfe719c0a800b2b4fcc399aea4fc8be20c48b04ab4118841fd5419eb73` |
| `browser_use/tools/views.py` | `7dcdadaf8641e21fb4eaa937e9800468b9bdcb99acad95c8008690786c874231` |
| `browser_use/tools/registry/service.py` | `3517c114d622a415c9da48ede49b5b625c97a1169161478541c68a05b8ae495e` |
| `browser_use/browser/session.py` | `797866229df7757c821c44da118b04ec0a78c2c3eb8e10c22eff9c44598dc8d5` |
| `browser_use/browser/profile.py` | `5b42a8285bab5116c08ec61cad643ed71b546cc9c82cfd77a7d7929330b40a47` |
| `browser_use/browser/watchdogs/dom_watchdog.py` | `5cafe302c3c148964a745e70230eb0ed14ff109890f1f57994658d25f14a3448` |
| `browser_use/browser/watchdogs/local_browser_watchdog.py` | `378d53c997b5faf1c35c3654d54ee006243624b3c8cd6fb6c24f1c3f672e6a88` |
| `browser_use/browser/watchdogs/screenshot_watchdog.py` | `ec98ee1e13e93e6989a6923e342a6e060e20c389ecbc0fba69d79662a2aa7ce5` |
| `browser_use/browser/watchdogs/security_watchdog.py` | `7d4aba8c663602f2fa506befe7a7b63a8074452e83c6706929b531953665f6ac` |
| `browser_use/browser/watchdogs/downloads_watchdog.py` | `a27d9d5ef87d0d2c459cc26e7b6a77b3b6520b24758b4b1fe582920529ff4a07` |
| `browser_use/browser/watchdogs/default_action_watchdog.py` | `0f679e4de08dd45c8bba824666a1d87569855b00a45f5db3c9c8f61e1957aebc` |

## 4. 为什么可以 vendor

- 上游整仓 **MIT**：允许任意使用、复制、修改、再分发，唯一条件是保留版权与许可声明（本目录随附 LICENSE 全文即满足）。
- 本目录对上游文件零修改、只读研究用途搬运，未构建、未再分发衍生品。
- 上游无独立 NOTICE 文件，无逐文件版权头；归属由本文件 + `LICENSE-mit.txt` 承担。

## 5. 关联

- 行为分析与证据映射：[`../../agents/browser-use/evidence/inventory.md`](../../../agents/browser-use/evidence/inventory.md)
- 工具面规范化 JSON：[`../schemas/tools.json`](../schemas/tools.json)
- cleanroom 参考实现（非本目录代码的转写）：[`../reference/`](../reference/)
