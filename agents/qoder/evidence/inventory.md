# Qoder CU/BU 逆向证据清单

> 分析对象：本机安装的 Qoder 0.4.3（macOS arm64）。压缩 JS 为单行打包产物，行号无意义，故以"标记字符串 + 字节偏移 + 复现命令"定位（偏移基于 `npx @electron/asar extract` 到 `/tmp/qoder-asar` 后的 `out/main/index.js`，12,234,878 字节）。全部操作只读；未把任何专有源码文件或二进制复制进本仓库，正文引用每处 ≤10 行。

## 0. 已确认排除项

| 项 | 理由 |
|---|---|
| `/Volumes/YANG/qoder/QoderGateway/`（qoder2api、launcher 脚本） | 分析者自建的第三方网关项目，非 Qoder 产品组件 |
| `~/.qoder/qoder2api.db`（28KB，2026-09-20） | 同上项目的残留数据（推断：Qoder 产品数据均走 `main.sqlite`/`chat-session-turn-payload-buffer.sqlite`，无此命名） |

## 1. 软件版本与载体

| 项 | 值 | 证据 |
|---|---|---|
| 应用 | Qoder 0.4.3，`com.qoder.app`，URL scheme `qoder`/`qoder-app`，ElectronAsarIntegrity sha256 `81b2dfe9…` | `/Applications/Qoder.app/Contents/Info.plist` |
| package.json | name `qoder`，description "Qoder - Agent workbench for human and AI software teams"，main `./out/main/index.js`；依赖 `@ali/qoder-browser-use-sdk 0.4.0`、`@qoder-ai/qoder-agent-sdk`（npm:`@ali/qoder-agent-sdk-next@1.0.50`）、`@modelcontextprotocol/{client,node,server} ^2.0.0`、`@qoder-space/{workbench,editor-core,collaboration-*}`、node-pty、sharp、ws | `/tmp/qoder-asar/package.json`（源 `/Applications/Qoder.app/Contents/Resources/app.asar`，136,529,599 字节） |
| 技术栈判定 | **Electron 自研 workbench，非 VSCode fork**：无 product.json / `out/vs` 布局；workbench/editor 为 `@qoder-space/*` 私有包；Helper 四件套 + Squirrel/Mantle/ReactiveObjC（Electron 标配） | `ls /Applications/Qoder.app/Contents/Frameworks/`；`ls /tmp/qoder-asar/out/`（main/preload/renderer） |
| 用户数据 | `~/Library/Application Support/com.qoder.app.stable/`（Electron userData）；`~/.qoder/`（QODER_HOME：skills/plugins/projects/logs/ipc/host-actions/shell-snapshots/file-history/tasks） | 目录勘查 |
| 登录态 | `.qoder-app-status.json`：product `qoder`，version 0.4.3，logged_in true | `~/.qoder/.qoder-app-status.json` |
| IDE 产品分立 | entry 脚本寻找 bundle id `com.qoder.ide`（"Qoder IDE.app"，VSCode 兼容 remote-cli 语义），本机**未安装**；`qodercli` 亦未安装（`type -P` 空） | `~/.qoder/entry/qoder`（4150B bash，明文） |

## 2. agent 架构与端点

