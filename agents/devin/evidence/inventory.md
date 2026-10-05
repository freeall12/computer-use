# Devin 证据清单（inventory）

> 全部条目为只读静态取证所得，未运行任何 Devin 组件、未抓包、未触碰凭据值。
> 路径约定：`$CFG` = `~/.config/devin`，`$DATA` = `~/.local/share/devin`，`$CACHE` = `~/.cache/devin`，
> `$OMP` = `~/Desktop/oh-my-pi`（本机第三方开源协议参考实现，仅引用其公开形态），
> 日志行号 `$L` 指 `$DATA/cli/logs/` 内文件。凡涉及账号 ID/用户名/私有主机名一律截断或占位。

## A. 产品判定与谱系

| # | 结论 | 证据（路径 / 命令 / 文档） |
|---|---|---|
| A1 | 本机存在三套"Cognition/Devin"产品痕迹：① Devin CLI（内部代号 **chisel**，Rust，version `3000.6.19` commit `e2b252e2`，binary 名 `devin`）；② Devin Desktop（= Windsurf IDE 更名，VS Code fork，已卸载）；③ Devin Cloud（`app.devin.ai` / `api.devin.ai`） | `$DATA/cli/logs/devin_20260916-205622_76768.log:3`（`chisel: version=3000.6.19 commit=e2b252e2 os=macos arch=aarch64 binary=devin startup`）；`~/.codeium/windsurf/bin/devin-desktop` 悬挂 symlink；`$CACHE/cli/devin_deployment.*.bin` payload 解码 |
| A2 | Devin Desktop = Windsurf 更名（Cognition 2025-07 收购 Windsurf 后合并品牌）：本机 `~/.devin/` 为 VS Code fork 用户目录布局；安装器把 `devin-desktop` CLI 放进 Windsurf 的 bin 目录；CLI 日志里 ACP client 自报 `client=Some("windsurf")`、authenticate 方法 id `windsurf-api-key` | `ls -la ~/.codeium/windsurf/bin/`；`cat ~/.devin/argv.json`（模板注释原文 "pass permanent command line arguments to VS Code"）；`$L` initialize/authenticate 行；docs.devin.ai/_llms/en/desktop.md（changelog 标题 "Devin Desktop (Windsurf) stable release"、FAQ "the transition from Windsurf to Devin Desktop"） |
| A3 | CLI 走 `windsurf_api_client` 复用 Windsurf 后端客户端：`windsurf_api_client::remote_config` 约每 60s 重验远端配置；telemetry 走 Unleash flag（563 个 flag 定义已缓存） | `$L` WARN 行（`remote config revalidation failed…timed out after 2000ms`，多行，间隔约 60s）；`$CACHE/cli/unleash_definitions.bf84fa7496e6f844.bin`（解码后 features JSON，flag 总数 563） |
| A4 | CLI 首次启动由 `config_importers::jsonc` 写出 `~/.config/devin/config.json`，本机值为 `{"version": 1}`（无凭据）；文档确认该文件即全局用户配置（含 `sandbox` 网络过滤节） | `$DATA/cli/logs/devin_20260911-125208_13731.log:5`（`Configuration saved to /Users/laplace/.config/devin/config.json`）；`cat ~/.config/devin/config.json`；docs.devin.ai/cli/reference/permissions.md |
| A5 | 本机安装时间线：2026-09-11 12:50-12:52（argv precopy、config、skills、PATH 同分钟创建）→ 09-11/09-16/09-18 三天运行日志 → 之后 Devin.app 被整体移除（symlink 悬挂） | `stat -f '%SB' ~/.devin/.devin-argv-precopy`（2026-09-11T04:50:15Z）；`ls -la ~/.local/share/devin/cli/logs/`；`ls /Applications/Devin.app`（不存在）；`ls -la ~/.codeium/windsurf/bin/devin-desktop`（悬挂） |
| A6 | CLI 二进制本机已不存在：`command -v devin` 空；homebrew（`brew install --cask devin-cli` 未装）/npm/cargo/go/pipx/uv/volta/bun 目录均无 `devin`；无 pkgutil receipts；Trash 无。推断 CLI 由 Devin.app 内嵌分发（flag `devin-cli-bundling` 存在；文档："CLI can be bundled with Devin Desktop"） | `which -a devin`、`ls $(npm config get prefix)/bin | grep -i devin` 等全负；`pkgutil --pkgs | grep -i cognition` 空；`$CACHE/cli/unleash_definitions…` flag 名 `devin-cli-bundling`；docs.devin.ai/cli |
| A7 | 交叉印证：Synara 分册 A6 记录其 provider 文档列表含 `devin`；本机 oh-my-pi 项目实现了 `devin` provider（模型网关）与 `devin` OAuth 登录（云 CLI），两者与本分册证据互洽 | agents/synara/evidence/inventory.md A6；`$OMP/packages/ai/src/providers/devin.ts`、`$OMP/packages/ai/src/registry/oauth/devin.ts` |

