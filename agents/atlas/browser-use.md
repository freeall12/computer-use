# Atlas Browser Use（浏览器本体与 ChatGPT 集成）完整逆向

> 证据见 [evidence/inventory.md](evidence/inventory.md)；【实证】/【推断】标注同前篇。

## 0. TL;DR

**Atlas 是一个 fork Chromium 套 Swift 壳的 Arc 式架构**：Chromium 150 提供完整浏览器面（扩展、DevTools、AppleScript、多进程 Helper），Swift 层经 Mojo 桥 `owl.mojom.*` 替代 Chrome 原生 UI，并把浏览历史摘要（browser memories）、页面上下文（side chat）喂给 ChatGPT。

```
Swift 壳（Aura/Owl，SwiftUI）— UI、设置、agent、对话
 │ owl.mojom.*：Profile/Session/WebView/WebContent/ExtensionService/
 │              DevToolsSession/DownloadManager/NotificationService…
 ▼
Chromium 150.0.7871.115 fork（chrome://agentviewer 为新增 WebUI 页）
 │ Renderer/GPU/Service/Alerts Helper；resources.pak 无 OpenAI 内容
 ▼
chatgpt.com 前端远程加载（Mojo WebBridge：ConversationController/
 LocalToolHandler/AuthHandler/AgentUIHandler 等 14+ 接口）
```

## 1. 浏览器本体能力

| 能力 | 实证 |
|---|---|
| 扩展 | Chrome Web Store 全量；`ExtensionService_InstallExtensionById`；onboarding 引导装官方 ChatGPT 扩展（id `hehggadaopoacecdllhhajmbjkdcmajg`，与 Codex 分册同一扩展） |
| AppleScript | `scripting.sdef` 标准 Chromium 词典（window/tab 操作，`BrowserCrApplication`） |
| Native Messaging | 布点 `/Library/OpenAI/ChatGPT Atlas/NativeMessagingHosts` |
| DevTools | 内建 + Mojo `DevToolsSession`（agent 层可编程开 session） |
| WebUI 页 | `chrome://agentviewer`（新增）、settings/history/downloads/extensions/bookmarks/password-manager/inspect/management/credits |
| 语音 | LiveKitWebRTC + realtime.chatgpt.com |
| 更新 | Sparkle + `persistent.oaistatic.com/atlas/public/ChatGPT_Atlas.dmg` |
| 企业管理 | `/Library/OpenAI/Atlas/CloudManagementEnrollmentOptions`（CloudManagement 托管） |

## 2. 浏览历史 → 模型工具（browser memories）

**浏览历史被摘要成"browser memories"，以 `browser_history.retrace` 工具供给 ChatGPT。** 这是 Atlas 独有的 BU 面：不是逐页快照，而是定期聚合摘要。

- 服务：`AuraBrowserMemories`（`BrowserMemoriesService`、`WebHistorySearchStrategy`）；设置里可删历史/归档单条 memory。
- 嵌在二进制里的工具指引原文（摘录，全文进 evidence §5）："The user is using a ChatGPT Browser, so you have access to and can search their personal browsing history…"，开关藏在 Settings → Personalization → Reference browser memories。
- 搜索黑名单：`AuraComposerSupport/SearchBlocklist` 控哪些站不进摘要。

## 3. 页面上下文 → ChatGPT（side chat / tab context）

| 通道 | 机制 |
|---|---|
| Side chat | 页侧栏聊天；`WebSideChatContextProvider` 取当前页上下文；`ConversationController_SendSideChatCompletion` |
| 跨标签上下文 | composer `@` 选 tab：`tabContextProvider/Cache/BatchFetcher`；`ATLAS_COMPOSER_TAB_CONTEXT_SELECTION_SOURCE_*` |
| 划词聊天 | AuraCursorChat（划选即问） |
| 页→壳桥 | `owl.mojom.WebBridge`（页面 JS 绑定 14+ handler：AuthHandler/LinkHandler/AgentHandler/LocalToolHandler/SettingsHandler…） |
| 自动滚动路由 | 注入 `window.__oaiAutomaticScrollEventRoutingInstalled` 钩子修正滚动事件归属【推断：服务合成滚动可见性】 |

## 4. 端点清单

| 端点 | 用途 |
|---|---|
| `chatgpt.com` + `/backend-api` + `/conversation` | 前端与对话 API |
| `ab.chatgpt.com`（/v1/sdk_exception） | statsig 实验门控（含 `computer_use:dragonfruit_screenshot_*`） |
| `realtime.chatgpt.com` | 语音 |
| `api.openai.com`（/auth /mfa /profile /v1） | 账号 |
| `skybridge.oaistatic.com` | 前端静态资源【推断】 |
| `persistent.oaistatic.com/atlas/` | 安装包与 LGPL 声明 |
| `chromewebstore.google.com/detail/chatgpt/hehgg…` | 扩展安装 |

## 5. 与 Codex browser-use 对照

| 维度 | Codex（agents/codex 分册） | Atlas |
|---|---|---|
| 浏览器来源 | 复用用户 Chrome/Edge/Brave/Opera + 云端 cdp | 自带 fork Chromium |
| 连接方式 | 扩展 + Native Messaging | 进程内 Mojo（无桥接损耗） |
| 登录态 | 用户真实浏览器 profile | Atlas 自身 profile + 按站点授权 |
| 页面观察 | browser-accessibility WASM + CDP | 页内 Playwright 移植 |
| 历史利用 | 无 | browser memories 聚合喂模型 |
| 扩展支持 | 借宿主浏览器扩展 | 原生支持 + 预装 ChatGPT 扩展 |
| 同源 | ChatGPT 扩展 id、guardian 审批话术相同 | 同左 |

## 6. 本机不可见边界

- Chromium fork 相对上游的 diff 面（除 `chrome://agentviewer`、ContextualTasks/AIM 导航拦截外）未逐条比对【推断：定制集中在导航拦截与 mojo 桥】。
- `chatgpt.com` 前端 JS（agent 对话 UI、BrowserAuth 卡片）在服务端，本包不含；resources.pak 已验证无 agent 内容。