| 项 | 值 | 证据 |
|---|---|---|
| 本地 Runtime | `runtime:qoder` "Built-in local CLI"，placement local，protocolFamily qoder，capabilities `{resume,steer,fork,tools,permissions,skills,mcp}=true/batch=false`；本地 agent 锁定内置 qodercli（错误码 `LOCAL_AGENT_RUNTIME_LOCKED`，中文文案"本地 Agent 时只能使用平台内置 qodercli Runtime"） | `qoder-data.v1.json` runtimes/runtimeProfiles；index.js 偏移 ~5029098（`rme="runtime:qoder"`）、~5041198 |
| 云 Runtime | `runtime:qoder-cloud:*`；工具映射 `Idr={quest:yRe,questCn:yRe,qoderWork:pdr}`；qoderWork 面：`Bash/Read/Write/Edit/Glob/Grep/WebSearch/WebFetch/Skill/Agent/AskUserQuestion/Task→Agent/qw_mcp_call/qw_mcp_get/qw_mcp_list/TodoWrite/present/present_files/BashOutput/qoder_cron/run_preview/check_runtime/kill_bash/fetch_rules`；quest 面含 `CallMcpTool→mcp_call` | index.js 偏移 ~7077511（yRe）、~7081181（pdr）、~7082000（fdr 内置 server 前缀 `["browser-use","chrome-devtools","computer-use","genui","schedule"]`） |
| wire 协议 | `WIRE_PROTOCOL_VERSION="1.5.0"`；`HOST_ACTIONS=["copy_text","helpful","not_helpful","create_branch_task","copy_markdown","add_reply_to_task"]`；`QoderModelPurpose={Main,Plan,Task,Compact,Title,Suggestion,Generate,HookPrompt,Subagent,WebFetch,ImageGen,Compression,Utility}`；worker runtime 下发 `https://download.qoder.com/qodercli/releases/1.1.64/qodercli-worker-runtime-{target}.tgz` | `node_modules/@qoder-ai/qoder-agent-sdk/dist/protocol/index.js`、`dist/runtime-manifest.json`（qoderCliVersion 1.1.64） |
| 端点（静态记录） | prod：fast/security `api2.qoder.sh`、inference `api3.qoder.sh`、center `center.qoder.sh`、openapi `openapi.qoder.sh`；国区 `gateway.qoder.com.cn`/`openapi.qoder.com.cn`/`download.qoder.com.cn`；遥测 `btardsb9ml-default-sea.rum.aliyuncs.com`（ARMS RUM）；`api.qoder.com/api/v1/cloud` | `~/.qoder/.cache/endpoint-cache.json`、`qoder-client-endpoint-cache.json`；index.js 端点枚举 |
| 基础工具面 | `KHe=["Read","Write","Edit","Glob","Grep","Bash","WebSearch","WebFetch","ImageGen","NotebookEdit","TaskCreate","TaskList","TaskGet","TaskUpdate","TaskStop","ExitPlanMode","CreateGoal","GetGoal","UpdateGoal","AskUserQuestion","Skill","Agent"]` | index.js 偏移 ~5027800 |
| node_repl 服务 | 注册名 "node-repl"；内核 ≤8 会话/30min 闲置回收；turn 上下文经 `_meta["com.qoder/turnContext"]`；内核包在 `process.resourcesPath/node-repl`，子进程 `ELECTRON_RUN_AS_NODE=1 --no-warnings --experimental-vm-modules`，env 注入 `QODER_HOME` + `QODER_CU_RUNTIME_APP_PATH=<QODER_HOME>/bin/<resourceId>/<runtimeAppName>`；`readableRoots=[cwd]` | index.js 偏移 ~4035136（nodeReplMainService）、~4040000（nativeNodeReplMainService Ykt） |
| node_repl 工具 | `node_repl`（描述：会话持久 top-level 绑定、top-level await、默认 10 分钟、`nodeRepl.write/emitImage/cwd/homeDir/tmpDir/getHeapStatus`、禁静态 import、禁 process 模块）+ `node_repl_wait/node_repl_cancel/node_repl_reset/node_repl_add_node_module_dir` | index.js 偏移 ~4012325（描述全文） |
| 内核上游 | `源仓库 /Users/jiffies/code/qwen-code-cu/qwen-code，commit b1ac3e297023a27dea8b4836fb86f0a4b4bd8b49，原目录 packages/qwen_node_repl，Apache-2.0`；"按 com.qoder/turnContext 分配的内核池（最多 8 个、闲置 30 分钟回收）" | `/Applications/Qoder.app/Contents/Resources/node-repl/UPSTREAM.md`（整段引述 ≤10 行） |
| 机器风险标识 | `~/.qoder/.bin/runtime-info-darwin-arm64-6153434d1073ca6f`（1,026,912B）；主进程以 `--account-stdin` 喂 `{account}` 取 `machineToken/machineType/machineCode`（错误码 `NATIVE_RISK_IDENTITY_*`） | index.js 偏移 ~4846000 区域（`runtime-info` 引用） |

## 3. Computer Use 证据