## B. 本机数据面（路径 + 内容形态）

| # | 结论 | 证据 |
|---|---|---|
| B1 | `$CFG/config.json` = `{"version": 1}`（18 字节，无 token）；`$CFG/cli/` 空目录（用户级 CLI 安装位）；`$CFG/skills/` 99 个 symlink → `~/.agents/skills/<name>` | `cat $CFG/config.json`；`find $CFG -type f`（仅 1 个文件）；`ls -la $CFG/skills | head`；对照 `ls -la ~/.claude/skills`（同批 Jul 7 20:35 symlink，跨 agent 共享技能库挂载） |
| B2 | `~/.devin/`（Desktop 用户目录）：`argv.json`（VS Code 模板 + crash-reporter-id）、`.devin-argv-precopy` 时间戳、`extensions/extensions.json=[]`（空） | `cat ~/.devin/argv.json`、`cat ~/.devin/extensions/extensions.json` |
| B3 | `~/.zshrc:135-136`：`# Added by Devin` + `export PATH="/Users/laplace/.codeium/windsurf/bin:$PATH"` —— Devin 安装器复用 Windsurf bin 目录注入 PATH | `grep -n -A1 'Added by Devin' ~/.zshrc` |
| B4 | `$DATA/cli/` 结构：`installation_id`（36 字节 UUID）、`sessions.db`(+`-wal`/`-shm`, SQLite 3)、`session_locks/<形容词-名词>.lock`×8（内容=持有进程 PID，如 `fossil-marten.lock` 内容 `76768`）、`plugins/discovered.json`+`lock.json`（+各自 .lock）、`logs/`×6、`skill_events_spool.lock`、`$DATA/mcp/oauth/`（空，MCP OAuth token 存储位） | `find $DATA -maxdepth 3`；`file` 各文件；`cat $DATA/cli/session_locks/fossil-marten.lock` |
| B5 | sessions.db 为 **ACP 会话森林存储**（refinery 迁移 16 个：`initial_schema → message_forest → tool_call_state → add_hidden_column …`）。表：`sessions(backend_type, model, agent_mode, cogs_json, workspace_dirs, hidden, metadata)`、`prompt_history(…, is_shell)`、`message_nodes(会话内 node 森林，支持 fork/revert)`、`rendered_commits(rendered_html)`、`tool_call_state(tool_call_json = "Serialised acp::ToolCall JSON", tool_call_update_json)`、`app_state`。**本机全部表 0 行**（会话数据未落库或已清理） | `sqlite3 $DATA/cli/sessions.db '.schema'`；迁移表 `SELECT version,name FROM refinery_schema_history`（16 行全文见查询输出）；`SELECT count(*) …` 全 0 |
| B6 | `tool_call_state` 注释直接点明工具调用以 **ACP `ToolCall`/`ToolCallUpdate` JSON** 序列化存储 —— CLI 工具面对外协议形状即 ACP 对象 | `.schema` 内注释原文（引用 ≤2 行见分册） |
| B7 | `$CACHE/cli/` 缓存 5 个 bin（外层 JSON + base64 payload）：`devin_deployment` → `{"webapp_host":null,"api_url":"https://api.devin.ai"}`；`managed_plugins` → managed scope 插件清单（account/org/user 三级 id，manifest 均空）；`model_configs_v5` → 284KB protobuf 模型目录；`team_settings` → 模型 uid 列表；`unleash_definitions` → 563 flags；另有 `mcp/descriptions.json`（各 MCP server 的描述缓存） | `python3` base64 解码各 payload（命令见分册复核入口）；ID 已脱敏（`account-024d…`/`org-cefa…`/`user-d9e8…` 前缀可见） |
| B8 | 模型目录（model_configs_v5）实锤 **CLI 模型 API 走 Codeium 网关**：条目形如 label `Claude Opus 5 Medium` / uid `claude-opus-5-medium` / api base `https://server.codeium.com` / 服务端模型名 `claude-opus-5`、tokenizer `LLAMA_WITH_SPECIAL2`、effort 变体（low/medium/high/xhigh/max + `*‑fast`）、定价文案（"Upgrade to Pro…" → devin.ai/pricing）；team_settings 模型列表含 Devin 自家系列：`swe-2-high`、`swe-1-6-slow`、`swe-1-7-lightning`、`adaptive` 及 `glm-5-2`、`glm-5-3-low/high/max`、`kimi-k3-high`、`gpt-5-6-sol/luna`、`gpt-6-astra-medium` 等 | `strings $CACHE/cli/model_configs_v5.*.bin`、payload 解码后文本片段；team_settings payload 文本 |
| B9 | `mcp/descriptions.json` 缓存了用户自配 MCP server 的能力描述（streamable HTTP，本机 3 个，主机名为用户私有基础设施，本文档以 `<user-private-host>` 占位） | `cat $CACHE/cli/mcp/descriptions.json`（键名 observability/k8s-prod/k8s-qa；主机名脱敏） |
| B10 | 无凭据落盘：文档记录 `devin auth login` 凭据存 `~/.local/share/devin/credentials.toml`，本机不存在该文件（ACP 模式下凭据由宿主注入，见 C6） | `ls $DATA/devin/credentials.toml`（不存在）；docs.devin.ai/cli/enterprise/devin-auth.md |

