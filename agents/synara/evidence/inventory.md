# Synara 证据清单（inventory）

> 全部条目为只读静态取证所得。`main.js` 指 `/tmp/synara-analysis/app/apps/desktop/dist-electron/main.js`（解包自 `Contents/Resources/app.asar`，SHA256 见 Info.plist `ElectronAsarIntegrity`）；`index.mjs` 指 `/tmp/synara-analysis/app/apps/server/dist/index.mjs`；`$R` 指 `Contents/Resources/`。

## A. 产品判定

| # | 结论 | 证据（路径 / 命令） |
|---|---|---|
| A1 | bundle id `com.emanueledipietro.synara`，版本 0.9.2，分类 developer-tools，最低 macOS 12 | `plutil -p $R/../Info.plist`（CFBundleIdentifier / CFBundleShortVersionString / LSApplicationCategoryType / LSMinimumSystemVersion） |
| A2 | Electron 应用 | 同上 Info.plist：`NSPrincipalClass = AtomApplication`、`ElectronAsarIntegrity`（app.asar SHA256 `3f60cf26…`） |
| A3 | Electron 43.4.1 / Chrome 150.0.7871.224，arm64 | `plutil -p "$R/../Frameworks/Electron Framework.framework/Resources/Info.plist"`（CFBundleVersion 43.4.1）；`strings "…/Electron Framework"` → `Chrome/150.0.7871.224 Electron/43.4.1`；`codesign -dv` → `Mach-O thin (arm64)` |
| A4 | Developer ID 签名，Team `HR24WHR326`，硬化运行时，签名时间 2026-09-26 | `codesign -dv /Applications/Synara.app`（TeamIdentifier、flags=0x10000(runtime)） |
| A5 | 作者 Emanuele Di Pietro（独立开发者），更新走 GitHub `Emanuele-web04/synara` releases | Info.plist `NSHumanReadableCopyright = "Copyright © 2026 Emanuele Di Pietro"`；`app/package.json`（author、synaraSourceTag v0.9.2、synaraCommitHash）；`$R/app-update.yml`（owner/repo/provider: github） |
| A6 | 官网/文档域 trysynara.com；多 provider 定位 | index.mjs 内嵌文档链接 `https://trysynara.com/docs/providers/{claude-code,codex,cursor,opencode,pi,omp,grok,factory-droid,devin,antigravity}` |
| A7 | 内嵌 agent 运行时：claude-agent-sdk 0.3.259（含 201MB `claude` CLI 原生二进制）、pi 系 0.87.1（@earendil-works）、@opencode-ai/sdk 1.18.31、@agentclientprotocol/sdk 1.2.1 | `app/package.json` dependencies；`app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/`（claude 二进制 201,396,640 B） |

## B. CU 能力

