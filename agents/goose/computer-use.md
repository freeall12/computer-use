# Goose 的 Computer Use：单工具透传 Peekaboo CLI，自身零 AX/CGEvent 代码

> 分析基线：上游 `block/goose` v1.53.0（commit `5bd5e548`，2026-10-05，Apache-2.0）；本机无有效安装（负证据见 [evidence/inventory.md §A](evidence/inventory.md)）。
> 源码路径（相对上游仓库根）：`crates/goose-mcp/src/computercontroller/`、`crates/goose-mcp/src/peekaboo/`；已 vendor 至 [source/goose/vendor/](../../source/goose/vendor/PROVENANCE.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 载体判定 | 官方 builtin extension **Computer Controller**（`computercontroller`），编译进 goose-mcp crate（feature gate），in-process 跑标准 MCP；桌面端默认**关闭** |
| 执行判定 | macOS 上 `computer_control` 只把命令字符串透传给外部 **Peekaboo CLI**（steipete/peekaboo，MIT，Swift）——Goose 零 AX/CGEvent/SCK 代码 |
| 工具面 | 4 工具 = `computer_control` + 办公三件套 `xlsx_tool`/`docx_tool`/`pdf_tool` |
| 平台边界 | 非 macOS 无 `computer_control`（Linux/Windows 退化为纯办公工具） |
| 安全 | 通用三层权限，无 CU 专用门；TCC 由 Peekaboo 自行触发 |
| 代价 | 失去会话级控制：无 lease、无急停、无后台交付语义 |

## 架构一图：Peekaboo 透传链路

```
模型发 computer_control(command="see --app Safari --annotate")
        │
peekaboo_impl()（computercontroller/mod.rs:451-576）
 1. ensure_peekaboo()        — peekaboo 缺失则 brew 自动安装（失败则修 PATH 重试）
 2. shell_words::split       — POSIX 分词（空串 → INVALID_PARAMS）
 3. see/image                — 自动追加 --path ~/.cache/goose/computer_controller/…png（+--json-output）
 4. list/window/menubar/permissions/clipboard — 自动追加 --json
 5. run_peekaboo_cmd()       — std::process 同步执行（无超时；工具级 timeout:300s 在 extension 层）
 6. 存在 *_annotated.png     — 用标注版作截图返回
 7. 截图读文件 → base64 → ContentBlock::image("image/png")
        │
返回信封 = [Text(stdout ≤12000 chars, audience=[Assistant]), Image(base64 png), …]
```

## 1. 结论先行

1. **载体是官方内置 extension，不是内核原语**：Computer Controller 以 in-process duplex stream 跑 MCP 协议，模型侧与外部 MCP server 无差别；桌面端 `built-in-extensions.json` 中 `enabled:false`，需设置或 `goose configure → Toggle Extensions` 手动开启。
2. **执行层完全是第三方**：屏幕捕获、元素定位、输入注入全部由 Peekaboo 完成——9 个被逆向 agent 中唯一的"纯 CLI 透传"实现（对照表见 [README](README.md)）。
3. **能力随 Peekaboo 升级，工具面永不膨胀**（永远 1 个工具）；代价是无 lease、无急停、无后台交付。
4. **非 macOS 无此工具**：`tool_router_macos` 仅在 `target_os = "macos"` 注册；桌面控制需自行挂第三方 MCP（官方文档另收 `linux-mcp-server-mcp`）。

## 2. 启用与安装链

| 环节 | 事实 | 证据 |
|---|---|---|
| 桌面端预置 | builtin 五件套：`developer`（默认开）/ `computercontroller` / `autovisualiser` / `memory` / `tutorial`（后四者默认关） | `ui/desktop/src/built-in-extensions.json` |
| CLI 开启 | `goose configure → Toggle Extensions → computercontroller` | 官方文档 computer-controller-mcp.md |
| 编译裁剪 | `--features computer-controller` 才编入；`BUILTIN_EXTENSIONS` 按 feature 逐条 extend | `goose-mcp/src/lib.rs:22-43,89-99` |
| 进程形态 | in-process：tokio duplex stream 起 MCP server，无子进程 | `goose-mcp/src/lib.rs:47-70` |
| 执行层自动安装 | 首次调用 `ensure_peekaboo()`：`which peekaboo` 不在 → `brew install steipete/tap/peekaboo` → 失败追加 `$(brew --prefix)/bin` 重试；`AtomicBool` 缓存 | `peekaboo/mod.rs:7-85` |
| 执行层 TCC | Peekaboo 要求 **macOS 15+（Sequoia）+ Screen Recording + Accessibility**（错误信息明示）；goose entitlements 含 apple-events 但 TCC 由 peekaboo 触发 | `computercontroller/mod.rs:408-411` |
| 缓存目录 | `~/.cache/goose/computer_controller/`（Windows：%LOCALAPPDATA% 同名） | `computercontroller/mod.rs:238-250` |

## 3. 完整工具面（源码 schema 还原）

### 3.1 `computer_control`（唯一 CU 工具）

| 参数 | 类型 | 语义 |
|---|---|---|
| `command` | string（必填） | Peekaboo 子命令 + 参数的**单条字符串**，如 `"see --app Safari --annotate"`、`"click --on B1"`、`"hotkey --keys cmd,c"` |
| `capture_screenshot` | bool（默认 false） | 动作后自动补拍前台截图并随结果返回——"动作→看结果"循环内建 |

工具注册时注入 **extension instructions**（约 100 行内嵌 Peekaboo 命令手册）。命令空间速查（全部为 peekaboo 子命令，非 goose 代码）：

| 域 | 子命令 | 例 |
|---|---|---|
| 观察 | `see` / `image` / `capture` | `see --app Safari --annotate`；`image --mode screen --screen-index 1 --retina`；`see --app Notes --analyze "…"`；`capture live --mode region --duration 30` |
| 点击 | `click` | `click --on B1`（元素 ID）/ `--coords 100,200` / `--double` / `--right` |
| 输入 | `type` / `press` / `hotkey` / `paste` / `move` | `type "hello" --return`；`--wpm 80` 打字速率模拟；`press tab --count 3`；`paste`（长文本首选）；`move 500,300 --smooth` |
| 滚动/拖拽 | `scroll` / `drag` / `swipe` | `scroll --direction down --amount 5 --smooth`；`drag --from B1 --to T2`；`swipe --from-coords … --duration 800` |
| 应用/窗口 | `app` / `window` / `list` / `space` | `app launch Safari --open https://…`；`window set-bounds`；`list apps/windows/screens --json`；`space switch --index 2` |
| 菜单/系统 | `menu` / `menubar` / `dock` / `dialog` / `clipboard` / `open` / `permissions` | `menu click --path "Format > Font > Show Fonts"`；`dock launch Safari`；`dialog click --button "OK"`；`permissions status`（TCC 两权限） |
| 定位参数（通用） | `--app --pid --window-title --window-id --on ID --coords --snapshot --no-auto-focus --space-switch --bring-to-current-space` | `--snapshot` 复用此前 see 结果不重拍；`--no-auto-focus` 不抢焦点 |

> 演进：1.0.x 时代曾为外部 MCP server（多细粒度工具）；现行版本内置化 + 单工具透传。

### 3.2 办公三件套（同 extension，非 CU）

| 工具 | operations |
|---|---|
| `xlsx_tool` | list_worksheets / get_columns / get_range / find_text / update_cell / get_cell / save |
| `docx_tool` | extract_text / update_doc（replace_text/insert_text 等，含样式） |
| `pdf_tool` | extract_text / extract_images |

## 4. 观察机制：AX 树标注截图，无独立 AX 文本通道

- **元素 ID 标注来自 AX 树**：`see --annotate` 由 Peekaboo 读 Accessibility 树生成 B1/T2 式编号叠加在截图上——set-of-marks 的**变体**（标注由 AX 而非视觉模型产生，9 家分册"CU 侧无人用 SoM"的例外）。
- **snapshot 复用**：`--snapshot <id>` 让后续 click/type 直接引用此前 see 的快照——防漂移思路与 Claude/MiniMax 同源，但生命周期在 Peekaboo 侧，goose 不管理。
- **文本截断 12000 字符** + `[Output truncated. N total chars.]` 提示；Text 块带 `annotations.audience=[Assistant]`。
- **无独立 AX 树文本通道**：AX 信息全部打包在截图标注 + JSON stdout 里（不像 ZCode/Codex 单独结构化返回）。

## 5. 动作机制：注入在 Peekaboo，goose 只拼参数

| 环节 | 事实 | 影响 |
|---|---|---|
| 注入主体 | Peekaboo（Swift，CGEvent + AX API）；goose 不感知哪个事件落在哪个窗口 | goose 侧零原生代码 |
| 执行模型 | `std::process::Command::output()` **同步阻塞、无超时**（工具级 timeout 300s 在 extension 层） | 长命令卡住该 server 执行线程（不响应取消） |
| PATH 修复 | `merged_path()` 为子进程重建 PATH（桌面 GUI 启动常缺 /opt/homebrew/bin） | 保证 peekaboo/brew 可达 |
| 动作后验证 | `capture_screenshot:true` 自动补拍 `image --mode frontmost` | 最轻量的 verify 一档 |
| 缺失能力 | 无 generation/lease/急停/后台交付 | 用户干预仅会话级中断（UI 停止按钮） |

## 6. 权限模型：通用三层正交叠加，无 CU 专用门

| 层 | 机制 | 载体 |
|---|---|---|
| ① 全局模式 `GooseMode` | `auto`（默认，自动批准一切）/ `approve`（每次问）/ `smart_approve`（敏感才问）/ `chat`（禁工具） | `goose config -s GOOSE_MODE=…` |
| ② 每工具级别 | `always_allow` / `ask_before` / `never_allow` 三张名单，按扩展名分组持久化 | `~/.config/goose/permission.yaml` |
| ③ LLM 独立审查 | smart_approve：独立 LLM 判定"严格只读"（只读放行）；adversary mode：独立 agent 按 ALLOW/BLOCK 复核，**fail-open** | `permission_judge.rs`、`adversary_inspector.rs` |

**CU 特有含义：**

- `auto` 模式下 `computer_control`（点击、删文件、发消息）**不经任何确认直接执行**；smart_approve 下点击/打字非只读，会弹窗。
- OS 层 TCC 是一次性系统授权，授权给 peekaboo（或其宿主终端）而非 goose；goose 无应用白名单/tier/敏感应用限权（对比 Claude Code 分级）。
- 企业侧唯一硬闸是扩展安装白名单 `GOOSE_ALLOWLIST`（管"能装什么"，非运行时行为），见 [browser-use.md §4](browser-use.md)。

## 7. 与 trycua/Cua AI 生态：无关，是平行路线

**Peekaboo 与 cua-driver 是"同一问题域、两条开源底座"**——逐维对照表见 [README](README.md)。对自研 CU agent 的启示：Peekaboo 路线把执行层外包给成熟独立 CLI，工程成本最低、能力上限受制于 CLI 的会话模型；cua-driver 路线相反。两条路线在 [reusable/patterns.md](../../reusable/patterns.md) 的"执行层宿主形态"谱系上分居两端。

## 8. 本机未发现 / 不可用项（负结论）

- `goose` CLI、Goose 桌面端、`~/.config/goose/config.yaml`、`~/.cache/goose/`、Application Support 下 goose 目录：**均不存在**。
- 99 个 skills 断链 symlink 仅证明曾安装并做过 skills 定制，不构成任何可用能力；"实际启用了哪些 extension"无从考证（无 config.yaml）。
- 桌面端无 CU 急停热键、无后台交付、无应用级授权 UI——**上游源码层面就不存在**，非本机缺失。