## C. Computer Use（CU）

| # | 结论 | 证据 |
|---|---|---|
| C1 | **CU 执行面在 Devin Cloud 会话 VM 内**，工具名 **`computer`**："The `computer` tool is available in every desktop-mode session"；机制为截图→定位→动作→再截图循环；显示器固定 **1024×768** | docs.devin.ai/work-with-devin/computer-use.md（2026-10-06 抓取，原文引用见 computer-use.md §2） |
| C2 | 支持平台：Linux（默认）/ Windows / macOS 全桌面 + Outposts（Linux 需 `DISPLAY` 指向 X server，可用 Xvfb；macOS 复用现有桌面会话；Windows 需自装 Chrome）；macOS 输入为"synthetic mouse and keyboard input"，需 Accessibility（TCC）+ 截屏需 Screen Recording —— 均指云 VM 内 | 同上页；onboard-devin/environment/macos-support.md 存在于站点地图 |
| C3 | 开关为**组织级**："Computer use" toggle（Settings > Devin > Sessions），仅 org admin 可改；"Desktop mode is available on all plans"；无逐动作人工审批模型（人接管走 Interactive Browser 的 Browser/Computer 标签） | 同上页 |
| C4 | Interactive Browser 与 CU 同一入口：会话 UI 的 "Browser" 标签在 CU 启用后改名 "Computer"，可直接人手接管 Devin 的浏览器与桌面（SSO/MFA/CAPTCHA） | docs.devin.ai/work-with-devin/devin-session-tools.md |
| C5 | 云会话内浏览器暴露 **CDP 端点 `http://localhost:29229`**（端口固定，desktop mode 开关与否均开放），供 Playwright `connect_over_cdp` 附着；浏览器状态（cookies/localStorage/auth）在脚本退出后保留 | docs.devin.ai/work-with-devin/computer-use.md |
| C6 | **本地 CLI 无 CU 工具（负证据三重）**：① 权限文档的内置工具匹配器仅 `read, edit, grep, glob, exec`（+ `exit_plan_mode`）；② 全站文档中 computer-use 只存在于 Cloud 分区，CLI 分区无对应页；③ 本机 3 天 CLI 日志的全部内部模块清单无截图/输入注入/AX 模块（只有 `toolbox::tools::exec`、`toolbox::tools::mcp` 等） | docs.devin.ai/cli/reference/permissions.md；docs.devin.ai/llms.txt 站点地图；`cat $L/*.log | grep -oE '[a-z_]+::tools::[a-z_:]+' | sort -u` |
| C7 | CLI 的"自主无监督"形态 = `--sandbox`（OS 级沙箱）+ `--permission-mode autonomous`（唯一允许与 --sandbox 同用的模式；shell/fetch 自动批准、edit/write 仍提示）；Windows 无 OS 级沙箱会硬失败（含作为 ACP server 跑在 IDE 内时） | docs.devin.ai/cli/sandbox.md、cli/reference/permissions.md |
| C8 | Cascade/Devin Desktop 侧**无本地桌面控制证据**：Desktop 文档工具面只有 Previews（网页预览）、Terminal、Command/Tab、MCP；`~/.devin`、日志与 flags 中无 CGEvent/AX 注入类组件（对照 Cursor/Synara 分册的本地 CU 引擎形态） | docs.devin.ai/_llms/en/desktop.md；flags 全清单（无 computer/mouse-input 类 flag，仅 `/mouse` 斜杠命令名存在，语义未证实） |
| C9 | flags 印证 Cascade 浏览器/测试面归属 Desktop 而非本地桌面控制：`cascade-windsurf-browser-control`、`CASCADE_WINDSURF_BROWSER_TOOLS_ENABLED`、`cascade-devin-testing-panel`、`windsurf-browser-remote-debugging-port` | `$CACHE/cli/unleash_definitions…` flag 名清单（563 个全枚举见取证过程） |

