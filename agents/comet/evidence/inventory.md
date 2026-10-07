# Comet 逆向证据清单

> 基线：2026-10-07/08 分析。全程只读静态分析：DMG 挂载只读、拷贝后 detach；未安装、未启动 app；无运行痕迹产生；不抓包、不触碰凭据。专有代码仅 ≤5 行摘录进本文件。

## 0. 下载与磁盘

| 项 | 值 |
|---|---|
| 官方分发端点 | `https://www.perplexity.ai/rest/browser/download?channel=stable&platform=mac_arm64`（HTTP 307，curl UA 可过） |
| 重定向目标 | `https://pplx-browser-binaries.a0adf9b772aecba4fa8883581f3c9180.r2.cloudflarestorage.com/153.0.8010.222/comet_latest.dmg?<AWS4 签名>`（X-Amz-Expires=3600） |
| 官方最新版本 | 153.0.8010.222（Chromium 基线；DMG 由服务端按平台签名下发） |
| 实际分析版本 | **145.2.7632.4587**（官方 R2 域在本机网络被 TLS 重置：代理 127.0.0.1:1082 与直连均 SSL_ERROR_SYSCALL；改用 MacUpdate 镜像 `dist.macupdate.com/distributive/65431/.../comet_145.2.7632.4587.dmg`，269MB） |
| 磁盘占用（留存于 /Volumes/YANG/apps-re/comet/） | DMG 269MB + Comet.app 717M（ExFAT）+ crx/ 解包 ~45MB ≈ **1.03GB** |
| 版本差 caveat | 145→153 间隔 8 个 Chromium 大版本；agent 架构（三扩展+CDP 桥）无版本演进证据，153 的工具面可能扩展，未验证 |

## 1. Bundle 身份

```
CFBundleIdentifier  = ai.perplexity.comet
CFBundleShortVersion = 145.2.7632.4587   CFBundleVersion = 7632.4587
codesign: universal x86_64+arm64, hardened runtime, library-validation
Timestamp = Mar 28, 2026；含 embedded.provisionprofile
主二进制 = Frameworks/Comet Framework.framework/Versions/145.2.7632.4587/Comet Framework（449MB）
```

- Updater：`CometUpdater.app` + 特权助手 `ai.perplexity.comet.UpdaterPrivilegedHelper`；REST `/rest/browser/update`；扩展 API `perplexity.update.start(downloadUrl)` 接受任意 URL 参数（服务端驱动升级）。
- `comet://` scheme：newtab / settings/import / settings/default。

## 2. 三个内置扩展（Default Apps/）

`external_extensions.json` 固定映射（含 ID）：

| 文件 | 扩展名 | ID | 版本 |
|---|---|---|---|
| agents.crx | comet-agent | `npclhjbddhklpbnacpjloidibaggcgon` | 0.0.187（源文件时间 2026-03-18） |
| perplexity.crx | Comet | `mcjlamohcooanphmebaiigheeeoplihb` | 1.0.76 |
| comet_web_resources.crx | Comet Web Resources | `mjdcklhepheaaemphcopihnmjlmjpcnh` | 2026.3.26.537 |

### comet-agent manifest 关键点（完整件：source/comet/schemas/comet-agent-manifest.json）

