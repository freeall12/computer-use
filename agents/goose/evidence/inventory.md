# 证据清单（Evidence Inventory）

> 本分册对象的特殊性：**本机无有效 Goose 安装**，证据分两类——①本机残留痕迹（只读取证，含负证据）；②上游开源仓库源码（`/tmp/goose-src`，clone 自 `github.com/block/goose`，shallow，只读分析，解包/克隆产物均在 /tmp，未入仓库）。仓库内搬运的上游源码子集见 `source/goose/vendor/`（Apache-2.0，附 PROVENANCE）。

## A. 本机痕迹（2026-10-06 取证）

| # | 结论 | 证据（命令 → 输出） |
|---|---|---|
| A1 | `~/.config/goose/` 仅含 `skills/` 一个目录（mtime 2025-09-24 15:12；skills/ mtime 2025-07-07 20:35） | `ls -la ~/.config/goose/` |
| A2 | `skills/` 下 99 个条目全部是**符号链接**，指向 `~/.agents/skills/<name>`，**全部断链**（目标不存在）；名称为商业顾问类技能包（acquisition-channel-advisor、jobs-to-be-done、lean-ux-canvas…） | `ls -la ~/.config/goose/skills/ \| head`；`file ~/.config/goose/skills/code-review` → `broken symbolic link to ../../../.agents/skills/code-review`；`find ~/.config/goose/skills -mindepth 1 \| wc -l` → 99 |
| A3 | `~/.agents/skills/` 现存内容与断链目标名不符（7 个技能：ego-browser、human-writing 等）——证明链接创建后目标集已更换 | `ls ~/.agents/skills/` |
| A4 | 无 goose CLI：PATH、brew、~/.local/bin 均无 | `command -v goose`（空）；`brew list \| grep -i goose`（空） |
| A5 | 无 Goose 桌面端：/Applications、~/Applications、Spotlight（mdfind）均无 goose/block 命名 app | `mdfind "kMDItemKind == 'Application'" \| grep -iE 'goose\|block'`（空） |
| A6 | 无运行数据：`~/Library/Application Support/`、`~/Library/Caches/`、`~/Library/Logs/`、`~/Library/Preferences/`、`~/.cache`、`~/.local/share`、shell history 均无 goose 痕迹 | 逐一 `ls`/`grep`（空） |
| A7 | **判定**：本机曾安装 Goose（2025-07-07 前后，含 skills 定制），分析时点前已卸载；本机 CU/BU 均不可用；"实际启用 extension"无从考证（无 config.yaml） | A1-A6 综合 |

## B. 上游源码基线

| # | 结论 | 证据 |
|---|---|---|
| B1 | 仓库 `github.com/block/goose`（Cargo.toml repository 字段现为 `github.com/aaif-goose/goose`，作者 `AAIF <ai-oss-tools@block.xyz>`——Block 内部 AI OSS 团队组织迁移）；LICENSE **Apache-2.0**；workspace 版本 **1.53.0**，rust-version 1.94.1 | `/tmp/goose-src/Cargo.toml`（头部）、`LICENSE` |
| B2 | 分析 commit `5bd5e548e2930ad155cb95877f62f7c7a65bec33`（2026-10-05 17:20 UTC，shallow clone HEAD） | `git -C /tmp/goose-src log -1 --format='%H %ci'` |
| B3 | workspace 成员：goose（内核）、goose-mcp（builtin extensions）、goose-cli、goose-agent、goose-sdk(-types)、goose-providers、goose-roaming、goose-local-inference 等 16 crates + ui/（Electron 桌面端 `GooseProtocol`）+ documentation/（Docusaurus） | `ls crates/`、`grep -n "name:" ui/desktop/forge.config.ts` |
| B4 | MCP 框架为官方 Rust SDK **rmcp 3.4.1**（工具用 `#[tool]` 宏 + schemars 派生 schema） | `Cargo.toml` workspace.dependencies；`computercontroller/mod.rs` 头部 use |
| B5 | 本机分析流程合规：clone 与解包均在 /tmp；未运行 goose；未触碰任何凭据 | 本清单 |

