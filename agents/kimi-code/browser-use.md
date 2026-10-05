# Kimi Code Browser Use 完整逆向

> 对象：Moonshot AI Kimi Code 的浏览器控制能力。本机实测发现**三条并行链路**：webbridge（用户真实浏览器 + 扩展）、桌面内嵌浏览器（Kimi Code Desktop 自带 Browser MCP）、以及被废弃/独立的旧 WebBridge skill 形态。
> 证据编号 `(E#)` 对应 [evidence/inventory.md](evidence/inventory.md)。

## TL;DR

Kimi 的 browser use 不是 CDP-over-DevToolsPort，也不是内置 WebView 直接注入，而是**守护进程 + 浏览器扩展**的伴生架构：Go 守护进程 `kimi-webbridge`（v2.0.22，源码包 `dev.msh.team/harness/agent-extension`）监听 `127.0.0.1:10086`，扩展经 WebSocket `ws://127.0.0.1:10086/ws` 反连；agent 通过 HTTP `POST /command`（JSON envelope + 顶层 `session` 字段）下达 navigate/click/fill/snapshot 等 14+ 命令，扩展在页面里执行——观察走**无障碍树文本快照（`@e` refs）**，动作走**合成 DOM 事件（`el.click()`/input 事件）**，`cdp` 工具作为 `chrome.debugger` 直通逃生舱。最大卖点是**复用用户真实登录态**；最大约束是 `event.isTrusted` 严格站点失效。桌面端另有第二条链路：Kimi Code Desktop 内嵌浏览器以 per-session HTTP MCP 暴露单一 `run` 工具（协议 `kimi.browser/1.0.0`，43 个操作），带 agent 活动浮层、用户接管（takeover）与动作 receipts 审计。

## 1. 三条链路总览

| | 链路 A：webbridge（CLI 主用） | 链路 B：桌面内嵌浏览器 | 链路 C：旧独立 skill |
|---|---|---|---|
| 宿主浏览器 | 用户自己的 Chrome/Edge（真实 profile、登录态） | Kimi Code Desktop 的 Electron 内嵌浏览器 | 同 A |
| 观察者 | 浏览器扩展（MV3，Chrome/Edge 商店分发） | 主进程 `browser-*.ts`（30 个模块） | — |
| 传输 | HTTP `127.0.0.1:10086` + WS 扩展反连 | per-session HTTP MCP（随机端口 `/mcp`，头 `X-Kimi-Session-Id`） | — |
| 观察机制 | AX 树文本快照 + `@e` refs；`read_page` 支持 iframe | TOON 文本/元素快照 + 视觉截图（snapshotId 锚定） | — |
| 动作机制 | 合成 DOM 事件；`cdp` = chrome.debugger 直通 | 元素语义操作 + 视觉坐标操作（世界 1001 注入脚本） | — |
| 工具面 | 14+ 命令（SKILL.md 工具表） | 单一 `run` 工具 × 43 操作 | — |
| 版本（本机） | daemon v2.0.22 / 插件 1.11.3 | app 1.0.4 | 已迁移备份 |

## 2. 链路 A：webbridge 完整解剖

### 2.1 组件与数据流

```
kimi CLI ──(skill: kimi-webbridge，curl 调 HTTP)──► kimi-webbridge daemon (Go, 127.0.0.1:10086)
   │ POST /command {"action","args","session"}          │ WebSocket ws://…:10086/ws
   │ ◄── {"ok":true,"data":…} / {"ok":false,"error":{code,message}}
   ▼                                                ▼
                                        Kimi Browser Extension（用户 Chrome/Edge）
                                             │ chrome.debugger / chrome.scripting / content scripts
                                             ▼
                                        页面（用户真实登录态）
```

- 守护进程：`~/.kimi-webbridge/bin/kimi-webbridge`（Go + cobra；build path `dev.msh.team/harness/agent-extension/internal/…`，模块含 `daemon/{server,session,allowlist,hygiene,save_pdf,screenshot,sidepanel_control,skill_status,trajectory}` 与 `skillpaths`）(E8)。
- 日志实录：`[agent-extension-daemon] listening on 127.0.0.1:10086` → `[ws] extension connected` → `[ws] hello from extension v2.0.22 (daemon v2.0.22)` (E8)。
- 文件布局（operations.md, E8.1）：`bin/`、`config.json {"addr":"127.0.0.1:<port>"}`（可选）、`daemon.pid`/`daemon.addr`、`logs/daemon.log(.prev)`。
- CLI 子命令：`start`（幂等，可 `--addr`）/ `status`（读 /status）/ `logs` / `stop` / `restart` / `upgrade [version]`（对齐已连扩展版本） / `install-skill`（装进检测到的 agent runtime：Claude Code / Codex / Kimi CLI / OpenClaw / Hermes）/ `uninstall`。

