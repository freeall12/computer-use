# Atlas 逆向证据清单（evidence）

> 数据文件，不受文风规范约束。分析日期 2026-10-08。全程只读静态：未运行安装器、未启动 app。
> 所有二进制路径基于 `/Volumes/YANG/apps-re/atlas/ChatGPT Atlas.app`（下称 `$APP`）。

## 1. 获取与版本

| 项 | 值 |
|---|---|
| 官方直链 | `https://persistent.oaistatic.com/atlas/public/ChatGPT_Atlas.dmg`（HTTP 200，content-length 269,967,267，last-modified 2026-07-27T23:03:08Z） |
| 下载副本 | `/Volumes/YANG/apps-re/atlas/ChatGPT_Atlas.dmg`，sha256 `894b60a1276c65dd220984db647963e6245e06e2211fb3c61b944f6e1a013435` |
| 挂载 | hdiutil attach -readonly；DMG 内 `ChatGPT Atlas.app` + Applications 符号链接 |
| 外层 app | bundle id `com.openai.atlas`，CFBundleShortVersionString `1.2026.189.1`，LSMinimumSystemVersion `14.2`，含 `embedded.provisionprofile` |
| 内层 app | `Contents/Support/ChatGPT Atlas.app`，bundle id `com.openai.atlas.web`，CFBundleName `Atlas`，版本 `150.0.7871.115`（Chrome 版本号方案） |
| 签名 | TeamIdentifier `2DC432GLL2`（OpenAI；与 Sky CUA 的 Group Container `2DC432GLL2.com.openai.sky.CUAService` 同团队） |
| bundle 体积 | 总 967M：Frameworks 249M（Aura.framework 139M + OwlBridge 8.4M + Sparkle/LiveKitWebRTC/Lottie/Assets）、Support 481M、Resources 201M |
| Chromium 框架 | `.../ChatGPT Atlas Framework.framework/Versions/150.0.7871.115/ChatGPT Atlas Framework`（222M）+ Helpers `(Renderer|GPU|Service|Alerts).app` |
| framework Resources | `chrome_100_percent.pak / chrome_200_percent.pak / resources.pak(13M) / v8_context_snapshot.arm64.bin / icudtl.dat / gpu_shader_cache.bin / install.sh / product_logo_32.png / ChatGPT Atlas Framework.sig` |
| Libraries | IwaKeyDistribution、MEIPreload、PrivacySandboxAttestationsPreloaded、libEGL/GLESv2/vk_swiftloader |

strings dump 存档：`/Volumes/YANG/apps-re/atlas/analysis/framework_strings.txt`（823,224 行）。Aura 主二进制 strings 525,641 行（临时分析，未入仓库）。

## 2. 外层壳与 Swift 模块

- Resources 下约 130 个 `.bundle`（Aura_AuraAgents / Aura_AuraBrowserMemories / ChatGPTAutomation_ChatGPTAutomation / Aura_AuraCursorChat / Aura_AuraSideChat / ChatGPTPairWithAI / ChatGPTWhisper…）——**多数仅含 Info.plist**，代码静态链入 Aura 二进制；bundle 是模块清单。
- Info.plist 128K（Chromium 式大 plist）；PkgInfo `APPL????`（无四字符类型码）。
- 三层 Mojo/IPC 命名空间（Swift 符号 `$s5Mojom03OwlA0O…` = `Mojom.OwlAtlas…`）。

## 3. agent mode（computer use）关键 strings 原文

### 3.1 命令/工具注册表（Aura，`Conversations/GizmoAPI.swift` 相邻区）

```
research_kickoff_tool / start_research_task / myfiles_browser / python /
voice_mode.hangup / web.run / automations.list / file_search.msearch /
container.exec / browser_history.retrace / clarify_with_text /
computer.click / computer.typing / computer.scroll / computer.initialize /
computer.dom_do / computer.do / computer.get / computer.get_dom /
computer.create_tabs / computer.list_tabs
（另有 computer.double_click / computer.drag / computer.move / computer.type /
 computer.keypress / computer.wait / browser.search / browser.run 各 1 处命中）
```

### 3.2 命令参数词表（`AuraAgents/PlaywrightActionHandler.swift` → `RemoteBrowserCommand.swift` 相邻区）

```
relative_path tab_id app_id destination_path source_path limit items tabs
timeout_ms scroll_x scroll_y node_id dom_snapshot download_id
include_non_interactable file_chooser_id files selector modifiers force
replace selections checked fullPage cropX cropY cropWidth cropHeight
is_multiple wait_until display_truncate_max_chars urls content_type results
title dateVisited lastOpened tabGroup
wait_until 取值：domcontentloaded / load / networkidle / commit
按钮/修饰键：left / middle；Control / ControlOrMeta / Meta / Shift
content_type 取值：domSnapshot / xlsx / pptx
```