| # | 结论 | 证据 |
|---|---|---|
| B1 | 引擎 cua-driver v0.28.2，Cua AI Inc.（MIT），Rust 1.97.1，arm64，33,095,088 B | `$R/cua-driver/provenance.json`（version/source/nativeRevision 39/patched true/patchSha256/binarySha256）；`$R/cua-driver/LICENSE.txt`；`ls -l $R/cua-driver/` |
| B2 | 宿主以 `serve --embedded --socket <unix sock>` 托管；env 关遥测/自更新、设观察节奏 100/350ms、`CUA_DRIVER_HOST_BUNDLE_ID`、`CUA_DRIVER_PERMISSION_MODE=standard` | main.js:1601-1636（spawn 调用与 env 对象） |
| B3 | 传输为随机命名 Unix socket `driver-<uuid>.sock`（Windows 命名管道 `\\.\pipe\synara-cua-driver-*`）；metadata 握手校验 `synara_native_revision` | main.js:1603、1691 附近（endpoint 构造与 80 次 metadata 重试） |
| B4 | 孤儿驱动清理：扫描 `cua-driver serve --embedded` 进程，宿主 pid 已死即 kill | main.js:652-674（正则匹配 + `killed orphaned cua-driver` 日志） |
| B5 | 宿主工具面：CUA_READ_TOOLS 14 项 / CUA_ACTION_TOOLS 18 项 / CUA_BROWSER_TOOLS 9 项 | main.js:233-248、249-268、280-290（Set 字面量） |
| B6 | 原生注入/观察 API：CGEvent 系（鼠标/滚轮/键盘/窗口）、ScreenCaptureKitBridge、AXShowMenu/AXRole、跨平台 UIA/AT-SPI/DXGI | `strings $R/cua-driver/cua-driver`（`CGEvent::new_mouse_event(up) failed`、`CGEventCreateScrollWheelEvent2 failed`、`ScreenCaptureKitBridge`、`cua-sck-window-capture`、`AXShowMenu`、`ax_capability (via UIA)` 等） |
| B7 | OS 授权三件套 accessibility/screenRecording/inputMonitoring；授权提示语与 Info.plist 一致 | main.js:14918-14927（`ComputerPermission` Literal schema 与注释）；Info.plist `NSAccessibilityUsageDescription = "Synara controls the windows you authorize for Computer use."`、`NSScreenCaptureUsageDescription` |
| B8 | deliveryMode 为宿主信封元数据，模型不可指定 | main.js:334-337 注释原文 "`deliveryMode` is trusted host-envelope metadata … never a native argument or a model-supplied override" |
| B9 | 前台授权引擎：可见使用正则族（英/意）、后台倾向短语否决、肯定回复确认、批准卡、2 秒用户安静期、授权屏障（continue 不能新建授权） | index.mjs:2820-2964（`computerVisibleUse.ts` 全模块：VISIBLE_USE_PATTERNS/BACKGROUND_USE_PATTERNS/`COMPUTER_USER_INTERACTION_QUIET_MS = 2e3`/`computerForegroundAuthorizationForMessages`） |
| B10 | Space 指定需整句 `use the space id N for this task` | index.mjs:2967-2987（`messageDesignatesComputerSpaces`） |
| B11 | 能力域 `computer:control`；线程不得向子任务委托计算机控制 | index.mjs:7181-7182（`Computer control requires the explicit "computer:control" scope.`、`Threads cannot delegate computer control to tasks they create.`） |
| B12 | 人接管：仅前台在途动作被物理输入打断；takeoverTargets + 重新观察；后台不受人输入影响 | main.js:2037-2075（`physicalInput` 与前置注释） |
| B13 | 物理 Escape 急停：appsnap-helper `--escape-monitor` 专职进程，仅活跃 generation 时武装 | main.js:2083-2094（`updateInputMonitorArmed`）、33312/33416（spawn `--escape-monitor`）；helper strings `--escape-monitor`、`--release-held-input`、`--computer-frames`、Input Monitoring 文案 |
| B14 | activation shield 协议：engage/release/release_all，frame+window_id+pid 校验 | cuaDriverHostStandalone.js:29-70（CUA_SHIELD_ID_PATTERN/几何上限/parseCuaShieldArgs）；main.js:1138-1180（handleShield） |
| B15 | LLM 工具名（computer_* 读 13 + 变更 20）与批准集合 | index.mjs `name: "computer_*"` 定义块（21764-22093 等）；index.mjs:19635-19656 `COMPUTER_APPROVAL_REQUIRED_TOOLS` |
| B16 | 审计日志记录批准类工具 + computer_read_clipboard（"log exists for abuse review"） | index.mjs:19660 附近注释 |
| B17 | agent 光标/焦点恢复：`--compact-cursor --idle-hide-ms`、stderr 事件 `synara_cua_overlay_init`/`synara_cua_focus_restore` | main.js:1605-1609、1653-1661 |
| B18 | AppSnap（Option 双键抓窗入聊天） | helper strings：`OptionChordMonitor`、`leftOptionIsDown`、`rightOptionIsDown`、`Input Monitoring permission is required to watch both Option keys.` |
| B19 | 引擎自带独立 CLI/MCP/守护模式/skill packs（含 zcode）/加密 Computer History | cua-driver strings：`Usage: cua-driver [SUBCOMMAND]`、`Subcommands: mcp, list-tools, … history`、`One of: claude, codex, …, zcode` |

## C. BU 能力