| # | 结论 | 证据 |
|---|---|---|
| C1 | app-plugin 声明 | `/Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/.qoder-app-plugin/plugin.json`：id/版本 1.0.0、`activationEvents:["onStartup"]`、permissions `["chat.observeTurn","chat.continueSession"]`、configuration 三键（`computerUse.enabled`/`recordAndReplay.enabled` 均 default **false**，darwin≥14；`browserUse.enabled` default false）、`qoderAgentSdk.plugins[]` 四子插件 enablement、nativeModules `picture-in-picture-host`（resourceId `qoder-computer-use-presentation-provider`） |
| C2 | Windows 16 工具清单 | 同文件 `mcpToolPresentations`：`list_apps,list_windows,get_window,launch_app,activate_window,get_app_state,get_window_state,click,perform_secondary_action,set_value,select_text,scroll,drag,press_key,type_text,run_steps`；`event-stream` server 3 工具 `event_stream_start/status/stop` |
| C3 | MCP 配置 | `dist/cli/computerUseWindows/.mcp.json`（server `computer-use`，stdio launcher，timeout 120000，env_vars QODER_HOME）；`dist/cli/recordAndReplay/.mcp.json`（server `event-stream`，timeout 220000，另 env QODER_CHAT_SESSION_ID）；`dist/cli/computerUse/` 无 .mcp.json（纯 SKILL 面） |
| C4 | launcher 身份与 execve | `dist/cli/*/bin/computerUseClientLauncher.cjs`：base64 身份 `{"productId":"qoder","defaultHomeDirectory":".qoder","runtimeResourceId":"qoder-computer-use","macosAppName":"Qoder Computer Use.app",…}`；darwin 解析 `<QODER_HOME>/bin/qoder-computer-use/Qoder Computer Use.app/Contents/SharedSupport/QoderComputerUseBridge.app/Contents/MacOS/QoderComputerUseBridge`，win32 `QoderComputerUse.exe`；"Bridge 会校验直接父进程；不能用 spawn 在宿主与 Bridge 之间留下 Node launcher" → `process.execve` |
| C5 | 原生应用版本/信任链 | `~/.qoder/bin/qoder-computer-use/Qoder Computer Use.app/Contents/Info.plist`：`com.qoder.computeruse` v1.0.12，LSUIElement，`QoderComputerUseTrustedTeamIdentifiers=[T27K5A5ZWD,B6U242QL73]`，`TrustedBundleIdentifiers` 14 项含 `com.aliyun.lingma.ide`、`com.qoder.computeruse.bridge`，`QoderComputerUseEnforceSenderAuthorization=false`，`NSAppleEventsUsageDescription`；Bridge plist 同构（`com.qoder.computeruse.bridge`，AppleEvents→runtime） |
| C6 | 分发校验 | `/Applications/Qoder.app/Contents/Resources/bundled-resources/manifest.json`：resource `qoder-computer-use` v1.0.12 rev 2026091401，zip 2,223,723B sha256 `4f368ad0…`，78 entries / 9,361,563B 上限，逐文件 sha256；entrypoints `runtime`+`bridge` |
| C7 | SDK 传输 | `node-repl/node_modules/@qoder-space/computer-use-sdk/source/socketTransport.ts`（114 行）：protocol `qoder-computer-use-tools`、注册表安全校验（isFile/非 symlink/`mode&0o077===0`/uid）、initialize+token 握手、15s ping、默认 140s 超时、超时断链不重放；`runtimeBootstrap.ts`（22 行）：ENOENT/ECONNREFUSED → `/usr/bin/open -g <QODER_CU_RUNTIME_APP_PATH>` 等 10s；`index.ts`（151 行）：registry `<QODER_HOME>/ipc/computer-use-tools.json`，方法 `ComputerUseIPCListAppsRequest/ComputerUseIPCAppGetStateRequest/ComputerUseIPCAppPerformActionRequest`，动作枚举 9 种，busy 单飞，`ComputerUseError` 携带 result；注释"与 qcum 的应用级快照契约一致，不伪造 qwen 的窗口 ID 或元素 token" |
| C8 | SKILL 全文 | `dist/cli/computerUse/skills/computer-use/SKILL.md`：TS 类型签名、`getAppState` 每 turn 先行、elementIndex/坐标二选一、paste 剪贴板条件恢复、pressKey 禁系统级快捷键、`Computer Use Confirmations Policy`（编号 [1]–[15] 四档确认分类 + 卫生规则） |
| C9 | Runtime 符号（Swift） | `strings` Runtime 二进制（6,024,672B）：`ComputerUseIPC*`（ListApps/AppGetState/AppPerformAction/AppStart/AppStartFrontmostCapture/AppCancelCapture/AppUsage/Health/HostSessionObserve/RequestLimiter/RequestAdmission/SenderAuthorization）、Appshot 系、`RemoteHostedPIP{Host,Producer}XPCProtocol`、`ComputerUseRuntimePermissionGate/Window/Row`、`AppApprovalStore`、`ComputerUseAppApprovals.json`、`ComputerUseAllowForbiddenTargets`、"User approval required for app: "、"Computer Use stopped due to encountering a disallowed URL: "、`CGEventPostToPid`、`ScreenCaptureKit`、`AXManualAccessibility`、`BackgroundTextInputSession`、`RecordReplayRecordingControls{Window,Button}`、权限 pending 工具文案全文 |
| C10 | Bridge 符号 | `strings` Bridge 二进制（1,980,464B）：`_TtC14ComputerUseMCP14MCPToolGateway`、`ComputerUseMCPServer`、`MCPStdioRequestQueue`、`AppleEventComputerUseTransport`、`ComputerUseClient/AppleEventComputerUseTransport.swift`；工具描述原文（setValue 的 AXValue/全 Unicode/Monaco 警告、pressKey 的系统快捷键边界、paste 验证告诫、`event_stream_start/status/stop`、`max_duration_seconds`、`screenshot_mode`、`suppressedEventsPath`） |
| C11 | 录制产物语义 | `record-and-replay/SKILL.md`：events.jsonl/session.json/suppressedEventsPath、事件类型（window.changed/mouse.*/keyboard.*）、diffFromPrevious unified-diff、结束话术 "I'm done recording."/"I've cancelled recording."、生成 `~/.qoder/skills/<name>/SKILL.md` |
| C12 | 设置 UI | 渲染层 bundle（out/renderer/assets/index-nRmb_3VI.js，20MB）："电脑操控和录制与回放需要 macOS 14…"、"电脑操控需要 Windows 10…"、"电脑操控能力，包括前台应用截取和浏览器连接" |
| C13 | 负证据 | `ls ~/.qoder/ipc/` → 空；无 `computer-use-tools.json`；无 Runtime 进程/审批文件；`app_settings` 表空（sqlite3 main.sqlite） |