### 3.3 页内注入 JS（Aura 内嵌，逐字摘录）

ARIA 快照（`playwrightDomSnapshot()` 工具体）：

```js
try {
  const injected = window.__pwInjected;
  if (!injected) { return 'Error: Playwright not injected'; }
  const root = document.body || document.documentElement;
  if (!root) { return ''; }
  return injected.incrementalAriaSnapshot(root, { mode: 'ai', track: 'superassistant-dom-snapshot' }).full;
} catch (e) { return 'Error: ' + (e && e.message ? e.message : String(e)); }
```

可见文本兜底：`const root = document.body ?? document.documentElement; return root?.innerText ?? "";`

点击合成（节选自内嵌 minified JS，完整序列）：`elementFromPoint` 取中心 → 依次派发 `pointerover → mouseover → pointerenter → mouseenter → pointermove → mousemove → pointerdown → focus → pointerup → mouseup → click`；前置 `scrollIntoView({block:"nearest",inline:"nearest"})` + 视口内校验（8px 边距）；`OPTION/SELECT` 特判为直接 `value` 写入 + `input/change` 事件。

滚动合成：`document.elementFromPoint(innerWidth/2, innerHeight/2)` → 向上找第一个可滚祖先 → `scrollBy({top: ±0.9*innerHeight, behavior:"smooth"})`。

### 3.4 Playwright 移植组件名（Swift 符号）

`PlaywrightSetupCheck / PlaywrightSetupBootstrap / PlaywrightSelectorHelpers / PlaywrightLocatorRead / PlaywrightLocatorCount / PlaywrightLocatorFocus / PlaywrightInjected / PlaywrightElementInfo / PlaywrightWaitForElementAndMakeVisible / PlaywrightWaitForElementAndMakeActionable / PlaywrightDomSnapshotFormatter`（后者解析 `Node/NodeBox`）。

快照 YAML 解析正则（PlaywrightActionHandler.swift 区）：
`#/^- (generic|listitem|group)(?: \[[^\]]+\])*\:?$/#`、`#/^- img(?: \[[^\]]+\])*\:?$/#`、`#/ \[cursor=[^\]]+\]/#`、`#/ \[ref=[^\]]+\]/#`

JS bundle 装载：`__loadJSBundle` / `__internal.setUpRuntime` / `AgentLib.js_repl` / `AgentLib.atlas_repl`（命名 JS 包）。

### 3.5 CUA DOM 执行错误话术（执行路径实证）

```
No environment for executing CUA dom type
cua dom type unable to enter text / cua dom type unable to press enter
DOM Click failed due to missing cuaEnvironment
Missing DOM node for ID … / Unable to scroll DOM / Unable to perform cua dom scroll
waitBetweenCompoundTypingActions(trace:)
command.steps.get_dom.duration / command.steps.execute.duration /
command.steps.execute.attempt / command.steps.download.duration /
command.steps.capture_screenshot.count / command.steps.execute.agent_stopped.count
```

### 3.6 会话/命令流（WebSocket）

```
RemoteBrowserCommandHandler.executeCommand(payload:agentID:requestID:callId:
  attempt:sentAt:isPreinitialize:requestIndex:recordActionStateSnapshot:trace:
  skipShouldHandleCommandsCheck:)
Received remote command. type= … / JSON payload missing type parameter /
No command registered for type …
AuraAgents/RemoteCommandWebSocketEventMediator.swift：waitForRemoteWorkerResponse(requestID:timeout:)
turn.commands.succeeded.count / turn.commands.failed.count / turn.pauses.duration
The user has stopped the agent and all tool calls will be ignored. End the agent turn.
Failed to create remote browser command file environment. / makeFileEnvironment(agentID:log:)
AtlasBrowserAgentSessions / RemoteBrowserAgentContext.swift
```

用户侧帮助文案：`Agent mode uses a remote browser and takes screenshots. You can take control at any time. Agent mode has privacy risks. [Learn…`

### 3.7 ComputerUse 动作类型（Swift 符号，AuraAgents）

`ComputerUseActionHandler`；动作：`Click / DoubleClick / Drag / KeyPress / Move / Scroll / Type / Wait`；环境：`AgentComputerUseEnvironment(Providing)`、`AgentDOMEnvironment`、`AgentInputEvent / MouseButton / AgentInputCoordinateSpace / AgentImageData / DOMRepresentation / DOMNodeMetadata / AgentTag / AgentTabInfo`。