## D. Browser Use（BU）

| # | 结论 | 证据 |
|---|---|---|
| D1 | 云端 BU 载体 = 会话 VM 内 Chromium（Interactive Browser）：人可同屏接管；cookie/会话态会话内持久；可经 blueprint 恢复登录态 | docs.devin.ai/work-with-devin/devin-session-tools.md |
| D2 | 登录态持久化工具 **`save_browser_profile`**（需 Manage Org Blueprints 权限）："zips the browser data directory (cookies, `localStorage`, and other Chrome profile data)" → 挂到 org blueprint `initialize` 步骤；恢复时解压到 `/home/ubuntu/.browser_data_dir`（经 `$FILE_BROWSER_PROFILE`）；≤200MB；Chrome 密码库与缓存被排除；不恢复扩展 | docs.devin.ai/work-with-devin/browser-auth.md |
| D3 | 本地 CLI 无浏览器工具（同 C6 三重负证据）；CLI 侧 BU 投影 = ① ACP 扩展能力位 **`browser_preview` / `browser_preview_open`**（由宿主 IDE 提供预览，本机三份日志均实测 `browser_preview=true, browser_preview_open=true`）；② MCP 外挂（`devin mcp add`，支持 stdio/http 传输 + OAuth）；③ `--cloud` 把任务代理给云会话 | `$L` initialize 行；docs.devin.ai/cli/reference/commands.md（mcp 子命令族）；同页 `--cloud` |
| D4 | ACP `browser_preview` 为 Cognition 私有扩展（标准 ACP 只有 extMethod/extNotification 机制；公开资料无该方法文档）——方法名未证实，仅能力位实测 | agentclientprotocol.com/protocol/v1/extensibility（扩展机制）；日志能力位原文 |
| D5 | Devin Desktop（Windsurf 更名）本地浏览器面 = **Previews**："Preview your web app locally in Devin Desktop IDE or browser with element selection, error capture, and direct integration with the agent"；其底层通道在 exa proto 中可证：`exa.browser_preview_pb.BrowserPreviewService{SendDOMElement, SendScreenshot, SendConsoleOutput}`（IDE 内嵌预览 → 模型上下文） | docs.devin.ai/_llms/en/desktop.md；`$OMP/…/proto/exa/browser_preview_pb/browser_preview.proto`（27 行全文） |
| D6 | Cascade 浏览器相关 flags（同 C9）+ `browser-interactions-num-implicit-steps`、`windsurf-browser-screenshot-tracking`、`windsurf-browser-webdev-tracking`、`implicit-uses-open-browser-url` —— 指向"预览/追踪/隐式打开 URL"形态，非通用桌面浏览器控制 | flags 清单 |
| D7 | 云端 API 有 v1/v2/v3 三代会话 API（sessions/messages/attachments/secrets/PAT），是第三方驱动云会话（含 Browser/Computer 观测）的正规入口；本机 `devin_deployment` 缓存证实 CLI 的 `api_url=https://api.devin.ai` | docs.devin.ai/_llms/en/api.md（索引）；`$CACHE/cli/devin_deployment.*.bin` 解码 |

## E. 传输与端点（静态记录）

