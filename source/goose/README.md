# source/goose/ —— Goose（Block）CU/BU 能力三层源码

> 对应分册：[agents/goose/](../../agents/goose/README.md)（总览）、[computer-use.md](../../agents/goose/computer-use.md)、[browser-use.md](../../agents/goose/browser-use.md)、[evidence/inventory.md](../../agents/goose/evidence/inventory.md)。

## 版本基线

| 项 | 值 |
|---|---|
| 上游 | `github.com/block/goose`（Cargo repository 字段现为 `github.com/aaif-goose/goose`） |
| 版本 | workspace **1.53.0** |
| 修订 | commit `5bd5e548e2930ad155cb95877f62f7c7a65bec33`（2026-10-05 UTC，shallow clone HEAD） |
| 许可证 | **Apache-2.0**（上游整仓） |
| 语言 | Rust（rmcp 3.4.1 SDK）+ TypeScript（Electron 桌面端） |
| 本机安装 | **无**（仅 `~/.config/goose/skills/` 断链残留；本目录三层全部基于上游源码与官方文档） |

## 三层结构

```
source/goose/
├── schemas/tools.json   CU/BU 工具面规范化 JSON（builtin + 官方收录外部扩展）
├── reference/           cleanroom 重写的最小 MCP extension（TypeScript，复现形状）
└── vendor/              上游 Apache-2.0 源码子集原样搬运（附 PROVENANCE + LICENSE 全文）
```

### 1. vendor/（开源搬运 —— 本仓库首个有 vendor 层的 agent）

Goose 上游**本身就是开源仓库**（Apache-2.0），CU 能力的完整实现可以直接原样搬运，这是与 zcode/codex/claude-code/cursor 四册（全专有、无 vendor）最大的不同。搬运范围 = computer/browser 能力对应的最小源码子集：

```
vendor/
├── PROVENANCE.md            上游 URL、commit、文件清单、许可证映射、搬运范围说明
├── LICENSE-apache-2.0.txt   上游 LICENSE 全文（原样）
├── goose-mcp/               builtin extension 容器
│   ├── lib.rs               feature gate + BUILTIN_EXTENSIONS 注册表 + in-process spawn
│   ├── computercontroller.mod.rs   Computer Controller extension 全文（computer_control + 办公三件套 + Peekaboo 透传）
│   └── peekaboo.mod.rs      Peekaboo 检测/brew 自动安装
├── goose-platform-ext.mod.rs  PLATFORM_EXTENSIONS 注册表（developer 等 11 个进程内扩展）
└── goose-permission/        权限模型
    ├── goose_mode.rs        GooseMode 四档（auto/approve/smart_approve/chat）
    ├── permission.rs        运行时 Permission 五档判定值
    └── config-permission.rs 每工具 PermissionLevel 三级 + permission.yaml 持久化
```

每个文件与上游逐字节一致（仅文件名加了 `mod.rs` → `.<module>.rs` 的平铺后缀，路径映射见 PROVENANCE）。

### 2. schemas/tools.json（接口数据，手写整理）

从上游 Rust struct + `#[tool]` 宏描述手工转写的规范化 JSON，覆盖：

- builtin：`computer_control`（唯一 CU 工具）+ `xlsx_tool`/`docx_tool`/`pdf_tool`；
- browser：Goose **没有内置浏览器工具**——以 `browser_extensions` 数组记录官方收录的 5 个外部 MCP 扩展及其安装命令（工具 schema 归各上游，不在此复刻）；
- 权限对象面：`GooseMode` / `PermissionLevel` / `Permission` 枚举；
- 每个条目带 `source` 字段标注上游 文件:行号。

`_provenance.status = 文档`（上游开源源码即"文档"级事实；本机无安装，故无"实测"成分）。

### 3. reference/（cleanroom 参考实现）

`goose-computer-extension.ts`：用 TypeScript（可擦除类型语法，Node ≥22.6 直接运行）复现 Goose Computer Controller 的**形状**，含：

- `computer_control(command, capture_screenshot)` 单工具 + 命令字符串透传协议；
- POSIX 风格分词（shell_words 语义）、`see/image` 自动 `--path`/`--json-output`、JSON 类命令自动 `--json`、`capture_screenshot` 补拍、12000 字符截断、`audience: [assistant]` 注解；
- `ensure_peekaboo` 检测/自动安装钩子（mock：不真跑 brew）；
- GooseMode × PermissionLevel 权限门 + smart_approve 只读判定的最小桩；
- 内置 mock peekaboo（内存 AX 树 + 元素 ID 标注），`test.mjs` 纯 Node 断言自测。

**不是**上游 Rust 代码的转写或翻译——仅按分册记录的行为规格重写，机制出处逐条注释。

## 许可证归属

| 目录 | 归属 | 许可证 |
|---|---|---|
| `vendor/` | Block / AAIF（上游 goose 仓库） | Apache-2.0（全文见 `vendor/LICENSE-apache-2.0.txt`；NOTICE 要求见 PROVENANCE §4） |
| `schemas/tools.json` | 本仓库手写整理（事实来自 Apache-2.0 上游） | 随本仓库 LICENSE |
| `reference/` | 本仓库 cleanroom 撰写 | 随本仓库 LICENSE |
| Peekaboo（上游执行层，未 vendor，brew 分发二进制） | Peter Steinberger（github.com/steipete/peekaboo） | MIT（reference 的 mock 仅为行为演示，不含其代码） |
