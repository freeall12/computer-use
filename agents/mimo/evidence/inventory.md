# 证据清单（Evidence Inventory）— Xiaomi MiMo

> 本文件记录逆向结论 → 证据路径的映射。解包产物 `/tmp/mimo-asar` 来自 `/Applications/Xiaomi MiMo AI.app/Contents/Resources/app.asar`（100,967,240 字节；SHA256 完整性校验值见 Info.plist `ElectronAsarIntegrity` = `c325be00…dffcb`）。仅只读分析，未运行被分析对象、未抓包、未触碰凭据、未复制任何专有源码文件入仓。

## A. 应用标识与版本

| 结论 | 证据 |
| --- | --- |
| 应用 `Xiaomi MiMo AI`，`com.xiaomi.mimo.desktop-ai`，版本 26.914.142245，URL scheme `xiaomi-mimo-ai`，分类 developer-tools | `/Applications/Xiaomi MiMo AI.app/Contents/Info.plist`（CFBundleIdentifier/ShortVersionString/CFBundleURLSchemes/LSApplicationCategoryType） |
| Electron 应用，内部包名 `xiaomi-mimo-desktop-ai`，描述「Xiaomi MiMo 桌面客户端 — 集成 AI 编程助手的智能开发工具」，包管理器 bun 1.3.14，主入口 `out/main/launch.mjs` | `app.asar::package.json`（/tmp/mimo-asar/package.json） |
| 签名团队（宿主 app 未逐一验证；CU 伴生 app 已验证） | `codesign -dv ~/Applications/MiMo Computer Use.app` → TeamIdentifier `DG75VEYT9V`，flags `0x10000(runtime)`（Hardened Runtime），Timestamp 2026-09-05（公证时间戳） |
| 数据目录 | `~/Library/Application Support/Xiaomi MiMo AI/`（Electron userData）、`~/Library/Application Support/MiMo Automation/`（自动化运行时根）、`~/.config/mimocode/`（MiMoCode 引擎用户配置）、`~/Library/Application Support/MiMo Computer Use/`（锁屏操作 opt-in 状态） |
| 命名防混淆：`~/.config/mimocode/` 属小米 MiMo（MiMoCode），与 MiniMax 无关；与小米开源 MiMo reasoning 模型同产品线但本分册对象是本机应用产品 | 本目录结构（mimocode.jsonc 的 `$schema: https://mimo.xiaomi.com/mimocode/config.json`）；MiniMax 分册证据清单 A 节的排除说明 |

## B. 产品形态与宿主引擎（MiMoCode）