### 3.8 审批与安全话术（原文）

- logged-in 风险披露：`In "logged in" mode, ChatGPT can access your logged in sites, making it faster to complete tasks. ChatGPT is built to protect you, but there is always some risk that attackers could successfully break our safeguards to access your data, or take actions as you on logged in sites. You can use logged out mode to reduce risk.`
- 侧栏同款：`Let ChatGPT work alongside you using your logged in accounts. While ChatGPT is built to protect you, attackers on websites may succeed in using ChatGPT in Agent mode to access your data or take actions as you on logged in sites.`
- 降险指引：`Use "logged out" mode to have Agent mode use sites without being logged in as you. You can still log ChatGPT agent into individual sites, allowing it to use just those sites logged in.`
- 自动审批：`ChatGPT will automatically approve low-risk actions but may deny actions involving sensitive information. [Learn more](`
- localhost 开关：`Allow ChatGPT to interact with localhost servers`（`aura_agent_mode_settings_allow_localhost_title`；statsig 门 `agent_localhost_access_enabled_override`）
- statsig/本地化键：`browser_use_approval_allow_for_this_chat / browser_use_approval_enable_auto_approvals / browser_use_approval_guardian_approvals_description / agent_safe_mode / agent_mode_announcement / agent_background_notification_success`
- 设置键：`WebViewGroup_EnableAgentModeRestrictions_Params`（mojo）、`agentModeRestrictionsEnabled`
- 黑名单：`AuraContextBlocklist/{API+GlobalSiteSettings, API+UserSiteSettings, UserSiteSettingsService}`、`ensureNonBlocklistSiteIsOpen(in:)`、`Initiating agent for side chat but URL is blocked`、`AuraComposerSupport/SearchBlocklist`
- Safe Mode：`AgentSafeModeMenu / AgentSafeModeNuxModal / AddressBarSafeModeIndicatorPopover / ConversationController_SetAgentSafeMode`
- 停止熔断见 §3.6；看护：`AgentWebContentWatchdog`、`DefaultWebSocketWatchdog`、`OWL: did not receive ping from watchdog in a timely manner`
- 虚拟光标：`AgentCursor / AgentCursorWithLabel / AgentCursorRoundedRectangleOrbit / AgentCursorShowcaseView`；截图带光标：`captureCurrentTabScreenshot(cursorScaleFactor:cursorLocationOverride:coordinateSpace:)`
- 围观接管：`chrome://agentviewer`、`AgentHandler_TryOpenAgentViewer`、`Click to take control`、`userIsViewingAgent()`、`AgentLiveTabRemoveBehaviorManager`
- 下载隔离：`AgentHandler_MoveDragonfruitDownloads / AgentHandler_OpenDragonfruitDirectory / OpenFinder`； Dragonfruit 即本地 agent 运行时代号：`ConversationController_DragonfruitApprovalRequestReceived`、`userSentMessageInAgentConversation(…isLocalSafeMode:…originatesFromToolCall:isDragonfruit:initiateSource:)`、`chatgpt-kaur1br5-dragonfruit`

### 3.9 BrowserAuth（凭据通道，原文级符号）

`BrowserAuthAction / BrowserAuthElicitationContent / BrowserAuthFieldRow / BrowserAuthFields / BrowserAuthFormFillRequest / BrowserAuthFormFillResponse / BrowserAuthPresentation(Request) / BrowserAuthSession / BrowserAuthToolRecognizer / BrowserAuthViewModel`；聊天侧 `MessageToolBrowserAuthSubmittingPart`、`submitBrowserAuthAndDismiss(messageID:_:fieldValues:conversationID:)`（`ChatGPTMessages/MessagesViewModel+BrowserAuth.swift`、`ChatGPTMessageInput/BrowserAuthViewModel`）。

### 3.10 LocalTool 架构（Swift 符号）

`LocalToolManager(Factory/Providing) / LocalToolRegistry / LocalToolRegistration(Config) / LocalToolDescriptor / LocalToolHandler / LocalToolRecognizer / LocalToolInvocation{Context,Parameters,Result,Status} / LocalToolEvent / LocalToolConfig`；mojo：`ConversationController_LocalToolResult / LocalToolStatusUpdate / ToolStatusUpdate / HandleAgentRequest / PerformHandshake / RequestCompletion`；AgentHandler 面：`GetAgentStatus / GetClientCapabilityVersion / GetCodexTools / GetClientID / AgentConversationStopped / OpenAgentTabs / RefreshEcosystem / UploadAgentRolloutFeedback / UserSentMessageInAgentConversation / UserStoppedAgentConversation / ExportAsZip / OpenFinder / TryOpenAgentViewer`。