| # | 端点/端口 | 用途 | 证据 |
|---|---|---|---|
| E1 | `https://api.devin.ai` | CLI 云 API（deployment 缓存 `api_url`；OAuth token 交换 `POST /auth/cli/token`） | B7 解码；`$OMP/packages/ai/src/registry/oauth/devin.ts:11,66` |
| E2 | `https://app.devin.ai` | Web 应用 / OAuth 授权页（`GET /auth/cli/continue?redirect_uri=…&state=…&prompt=select_account&code_challenge=…&code_challenge_method=S256`）+ 云会话 URL（`devin --cloud -r https://app.devin.ai/sessions/…`） | `$OMP/.../oauth/devin.ts:52-60`；docs.devin.ai/cli/reference/commands.md |
| E3 | OAuth 本地回调 `127.0.0.1:59653/callback`（PKCE S256；token 为 JWT，取 `exp`，回退 365 天） | `$OMP/.../oauth/devin.ts:13-15,31-60,96-110` |
| E4 | `https://server.codeium.com` | 模型网关（Connect-RPC over HTTP/1.1）：`POST /exa.auth_pb.AuthService/GetUserJwt`、`POST /exa.api_server_pb.ApiServerService/GetChatMessage`（流式）、`POST /exa.api_server_pb.ApiServerService/GetCliModelConfigs`；帧格式 5 字节 Connect envelope（flag 0x01=gzip、0x02=end-of-stream trailers）；`Metadata.apiKey` 形如 `devin-session-token$…` | `$OMP/packages/ai/src/providers/devin.ts:48,59-68,446-501`；`$OMP/packages/catalog/src/discovery/devin.ts:11-13`；B8 模型目录 |
| E5 | `https://cli.devin.ai/install.sh`（macOS/Linux/WSL）、`brew install --cask devin-cli`、`https://static.devin.ai/cli/setup.ps1` 与 `.exe`（Windows） | CLI 安装分发 | docs.devin.ai/cli |
| E6 | 云会话内 `http://localhost:29229` | 会话 VM 内浏览器 CDP（Playwright `connect_over_cdp`） | docs.devin.ai/work-with-devin/computer-use.md |
| E7 | CLI 传输形态：本地 agent（Rust，`chisel_server::acp` stdio ACP server）+ 本地 exec 工具（`toolbox::tools::exec`，起 shell 前快照 login-shell env）+ MCP client（streamable HTTP / stdio，OAuth token 存 `$DATA/mcp/oauth/`）+ 云 API（E1）；遥测 Unleash flag 缓存于 `$CACHE`，telemetry_state 仅 `{"is_zdr":false}` | `$L` 全部日志行；B7、B9 |
| E8 | `devin ssh <session>` / `devin forward <session> <port>`（可 `--gateway host[:port]`）：从本地直连云会话机器的 SSH/端口转发通道（BU/CU 会话的人工观测通道之一） | docs.devin.ai/cli/reference/commands.md |

## F. 安全模型（审批/凭据/隔离）

| # | 结论 | 证据 |
|---|---|---|
| F1 | 权限规则四类匹配器：`Read(glob)` / `Write(glob)` / `Exec(prefix)` / `Fetch(URLPattern|domain:)`；工具名匹配 `read/edit/grep/glob/exec`；MCP 匹配 `mcp__server__tool` / `mcp__server__*` / `mcp__*`；解析顺序 deny→ask→allow→default(prompt)；跨配置层"更严者胜"（org deny 不可被覆盖） | docs.devin.ai/cli/reference/permissions.md（原文逐条） |
| F2 | 五种 permission-mode：normal(auto)/accept-edits/smart/dangerous(yolo,bypass)/autonomous（仅 autonomous 可配 --sandbox）；Smart 模式由快模型判断"明显安全"自动执行，但包安装、变更型 git、rm/sudo、破坏性云操作、涉密文件永不自动批准 | 同上 |
| F3 | 沙箱 fail-closed："will refuse to start rather than running unsandboxed"；Linux 依赖 bubblewrap(`bwrap`)+socat，macOS 用 Seatbelt（`devin sandbox setup` 可查前置），Windows 不支持；`Write(...)` 授权可动态扩张沙箱可写面；`Read(...)` deny 路径对沙箱内命令完全隐藏 | docs.devin.ai/cli/sandbox.md |
| F4 | 沙箱网络过滤：本地 loopback 托管代理，子进程流量强制过代理；`allowed_domains`/`denied_domains`（deny 优先）/`network_mode: full|limited`（limited 仅 GET/HEAD/OPTIONS）；`sandbox.excluded` 以 `Exec(...)` 规则豁免（deny>ask>allow，不可解析即留在沙箱，PTY shell 永在沙箱内） | 同上 |
| F5 | 凭据：`devin auth login`（浏览器 PKCE，回退 `--force-manual-token-flow`）→ `credentials.toml`（`$XDG_DATA_HOME/devin/` 或 `~/.local/share/devin/`，"persistent and does not expire"）；ACP 模式下"ACP host is the sole source of credentials"（宿主经 `authenticate` 注入 `api_key`+`api_server_url`，本地凭据弃用）；企业可 MDM 钉死登录账户；`WINDSURF_API_KEY` 亦可作 acp 凭据 | docs.devin.ai/cli/enterprise/devin-auth.md；`$L` ACP credential policy / authenticate 行；commands.md acp 条目 |
| F6 | 配置五级优先：org/team 设置 > 会话授权 > `.devin/config.local.json` > `.devin/config.json` > 用户全局 `~/.config/devin/config.json`；权限提示支持 once/session/project/project-local/global 五种持久化 | docs.devin.ai/cli/reference/permissions.md |
| F7 | 云端侧人接管与审批：Interactive Browser 人手接管（MFA/CAPTCHA）；blueprint 变更（如保存浏览器 profile）需批准步骤；Secrets 存凭据而非浏览器密码库；组织级 CU 开关 | devin-session-tools.md、browser-auth.md、computer-use.md |

