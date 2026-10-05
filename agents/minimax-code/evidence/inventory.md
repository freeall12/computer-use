# 证据清单（Evidence Inventory）

> 本文件记录逆向结论 → 证据路径的映射。解包产物 `/tmp/mm-asar` 来自 `/Applications/MiniMax Code.app/Contents/Resources/app.asar`（SHA256 完整性校验值见应用 Info.plist `ElectronAsarIntegrity`）。仅作只读分析，未复制任何专有源码文件入仓。

## A. 应用标识与版本

| 结论 | 证据 |
| --- | --- |
| MiniMax Code，`com.minimax.agent.cn`，3.1.0 / 3.1.0.177，Electron 42.8.0，URL scheme `minimax-cn` | `Info.plist`（CFBundleIdentifier/ShortVersionString/CFBundleVersion/CFBundleURLSchemes）；`Contents/Frameworks/Electron Framework.framework/Resources/Info.plist`（CFBundleVersion 42.8.0） |
| 内部包名 `@mmx-agent/electron` "MiniMax Agent Desktop Application"；workspace 依赖列出全部 @mavis/* 包 | `app.asar::package.json`（dependencies: @mavis/browser-core、@mavis/agent-tools、@trycua/cua-driver 0.22.1、@mavis/remote-control-bridge、node-pty、ws 等） |
| 数据目录 | `~/Library/Application Support/MiniMax/`、`~/.minimax/` |
| MiniMax Design.app 为独立应用 `com.minimax.hub` 3.0.21，未复用 coding agent 的 CU/BU 组件（推断，仅快速查验） | 其 Info.plist、MacOS 目录、asar 内常见依赖（electron-screenshots 等） |

## B. Computer Use

| 结论 | 证据（均在 /tmp/mm-asar 下） |
| --- | --- |
| CU 由 trycua CUA 驱动 0.22.1 提供，Rust/UniFFI，MIT | `node_modules/@trycua/cua-driver/package.json`（repository: github.com/trycua/cua；deps @ubjs/*）；`cua-driver-runtime.js` `createCuaDriverRuntime` |
| CUA 在独立 utility process（`mavis-cua`）运行，macOS `--message-loop-type-ui`，generation fencing | `dist/main/modules/local-runtime/computer-use/index.js`（utilityProcess.fork、MessageChannelMain、`[CuaUtility]` 日志） |
| 17 个 computer_* 工具及完整 schema | `node_modules/@mavis/local-runtime-v2/src/service/computer-use/tools.ts`（ACTIONS 常量表） |
| kind → 驱动工具映射（list_apps/list_windows/get_desktop_state/launch_app/bring_to_front/get_window_state/click/double_click/type_text/set_value/hotkey/press_key/scroll/invoke_menu/verify_state/set_window_frame/start_session） | `dist/main/modules/local-runtime/computer-use/cua-utility-server.js` `mapRequestToCuaTool`、`callCuaToolInSession` |
| 请求协议 `{version:1, requestId, kind, sessionId, generation, leaseId, payload}`；cua-cancel/cua-release | `node_modules/@mavis/local-runtime-v2/src/service/computer-use/client.ts`、cua-utility-server.js `handleRequestMessage` |
| 单会话 lease、观察类动作不占租约、lease TTL | cua-utility-server.js `isMutatingRequest`、`releaseLease`、`lease_acquire/lease_release` 日志 |
| macOS TCC 双权限（屏幕录制+辅助功能）+ 权限引导 IPC | `dist/main/modules/screenshot/permission.js`、`dist/main/ipc/cuPermission.ipc.js`、cua-utility-server.js `cua-permissions-request` 往返 |
| UI 安全示能：桌面遮罩条+停止按钮、指针动画（不读不动真实光标）、窗口级预览、窗口焦点交还、防休眠 | `cua-overlay.js`（STOP_URL=`https://computer-use.invalid/stop`，点击→`POST /minimax-desktop/api/v1/session/:id/abort`）、`cua-pointer.js`、`cua-preview-target.js`、`cua-window-handoff.js`、`index.js updateCuaActivity` |
| background/foreground 双交付、background 拒绝不自动升级 | cua-utility-server.js `callCuaToolWithDeliveryMode`、`shouldAvoidNativeBackgroundClick` |
| 结果信封：文本+image 块（≤7MB fail-closed）、无截图/无效果提示注入、details.structuredJson | `service/computer-use/client.ts` `computerUseToolResult`、`trustedResultImages`、`missingClickEffectGuidance` |
| 启用门 = 官方插件 computer-use + hostCapabilities 'computer-use' + 会话级选择 | `service/computer-use/initialize.ts`、`session-selection.ts` |
| 官方插件清单与 binding | `~/.minimax/v2/plugin-cache/official/sha256-tree-v1-b9fdb15…/.minimax-plugin/plugin.json`（电脑操控 v1.0.1）、`bindings/computer.binding.json`（computer.use v1、interactive）、`skills/computer-use/SKILL.md`（明言适配官方 CUA Driver 0.22.1 skill） |
| CU 专用轮转日志 | `dist/main/utils/computer-use-log-writer.js` |

## C. Browser Use

| 结论 | 证据 |
| --- | --- |
| 嵌入式浏览器 = WebContentsView（Electron 30+） | `dist/main/modules/browser/controller.js`（中文注释"管理嵌入式 WebContentsView"） |
| CDP 观察域：DOM.getDocument / Accessibility.getFullAXTree 等 | `node_modules/@mavis/browser-core/src/cdp-helper.ts` 头注释与类型（CDP* 系列类型、DOM/Runtime/Network/Accessibility 调用） |
| 统一 browser 工具 24 action + 输入契约 | `node_modules/@mavis/agent-tools/src/desktop/builtin-browser-defs.ts`（`LOCAL_BROWSER_ACTION_NAMES`、`LOCAL_BROWSER_ACTION_INPUT_CONTRACTS`、LocalBrowserToolDef 长描述） |
| 13 个细粒度 browser_* 工具 schema | 同上文件 780-1006 行 |
| compact/full 暴露与 provider 导航指引 | `desktop/local-browser.ts`（exposure、`browserProviderNavigationGuidance`：electron-file-panel / native-headless-chrome 两分支） |
| 文本输入超时预算（delay×字符 + CDP 事件×20ms + 30s） | `dist/main/modules/browser/embedded-browser-tool-runtime.js`（VERIFIED_FILL_*、TEXT_INPUT_* 常量、INPUT_DURATION_EXCEEDS_DEADLINE） |
| Skill 前置门 + 独占 step 强制 + SKILL_REQUIRED | `service/browser-use/policy.ts`（`createBrowserSkillExclusiveStepHook`）、skill 资产 `assets/agents/mavis/skills/control-in-app-browser/SKILL.md`（全文） |
| requiredNextTool=ask_user 硬门、BROWSER_PLUGIN_MANAGED、受信任来源校验 | `service/browser-use/policy.ts` `createBrowserUseTurnToolSafetyGuard` |
| kill switch（吊销后零 I/O） | `service/browser-use/browser-use.service.ts` `createLiveBrowserUseAdapter` |
| 上传路径白名单（当前轮附件/活动工作区，含 symlink 解析） | `service/browser-use/workspace-assets.adapter.ts`、skill 文本、builtin-browser-defs.ts `paths` 描述 |
| 元素映射缓存落盘 | `browser-core/src/element-map-manager.ts`（`element-map-${domain}-${hash}.json`）；`~/Library/Application Support/MiniMax/browser-cache/element-maps/` |
| 会话级 tab 持久化 | `~/Library/Application Support/MiniMax/embedded-browser-tabs.json`（registry v2、persistentTabId、navigationHistory） |
| headless provider 本机无启动代码（推断属 TUI/云端） | `grep -r headless /tmp/mm-asar/dist/main` 仅命中 document-preview/libreoffice；`grep -rln 'native-headless-chrome'` 仅 agent-tools 定义与 browser-core 注释 seam |
| chrome-devtools-mcp 官方插件（1.8.0，stdio，29 工具） | `~/.minimax/v2/plugin-cache/official/sha256-tree-v1-9c07770…/chrome-devtools-mcp.mcp.json`、`plugin.json`；`~/.minimax/mcp-runtime-names.json`（工具全名单） |
| browser 官方插件 binding | `~/.minimax/v2/plugin-cache/official/sha256-tree-v1-74e227d…/bindings/browser.binding.json`（browser.use v1、mcp_browser 由宿主适配器改名） |
| 宿主侧 capability 适配器（computer_/browser 改名绑定） | `local-runtime-v2/src/service/turn-system/agent-host/assembly/host-capability/{computer,browser,registry}.ts` |

## D. Agent 内核 / 协议 / 云端

| 结论 | 证据 |
| --- | --- |
| Anthropic Messages 协议 | `@mavis/local-runtime/src/model-provider/minimax-api.ts`（`MINIMAX_API_FORMAT='anthropic-messages'`，默认 baseURL api.minimaxi.com / api.minimax.io）；`@mavis/config/src/config.ts` PRESET_BASE_URLS（agent.minimax.{cn,io}/mavis/api/v1/llm/v1） |
| pi 框架内核（Anthropic tool_use/tool_result 原生） | `node_modules/@earendil-works/pi-ai/package.json` 0.79.1、`dist/providers/anthropic.js`（tool_use/tool_result 编码）；`@earendil-works/pi-agent-core`（agent-loop/harness） |
| RuntimeTool 契约（typebox、executionMode、prepareArguments） | `@mavis/agent-core/src/tools/types.ts`（中文注释详细说明 ToolDefinition/ToolImpl/RuntimeTool） |
| 内置工具族与 Claude Code 同构 | `@mavis/agent-tools/src/desktop/builtin-defs.ts`（read/write/edit/bash/grep/glob/todowrite/skill/code_review/memory/ask_user/request_feature_enable/web_fetch/task/task_append/task_query/task_output/task_stop/mavis） |
| `computer_` 前缀跨原生/MCP 归一 | `@mavis/agent-tools/src/desktop/canonical-tool-policy.ts`（`isComputerUseRuntimeToolName`） |
| MCP 支持 + tool_search 延迟披露 | `@mavis/agent-tools/src/mcp-disclosure/`（bounded-tool-search.ts、tool-search.ts、hint.ts） |
| opencode 兼容/迁移痕迹 | `@mavis/local-runtime/src/legacy-opencode/*`（migration-records、pi-seed 等）；`~/.minimax/config.yaml` provider 段（opencode 风格，`npm: '@ai-sdk/anthropic'`，MiniMax-M2.7/M3/M3.1-Flash-Preview 模型表） |
| Matrix 云端与区域端点 | `@mavis/local-runtime/src/matrix/matrix-env.ts`（matrix-test/matrix-overseas-*.xaminim.com；prod agent.minimax.cn / agent.minimax.io；legacy agent.minimaxi.com） |
| 云端多模态工具（images/videos/voice…） | `@mavis/agent-tools/src/cloud/matrix-tools/tool-defs.ts`（images_understand、image_synthesize、submit_video_generation 等） |
| mcode-tools 连接器 CLI（App/Connector 目录走云端） | `~/.minimax/.builtin-skills/mcode-tools-master/SKILL.md`；`~/.minimax/integrations/mcode-tools/cn/`（空目录占位） |
| 本地沙箱运行时 | `node_modules/@minimax/mcode-sandbox-runtime/package.json`（"MCode Sandbox Runtime for internal process isolation"，bin: srt） |
| 手机遥控桌面（RC WebSocket，事件帧/权限回执/ composer 模式） | `@mavis/remote-control-bridge/docs/{EVENT-FRAMES,EVENT-UPSTREAM-DESIGN,RECONNECT-CREDENTIAL-DESIGN}.md`、`~/Library/Application Support/MiniMax/remote-control/state.json` |
| 消息通道路由（飞书/Telegram/微信 → agent mavis） | `~/.minimax/channel-routes.yaml`、`~/.minimax/channel-bindings.yaml` |
| 本地运行时 HTTP API | `dist/main/modules/local-runtime/index.js`（`DESKTOP_SERVICE_API_PREFIX='/minimax-desktop/api'`、默认端口 3100、127.0.0.1） |
| 内置多智能体（explore/mavis/verifier/worker） | `~/.minimax/agents/.builtin/`；`@mavis/local-runtime-v2/assets/agents/{builtin-agents.json,worker/*}` |
| 技能生态 | `~/.minimax/.builtin-skills/`（docx/pdf/pptx/xlsx/deep-research/visual-page/…）；`~/.minimax/skills/ego-browser -> ~/.local/share/ego/ego-skills`（用户自装） |

## E. 未在本机发现的能力（负结论）

- 云端沙箱浏览器/VNC 式远程浏览器：**未发现**（BU/CU 均本地；云端 Matrix 工具面为多模态生成/检索类）。
- Anthropic 官方 `computer-use` beta 工具类型（`computer_20250124` 等）或 beta header：**未发现**（pi-ai anthropic provider 无引用）。
- CU/BU 的"远程输入注入"事件帧（RC 桥只遥控会话/权限/消息）：**未发现**。
- 桌面端 `native-headless-chrome` provider 的启动代码：**未在本机发现**（仅定义与 provider 中立接口）。
- Set-of-marks 式编号圆圈标注（CU 侧）：**未发现**；CU 用 AX element_token + 指针动画，BU 用可交互元素快照 + 不透明 ref。

## F. 方法与合规说明

- 解包：`npx @electron/asar extract` → /tmp/mm-asar（555MB）；未修改 /Applications 下任何文件。
- 凭据：`~/.minimax/auth/`、token 字段均未读取明文；本文档引用的配置已脱敏（channel-routes projectKey、config token 等）。
- 会话内容（`~/.minimax/sessions`、background-tasks）未读取，避免触及用户数据。
- 专有源码引用：所有引用 ≤10 行/处，且以分析说明为目的。