| 结论 | 证据 |
| --- | --- |
| 完整 Agent IDE（壳内嵌自研编码引擎），非套壳 | `mimo-desktop-guide` SKILL.md（/tmp/mimo-asar/electron/lib/engine/skills/mimo-desktop-guide/SKILL.md）：产品三工作流（coding agent / 日常对话 / Office 文件助手）、Projects/Git/Terminal/权限审批/自动化任务/插件市场 |
| 引擎名 MiMoCode；宿主进程打包于 `out/main/node.mjs`（47 个 mjs 主进程产物之一） | `/tmp/mimo-asar/out/main/node.mjs` 中 `MiMoCode` 出现 115 次；`engine-entry.mjs`、`engine-tools/` 目录 |
| 双协议模型访问：Anthropic Messages（`v1/messages` + `anthropic-version`/`anthropic-beta` 头 52 次）与 OpenAI（`chat/completions` 44 次） | `/tmp/mimo-asar/out/main/node.mjs` 字符串统计；`/tmp/mimo-asar/electron/prompts/` 下并存的 `claude.txt`（12KB）与 `gpt.txt`（18KB）双适配 prompt |
| 模型 ID：`xiaomi/mimo-v2.5`、`mimo-v2.5-pro`、`mimo-v2-pro`、`mimo-v2-flash`、TTS 系列 | `/tmp/mimo-asar/out/main/node.mjs` 字符串统计（xiaomi/mimo-v2.5 ×22、mimo-v2.5-pro ×43） |
| 引擎工具面：Read/Write/Edit/Bash/Glob/Grep/WebSearch、`task`、`actor`（spawn/run 子代理）、`ask`、`js`（自动化 REPL）、会话协作工具 | `/tmp/mimo-asar/electron/prompts/claude.txt`（工具使用章节）；engine-config/tools/ 15 个工具脚本（`~/Library/Application Support/Xiaomi MiMo AI/engine-config/tools/`：create_session、update_session、talk_to_session、contacts、list_external_sessions、read_external_session、image_gen、image_edit、asr_transcribe、tts_speech、pdf_locate、present_files、get_desktop_settings、set_desktop_setting、automation_update） |
| 会话协作工具语义（contacts/create_session/talk_to_session sync·async/外部 agent 会话读取，外部 agent 例为 Claude Code） | `/tmp/mimo-asar/electron/lib/engine/skills/session-chat/SKILL.md`（全文） |
| 托管运行时注入：`MIMO_PYTHON`/`MIMO_SOFFICE`/`MIMO_QPDF`/`MIMO_RIPGREP_PATH`/`MIMO_NODE`/`MIMO_NPM`/`MIMO_NODE_MODULES` | `/tmp/mimo-asar/electron/prompts/desktop-base.md`「Managed runtimes」章节 |
| 引擎为 Claude Code 工具协议同构端（prompt 形态、工具命名、AGENTS.md/skill 体系一致；自研运行时） | `/tmp/mimo-asar/electron/prompts/claude.txt` 开头「You are MiMo agent, built on MiMo's Desktop」+ CC 式章节结构（System/Doing tasks/Executing actions with care/Tone and style） |
| 自进化 Agent 雏形「evolve」随包分发（Python harness，非 CU/BU 组件） | `/Applications/Xiaomi MiMo AI.app/Contents/Resources/evolve-seed/`（AGENTS.md/README.md/bootstrap.py/harness/instance） |

## C. Computer Use

