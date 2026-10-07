# Cursor Browser Use（浏览器控制）· 内嵌浏览器 + ref 句柄

> 分析对象：Cursor 3.22.12（macOS arm64，VSCode 1.128.0 fork）。证据见 [evidence/inventory.md](evidence/inventory.md)；推断处明确标注。

> 一句话结论：**不是外接 Playwright：主进程宿主内嵌 Electron 浏览器标签，扩展注入 JS 生成「a11y 快照 YAML + data-cursor-ref 句柄」，动作按 ref 定位后合成 DOM 事件——CDP Input 被主进程硬禁，原始 CDP 只是白名单逃生舱。**

| 项 | 值 |
|---|---|
| 载体 | 内置扩展 `cursor-browser-automation` v1.0.0 + 主进程 browserViewMainService |
| provider id | `cursor-ide-browser`（15 注册 + browser_lock = 16 工具） |
| 观察 | 注入 JS 遍历 composed DOM（含开放 shadow root）→ YAML 快照 + `data-cursor-ref="eN"` + diff |
| 动作 | 按 ref 重定位 + element 描述防漂移校验 → 合成 Pointer/Mouse/Keyboard/DragEvent |
| CDP | browser_cdp 逃生舱；Input/Browser/Storage/SystemInfo/Target/Tethering 域 + cookie/导航方法硬拒 |
| 模型侧 | 服务端专用模型 "sand-cua"；浏览器代理默认 subagent 形态（browser_subagent on） |
| 本机可用 | ✅ `~/.cursor/browser-logs/` 有真实使用痕迹（2026-08/09） |

## 架构一图

```
模型（服务端 "sand-cua"；agent.v1 protobuf over api2/api5）
 ▼ MCP tools/call
渲染进程 workbench：composer/agent 运行时（browser_subagent 默认 on）
  cursor-browser-automation 扩展：工具 schema + 系统提示词 + 页面注入脚本
  + browserSnapshotWatchdogService（快照保活 15s/3s/5min）
 │ IPC "browserViewService" ｜ executeCommand("cursor.browserView.*")
 ▼
主进程 main.js：browserViewMainService（Electron webview/WebContentsView）
  标签管理（可见 + headless）· webRequest 网络追踪 · console 捕获 · 证书/外跳确认
  sendCDPCommand → debugger.attach("1.3") + 拒绝列表
 ▼ Chromium
目标网页（合成 DOM 事件；isTrusted=false）
```

另有第二 provider `cursor-browser-extension`（与 cursor-ide-browser 并列注册；推断用于把用户本机 Chrome 以扩展形态接入，本机未验证）。

> 各工具完整 parameters JSON 见 `source/cursor/schemas/browser-tools.json`（含 ref 机制与合成事件细节）。

## 工具面：16 个 browser_*

| 工具 | 类别 | 语义 |
|---|---|---|
| `browser_navigate` | 导航 | 默认复用现有标签；position 仅用户明确要求展示时设置（后台自动化省略以免抢焦点）；导航前强制 origin allowlist |
| `browser_tabs` | 导航 | list/new/close/select；headless 标签由 newHeadlessTab 支撑 |
| `browser_lock` | 导航 | 锁/解锁浏览器防用户并发；**用户始终可点 "Take Control" 夺回**；必须先 navigate 后 lock、结束 unlock |
| `browser_snapshot` | 观察 | **页面结构唯一事实来源**：a11y 快照 YAML（interactive/maxDepth/compact/selector/includeDiff） |
| `browser_take_screenshot` | 观察 | 视觉验证；提示词明确「不能基于截图定位动作，动作一律用 snapshot 的 ref」 |
| `browser_highlight` / `browser_get_bounding_box` | 观察 | 页内高亮 / 元素包围盒（坐标诊断） |
| `browser_click` | 交互 | 按 ref 点击 + element 描述防错位校验 + offset/doubleClick/modifiers/holdDurationMs；「Use this instead of CDP Input.*」 |
| `browser_mouse_click_xy` | 交互 | 视口坐标兜底（"Prefer browser_click with refs"） |
| `browser_type` / `browser_fill` / `browser_select_option` | 交互 | 按 ref 输入/填充/下拉选择 |
| `browser_press_key` / `browser_scroll` / `browser_drag` | 交互 | 按键 / 滚动（可滚某元素入视野）/ HTML5 拖拽（合成完整 DragEvent 链） |
| `browser_cdp` | 逃生舱 | 原始 CDP：Runtime.evaluate / DOM.getDocument / CSS…/ Profiler / Performance；**Input/cookie/storage/permission/download/target/system 一律被拒**；大响应落盘 |