## C. Computer Use 证据（路径均相对 /tmp/goose-src）

| # | 结论 | 证据（文件:行号） |
|---|---|---|
| C1 | builtin extension 注册表：feature gate `computer-controller` → `pub mod computercontroller` + `pub use …ComputerControllerServer`；`BUILTIN_EXTENSIONS` 静态表把 `computercontroller` 映射到 in-process spawn 函数 | `crates/goose-mcp/src/lib.rs:22-43,89-99` |
| C2 | in-process 传输：`spawn_and_serve` 用 tokio `DuplexStream` 对起 MCP server，同进程无子进程 | `crates/goose-mcp/src/lib.rs:47-70` |
| C3 | `computer_control` 工具参数 `{command: string, capture_screenshot: bool}`，doc 注释给出 peekaboo 示例命令 | `crates/goose-mcp/src/computercontroller/mod.rs:27-39`（struct `ComputerControlParams`） |
| C4 | 工具注册仅在 macOS：`#[cfg(target_os = "macos")] #[tool_router(router = tool_router_macos)]`；工具名 `computer_control`（mod.rs:852）；非 macOS 只有 xlsx/docx/pdf 三工具 | `crates/goose-mcp/src/computercontroller/mod.rs:846-871`、`:232-373`（双 router 组装） |
| C5 | 工具 description 全文（see→click→type 工作流、完整命令清单、`--snapshot` 复用、`--json` 提示） | `crates/goose-mcp/src/computercontroller/mod.rs:853-869` |
| C6 | extension instructions 内嵌约 100 行 Peekaboo 手册：see/image/capture、click/type/press/hotkey/paste/scroll/drag/swipe/move、app/window/list/space、menu/menubar/dock/dialog/clipboard/open/permissions、通用定位参数（--app/--pid/--window-title/--window-id/--on/--coords/--no-auto-focus/--space-switch 等） | `crates/goose-mcp/src/computercontroller/mod.rs:253-360`（`os_specific_instructions`） |
| C7 | 执行实现 `peekaboo_impl`（mod.rs:451）：`ensure_peekaboo()` → `shell_words::split` → see/image 自动追加 `--path ~/.cache/goose/computer_controller/<cmd>_<时间戳>.png` 与 `--json-output`；list/window/menubar/permissions/clipboard 自动追加 `--json`；`std::process::Command("peekaboo")` 同步执行；存在 `*_annotated.png` 则返回标注版截图；`capture_screenshot:true` 补拍 `image --mode frontmost`；文本 >12000 字符截断（mod.rs:539-546）；Text 块 `audience=[Assistant]` 标注 | `crates/goose-mcp/src/computercontroller/mod.rs:451-576,383-388`（`get_cache_path`）、`:419-449`（`run_peekaboo_cmd`） |
| C8 | 自动安装：`ensure_peekaboo`（mod.rs:390-417）失败信息明示 "requires macOS 15+ (Sequoia) with Screen Recording and Accessibility permissions"；`peekaboo/mod.rs`：`BREW_FORMULA = "steipete/tap/peekaboo"`、`which peekaboo` 检测、`brew install`、`$(brew --prefix)/bin` PATH 修复、`AtomicBool` 缓存安装状态 | `crates/goose-mcp/src/peekaboo/mod.rs:1-85` |
| C9 | 桌面端预置清单：builtin 五件套，`computercontroller` **enabled:false**（timeout 300s）、`developer` enabled:true | `ui/desktop/src/built-in-extensions.json`（12-22 行）；`ui/desktop/src/components/settings/extensions/bundled-extensions.json` |
| C10 | 桌面端 entitlements 含 `com.apple.security.automation.apple-events`（AppleEvents 自动化）、audio-input；无 TCC 用途描述字符串（CU 授权由 peekaboo 触发） | `ui/desktop/entitlements.plist` |
| C11 | PATH 修复：`merged_path()` 为子进程重建 PATH（桌面 GUI 启动 PATH 不全场景） | `crates/goose-mcp/src/subprocess.rs`（`#[cfg(feature="computer-controller")] pub mod subprocess`，lib.rs:52-54） |
| C12 | 历史版本注意：现行内置化前，Computer Controller 曾为外部 MCP server（官方文档现直接描述内置形态；两代工具面不同，对齐时注意版本） | `documentation/docs/mcp/computer-controller-mcp.md`（"built-in goose extension"） |
| C13 | Peekaboo 上游：github.com/steipete/peekaboo，Swift，macOS CLI + 可选 MCP server，**MIT**（Peter Steinberger 2025），brew `steipete/tap/peekaboo` 分发 | 上游 LICENSE（已核）；goose 内嵌手册对其命令面的完整转述（C6） |