| 结论 | 证据 |
| --- | --- |
| CU 本体 = npm 包 `@mi/mimo-computer-use` **0.7.11**，自述「Cross-platform computer-use MCP server … **inspired by Codex Desktop's sky executor**. Pluggable into any MCP-capable agent」，发布到小米内部 registry `https://pkgs.d.xiaomi.net/artifactory/api/npm/mi-npm/`（restricted） | `~/Library/Application Support/MiMo Automation/Runtime/0.7.11/products/computer-use/node_modules/@mi/mimo-computer-use/package.json`（name/version/description/publishConfig；下称 CU 包根） |
| 明确对标 OpenAI Codex Desktop 的 clean-room 复刻：「reproduces OpenAI Codex Desktop's computer-use capability」；Codex `SkyComputerUseClient` 仅作只读 A/B 基线（`~/.codex/computer-use/...`）；`codex-parity.js`/`codex10.js` 为 A/B fixture；README 有专节「vs Codex」与「Codex-parity note」 | CU 包根 `README.md`（头部、Architecture 表、Tools reference、vs Codex 节） |
| 模型可见工具面 = **1 个持久 `js` REPL 工具**，`tools/list` 恰为 `["js"]`，参数 `{code, title?, description?, timeout_ms?}`；内核预注入 `@mimo/sky`（桌面）与 `@mimo/browser-use`→`agent`（浏览器） | CU 包 `dist/node-repl.js`（tools/list 与参数校验字符串，`"js", args, ["title", "description", "code", "timeout_ms"]`；`globalThis.sky = (await import("@mimo/sky")).sky` 注入逻辑）；README「MCP entry point」节 |
| `@mimo/sky` 门面 10 方法完整 TypeScript 签名：list_apps/get_app_state/click/drag/perform_secondary_action/press_key/scroll/select_text/set_value/type_text；SkyState（screenshot.unchanged/targetWindow/action.dispatchStatus/axRevision 等） | 宿主已装技能 `~/.config/mimocode/skills/mimo-computer-use/mimo-computer-use/SKILL.md`「Public API」节（140-224 行）；与 CU 包 README 10-tool 表一致 |
| macOS 原生引擎 **sky-mac**（Swift）：免聚焦 AX 树、per-pid CGEvent、`AXManualAccessibility`（Electron/Chromium 穿透）、SkyLight 私有 SPI（`SLEventPostToPid` + activate-without-raise）坐标点击不抬窗、ScreenCaptureKit 窗口级截屏、capture-excluded 虚拟光标 overlay | CU 包 `README.md`「Its distinguishing pieces」与 Architecture 表（src/sky-mac.ts、native/sky-mac、native/window-capture-macos、native/cursor-overlay-macos 条目） |
| 输入兜底 nut.js（`@nut-tree-fork/nut-js` ^4.2.0）、截图兜底 screenshot-desktop + sharp；依赖 `@modelcontextprotocol/sdk` ^1.0.4、zod；optional playwright 1.61.1 | CU 包根 `package.json` dependencies |
| Windows 清洁室 **Window2** 后端：HWND 定位、窗口捕获、UIA 状态、语义 UIA 动作、前台 SendInput 兜底、文本选择；windows-helper/recorder/product-manager 三个原生 exe | CU 包 README Architecture 表「Windows」行 + package.json `files`（native/windows-helper/mimo-computer-use.exe 等） |
| 原生伴生 app `MiMo Computer Use.app`（`com.xiaomi.mimo.computeruse` 0.7.11）：持 TCC（辅助功能+屏幕录制），内含 MiMoComputerUseAgent、Helpers/{window-capture,lock-state,lock-curtain,lock-guardian}-macos、Resources/cursor-overlay-macos、PlugIns/CCULockUnlockAuthorizationPlugin.bundle、Library/LaunchServices/lockcontrol、Bootstrap/（MCP binder） | 本机实装 `~/Applications/MiMo Computer Use.app` 目录树（Contents/MacOS、Helpers、PlugIns、Library/LaunchServices、Resources/Bootstrap）；`codesign -dv`（TeamIdentifier DG75VEYT9V） |
| 严格启动校验：固定入口 `Computer Use/bin/mcp` 校验 `current` 符号链接落点、Info.plist 的 channel/namespace/bundleId（`stable:stable:com.xiaomi.mimo.computeruse`）、`codesign --deep --strict`、TeamIdentifier+Authority 钉死（`DG75VEYT9V:Developer ID Application: Beijing Xiaomi Co., Ltd (DG75VEYT9V)`）后 exec Bootstrap binder | `~/Library/Application Support/MiMo Automation/Computer Use/bin/mcp`（shell 脚本全文，die/校验/exec 序列） |
| 宿主接线：MiMo Desktop 把官方插件开关写进 `~/.config/mimocode/mimocode.jsonc` 的 `mcp.node_repl` 条目，命令 = `MiMo Automation/Launchers/bin/automation-repl`，环境变量 `MIMO_AUTOMATION_COMPUTER_USE_ENABLED` / `MIMO_AUTOMATION_BROWSER_USE_ENABLED` / `MIMO_PRESENTATION_HOST_SOCKET` | 本机 `~/.config/mimocode/mimocode.jsonc`（node_repl 条目全文）；`/tmp/mimo-asar/out/main/index.mjs`（`const z1="node_repl"`，开关→env 写入逻辑） |
| automation-repl 分发逻辑：CU 开→exec `Computer Use/bin/mcp node-repl`；否则回落 browser-replay 产品的 `@mi/mimo-computer-use/dist/node-repl.js` / `browser-mcp.js`；`MIMO_BROWSER_DEFAULT=iab` 由 Browser Provider descriptor 存在性决定 | `~/Library/Application Support/MiMo Automation/Launchers/bin/automation-repl`（shell 脚本全文） |
| 本机状态：CU 启用（env=1）、BU 关闭（env=0）、Browser Provider 目录为空（无 provider.json → IAB 未发布）、锁屏操作 opt-in 已开启 | mimocode.jsonc env；`~/Library/Application Support/MiMo Automation/Browser Provider/`（空目录）；`~/Library/Application Support/MiMo Computer Use/lock-control-enabled`（内容 `enabled`） |
| 锁屏操作（Locked use）安全边界：SecurityAgentPlugins 授权插件经固定 socket `/Library/Application Support/MiMo Computer Use/LockAuthorization/authorization.sock` 查询；内核审计 token + bundleId/TeamID/Developer ID 链/Hardened Runtime/无 get-task-allow 校验；1–20s 单调 TTL 一次性决策，物理输入/断连即撤销；46 秒准入隔离期 | CU 包 README「Locked use」节（Production behavior / Current security boundary）；`CCULockUnlockAuthorizationPlugin` bundle 实装于 `~/Applications/MiMo Computer Use.app/Contents/PlugIns/` |
| 安全门 CCU_SAFETY_MODE：off/prompt/smart/enforce 四档，enforce 走 MCP elicitation fail-closed；默认门控工具集 `click,drag,type_text,press_key,set_value,perform_secondary_action,select_text`；schema 无 confirm/risk 参数（Codex parity） | CU 包 README「Safety」节 + 环境变量表（CCU_SAFETY_MODE/CCU_CONFIRM_TOOLS 行） |
| 关键环境变量契约：CCU_MAX_IMAGE_DIM=1280、CCU_IMAGE_FORMAT=jpeg、CCU_JPEG_QUALITY=80、CCU_CURSOR_OVERLAY、CCU_LIVE_PREVIEW、CCU_DISABLE_SKYMAC、CCU_SAFETY_MODE 等；bootstrap-owned 内部绑定（CCU_SKY_AGENT_SOCKET 等）刻意不允许 host 配置 | CU 包 README「(b) Environment variables」表 |
| 技能三份（computer-use 全量档 / mimo-browser-use / record-and-replay-mimo-adapter）+ codex10/codex-parity 研究档 | CU 包 `skills/` 目录清单（7 个 SKILL.md） |
| Record & Replay（录制→Skill）第三产品线：`MiMo Record and Replay.app`（com.xiaomi.mimo.recordandreplay）+ mimo-record-and-replay 插件，本机未见实装 | CU 包 README 分发表（Release unit 表）；product-identities.json bundleIdentifiers；本机 `MiMo Automation/Applications/` 仅有 MiMo Browser Use.app |
| 产品身份契约（Apple teamId、10 个 bundleId、native messaging host 名） | CU 包 `product-identities.json`（schemaVersion 2，apple.teamId=DG75VEYT9V，browser.nativeMessagingHost=com.xiaomi.mimo.browser） |