## G. 谱系与横向

| # | 结论 | 证据 |
|---|---|---|
| G1 | 协议家族一脉相承：CLI 与 Devin Desktop 共用 `exa.*` protobuf 家族（35 个包：api_server_pb、auth_pb、chat_client_server_pb、browser_preview_pb、cortex_pb、extension_server_pb…）与 `server.codeium.com` 网关；APIProvider 枚举含 `ANTHROPIC_DEVIN/OPENAI_DEVIN/FIREWORKS_COGNITION` 等内部路由名 | `$OMP/.../proto/exa/` 目录清单（35 包）；`$OMP/packages/catalog/src/discovery/devin-proto.ts` APIProvider 枚举 |
| G2 | CLI 技能系统读 8 家 provider 目录布局：`providers=[devin,agents_standard,cursor,windsurf,claude,opencode,zed,copilot]`（本机一次会话 `loaded=11 by_provider=[builtin=3,copilot=1,devin=7]`）；技能目录含 `~/.config/devin/skills`（XDG 全局）—— 与本机 B1 的 99 个 symlink 对上；SKILL.md frontmatter：`name/description/allowed-tools/permissions/triggers/subagent` | `$L` skills discovery 行；docs.devin.ai/cli/extensibility/skills/overview.md |
| G3 | ACP 扩展方法族 `cognition.ai/*`（实测 7 个）：`document/didOpen`、`document/didFocus`、`workspace/didChangeFiles`、`skills/list`、`mcp/listServers`、`rules/list`、`revert/listSteps`；client 能力位 25 项（terminal、fs.read/write、subagents、elicitation、partial_content、multi_root、windsurf_config、revert、editor_context、mcp、plugins、fast_context、subagent_control、**browser_preview、browser_preview_open**、clipboard_write…） | `$L`（含 .gz 解包后）`grep -hoE 'cognition\.ai/[a-zA-Z/]+' | sort -u`；initialize 行（三份日志一致） |
| G4 | CLI 插件体系为 managed+本地双轨：`plugins/discovered.json` 记录 managed origins（account/org/user 三级声明，`declaration_hash` 一致）；flags 另见 `enable-acp-mcp-registry`、`mcp-registry-url-override`、`customizations-panel-plugins` | B7、flags 清单 |
| G5 | 会话本地存储支撑 fork/revert/steps（message_nodes 森林 + rendered_commits + prompt_history），对应斜杠命令 `/fork /steps /revert /resume /ls /export`（ATIF 格式导出） | B5 schema；docs.devin.ai/cli/reference/commands.md |

## H. 证据强度分级

- **直接证据**（本机文件/日志/schema 实读、缓存解码、proto 文件、官方文档原文）：A1-A6、B1-B10、C1-C7、D1-D3、D5、D7、E1-E8、F1-F7、G1-G5。
- **推断**（已标注）：A6 后半（CLI 由 Desktop 内嵌分发——bundle 事实由 flag+文档支持，但本机未留存安装器）；C8（Desktop 无本地桌面控制——负证据推断）；D4（browser_preview 具体方法名——未证实）；`$CFG/cli/` 空目录用途；`/mouse` 斜杠命令语义；B5 中会话 0 行的原因。
- **未验证**：任何运行时行为（未登录、未发起云会话、未抓包）；云 VM 内 computer 工具的具体实现（VNC/原生注入细节官方未披露）；`devin acp` 在 JetBrains/Zed/Xcode 宿主下的差异；企业 Strict 模式（文档标注"未来"）。
