# Block Goose：Computer Use（桌面控制）完整逆向

> 分析基线：上游 `block/goose` v1.53.0（commit `5bd5e548`，2026-10-05，Apache-2.0）；本机无有效安装（见 [evidence/inventory.md §A](evidence/inventory.md)）。
> 源码路径（相对上游仓库根）：`crates/goose-mcp/src/computercontroller/`、`crates/goose-mcp/src/peekaboo/`。已 vendor 至 [source/goose/vendor/](../../source/goose/vendor/PROVENANCE.md)。

## 1. 结论先行

1. **载体判定：官方内置 extension，不是内核原语**。Computer Use 由 builtin extension **Computer Controller**（`computercontroller`）提供，编译进 `goose-mcp` crate（feature gate `computer-controller`），以 in-process duplex stream 跑标准 MCP 协议（模型侧与外部 MCP server 无差别）。桌面端默认**关闭**（`ui/desktop/src/built-in-extensions.json` 中 `enabled:false`），需在设置或 `goose configure → Toggle Extensions` 手动开启。
2. **执行判定：Peekaboo CLI 透传**。macOS 上 `computer_control` 工具只做一件事：把 `command` 字符串经 `shell_words::split` 解析后原样交给外部进程 `peekaboo` 执行。Goose 自身**不含任何 AX/CGEvent/ScreenCaptureKit 代码**——屏幕捕获、元素定位、输入注入全部由 Peekaboo（[steipete/peekaboo](https://github.com/steipete/peekaboo)，MIT，Swift 单二进制）完成。
3. **这是 9 个被逆向 agent 中唯一的"纯 CLI 透传"CU 实现**：其他各家都把执行层内嵌（静态链接/内嵌 driver/utility process），Goose 反其道而行——能力随 Peekaboo 版本升级而升级，工具面永不膨胀（永远只有 1 个工具），代价是失去会话级控制（无 lease、无急停、无后台交付语义）。
4. **非 macOS 平台没有 computer_control**：`tool_router_macos` 仅在 `target_os = "macos"` 下注册该工具；Linux/Windows 的 Computer Controller 退化为纯办公文档工具（xlsx/docx/pdf），桌面控制需自行挂第三方 MCP（官方文档另收 `linux-mcp-server-mcp`）。

## 2. 启用与安装链

| 环节 | 事实 | 证据 |
|---|---|---|
| 桌面端预置清单 | builtin 五件套 `developer`（默认开）/ `computercontroller` / `autovisualiser` / `memory` / `tutorial`（后四者默认关） | `ui/desktop/src/built-in-extensions.json`、`ui/desktop/src/components/settings/extensions/bundled-extensions.json` |
| CLI 开启 | `goose configure → Toggle Extensions → computercontroller` | `documentation/docs/mcp/computer-controller-mcp.md` |
| 编译裁剪 | feature gate：`--features computer-controller` 才编入；`BUILTIN_EXTENSIONS` 注册表按 feature 逐条 `extend` | `crates/goose-mcp/src/lib.rs:22-43,89-99` |
| 进程形态 | **in-process**：`spawn_and_serve` 在 goose 进程内用 tokio duplex stream 起 MCP server，无子进程 | `crates/goose-mcp/src/lib.rs:47-70` |
| 执行层自动安装 | 首次调用 `computer_control` 时 `ensure_peekaboo()`：`which peekaboo` 不在 → `brew install steipete/tap/peekaboo` → 失败则把 `$(brew --prefix)/bin` 追加进 PATH 重试；成功后进程内 `AtomicBool` 缓存 | `crates/goose-mcp/src/peekaboo/mod.rs:7-85`、`computercontroller/mod.rs:390-417` |
| 执行层 TCC | Peekaboo 要求 **macOS 15+（Sequoia）+ Screen Recording + Accessibility**（错误信息明示）；goose 桌面端 entitlements 含 `com.apple.security.automation.apple-events` 但 TCC 授权由 peekaboo 二进制触发 | `computercontroller/mod.rs:408-411`、`ui/desktop/entitlements.plist` |
| 缓存目录 | 截图/标注缓存：`~/.cache/goose/computer_controller/`（Windows：`%LOCALAPPDATA%\Block\goose\cache\computer_controller\`） | `computercontroller/mod.rs:238-250` |

## 3. 完整工具面（从源码 schema 还原）

Computer Controller 在 macOS 上共 **4 个工具**：`computer_control` + 办公三件套 `xlsx_tool` / `docx_tool` / `pdf_tool`（后三者与 CU 无关但同 extension，列出以完整）。

### 3.1 `computer_control`（唯一 CU 工具）

```jsonc
// 来源：crates/goose-mcp/src/computercontroller/mod.rs:27-39,852-871
{
  "name": "computer_control",
  "description": "macOS UI automation via Peekaboo CLI. Pass a subcommand string as `command`. …",
  "parameters": {
    "command": { "type": "string",
      "description": "The peekaboo subcommand and arguments as a single string. Examples: \"see --app Safari --annotate\" / \"click --on B1\" / \"type \\\"hello\\\" --return\" / \"hotkey --keys cmd,c\" …" },
    "capture_screenshot": { "type": "boolean", "default": false,
      "description": "Whether to capture and return a screenshot as part of the result. Useful after click/type actions to see the updated UI state." }
  }
}
```

工具注册时同时注入 **extension instructions**（`get_info().with_instructions`），本质是一份**内嵌的 Peekaboo 命令手册**（约 100 行），把整个命令空间"写进"模型上下文。命令空间速查（全部为 peekaboo 子命令，非 goose 代码）：

| 域 | 子命令 | 例（instructions 原文摘要） |
|---|---|---|
| 观察 | `see` / `image` / `capture` | `see --app Safari --annotate`（标注元素 ID 截图）；`image --mode screen --screen-index 1 --retina`；`see --app Notes --analyze "describe…"`（AI 分析）；`capture live --mode region --region 100,100,800,600 --duration 30` |
| 点击 | `click` | `click --on B1`（元素 ID）/ `click --coords 100,200` / `--double` / `--right` |
| 输入 | `type` / `press` / `hotkey` / `paste` / `move` | `type "hello" --return`、`type "slow" --wpm 80`（打字速率模拟）；`press tab --count 3`；`hotkey --keys cmd,shift,t`；`paste --text "…"`（长文本首选）；`move 500,300 --smooth` |
| 滚动/拖拽 | `scroll` / `drag` / `swipe` | `scroll --direction down --amount 5 --smooth`；`drag --from B1 --to T2`；`swipe --from-coords 100,500 --to-coords 100,200 --duration 800` |
| 应用/窗口 | `app` / `window` / `list` / `space` | `app launch Safari --open https://…`；`window set-bounds --app Safari --x 50 … --width 1200`；`list apps/windows/screens --json`；`space list` / `space switch --index 2`（多虚拟桌面） |
| 菜单/系统 | `menu` / `menubar` / `dock` / `dialog` / `clipboard` / `open` / `permissions` | `menu click --app Safari --item "New Window"`、`menu click --app TextEdit --path "Format > Font > Show Fonts"`；`dock launch Safari`；`dialog click --button "OK"`；`clipboard --action get/set`；`open https://… --app Safari`；`permissions status`（检查 TCC 两权限） |
| 定位参数（通用） | `--app` `--pid` `--window-title` `--window-id` `--window-index` `--on ID` `--coords x,y` `--snapshot <id>` `--no-auto-focus` `--space-switch` `--bring-to-current-space` | `--snapshot` 复用此前 see 结果不重拍；`--no-auto-focus` 不抢焦点 |

**版本注意**：goose 1.0.x 时代的 Computer Controller 曾是外部 MCP server（`uvx mcp-server-computer-controller`，工具面为多个细粒度工具）；现行版本（本基线）已内置化并改为 Peekaboo 单工具透传。做历史对齐时勿混用两代工具面。

### 3.2 办公三件套（同 extension，非 CU）

| 工具 | operations | 备注 |
|---|---|---|
| `xlsx_tool` | list_worksheets / get_columns / get_range / find_text / update_cell / get_cell / save | 参数含 worksheet/range/search_text/row/col/value |
| `docx_tool` | extract_text / update_doc（mode: replace_text/insert_text…，含 DocxTextStyle 样式） | |
| `pdf_tool` | extract_text / extract_images | |

## 4. 观察机制

```
模型发 computer_control(command="see --app Safari --annotate")
        │
        ▼
peekaboo_impl()（computercontroller/mod.rs:451-576）
  1. ensure_peekaboo()                    — peekaboo 缺失则 brew 自动安装
  2. shell_words::split(command)          — POSIX 风格分词（空串→INVALID_PARAMS）
  3. 若首词为 see/image：
       自动追加 --path ~/.cache/goose/computer_controller/see_<时间戳>.png
       see 另自动追加 --json-output
  4. 若首词 ∈ {list, window, menubar, permissions, clipboard}：
       自动追加 --json（结构化输出）
  5. run_peekaboo_cmd() → 同步子进程执行，收集 stdout/stderr
  6. see：若存在 <path 去掉 .png>_annotated.png → 用标注版作截图返回
  7. 截图读文件 → base64 → ContentBlock::image("image/png")
        │
        ▼
返回信封 = [Text(stdout ≤12000 chars, annotations.audience=[Assistant]), Image(base64 png), …]
```

要点：

- **元素 ID 标注来自 AX 树**：`see --annotate` 由 Peekaboo 读取 Accessibility 树生成 B1/B2/T2 式编号叠加在截图上；这与各家"AX 增量 diff"同源，但编号是**视觉叠加的 set-of-marks 变体**（9 家分册中 CU 侧"无人用 SoM"结论的例外——只不过标注元素由 AX 而非视觉模型产生）。
- **snapshot 复用**：`--snapshot <id>` 让后续 click/type 直接引用此前 see 的元素快照，不重拍屏——与 Claude Code 的 app snapshot、MiniMax 的 session lease 同一防漂移思路，但粒度在 Peekaboo 侧、goose 不管理其生命周期。
- **文本截断 12000 字符**：`list --json` 等大输出防爆上下文；截断提示 `[Output truncated. N total chars.]`（mod.rs:539-546）。
- **audience 标注**：Text 块带 `annotations.audience=[Assistant]`，提示 UI 该文本主要给模型看（桌面端渲染时弱化）。
- **无专用的 AX 树文本通道**：AX 信息全部打包在截图标注 + peekaboo JSON stdout 里，不像 ZCode/Codex 把 AX 树单独结构化返回。

## 5. 动作机制（输入如何注入）

1. **注入主体是 Peekaboo**（Swift，CGEvent + AX API），goose 侧只负责拼进程参数。goose 不感知"哪个 CGEvent 落在哪个窗口"。
2. **同步阻塞执行**：`run_peekaboo_cmd` 用 `std::process::Command::output()` 等待子进程退出，**无超时控制**（extension 层面另有 `timeout: 300` 秒的工具级超时，见 built-in-extensions.json）。异步 MCP server 内跑同步阻塞调用——长命令会卡住该 server 的执行线程（tokio spawn 的专用任务，不卡主循环，但不响应取消）。
3. **PATH 修复**：桌面端（GUI 启动）PATH 通常缺 `/opt/homebrew/bin`，`merged_path()`（`goose-mcp/src/subprocess.rs`）为子进程重建 PATH，保证 peekaboo/brew 可达。
4. **动作后验证 = `capture_screenshot:true`**：工具自动补拍 `image --mode frontmost` 并追加为 image 块——"动作→看结果"循环由工具层内建，无需模型二次调用（对比各家 verify_after 三态设计，这是最轻量的一档）。
5. **无 generation/lease/急停**：没有后台交付模式、没有独占租约、没有物理 Esc 急停。用户干预靠 goose 会话级中断（桌面端 UI 停止按钮）。

## 6. 权限模型（CU 视角）

Goose 的权限模型与 CU **解耦**——没有任何"computer 动作特殊门"，三层通用机制正交叠加：

| 层 | 机制 | 载体 | 证据 |
|---|---|---|---|
| ① 全局模式 `GooseMode` | `auto`（默认，自动批准一切工具）/ `approve`（每次询问）/ `smart_approve`（敏感操作才问）/ `chat`（禁一切工具） | `goose config -s GOOSE_MODE=…`、桌面端设置 | `crates/goose-provider-types/src/goose_mode.rs:22-32` |
| ② 每工具级别 `PermissionLevel` | `always_allow` / `ask_before` / `never_allow` 三张名单，按扩展名分组持久化 | `~/.config/goose/permission.yaml`，类别含 `user` 与 `smart_approve` | `crates/goose/src/config/permission.rs:19-29` |
| ③ LLM 独立审查 | `smart_approve`：用独立 LLM 调用（platform__tool_by_tool_permission 工具）判定请求是否**严格只读**，只读自动放行，其余弹窗；`adversary mode`：`~/.config/adversary.md` 规则文件存在即启用，独立 agent 按 ALLOW/BLOCK 复核每个工具调用，**fail-open**（审查失败放行） | `crates/goose/src/permission/permission_judge.rs`、`crates/goose/src/security/adversary_inspector.rs`、`documentation/docs/guides/security/adversary-mode.md` |  |

运行时判定值：`Permission { AlwaysAllow, AllowOnce, Cancel, DenyOnce, AlwaysDeny }`（`goose-provider-types/src/permission.rs`）——桌面端批准按钮即这五档。

**CU 特有含义**：

- `auto` 模式下 `computer_control`（点击、删除文件、发消息…）**不经任何确认直接执行**；`smart_approve` 模式下"click/type"这类操作不会被 LLM 只读判定放行（非只读），会弹窗。
- OS 层 TCC（Screen Recording + Accessibility）是**一次性系统授权**，goose 不做应用级授权管理——首次 TCC 弹窗由 peekaboo 触发，授权给 peekaboo（或其宿主终端）而非 goose。
- 无应用白名单/tier/敏感应用限权（对比 Claude Code：浏览器→read、终端→click 的硬编码分级在 goose 不存在）。
- 企业侧唯一硬闸是**扩展安装白名单** `GOOSE_ALLOWLIST`（控制能装哪些 MCP server，而非运行时工具权限），见 [browser-use.md §4](browser-use.md)。

## 7. 与 trycua/Cua AI 生态的关系

**无关，是平行路线**：

| 维度 | Goose + Peekaboo | MiniMax/Synara + cua-driver（trycua） |
|---|---|---|
| 语言/形态 | Swift 单二进制 CLI，brew 分发，stdin/stdout 文本协议 | Rust 库（UniFFI），宿主进程内嵌，JSON 消息协议 |
| 集成深度 | 零集成：子进程 + 命令字符串透传 | 深度集成：进程内嵌 + 会话/租约/generation |
| 观察输出 | 截图 + AX 标注叠加 + JSON stdout | AX 结构化状态 + 分级截图（≤7MB fail-closed） |
| 权限 | TCC 系统授权，agent 不管理 | hostCapabilities + 前台授权引擎 + overlay 示能 |
| 升级方式 | `brew upgrade peekaboo`，goose 不改代码 | 随宿主发版 |
| 许可证 | Peekaboo MIT | cua-driver MIT |

对"自研 CU agent"的启示：Peekaboo 路线把**执行层外包给成熟的独立 CLI**，工程成本最低、能力上限受制于 CLI 的会话模型（无后台控制/急停）；cua-driver 路线相反。两条路线在本仓库 [reusable/patterns.md](../../reusable/patterns.md) 的"执行层宿主形态"谱系上分居两端。

## 8. 本机未发现 / 不可用项（负结论）

- `goose` CLI、Goose 桌面端、`~/.config/goose/config.yaml`、`~/.cache/goose/`、`~/Library/Application Support/` 下的 goose 目录：**均不存在**。
- `~/.config/goose/skills/` 下 99 个条目全部是**断链符号链接**（→ `~/.agents/skills/<name>`，目标已不存在），2025-07-07 20:35 创建——仅证明曾安装并做过 skills 定制，不构成任何可用能力。
- 因此"本机实际启用了哪些 extension"无从考证（无 config.yaml）；本分册 CU/BU 判定均基于**上游源码 + 官方文档**，非本机运行时状态。
- goose 桌面端无 CU 急停热键、无后台交付、无应用级授权 UI 的任何痕迹（上游源码层面就不存在，非本机缺失）。