## D. Browser Use

| 结论 | 证据 |
| --- | --- |
| BU 是同一 `js` 内核里的 `@mimo/browser-use` 模块：`agent.browsers` 对象图（get/getForUrl/getDefault/list），非离散 MCP 工具；「There are no separate browser_* tools」（离散 browser_* 为 legacy 兼容面：playwright 后端 22 个 / extension 后端 13 个，研究 fixture） | CU 包 `skills/mimo-browser-use/SKILL.md`（全文）；README「Legacy flat browser tools」节与 Codex-parity note |
| 四后端统一 Provider 契约：**iab**（宿主发布 Browser Provider descriptor + 私有 socket，宿主拥有 Electron 对象/cookie/认证 UI）、**extension**（用户真实 Chrome/Edge/Brave/Chromium）、**managed**（Chrome for Testing，`~/.mimo-browser-use/browsers`，MCP 启动绝不静默下载）、**cdp**（显式 raw endpoint） | CU 包 README「Browser Runtime backends」节；`dist/browser/provider-protocol.js`、`managed-chromium.js`、`raw-cdp-transport.js`、`public-cdp-policy.js` 等模块清单 |
| Browser Bridge = MV3 扩展 v0.7.11（permissions: debugger/tabs/scripting/nativeMessaging/bookmarks/history/downloads/tabGroups/webNavigation/alarms/storage；host_permissions `<all_urls>`），经 **Chromium Native Messaging**（host 名 `com.xiaomi.mimo.browser`）+ JSON-RPC 2.0 与本地 Node host 通信，CDP 1.3 走 `chrome.debugger`；拓扑 `MCP ──unix socket──► host ──Native Messaging──► extension ──CDP──► page`；不暴露 remote-debugging 端口 | `~/Library/Application Support/MiMo Automation/Browser Bridge/manifest.json`（全文）；`background.js` 头注释（HOST_NAME/JSONRPC_VERSION/DEBUGGER_VERSION/心跳/重连常量，PUBLIC_CDP_METHODS 白名单）；CU 包 README topology |
| Native messaging host 清单钉死两个 Web Store 扩展 ID：`hdegpkcbaiojkelbocodjnnaglojjlam`、`dbgblfpnkbjkklfekngphekkapoejffa`；宿主主进程内置商店链接 `https://chromewebstore.google.com/detail/browser-bridge/hdegpkcbaiojkelbocodjnnaglojjlam` 与 bundleId `com.xiaomi.mimo.browser` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.xiaomi.mimo.browser.json`（allowed_origins 两项）；`/tmp/mimo-asar/out/main/index.mjs`（`"com.xiaomi.mimo.browser"`, `jw="hdegpkcbaio…"`, `IN="dbgblfpnkbj…"`, `w1e=chromewebstore…`） |
| Node 侧 native host = `Launchers/bin/browser-native-host` → app 内置 Node 执行 `@mi/mimo-computer-use/dist/browser/host.js` | `~/Library/Application Support/MiMo Automation/Launchers/bin/browser-native-host`（shell 全文）；CU 包 package.json bin |
| 扩展侧呈现通道：pointer-transparent closed-Shadow-DOM 虚拟光标按需注入，等待 ≤1.5s 光标动画可观察后才发真实 CDP 输入；呈现失败不阻塞动作；非前台窗口的活动 tab 仍可观察 | CU 包 README「Extension-backed pointer operations」段；background.js CURSOR_ARRIVAL_TIMEOUT_MS=1500、CURSOR_CONTENT_SCRIPT |
| 桌面端 IAB 预览：宿主主进程开 `presentation-host/control.sock`（Unix socket，main 进程 `focusWebContents/prepareForWebContents`），经 `MIMO_PRESENTATION_HOST_SOCKET` 传给 MCP；独立宿主另有 native helper `browser-preview-macos` 每活动 tab 一个可拖拽预览面板（≤5fps/800px/JPEG，帧不进模型结果）；`MiMo Browser Use.app`（com.xiaomi.mimo.browseruse 0.7.11）为状态 GUI + 预览 helper 伴生 app | `/tmp/mimo-asar/out/main/index.mjs`（presentation-host socket 启动与 browser-window-focus 钩子）；CU 包 README「Codex-shaped browser previews」段；本机 `MiMo Automation/Applications/MiMo Browser Use.app`（Info.plist：CFBundleIdentifier=com.xiaomi.mimo.browseruse、版本 0.7.11、Helpers/browser-preview-macos） |
| 本机 BU 状态：插件曾尝试安装（automation-default-install.json 记录 2026-09-12 attempt），当前 env 关闭、无 provider.json → 判定「具备完整能力、本机未启用」 | `~/Library/Application Support/Xiaomi MiMo AI/automation-default-install.json`；mimocode.jsonc env；宿主技能目录仅有 `~/.config/mimocode/skills/mimo-computer-use/`（无 mimo-browser-use） |
| 浏览器轮次生命周期：宿主自动宣布 turn 完成（含取消/错误），host 负责 tab finalization（临时/重复 tab 回收、用户 tab 归还），无公开 tabs.finalize | CU 包 `skills/mimo-browser-use/SKILL.md` 末节「The configured MiMo host announces turn completion…」 |

## E. 传输与端点

| 结论 | 证据 |
| --- | --- |
| LLM 网关 `https://api.xiaomimimo.com/v1`；分区域 token-plan 网关 `token-plan-{cn,sgp,ams}.xiaomimimo.com/v1`（国区 cn） | `/tmp/mimo-asar/out/main/node.mjs`、`index.mjs` URL 字符串提取 |
| 开发者平台/控制台 `https://platform.xiaomimimo.com/`（含 console/plugin 插件市场路径）；下载页 `https://app.xiaomimimo.com/download`；产品官网 `https://mimo.xiaomi.com/coder/` | `/tmp/mimo-asar/out/main/*.mjs` URL 提取；asar package.json homepage |
| 内部 npm registry `https://pkgs.d.xiaomi.net/artifactory/api/npm/mi-npm/`（@mi scope，restricted） | CU 包 package.json publishConfig；README 安装节 |
| 资源 CDN `https://mimocode-cdn.xiaomimimo.com/`（query-classifier ONNX、音色 soundfont、LibreOffice 运行时等）；小米云存储 `https://mimocode.cnbj1.mi-fds.com/mimocode/mimocode` | `/tmp/mimo-asar/out/main/*.mjs` URL 提取 |
| 账号体系：小米账号 `account.xiaomi.com/pass/serviceLogin`、`api.account.xiaomi.com/pass/v2/safe/user/coreInfo`、`iauth.pt.xiaomi.com`；Google 登录页（google-login chunk） | `/tmp/mimo-asar/out/main/index.mjs`、`google-login-*.mjs` |
| 配置 schema `https://mimo.xiaomi.com/mimocode/config.json`（mimocode.jsonc `$schema`） | 本机 `~/.config/mimocode/mimocode.jsonc` 首行 |
| 内置第三方 MCP 集成（客户端内建远端 MCP 端点）：企查查 `agent.qcc.com/mcp/{case,company,document,executive,history,ipr,operation,regulation,risk,tender}/stream`、北大法宝 `apim-gateway.pkulaw.com/mcp-*`、bilibili API、github-mcp-server、lark-openapi-mcp、figma 本地 MCP 指引、notion MCP、playwright-mcp 引用 | `/tmp/mimo-asar/out/main/index.mjs` URL 提取（逐条可复核） |
| 更新：electron-updater（asar dependencies）；LLM 转发约束（prompt 声明内置工具/模型均经 MiMo 服务转发、外网 OpenAI API 直连不通） | `/tmp/mimo-asar/package.json`；`/tmp/mimo-asar/electron/prompts/desktop-surface.md`「网络约束」节 |

