# Kimi Code：Browser Use —— daemon+扩展复用真实登录态，内嵌浏览器可控可审计

> 基线：本机 2026-10-06（daemon v2.0.22 / 桌面 1.0.4）。证据编号 (E#) 对应 [evidence/inventory.md](evidence/inventory.md)。
> 全名单：[source/kimi-code/schemas/webbridge-commands.json](../../source/kimi-code/schemas/webbridge-commands.json)、[desktop-browser-operations.json](../../source/kimi-code/schemas/desktop-browser-operations.json)。

## 速览

**不是 CDP-over-DevToolsPort，也不是内置 WebView 直接注入，而是"守护进程 + 浏览器扩展"伴生架构；桌面端另有第二条内嵌浏览器链路。**

| | 链路 A：webbridge（CLI 主用） | 链路 B：桌面内嵌浏览器 |
|---|---|---|
| 宿主浏览器 | 用户自己的 Chrome/Edge（真实 profile、登录态） | Kimi Code Desktop 的 Electron 内嵌浏览器 |
| 传输 | HTTP `127.0.0.1:10086` + WS 扩展反连 | per-session HTTP MCP（随机端口 `/mcp`，头 `X-Kimi-Session-Id`） |
| 观察 | AX 语义树快照 + `@e` refs；iframe 只读 | TOON 文本/元素/视觉三模快照 |
| 动作 | 合成 DOM 事件（isTrusted=false）；`cdp` 逃生舱 | 元素语义 + 视觉坐标（隔离世界 1001） |
| 工具面 | 14+ 命令 | 单一 `run` 工具 × 43 操作 |
| 杀手锏 | 复用真实登录态 | 活动浮层 + 用户接管 + 30 天 receipts 审计 |

链路 C：旧独立 skill（`~/.kimi-code/skills/kimi-webbridge` 等）已被迁移备份进插件化形态。

## 链路 A：webbridge

```
kimi CLI（skill：curl 调 HTTP）── POST /command {action, args, session} ── daemon（Go，10086）
   ◄── {"ok":true,"data":…} / {"ok":false,"error":{code,message}}          │ WS ws://…:10086/ws
                                                              MV3 扩展 ── chrome.debugger/scripting ── 页面（真实登录态）
```

session = 一个任务 = 一个 Chrome tab group（`group_title` 为人类可读组名）；daemon 子命令 start（幂等）/status/logs/stop/restart/upgrade/install-skill/uninstall。

### 命令面（14+，SKILL.md 工具表）

| 命令 | 要点 |
|---|---|
| `navigate` | url/newTab/group_title；首次调用开 tab |
| `find_tab` | 按 host 匹配本会话 tab；`active:true` **借用用户正看的 tab**（`borrowed:true`，不进组） |
| `snapshot` | AX 树文本 + `@e` refs——读页面/定位元素的首选 |
| `click` / `fill` | 合成 `el.click()`；fill 双模式（value/contenteditable：ProseMirror/TipTap/Lexical/Slate/Quill），clear-and-insert |
| `evaluate` | 页面 realm 求值，跨调用共享；禁 `JSON.stringify(…,null,2)` 防截断 |
| `cdp` | **chrome.debugger 直通逃生舱**；`Target.activateTarget` 被拒；`Page.bringToFront` 受 focus-emulation 规则限制 |
| `screenshot` | 写盘返回 `{path,sizeBytes}`，不回 base64；支持元素级 |
| `network` | 每 tab 抓包 start/stop/list/detail（含响应体，stop 后释放 → `bodyError`） |
| `upload` / `save_as_pdf` | 文件上传；PDF 解码后 >100MB 拒绝 |
| `list_tabs` / `close_tab` / `close_session` | 会话 tab 清单 / 关当前 / 关整组（仅用户要求时） |
| `read_page` / `wait` | iframe 句柄读取（仅 SKILL 正文提及、不在工具表——推断 v2.0.x 后期加入） |

- 严格校验站点（部分银行/captcha）忽略合成事件 → SKILL 明文让 agent 请用户手改；受信输入逃生舱：`cdp` 先 `Emulation.setFocusEmulationEnabled` 让后台 tab 收真输入，仍不行才 `bringToFront`。
- iframe 是一等限制：单 tab 工具只见 top document；`snapshot` 附 frames 列表缓解只读，**对 frame 内元素执行动作不支持**。

### 会话与安全

- tab group = 任务容器（用户可视化 agent 在做什么）；借用只借不抢；关闭永远用户发起。
- 端口治理：绑非回环有明文警告 "any client on the network can drive your browser"；Origin 校验；daemon/扩展/skill 三方版本互检（mismatch 各带修复命令）；二进制升级强制 sha256。
- 隐私自述 "Everything runs locally; login state and page content never leave the device"；并存 DataRangers 匿名遥测（gator.volces.com）。
- 运维边界：agent 只可自行 `start`（幂等）；stop/restart/upgrade/uninstall 永远转告用户。

## 链路 B：桌面内嵌浏览器（run × 43 操作）

**单一 `run` 工具，protocol `kimi.browser/1.0.0`，per-session ephemeral MCP 注入（deferred，请求头 `X-Kimi-Session-Id`，会话存在期间才可见）。43 操作按域归组（原文枚举 39 个，全量见 schemas/desktop-browser-operations.json）：**

| 域 | 操作 |
|---|---|
| browser.*（5） | get_history / get_downloads / get_device_profiles / get_state / activate_panel |
| tab 管理（5） | create_tab / release_tab / activate_tab / switch_tab / close_tab |
| tab.*（9） | set_device_mode / get_state / navigate / search / go_back / go_forward / reload / stop_loading / wait_for_load |
| page 快照（5） | wait_for / text.snapshot / visual.snapshot / elements.snapshot / visual.crop |
| page.visual 动作（7） | click / click_if_interactive / hover / scroll / drag / type_text / press_key |
| page.element.*（8） | click / hover / fill / type_text / press_key / select_option / set_checked / scroll_into_view |

- 快照三模：文本（TOON 分块，默认 12000 字符，cursor 续读）、元素（TOON 行式，limit 100，产元素 ref）、视觉（截图 + snapshotId，crop 缓存 60s，过期 `SNAPSHOT_EXPIRED` 强制重拍）；`wait_for` 超时带 lastObserved 证据。
- 注入走隔离世界：AUTOMATION_WORLD_ID=1001（自动化）、BROWSER_ANNOTATION_WORLD=1002（标注拾取）；点击候选带 evidence 分级 native|role|handler|pointer|none（判断"为什么可点"）；本地文件页拒绝自动化（`BROWSER_LOCAL_FILE_REFUSAL`）。
- 人机共驾：控制权回合结束自动过期；`BROWSER_USER_TAKEOVER` 即停（本轮不再调浏览器，新用户回合归还）；`activeTabId`（agent 控制目标）≠ `visibleTabId`（用户在看的页），后台操作不扰人；agent 每类活动（reading/clicking/typing…14 类）经浮层实时渲染。
- receipts 审计：动作截图 ≤720px / JPEG q72 / 归一化 point·box 标记，按会话存 `userData/browser-receipts/`，保留 30 天每日清理；共 84 个 `kimi:browser-*` IPC 通道（站点权限走桌面审批、focus emulation、下载、设备模式等）。

## 取舍与谱系

- 双轨理由：webbridge 换真实登录态复用（能力上限高），内嵌浏览器换可控观察/坐标/接管/审计（一致性强）。
- ZCode：IAB/CDP 单链路；两者都以"写盘路径 + 文件读取"回传截图。Codex：native messaging 痕迹；Kimi 用 WS 反连扩展 + `cdp` 直通（同为 Chrome 官方 API 系），传输与会话治理完全不同。Claude Code：官方无浏览器控制（社区 MCP）；Kimi 以官方插件 + skill 内建，工程化程度高（中英双语、Windows 特殊性、shell 引号陷阱）。

## 置信度

高：daemon/skill/插件 manifest/桌面 bundle 均明文证据，协议样例可复现。中（推断）：扩展内部实现（商店闭源）、`read_page`/`wait` 版本边界、`/prompt`、`/trajectory` 等端点语义。未在本机发现：allowlist 细则、桌面浏览器与 CU 的联动、移动端/远程形态。