## 4. 负证据（重要：Atlas 不含 Sky 桌面栈）

| 检索词 | Aura 143M 二进制命中 | Chromium 222M 二进制命中 |
|---|---|---|
| `com.openai.sky` | 0 | 0 |
| `CUAService` | 0 | 0 |
| `computeruse.sock` | 0 | 0 |
| `tinysky` / `@oai/cua` | 0 | 0 |
| `Skyshot` | 0 | 0 |
| `ScreenCaptureKit` | 0 | — |
| `CGEvent` | 2（`eventWithCGEvent:` AppKit 类目、属性名列表——非自动化管线） | — |
| `AXUIElement` | 2（`AXObserver/NAXUIElementRef`，位于浏览器导入/进程切换表 `com.google.Chrome.canary…company.thebrowser.Browser…` 与 `AXEnhancedUserInterface/AXManualAccessibility` 相邻——供导入向导读他应用，非 agent 通道） | — |
| resources.pak | — | 无 `agentviewer / __pwInjected / superassistant / incrementalAria`（agent 逻辑不在 pak） |

`Operator` 命中均为 `OperatorAgentOverlay / OperatorAgentOverlayViewModel / OperatorAgentSession`（AuraAgents/OperatorAgentOverlayViewModel.swift）——云端 Operator 会话的展示面，非本地执行栈。

## 5. browser use 关键证据

### 5.1 owl.mojom 接口全集（两侧二进制并集）

```
AtlasResourceContentProvider / AutocompleteClient / AutocompleteController /
AutofillPopup(Client) / BookmarkModel(Client) / CertSelectionCancellation /
ChatGPTFrontend(Host) / DeferredLoadBlocker / DevToolsSession(Client) /
DownloadManager(Client) / DownloadURLToFileClient / ExtensionService(Client) /
FindClient / ICloudKeychainPasskeyBridge / LayerHost(Client) / MetricsService(Client) /
NotificationService(Client) / OmniboxAPIHandler / PermissionPrompt(Client) /
PopupMenuRunner / Profile(Client,CloseListener) / SaveAddressPrompt(Client) /
SaveCardPromptClient / SavePasswordPromptClient / SearchKeywordsClient /
Session(Client) / TabSharingSession / TranslatePromptClient / URLLoader(Client) /
WatchdogClient / WebContent(Renderer)(Client) / WebView(Client,ContainerView,Group…) /
WebViewSessionDataDecoder
```

WebView mojo 方法节选（`WebView_*_Params` 命名）：`EvaluateJavaScript / ExtractSerializedDom / ExtractSerializedDomElementInfo / ExtractAnnotatedText / TakeSnapshotWithOptions / CreateDevToolsSession / FindInPage / InsertViaPaste / SetStoragePartition / SetTabId / GoBack / GoForward / Reload / ZoomIn/Out / Copy / Cut / SelectAll / ShowTranslateBubble…`
WebContent：`OnMouseEvent / SetInputMode / DraggingEntered/Updated/Exited / PerformDragOperation / EndDrag`。
ChatGPTFrontendHost 侧 handler：`ChatGPTAgentHandler / ChatGPTAgentSafeModeSettingsHandler / ChatGPTAgentUIHandler / ChatGPTLocalToolHandler / ChatGPTConversationStateHandler / ChatGPTAuthHandler / ChatGPTTemplatedPromptHandler / ChatGPTTabContextProvider …`
WebBridge 页面绑定（Swift 枚举 `AuraMojom.WebBridge` targets）：`ConversationController / AgentHandler / AgentUIHandler / AgentUIController / LocalToolHandler / AuthHandler / AuthStateController / SettingsHandler / SettingsController / OpenSettingsController / LinkHandler / ProductEventHandler / ProfileStateHandler / GenericInterface`。

### 5.2 browser memories 嵌入式工具指引（原文）

> The user is using a ChatGPT Browser, so you have access to and can search their personal browsing history. However, the user has disallowed ChatGPT to reference their web history in chat. You can prompt the user to enable it in their settings, aka. Settings -> Personalization -> turn on "Reference saved memories", then "Reference browser memories" in chat. Once it is enabled, you can use this tool whenever the users asks you to reference their web history, recall, retrace, compare, or summarize pages they've already opened.

配套符号：`AuraBrowserMemories/{BrowserMemoriesService, DefaultBrowserMemoriesService, BrowserMemoriesResponse}`、`WebHistorySearchStrategy`、`browserMemoriesDisabledReplyMessage()`、statsig 键 `disable_web_history_tool_when_allow_hippo_in_chat_is_disabled`、UI 文案 `Browser memories update regularly and take into account your custom instructions and saved memories. Delete web history or archive specific browser memories when you don…`。工具名 `browser_history.retrace`（§3.1 注册表）。