- permissions: `debugger, scripting, cookies, tabs, webNavigation, webRequest, sessions, history, downloads, downloads.ui, clipboardRead, clipboardWrite, tabGroups, nativeMessaging, offscreen, declarativeNetRequestWithHostAccess, file://*/`
- host_permissions: `<all_urls>`
- content_scripts: `<all_urls>` → content.js + events.js；`https://docs.google.com/document*` → google_docs_cs.js（注入 main-world google_docs_web.js，读 `.kix-canvas-tile-*` canvas 文本 + 合成 copy 事件）
- externally_connectable.matches: 仅 `perplexity.ai` / `www.perplexity.ai` / `perplexity.com` 及 staging/testing/*.preview.i. 子域

### 解包产物（留存）

```
/Volumes/YANG/apps-re/comet/crx/
  agents/               # background.js 718KB, content.js, events.js, overlay.js 429KB,
                        # offscreen.js, pdf_worker.js 2.1MB(pdf.js), managed_schema.json, _locales 31 条
  perplexity/           # background.ts.j8RgGWRB.js 783KB, pdfjs 1.7MB, pages/self_check.js
  comet_web_resources/  # sidecar/ spa/ inline-assistant/ voice-assistant/ 静态资源（EAR 仅对 www.perplexity.ai 开放）
```

## 3. 执行链关键摘录

### 3.1 视觉 CU 循环（background.js，类 `yP.ComputerBatch`）

- 动作枚举：`LEFT_CLICK, RIGHT_CLICK, DOUBLE_CLICK, TRIPLE_CLICK, TYPE, KEY, SCROLL, SCROLL_TO, LEFT_CLICK_DRAG, SCREENSHOT, WAIT`（+ form_input 按 ref）
- 视口守卫：视口尺寸变化→拒绝执行并返回新截图（"Previous screenshots and coordinates are no longer valid"）
- 动作间随机延迟；最后点击动作后 1s 内补拍截图回传
- CDP 调用点：`Input.dispatchMouseEvent {type:"mousePressed"...clickCount}` / `Input.dispatchKeyEvent` / `Input.insertText` / `Input.dispatchDragEvent`+`Input.setInterceptDrags` / `Page.captureScreenshot`

### 3.2 观察序列化（background.js `getHtmlAXTree`/`uN`）

- `Q({tabId},"Accessibility.getFullAXTree")` + `DOMSnapshot.captureSnapshot {computedStyles, includeDOMRects}` → AX 节点树渲染为伪 HTML；可聚焦节点注入 `node="<axNodeId>"` 属性（常量 `aN="node"`）；heading→h1..h6；filter=VIEWPORT 时按 visibility 剪枝
- 元素引用寻址：`SCROLL_TO`/`form_input` 走 `DOM.resolveNode`→`DOM.getBoxModel`
- 原生 select 弹开检测→向模型回注 `<system-reminder>...use "ref" attribute with "form_input" action</system-reminder>`

### 3.3 云端会话（background.js `AsiCdpBridge`）

- 建立：perplexity.ai 发 `START_AGENT {task, uuid, base_url, extra_headers{source, enable_reconnect, skip_sidecar}}` → connect wsUrl+`?token=`（token 经 `Rj()` 签发）
- 远端 CDP 方法白名单（`rF`，15 个）：`Target.setDiscoverTargets/getTargets/attachToTarget/createTarget/activateTarget/closeTarget`, `Browser.setDownloadBehavior/getVersion/getWindowForTarget/getWindowBounds/setWindowBounds/cancelDownload`, `Network.clearBrowserCache/clearBrowserCookies`, `Fetch.enable`
- 终止：`POST /rest/sse/perplexity_terminate` body `{entry_uuid, context_uuid, model_preference:"pplx_asi"}` includeCredentials
- 急停：标签组关闭→terminateAndStop；WS close code 4004→stop；收包超时→close
- JS 对话框：`Page.javascriptDialogOpening` → 自动 `Page.handleJavaScriptDialog {accept:true}`（日志 "Dialog opened, accepting"）
- 下载：`chrome.downloads.onCreated/onChanged` → 回传 `Browser.downloadWillBegin/downloadProgress`，云端可 `Browser.cancelDownload`

### 3.4 本地工具面（CALL_TOOL 分派，类 `dI`）

`GetContent`（markdown+og_meta+pdp_data；`$.isUrlBlocked` 门禁；PDF→pdf_worker）、`GetSidecarContext`、`GetSidecarPageContent`、`SearchBrowser`（sources: OPEN_TABS/RECENTLY_CLOSED_TABS/HISTORY + tab groups；`perplexity.history_search_enabled` pref 默认 true）、`GetVisibleTabScreenshot`、`OpenTab`、`CloseTabs`、`GroupTabs`、`UngroupTabs`、`SearchTabGroups`

### 3.5 overlay 状态词汇（_locales/en/messages.json，31 条）

Clicking / Right-Triple-Double clicking / Typing / Pressing key / Scrolling(×3 语义) / Dragging / Filling form / Taking screenshot / Reading page / Getting page text / Finding elements / Searching / Navigating / Creating tab / Waiting / Thinking / Reasoning / Working / Done / Pause→Resume / **Take control**

## 4. 浏览器 fork 面（主二进制 strings + resources.pak）

### 4.1 内嵌扩展 API schema（23 个 perplexity.* 命名空间，完整 JSON 存 source/comet/schemas/）

| 命名空间 | 函数（要点） |
|---|---|
| perplexity.agentTabs | create(pairedTabId,url)/navigate/reload/destroy/get/getAllByPairedTab/goBack |
| perplexity.sidecar | toggle/open/close/navigate/runQuery/rememberVisibility/isInVoiceMode/getURL |
| perplexity.mcp | getTools/callTool(serverName,toolName,args)/getStdioServers/addStdioServer/updateStdioServer/removeStdioServer |
| perplexity.dxt | install(url)/startPackage/uninstall/getInstalledPackages/hasPermission/requestPermission |
| perplexity.blacklist | isDomainInBlacklist(domain, source) |
| perplexity.mission_control | showBadge/setAgentWorking/setBadgeText/setBadgeNeedsAttention/hideBadge |
| perplexity.system | getMachineId/captureTab(tabId,options)/installExtension(id,showPrompt,…)/setPerplexityAsDefaultBrowser/startVoiceInput/getStartupMetrics… |
| perplexity.views | showOverlay/showPopup/createWebOverlay/injectScriptInWebOverlay/setWebOverlayBounds/enableWebOverlayForwardEventsToTab/listWebOverlays/showSidecarNudge…（30 函数） |
| perplexity.pdf | getRawBytes/getText(tabId,pageNumber)/getPageCount |
| perplexity.commands | execute({command,windowId,tabId}) |
| perplexity.signature | signPayload(payloadJson) |
| perplexity.update | start(downloadUrl)/cancel/getStatus/relaunchBrowser |
| perplexity.shortcuts / themes / sync / analytics / actions / features / voiceAssistant / inlineAssistant / explanation_mode / import / adblockStatistics | 见 schemas |

### 4.2 fork 源码路径（二进制内嵌，采样）

`chrome/browser/perplexity/perplexity_agent_tabs.cc`、`perplexity_voice_assistant.cc`、`help_me_with_text_tab_helper.cc`、`spotlight/spotlight_webview_manager.cc`、`chrome/browser/extensions/api/perplexity/{shortcuts,signature,system}_api.cc`、`components/perplexity/mcp/{mcp_stdio_client,stdio_process,mcp_env_loader_mac}.cc`、`components/perplexity/dxt/{dxt_manager,dxt_node_installer}.cc`、`components/brave/content/browser/perplexity_filter_list_downloader.cc`、`components/perplexity/enterprise/crowdstrike_zta_service.cc`、`content/browser/speech/pplx/openai_web_socket_transcriber.cc`、agent 扩展源路径 `pplx/frontend/comet/agent_extension/background/asi/connect_asi_bridge.ts`（bazel 输出）

### 4.3 观察备用管线（Chrome Glic 血统）

`blink.mojom.AIPageContentAgent`、`AnnotatedPageContent*`（Extraction/Request/ZOrderEarlyFiltering/PaidContentAnnotation 等十余 feature flag）——fork 自带的 AI 页面内容抽取，作为 comet-agent AX 快照之外的第二套观察基建。

## 5. 端点汇总（静态可见）

| 域/路径 | 用途 |
|---|---|
| www.perplexity.ai/rest/browser/{download,update,update-crx,feedback,devicemanagement,annotate} | 分发/升级/反馈/企业管理/标注 |
| www.perplexity.ai/rest/sse/perplexity_terminate | agent 会话终止（pplx_asi） |
| www.perplexity.ai/rest/shopping/assistant/browser-config | 购物 agent 配置 |
| www.perplexity.ai/rest/event/analytics、irontail.perplexity.ai/v1/bulk/event | 遥测 |
| pplx-browser.perplexity.ai/{default_engine_filters,additional_engine_filters,cookie_filters}.txt、resources.json | 拦截规则分发 |
| comet-safebrowsing.perplexity.ai/v4 | Safe Browsing 代理 |
| suggest.perplexity.ai/search/v3/navigate | 导航联想 |
| fs-edge-assignment.eppo.cloud / fscdn.eppo.cloud | Eppo 特性开关 |
| api.mixpanel.com、Datadog RUM（datadoghq-browser-agent.com + d3uc069fcn7uxw/d20xtzwzcl0ceb.cloudfront.net）、Sentry | 分析 |
| wss://api.openai.com/v1/realtime | 语音转写（openai_web_socket_transcriber.cc） |
| wss://enclave.ua5v.com/enclave | 主二进制 strings 出现，用途未验证（低置信） |
| 广告拦截引擎 | Brave 组件衍生（perplexity_ad_block_statistic.cc 等），DNR 规则由 perplexity.crx 管理 |

## 6. 安全模型证据

- 企业 policy（agents/managed_schema.json）：`BlockedDomains`（"The agent will not be able to access or scrape content from these domains"）+ `OrganizationUUID`（未登录 enrolled 设备拉取限制用）
- 黑名单判定链（background.js `$.isUrlBlocked`）：内部页（chrome://、comet://、chrome-extension://、comet-extension://）恒禁 → file:// 仅白名单扩展名（.pdf/.docx/图片等）→ 企业 BlockedDomains 子域匹配 → `chrome.perplexity.blacklist.isDomainInBlacklist(domain, BlacklistSource.ALL)` → fallback pref `perplexity.client_context_domains_blacklist`
- 输入封锁：events.js 对 40+ 事件类型 capture 阶段 `stopImmediatePropagation+preventDefault`（仅 overlay 按钮豁免）；光标强制 progress
- 视口守卫 + 截图版本化（screenshot_uuid）防陈旧坐标

**负发现**：① 未发现逐动作人工确认 UI（仅任务级 Pause/Take control）；② agent 观察管线未见密码字段脱敏（MASK 代码属 Datadog RUM 遥测隐私配置 allow/mask/mask-user-input）；③ 未发现「云端直驱本地 Input.*」之外的 OS 级控制通道。

## 7. 复现命令

```bash
V=/Volumes/YANG/apps-re/comet
plutil -p $V/Comet.app/Contents/Info.plist | grep -E 'Identifier|ShortVersion'
D="$V/Comet.app/Contents/Frameworks/Comet Framework.framework/Versions/145.2.7632.4587/Default Apps"
unzip -oq "$D/agents.crx" -d $V/crx/agents      # CRXv3 = 593B 头 + zip
strings -arch arm64 "$V/Comet.app/Contents/Frameworks/Comet Framework.framework/Versions/145.2.7632.4587/Comet Framework" | grep -c perplexity   # 1244
grep -o 'Input.dispatchMouseEvent' $V/crx/agents/background.js | wc -l   # 6
python3 -c "import json;print(json.load(open('$V/crx/agents/manifest.json'))['permissions'])"
# pak 解析（v5 头：u32 ver, u8 enc, u16 rc, u16 ac, 条目 u16 id+u32 off）
```

## 8. 与 capability-matrix 的对接

- 13 家中形态唯一：「浏览器即 Agent 载体」。CU 列应记「有（浏览器域内，CDP 合成事件）」；BU 列「有（真标签页 + 云端 WS CDP 桥）」；本机可用性「✅ 架构完整（本机静态还原，未运行验证）」。
- 工具面口径：browser 侧 CALL_TOOL 10 工具 + ComputerBatch 10 动作 + 远端 CDP 白名单 15 方法；私有 API 23 命名空间。