| # | 结论 | 证据 |
|---|---|---|
| C1 | betterwright 2.7.3 随包（MIT，github.com/BetterWright/betterwright），自述 policy-guarded Playwright for AI agents | `app/node_modules/betterwright/package.json:2-5`；`NOTICE.md` |
| C2 | LLM 工具族 `browser_*` 13 项（status/tabs/open/navigate/back/forward/reload/resize/screenshot/logs/upload/run/close） | `apps/server/dist/MigrationBackup-0KuIxbjo.mjs:7994-8008`（BROWSER_TOOL_NAMES） |
| C3 | 集成浏览器控制免用户批准 | index.mjs:8704（browser_status 描述 "Integrated browser control requires no user authorization prompt."） |
| C4 | BetterWright 库实例化参数：downloadPolicy deny、credentialCapture false、vault false、headless false、NetworkPolicy allowLoopback | main.js:29448-29459 |
| C5 | CDP 桥：`contents.debugger.attach("1.3")` 包装面板 WebContents；PAGE_DOMAINS 白名单（含 WebMCP）；FORBIDDEN_METHODS 黑名单（cookie/证书/下载行为/Page.close） | main.js:27033-27120 |
| C6 | browser_run 凭据红线与不信任页面数据指令 | index.mjs:8715（BROWSER_TOOL_INSTRUCTION_COPY.browser_run 全文） |
| C7 | BetterChromium 153 固定 fork，setup/update 下载、SHA-256 pin；Synara 侧 `browser-engine/browser/{profile,runtime}` 目录为空（本机未安装） | `betterwright/docs/chromium-fork.md`；`find ~/Library/Application Support/synara/browser-engine`（仅空目录） |
| C8 | cua-driver CDP 家族 LLM↔驱动名映射（computer_browser_* → browser_*/get_browser_state） | MigrationBackup-0KuIxbjo.mjs:13266-13276（COMPUTER_BROWSER_DRIVER_NAMES） |
| C9 | windowed:true 需前台授权（spaceBroker.assertForegroundAllowed + 强制 foreground 投递） | index.mjs:18069-18082（browserCall） |
| C10 | 无可见授权拒绝语；tab_id 缺失时 bind 结果本地解析，否则 browser_tab_required | index.mjs:23143-23145、23160-23200 |
| C11 | existing_profile 附加安全链：pid/window_id 批准锚点、capability manifest、端点归属持续重验 | cua-driver strings：`strategy=existing_profile requires an exact pid approval anchor`、`…exact window_id approval anchor`、`the process is no longer proven to be the approved embedded browser host`、`the DevTools endpoint transport changed since binding` |
| C12 | Chrome 调试端口限制的官方绕行提示（launch_app + cdp_debugging_port + 独立 user-data-dir） | cua-driver strings（"Chrome refuses to open --remote-debugging-port on its default data directory…"） |
| C13 | cookie 导入：来源 chrome/safari/edge；site 域需与面板可见 origin 匹配；profile 域需 confirmed；人操作互斥、导航/销毁/60s 超时中断 | main.js:27650-27730（SOURCES/BrowserCookieImport） |
| C14 | 上传 staging 限额（单次 256MB / 每 WebContents 512MB / 64 目录 / 512 文件） | main.js:29508-29516 |
| C15 | 面板独立分区 Partitions/synara-browser；WebMCP guest 桥 | `~/Library/Application Support/synara/Partitions/`；guestPreload.js `#region src/browserWebMcp/guestBridge` |
| C16 | rookie-cookies 0.6.0（Rust NAPI）随包 | `app.asar.unpacked/node_modules/rookie-cookies-darwin-arm64/package.json` |

## D. 其他组件与传输

| # | 结论 | 证据 |
|---|---|---|
| D1 | iOS 模拟器驱动 device-helper：源码随包（Swift/ObjC），CoreSimulator+SimulatorKit 私有 API dlopen，JSON-RPC over stdio，H.264 Annex B 帧过 Unix socket（magic 0x5346），tap/swipe/key/text/button/screenshot/describe-ui（AXPTranslator 全量 AX 树） | `$R/device-helper/HEADER.md`（全文含协议表与帧格式）；`$R/device-helper/Sources/`（AXBridge.m/HIDBridge.m/FrameStream.swift/CoreSimulatorBridge.swift 等）；build.sh（用户 Xcode 现场编译，缓存于 `~/Library/Caches/synara/device-helper/<build>/`） |
| D2 | 服务端本地监听 127.0.0.1 + WebSocket 引导路径；本地 UI 由 apps/server/dist/client 提供 | index.mjs:92、138-181（listen/loopback 探测）、75000（DEFAULT_HOSTNAME="127.0.0.1"）；`apps/server/dist/client/assets/*` |
| D3 | 静态可见云端点（未抓包）：opencode.ai/zen/v1、pi.dev、openrouter.ai/api/v1、cloudcode-pa.googleapis.com/v1internal、chatgpt.com/backend-api/transcribe、platform.openai.com/usage、server.codeium.com、registry.npmjs.org、trysynara.com、synara-beta-diagnostics.kartik-9f9.workers.dev | `grep -ohE 'https://…' index.mjs main.js` 统计 |
| D4 | ATS 例外：localhost/127.0.0.1 明文 HTTP + NSAllowsLocalNetworking（服务本机 CDP/本地回环） | Info.plist NSAppTransportSecurity |
| D5 | 本地数据目录：`~/Library/Application Support/synara/`（Electron profile、Partitions/synara-browser、browser-engine、appsnap/tmp、private-runtime/browser-upload-staging、static-snapshots）；`~/Library/Caches/synara/`（device-helper） | 目录列举（本机实存） |
| D6 | cua-driver 遥测/自更新被宿主环境变量禁用 | main.js:1626-1627（CUA_DRIVER_RS_TELEMETRY_ENABLED=0、CUA_DRIVER_RS_UPDATE_CHECK=0） |

## E. 证据强度分级

- **直接证据**（解包 JS 模块、随包源码/文档/清单、二进制 strings、签名/plist）：A1-A7、B1-B18、C1-C14、C16、D1-D6。
- **推断**（已标注）：CU 引擎补丁的具体差异内容；rookie-cookies 的直接调用方；BetterChromium 未安装状态下的行为回退；`computer_browser_press` 经 `browser_type` 通道的语义；云浏览器 provider 未被 UI 暴露。
- **未验证**：任何运行时行为（未启动应用、未抓包、未触发 TCC 弹窗）。