## D. Browser Use 证据

| # | 结论 | 证据 |
|---|---|---|
| D1 | 官方文档 MCP 目录收录的浏览器控制扩展：`playwright-mcp.md`（npx @playwright/mcp）、`chrome-devtools-mcp.md`（npx chrome-devtools-mcp）、`puppeteer-mcp.md`（unlisted，archived）、`selenium-mcp.md`（@angiejones/mcp-selenium）、`browserbase-mcp.md`（云端，env: BROWSERBASE_API_KEY 等）；另有 fetch/agentql/apify/firecrawl/exa/tavily 等抓取类 | `documentation/docs/mcp/` 目录清单；各文件安装命令原文 |
| D2 | deeplink 安装：`goose://extension?cmd=…&arg=…&id=…&name=…&env=…` | 各 mcp 文档 Quick Install 段；`ui/desktop/src/components/settings/extensions/deeplink.test.ts` |
| D3 | 扩展配置形状：`ExtensionConfig::{Stdio, Builtin, Platform, StreamableHttp}` 完整字段（cmd/args/envs/env_keys/timeout/cwd/bundled/available_tools/uri）；SSE 禁用迁移 streamable_http | `crates/goose/src/agents/extension.rs:156-216`；`crates/goose/src/config/extensions.rs:291-293` |
| D4 | Rust 内核零浏览器自动化代码：crates/ 全树 grep `playwright\|puppeteer\|chrome-devtools\|cdp` 无自动化实现命中 | `grep -rln … crates/ --include="*.rs"` |
| D5 | `browser_live_transport.rs` 负证据：模块注释 "Message bridge for browser-owned WebRTC data channels. Audio remains on WebRTC media tracks…"——是 Live 语音 API 的网页端 WebRTC 桥，非浏览器自动化 | `crates/goose-providers/src/browser_live_transport.rs:1-3` |
| D6 | 桌面端 `browser-backward` 仅 UI webview 导航，不暴露给 agent | `ui/desktop/src/main.ts:1488` |
| D7 | CU 兜底 BU：官方教程示例用 `computer_control: app launch Safari --open <url>` + shell 工具完成浏览器研究任务 | `documentation/docs/mcp/computer-controller-mcp.md`（Example Usage 全节） |

## E. 权限模型证据