### 2.2 命令协议

统一信封：成功 `{"ok":true,"data":…}`，失败 `{"ok":false,"error":{"code","message"}}`；每个请求带顶层 `session`（一个任务=一个会话=一个 Chrome tab group，`group_title` 为人类可读组名）。

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"navigate","args":{"url":"https://www.kimi.com","newTab":true,"group_title":"调研"},"session":"k26-research"}'
```

### 2.3 工具面（SKILL.md 工具表全量, E8.1）

| 工具 | 参数 | 返回/语义 |
|---|---|---|
| `navigate` | `url`, `newTab`, `group_title` | `{success,url,tabId}`；首次调用开 tab |
| `find_tab` | `url`, `active` | 复选本会话开的 tab；`active:true` **借用用户正看的 tab**（`borrowed:true`，原位操作不并入组）；按 host 匹配（kimi.com 匹配 www.kimi.com，忽略 path） |
| `snapshot` | — | `{url,title,tree}`，**无障碍树文本 + `@e` refs**——读页面/定位元素的首选 |
| `click` | `selector`（@e 或 CSS） | 合成 `el.click()` → `{success,tag,text}` |
| `fill` | `selector`,`value` | input/textarea **和 contenteditable 富文本**（ProseMirror/TipTap/Lexical/Slate/Quill），返回 `mode:"value"\|"contenteditable"`；clear-and-insert 语义 |
| `evaluate` | `code` | 页面 JS realm 求值（`{type,value}`；跨调用共享 realm，建议 IIFE；禁止 `JSON.stringify(…,null,2)` 防截断） |
| `cdp` | `method`,`params` | **raw chrome.debugger 直通**；`Target.activateTarget` 被拒；`Page.bringToFront` 受"focus emulation"规则限制（见 §2.6） |
| `screenshot` | `format(png\|jpeg)`,`quality`,`selector?`,`path?` | **写盘返回 `{path,sizeBytes,…}`，不回 base64**；支持元素级截图 |
| `network` | `cmd:start\|stop\|list\|detail`, `filter`, `requestId` | 每 tab 抓包；`detail` 给 requestHeaders/requestBody/响应 `body`（stop 后释放 body → `bodyError`） |
| `upload` | `selector`,`files[]` | 文件上传 |
| `save_as_pdf` | `paper_format`(letter/a4/legal/a3/tabloid),`landscape`,`scale[0.1,2]`,`print_background`,`path?` | Page.printToPDF；解码后 >100MB 拒绝 |
| `list_tabs` / `close_tab` / `close_session` | — | 会话内 tab 清单 / 关当前 / 关整组（仅用户要求时） |
| `read_page` / `wait` | `{"frame":"#f1"}` / `{"frame":"any"}` | iframe 读取（snapshot 树列出 `frames:[{frame:"#f1",url,size…}]` 后按句柄读）；wait 等大预览帧可读。**仅 SKILL 正文提及、不在工具表**——比表新的扩展行为（推断：v2.0.x 后期加入） |

### 2.4 观察机制

- `snapshot` 返回"interactive elements with `@e` refs based on semantic role/name"，即从 DOM 提炼的**语义角色树**（a11y 语义 + 可交互判别），refs 比 CSS 选择器抗 class hash 变化。实现层未在本机获得扩展源码（商店分发），按 daemon strings 中 `Sec-Fetch-Site`/`SnapshotPayload` 等与 SKILL 描述判断为扩展内序列化（推断）。
- iframe 是一等限制：所有单 tab 工具只见 top document；`snapshot` 附 `frames` 列表缓解只读场景；**对 frame 内元素执行动作不支持**。
- 截图返回文件路径而非 base64（"the model can't read raw image bytes"——由 agent 用文件读取工具打开）。

### 2.5 动作机制

- click/fill = **合成事件**（`isTrusted=false`）；严格校验站点（部分银行、captcha）忽略之 → SKILL 明文让 agent 告知用户手改。
- 受信输入逃生舱：`cdp` 先 `Emulation.setFocusEmulationEnabled {enabled:true}` 让后台 tab 收真输入，结束后关闭；仍不行才 `Page.bringToFront`（且有"不会把 Chrome 从用户当前 app 前抢过来"的限定语义）。`Target.activateTarget` 直接拒绝。
- 上传走 `chrome.debugger` DOM.setFileInputFiles 类机制（`upload` 工具；推断）。

### 2.6 会话/安全模型

- **tab group = 任务容器**：session 名把任务开的 tab 收进一个组，用户可视化"agent 正在做什么"；关闭永远用户发起。
- 借用治理：`find_tab active:true` 只借不抢（`borrowed:true`，不进组）；默认永不触及用户其他 tab/窗口。
- 端口治理：绑非回环有明文警告 "any client on the network can drive your browser"（E8）；Origin 校验；换端口需用户在扩展设置里改一次 `ws://127.0.0.1:<port>/ws`（扩展记住）。
- 版本对齐：daemon/扩展/skill 三方版本互检（/status 的 `version_mismatch`/`skill_mismatch`/`update_available` 各带确切修复命令）；二进制升级强制 sha256 manifest（"refusing to install unverified content"）。
- 隐私自述（插件 longDescription）：**"Everything runs locally; login state and page content never leave the device"**——页面内容只在本地 daemon/模型上下文间流转。
- 运维边界（SKILL 明文）：agent 只可自行 `start`（幂等）；`stop/restart/upgrade/uninstall` 永远转告用户。
- 守护进程含 DataRangers 遥测（gator.volces.com，事件 webbridge_daemon_start/alive；E8）——与"内容不出设备"自述并存的匿名遥测。