## 4. Browser Use 证据

| # | 结论 | 证据 |
|---|---|---|
| B1 | 内置 server 与钉死基线 | index.js 偏移 ~8561395：`kSr()` 拼装 vSr/BSr/wSr 后与 `fSr.tools`（= `pSr` 16 项 @ ~8549306）join 比对，`throw new Error("Browser Use tool registration does not match the pinned chrome-devtools-mcp compatibility baseline.")`；serverName 常量 MGe（chunk 导入）；agent 前缀映射 `fdr=["browser-use",…]`、调用形如 `mcp__browser-use__navigate_page`（日志实证） |
| B2 | 16 工具 schema | 偏移 ~8550894 起的 zod schema `yn`（take_snapshot/take_screenshot/upload_file/press_key/handle_dialog/evaluate_script 的 function+args(uid 注入) 等）；工具描述注明 in-app/external 后端归属 |
| B3 | 外部旧命令面 | 偏移 ~9245907：`h1r=["tabs_context_mcp","navigate","read_page","computer","form_input","file_upload","handle_dialog","find","javascript_tool","read_network_requests","read_console_messages"]`；`computer` action left_click/double_click/hover/left_click_drag + ref；`qVe="browser_api"` |
| B4 | in-app 实现 | `WebContentsView` 管理类（`acquireAutomationTarget/show/hide/close/attach/detach/revokeInternet/blockNavigation`）；会话前缀 `` mj=t=>`chat:${t}:browser:` `` @ ~8548787；`runBrowserTurn` @ ~8536951 包 `internetAccess.run`；导航策略错误 JSON + "Internet access is restricted. Do not retry or bypass the policy. Local files and loopback previews remain available." @ ~8560896；分区目录 `Partitions/qoder-browser/` 实测存在 |
| B5 | Native Messaging host | `/Applications/Qoder.app/Contents/Resources/native-messaging-host/qoder-app-host.cjs`（3,559B 明文）：读 `~/.qoder/browser-connector/clients/*.json`，30s 过期/5s 未来容差/pid 存活，`watchRelayClients` protocolVersion 2 → `relayClientsChanged`；4 字节 LE 长度帧，1MB 上限 |
| B6 | host 安装器 | index.js 偏移 ~4833000–4846000：darwin/win32 安装类；wrapper `~/.qoder/browser-connector/bin/v2/<plat>-<arch>/<hash>/qoder-app-connector-host.sh`（`ELECTRON_RUN_AS_NODE=1 exec`）；自检 `NATIVE_CHROME_CONNECTOR_SELF_TEST_*`（5s 超时）；manifest 根清单 darwin 19 项（Chrome 系/Chromium/Edge 系/Brave 系/Opera 系/Vivaldi/Quark）、win32 注册表键 7 个；host 名 `qOr="com.qoder.app.connector"`、扩展 ID `ZOr=gblapfbnbicdckfhkllcnfleiemhmgeb`、`KOr=oknkojfamnpljdfpinkhbibicojelkoj`、canary/dev 三枚 `zOr` @ ~9241092 |
| B7 | Browser Agent 传输 | `computer-use-sdk/third_party/browser-use-sdk/README.md`（Qoder 自研声明，Apache-2.0，"reads one owner-only registry under QODER_HOME…Transport failures are never replayed automatically"）；bundle `index.js` 行 6723–6800：protocol `qoder-browser-use` v1、registry `browser-use.json`（≤32KB/0600/属主/进程存活）、endpoint 强制 http+数值 loopback、`browserCommand`、dialects tool/command；`Bearer`×2；`127.0.0.1` 校验 |
| B8 | Browser Agent 面 | `browserUse/skills/browser-use/SKILL.md`（全文）：`createBrowserAgent`→`browsers.list`→`tabs.new/user.openTabs/user.claimTab`（一次性 opaque id、fail-closed）→`tab.ax.get/write(state|screenshot|both,{disableDiffing})`→`tab.playwright`（locator/frameLocator/filechooser/download）→`tab.screenshot`→`capabilities`（cdp 允许列表、botDetection、pageAssets、webmcp）→`requestManualHandoff/markDeliverable/markHandoff`；错误码族与动态文档 id 清单；capabilities 宣告（index.js 偏移 ~9298197 `createBrowserAgent` 区域：browser: visibility/viewport/management，tab: cdp/botDetection/pageAssets/webmcp，provider `qoder-browser-connector` @ ~9297124） |
| B9 | SDK 输出适配 | `computer-use-sdk/source/browserAgentOutput.ts`（114 行）：AX 二进制解码、`tab.ax.write` 经 `nodeRepl.write/emitImage` 输出 |
| B10 | 本机真实使用 | `~/.qoder/logs/sessions/-Volumes-YANG-flova/6990b1af-afcb-4b7b-b8c5-a54d8e74afa5/segments/2026-10-05T03-55-31-960+08-00-y5mv52-p4483.jsonl`（8,873 行）：`mcp__browser-use__navigate_page`×18、`take_snapshot`×17、`evaluate_script`×3、`take_screenshot`×2、`list_pages`×2；样例行结构 `{ts,seq,level:"info",type:"tool.requested",turn_id,loop_id,tool_call_id:"call_…",data:{tool_name:"mcp_call",args:{toolName:"mcp__browser-use__take_snapshot",arguments:{}}}}` |
| B11 | 负证据 | `~/.qoder/browser-connector/` 不存在；`~/.qoder/ipc/browser-use.json` 不存在；`browserUse.enabled` 无开启记录 → connector/Browser Agent API 未激活 |