## 快照 + ref：观察与防漂移

1. 扩展经 `executeCommand("cursor.browserView.executeJavaScript")` 注入快照脚本（页面主世界）。
2. 遍历 composed DOM（`querySelectorAllIncludingOpenShadowRoots`），筛可交互元素。
3. 稳定句柄：已有合法 `data-cursor-ref` 则复用，否则分配 `e<N>`；本次未引用的旧 ref 清除。

```yaml
- role: button
  name: 新建项目
  ref: e2
- role: textbox
  name: 请输入标题
  ref: e18
  value: 故事脚本生成
- role: button
  name: 标题
  ref: e20
  nth: 1            # 同 role+name 的第 N 个
```

防漂移：动作可带 `element`（人类可读描述），执行前 `assertDescriptionMatches` 比对 tag/role/aria-label/text，不一致报错要求重新 snapshot。已知边界：**Iframe 内容不可访问**；设备仿真仅当前 agent turn 内有效。快照保活：watchdog 15s / 恢复检查 3s / 冷却 5min（durable snapshot 自愈）。

## 动作机制：为什么不用 CDP Input

所有交互 = 扩展拼装模板 JS 注入页面执行：click（scrollIntoView → 修饰键 → PointerEvent/MouseEvent 序列 + dropdown 智能关闭）；type/fill（blur 旧焦点 → focus → 设值，含 contenteditable/execCommand 分支）；drag（DataTransfer → dragstart[被 preventDefault 则建议改 evaluate] → dragenter/over/drop，坐标取元素几何中心）。

主进程拒绝 CDP Input 的官方理由：**「CDP Input.* methods are focus-sensitive in Electron webviews」**——webview 嵌在编辑器里，真实输入事件可能被路由到 Cursor UI 而非页面。合成 DOM 事件绕开焦点路由，代价是 `isTrusted=false`（对检测合成事件的站点无效【推断】）。

提示词纪律（扩展内置 instructions）：先 tabs list → navigate → 长自动化前 lock → snapshot+screenshot → 交互八件套 → cdp 做检查/性能分析；**同一失败动作不重复超过一次，4 次失败或停滞即停**；登录/passkey/验证码/破坏性确认必须交还用户；等待优先 CDP 短轮询。

## 安全模型

| 层 | 机制 |
|---|---|
| 导航白名单 | 拒绝 file://（强制 http/https）；管理员 origin allowlist（"blocked by administrator settings"）前置校验 |
| CDP 拒绝列表 | 域级 Browser/Input/Storage/SystemInfo/Target/Tethering；方法级 cookie 四件套 + cache + DOM.setFileInputFiles + Page.navigate 系 |
| 用户夺回 | browser_lock 锁定期间用户可点 "Take Control" |
| 团队策略 | proto browser_protection、mcp_tool_allowlist、admin_command_denylist；浏览器特性 failClosed（缓存缺失即拒绝） |
| 外跳确认 | 非 web 协议跳转弹系统对话框确认后才 shell.openExternal |
| 焦点保护 | headless 标签 + position 语义（后台自动化不抢焦点） |
| 遥测 | recordBrowserTelemEvent（toolName/argsJson/snapshotYaml/url） |

## 与 fork 底座的关系

浏览器是**编辑器维度的一等公民**（openBrowserEditor / splitEditor / 上下文菜单 / 心跳通道，建立在 editor/editorGroupService 与 AuxiliaryWindow 体系上）；MCP provider 框架（registerMcpProvider、durable snapshot、watchdog）是 Cursor 自建私有扩展 API，上游 VSCode 无；VSCode 自带 simple-browser 仍并存。

```bash
grep -o 't5=new Set(\[[^]]*\])' /Applications/Cursor.app/Contents/Resources/app/out/main.js  # CDP 拒绝列表
ls ~/.cursor/browser-logs/; head -40 ~/.cursor/browser-logs/snapshot-*.log                   # 真实痕迹
```