### 5.3 扩展与 WebUI

- 官方扩展深链：`https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg`（与 agents/codex/browser-use.md §1 的 Chrome Web Store id 完全一致）
- 扩展安装 mojo：`ExtensionService_InstallExtensionById_(Params|ResponseParams)`；分类页 `https://chromewebstore.google.com/category/extensions`
- chrome:// 页：`agentviewer`（OpenAI 新增）、`bookmarks / certificate-manager / credits / downloads / extensions / history / inspect / management / new-tab-page / password-manager / settings`
- AppleScript：`scripting.sdef` 标准套件（`BrowserCrApplication / WindowAppleScript`，tabs/given name/title）
- Native Messaging 布点：`/Library/OpenAI/ChatGPT Atlas/NativeMessagingHosts`
- 企业托管：`/Library/OpenAI/Atlas/CloudManagementEnrollmentOptions`、`OpenAI/Atlas Cloud Enrollment/`
- Group Containers：`2DC432GLL2.com.openai.atlas.web.{devicetrust, webauthn, webauthn-uvk, secure-payment-confirmation, unexportable-keys}`、`com.openai.shared`

### 5.4 Chromium 层定制（少）

- `ContextualTasks` 导航拦截：`HandleNavigationImpl posting OnNavigationToAiPageIntercepted`、`ContextualTasksUrlRedirectToAimUrl`、`lens.ClientToAimMessage`（"AIM" 页面/侧栏路由）【推断：把部分导航重定向到 AI 页，细节未拆】
- 嵌入 JS：`window.__oaiAutomaticScrollEventRoutingInstalled`（滚动事件路由钩子）
- 群组容器键 `chatgpt-atlas-enable-web-view-occlusion`；渲染器指标 `Memory.ChatGPT.Renderer.PrivateMemoryFootprint`；Keychain 加密 salt 串含 "ChatGPT Safe Storage"
- 上游 Chromium 自带 Google agentic 权限端点（`agenticpermission.pa.googleapis.com`）——非 OpenAI 功能，属上游代码

### 5.5 端点全集（两二进制合并去重）

```
https://chatgpt.com（+ /atlas /data-controls /download/ /backend-api /conversation /conversations/batch /backend-api/sentinel/heartbeat）
https://ab.chatgpt.com（/v1/sdk_exception）
https://realtime.chatgpt.com
https://api.openai.com（/auth /mfa /profile /v1）
https://skybridge.oaistatic.com
https://persistent.oaistatic.com/atlas/public/{ChatGPT_Atlas.dmg, Install_ChatGPT_Atlas.dmg}
```

安装包内自引用更新直链与本次下载源一致（Install_ChatGPT_Atlas.dmg 为另一变体，未抓取）。

## 6. 传播物料 / 其他

- 通知：`CHATGPT_NOTIFICATION_PERMISSION_REQUEST_KIND_CODEX`、CodexDownloadEmailService（"Check your email for the Codex Desktop download link."）——外层壳是 ChatGPT 全功能壳（含 Codex 面板入口 `/codex`），非浏览器专用壳。
- 遥测：Sentry（sentry-cocoa）、Segment、Datadog、OAIStatsig。
- 审计事件样例：`AnalyticsEvents_V1_ChatgptScreenshotUploadDetected`、`AtlasSideChatGuidedTour*`、`AtlasComposerTabContext*`。

## 7. 不可见边界与低置信点汇总

1. `computer.*` 完整 JSON schema、系统提示词、审批判定逻辑在 ChatGPT 服务端；本包仅参数词表。【推断：词表↔命令映射】
2. WebSocket 命令通道 URL 未以字面量出现。【推断：chatgpt.com 域运行时拼装】
3. `computer.do` vs `computer.dom_do` 的分工。【推断：前者带验证管线、后者直连 DOM】
4. 云端 agent（Operator）会话与本地 Dragonfruit 会话在 AgentHandler/UI 上如何并存：符号层可见两套（OperatorAgentOverlay vs AtlasBrowserAgentSessions），互通细节未见。【推断】
5. `ChatGPTAutomation` bundle 对应的自动化模块代码已链入 Aura 但未单独成库，其与 agent mode 的边界未拆。【推断：自动化 = 会话内 automations 定时任务（`automations.list`），非 computer use】
6. Chromium fork 相对上游 150 的完整 diff 未逐条比对（负证据仅限 strings 层）。
7. `contextBlocklistService` 全局黑名单的服务端下发频率与内容不可见。