## 5. 复现命令汇总

```bash
# 解包（只读，产物放 /tmp）
npx --yes @electron/asar extract /Applications/Qoder.app/Contents/Resources/app.asar /tmp/qoder-asar

# 关键偏移复核（示例）
python3 - <<'EOF'
src=open('/tmp/qoder-asar/out/main/index.js',encoding='utf-8',errors='replace').read()
for m in ['pinned chrome-devtools-mcp','com.qoder.app.connector','gblapfbnbicdckfhkllcnfleiemhmgeb',
          'watchRelayClients','nodeReplMainService','qoder-browser-connector','Built-in local CLI']:
    print(src.find(m), m)
EOF

# 原生 CU 应用
plutil -p ~/.qoder/bin/qoder-computer-use/Qoder\ Computer\ Use.app/Contents/Info.plist
strings -a ~/.qoder/bin/qoder-computer-use/Qoder\ Computer\ Use.app/Contents/MacOS/QoderComputerUseRuntime | grep -c ComputerUseIPC

# SKILL 与 SDK 源码
cat "/Applications/Qoder.app/Contents/Resources/extensions/qoder.computer-control/dist/cli/computerUse/skills/computer-use/SKILL.md"
cat /Applications/Qoder.app/Contents/Resources/node-repl/UPSTREAM.md
ls /Applications/Qoder.app/Contents/Resources/node-repl/node_modules/@qoder-space/computer-use-sdk/source/
```