## F. 谱系

| 结论 | 证据 |
| --- | --- |
| CU/BU 运行时是对 **OpenAI Codex Desktop computer use** 的清洁室复刻（自称「inspired by Codex Desktop's sky executor」，暴露 Codex-shaped `js`/`agent.browsers` 面），无 OpenAI 二进制依赖 | CU 包 README 头部、License & provenance 节（「independently written implementation inspired by observed Codex Desktop behavior. The runtime does not depend on OpenAI binaries such as `@oai/sky`」） |
| 宿主引擎是 **Claude Code 工具协议同构端**（CC 式系统 prompt/工具命名/AGENTS.md/skill，双协议输出 anthropic-messages + openai），自研运行时非 fork | `/tmp/mimo-asar/electron/prompts/claude.txt`、`desktop-base.md`；node.mjs 协议字符串 |
| 插件 SDK `@mimo-ai/plugin` 0.1.14 为 **MIT 开源**（`github.com/XiaomiMiMo/MiMo-Code`，packages/plugin）；`@mi/mimo-computer-use` 本体为专有（internal registry restricted，无公开仓库） | `~/.config/mimocode/node_modules/@mimo-ai/plugin/package.json`（repository/license MIT/author Xiaomi MiMo Team）；CU 包 publishConfig |
| 与小米开源 MiMo 模型的关系：同属 XiaomiMiMo 产品线，应用通过 `xiaomi/mimo-v2.5` 等模型 ID 调用小米 MiMo 模型；本分册对象为本机应用，不覆盖开源模型仓库 | node.mjs 模型 ID；`@mimo-ai/plugin` repository org |
| 与 qwen 系无代码级关联（Qoder 分册确认的 qwen-code 引擎不在此应用出现）；与 trycua cua-driver 无关联（nut-tree-fork 是其唯一输入兜底依赖） | asar 依赖树无 qwen/cua-driver 痕迹；CU 包 dependencies（@nut-tree-fork/nut-js） |

## G. 置信度标注

- **高（直接文件证据）**：B/C/D/E 全部表格结论均有文件路径支撑；`@mi/mimo-computer-use` 0.7.11 的 README/package.json/dist 结构为本分册 CU/BU 章的一手依据。
- **中（推断，已标注）**：桌面端 IAB（WebContentsView）与 presentation-host socket 的完整交互细节（只读了主进程接线，未运行验证）；evolve 自进化 harness 与 CU/BU 的关系（判定为独立子系统）。
- **低（需复核）**：Chrome Web Store 上架状态与两扩展 ID 的现存对应关系；`mimo-v2.5` 系列模型与开源 MiMo 模型的版本对应；Windows 侧行为（本机为 macOS，全部来自包内文档与脚本）。