### 2.7 配套 skill 生态

`install-skill` 把 kimi-webbridge skill 装进五个 agent runtime；tarball 还带 `references/cli-creator/*`（site-exploration/login-handling/go-layout/companion-skill-template）——官方方法论：把"对某网站的一次性操作"沉淀为可复用 CLI 工具 + 伴生 skill（E8）。

## 3. 链路 B：Kimi Code Desktop 内嵌浏览器

### 3.1 暴露方式

- 桌面主进程启动日志：`[kimi-desktop] Browser MCP listening on http://127.0.0.1:53291/mcp`（端口随机，E9）。
- `registerDesktopBrowserMcp`：每个会话创建时注入 ephemeral MCP `desktop_browser`（`deferred:true`，请求头 `X-Kimi-Session-Id`）——只有会话存在期间可见 (E9)。
- 工具面是**单一 `run` 工具**：`protocol="kimi.browser/1.0.0"` + `operation` 选择器，schema 把 43 个操作的参数合并扁平化，字段 description 自动生成"哪些操作必填/可选/互斥"（browser-tool-schema.ts 的 merge/flatten/describeUsage, E9）。

### 3.2 操作清单（43 个, E9）

```
browser.get_history / get_downloads / get_device_profiles / get_state / activate_panel
browser.create_tab / release_tab / activate_tab / switch_tab / close_tab
tab.set_device_mode / get_state / navigate / search / go_back / go_forward
tab.reload / stop_loading / wait_for_load
page.wait_for / page.text.snapshot / page.visual.snapshot / page.elements.snapshot
page.visual.crop / click / click_if_interactive / hover / scroll / drag / type_text / press_key
page.element.click / hover / fill / type_text / press_key / select_option / set_checked / scroll_into_view
```

### 3.3 观察机制（双模快照）

- **文本模**：`page.text.snapshot` —— 渲染 DOM 文本，TOON 格式分块（默认 maxChars 12000，2048–24000；scope=viewport/document/element 子树；cursor 续读；"Text block IDs cannot be used as element refs"）。
- **元素模**：`page.elements.snapshot` —— TOON 行式（limit=100、maxChars=8000，role/text 过滤，scanTruncated 提示），产出元素 ref 供 `page.element.*`。
- **视觉模**：`page.visual.snapshot` —— 截图 + `snapshotId`；`page.visual.crop` 从原图切区域（缓存 60s，`SNAPSHOT_EXPIRED` 要求重拍）；坐标 = 返回图像素，映射回 CSS viewport（滚动/缩放后仍可复用）。
- `page.wait_for`：element/text/url 三种条件 + `stableForMs`；超时带 `lastObserved` 证据。

### 3.4 动作机制与执行边界