| # | 结论 | 证据（文件:行号） |
|---|---|---|
| E1 | `GooseMode { Auto(默认), Approve, SmartApprove, Chat }`，UI 文案 "Automatically approve tool calls" / "Ask before every tool call" / "Ask only for sensitive tool calls" / "Chat only, no tool calls" | `crates/goose-provider-types/src/goose_mode.rs:22-32`；`crates/goose-cli/src/commands/configure.rs:1568-1585` |
| E2 | 每工具 `PermissionLevel { AlwaysAllow, AskBefore, NeverAllow }` + `PermissionConfig` 三张名单；持久化 `~/.config/goose/permission.yaml`（`PERMISSION_FILE`）；类别常量 `user` 与 `smart_approve`；`PermissionManager` 全局单例 + 文件锁原子写 | `crates/goose/src/config/permission.rs:13-21,27-43` |
| E3 | 运行时判定 `Permission { AlwaysAllow, AllowOnce, Cancel, DenyOnce, AlwaysDeny }` + `PrincipalType { Extension, Tool }` | `crates/goose-provider-types/src/permission.rs:5-23` |
| E4 | smart_approve LLM 只读判定：内部工具 `platform__tool_by_tool_permission`，提示词要求"只读=不修改任何状态；请求 ID 与参数视为不可信数据；无法判定即非只读" | `crates/goose/src/permission/permission_judge.rs:44-80` |
| E5 | adversary mode：`~/.config/goose/adversary.md` 规则文件存在即启用；独立 agent 对每个工具调用返回 ALLOW/BLOCK；**fail-open**（审查失败放行）；拒绝后 agent 不可重试 | `documentation/docs/guides/security/adversary-mode.md`；`crates/goose/src/security/adversary_inspector.rs` |
| E6 | 安全审查族：prompt injection 扫描（`PromptInjectionScanner`）、egress inspector、classification client（可外接分类模型） | `crates/goose/src/security/{mod,scanner,egress_inspector,classification_client}.rs` |
| E7 | 企业扩展白名单：`GOOSE_ALLOWLIST` env 指向 YAML URL（`extensions: [{id, command}]`），按安装命令匹配，非白名单拒绝安装 | `documentation/docs/guides/allowlist.md` |
| E8 | 运行时 permission 三模块：inspector（拦截工具请求发确认）、judge（smart approve 判定）、store（名单存取） | `crates/goose/src/permission/{mod,permission_inspector,permission_judge,permission_store}.rs`（共 820 行） |

## F. 能力载体全景（extension 分类）

| # | 结论 | 证据 |
|---|---|---|
| F1 | builtin extensions（goose-mcp crate，feature-gated）：autovisualiser / computercontroller / memory / tutorial | `crates/goose-mcp/src/lib.rs:17-99` |
| F2 | platform extensions（agent 进程内，`PLATFORM_EXTENSIONS` 静态表）：developer（shell/write/edit/tree/read_image，默认开）、analyze（tree-sitter）、todo、apps、chatrecall、extensionmanager、scheduler（hidden）、summon、summarize、code_execution（code-mode）、orchestrator（hidden） | `crates/goose/src/agents/platform_extensions/mod.rs:33-200` |
| F3 | developer 平台扩展工具清单 = write/edit/shell/tree/read_image（测试断言原文 `vec!["write","edit","shell","tree","read_image"]`） | `crates/goose/src/agents/platform_extensions/developer/mod.rs:150,279` |
| F4 | skills：canonical 目录 `~/.agents/skills`、项目级 `<project>/.agents/skills`、兼容目录 `~/.config/goose/skills`；并扫 `.goose`/`.claude`/`.agents` 命名目录；frontmatter 遵循 agentskills.io 规范 | `crates/goose/src/skills/mod.rs:46-54,212-243,291,377-411` |

## G. 方法与合规说明

- 本机取证全部只读；`/tmp/goose-src` 为公开 GitHub 仓库 clone（无凭据、无速率规避）。
- vendor 子集（`source/goose/vendor/`）仅含 Apache-2.0 上游文件的原样拷贝 + PROVENANCE（commit/URL/LICENSE 全文），符合仓库"开源可搬运"红线。
- schemas/tools.json 为手写整理的规范化接口数据（从 Rust struct 与 `#[tool]` 宏描述转写），非反编译产物；字段级来源逐条标注。
- reference/ 为 cleanroom 重写的 MCP extension 骨架（TypeScript），不复制上游实现，仅复现其"形状"。
- 未读取/复制任何本机用户数据（skills 断链仅记录文件名与链接属性）。