- 元素操作前须元素 ref 连接有效；视觉坐标操作绑定各自 snapshotId 的 tab。
- 注入脚本走**隔离世界**：`AUTOMATION_WORLD_ID=1001`（automation）、`BROWSER_ANNOTATION_WORLD=1002`（标注拾取）——与页面 JS 隔离 (E9)。
- 点击候选有 evidence 分级：`native|role|handler|pointer|none`（ClickCandidate, E9）——即判断"这玩意为什么可点"。
- 本地文件页拒绝自动化：`BROWSER_LOCAL_FILE_REFUSAL`（"ask the user to describe what they see instead"）。

### 3.5 人机共驾：控制面、浮层、接管、收据

这是链路 B 区别于一切同类的设计重心（`browser-control.ts`/`browser-overlay-preload.cjs`, E9）：

- **surface 状态机**：`{browserId,revision,labels:{running,elapsed,takeover,takeoverHint,pointer,typing,key,scrolling,activityTarget,activities:{reading,inspecting,capturing,clicking,hovering,typing,pressing,selecting,checking,scrolling,dragging,navigating,waiting}},colorScheme,reducedMotion,corners,insets}` —— agent 的每类活动实时渲染给用户。
- **指针/键入可视化**：pointer 事件 `move|down|up|type|key|scroll|reset|blocked`（overlay 内合成光标动画，非系统光标）。
- **用户接管（takeover）**：用户可随时接管；`kimi:browser-control-takeover` IPC + 工具描述 "On BROWSER_USER_TAKEOVER, stop browser calls for this turn; control becomes available in a new user turn"；控制权在回合结束自动过期（"Control expires at the end of the turn"）。
- **控制/可见分离**：`activeTabId`（agent 控制目标）≠ `visibleTabId`（用户在看的面板页）；后台操作可持续，用户看别的 tab 不受影响；工具描述要求"用户要求看的页面才 switch_tab 展示"。
- **receipts 审计**：`browser-receipts.ts` 把 agent 动作截图（≤720px、JPEG q72、归一化 point/box 标记）按会话存 `userData/browser-receipts/<sessionId>/`，保留 30 天、每日清理；IPC 提供 read/copy/delete —— 完整的"agent 干了什么"证据链 (E9)。
- IPC 全家 84 个 `kimi:browser-*` 通道：权限请求（camera/mic 等站点权限走桌面审批）、下载、历史、设备模式、focus emulation、annotation 采集（含用户右键目标追踪 `contextmenu` + isTrusted 过滤）等 (E9)。

## 4. 三链路取舍与谱系

- **为什么不用一个机制？** webbridge 复用真实登录态（能力上限高、可带 cookie 生态），内嵌浏览器换取可控的观察/坐标/接管/审计（一致性高），二者覆盖不同风险偏好；旧独立 skill（`~/.kimi-code/skills/kimi-webbridge`、`~/.agents/skills/kimi-webbridge`）已被迁移备份进插件化形态（E7 迁移逻辑）。
- **与 ZCode 对照**：ZCode 内置 browser-use 走 IAB/CDP 单链路；Kimi 是 daemon+扩展与桌面内嵌双轨。共同点：都把"写盘路径 + 文件读取"作为截图回传模型的方式。
- **与 Codex 对照**：Codex 本机留有 `chrome-native-hosts-v2.json`（native messaging 方向）；Kimi webbridge 用 WS 反连扩展，`cdp` 工具直通 chrome.debugger 与 Codex 的扩展调试同源（Chrome 官方 API），但传输与会话治理完全不同。
- **与 Claude Code 对照**：Claude Code 官方无浏览器控制（社区 MCP）；Kimi 以官方插件 + 官方 skill 形态内建，且 skill 文档（中英双语、含 Windows 特殊性、shell 引号陷阱）工程化程度高。

## 5. 置信度与待复核

- 高置信：daemon/skill/插件 manifest/桌面 bundle 均为明文证据；协议样例可直接复现（本机 daemon 未运行时未做在线验证，但离线证据链完整）。
- 中置信（推断）：扩展内部实现细节（商店闭源）；`read_page`/`wait` 的版本边界；webbridge `/prompt`、`/trajectory`、`/internal/sidepanel-control` 等 HTTP 端点细节（strings 证实存在、语义部分推断）。
- 未在本机发现：webbridge 的 allowlist 细则（allowlist.go 存在但规则未提取）；桌面内嵌浏览器与 kimi-cu（CU）的联动；移动端/远程形态。
