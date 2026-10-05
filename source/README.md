# source/ —— 整理后的源码层

> 本目录是仓库"不只是报告，还有可复用的代码"的部分：把 `agents/` 各分册记录的接口事实与行为规格，
> 整理为三层可复用产物。本文是**全仓库统一的整理规范**（首次创建于 zcode/codex/claude-code/cursor
> 四个分册的整理轮次，其余 agent 目录按同一规范补齐，各自目录内附 README 说明）。
>
> **红线**：本目录不含任何专有代码（无各产品打包产物、二进制、凭据；vendor 只收上游本身开源的
> 组件并附出处与 LICENSE）。所有文件均为本仓库作者手写整理或 cleanroom 重构。

---

## 三层结构

```
source/<agent>/
├── schemas/     接口数据：工具面与对象面的规范化 JSON
├── reference/   重构参考实现：cleanroom 重写的协议骨架（TypeScript）
└── vendor/      开源搬运（仅当上游本身开源；本仓库四个 agent 均无，见下）
```

### 1. vendor/（开源搬运）

只允许搬运**上游本身开源**的组件子集，且必须附：上游 URL、对应修订版本、原 LICENSE 全文。
专有代码绝对禁止 vendor。

**各 agent 目录的 vendor 判定**（有 vendor 的目录必须自带 PROVENANCE/UPSTREAM 说明 + 原 LICENSE 全文）：

| Agent | 判定 | 理由 |
|---|---|---|
| zcode | 无 vendor | 本体（computer-use/browser-use 插件、node-repl-host、CUA Helper、ax_native.node）全部专有，无开源上游。 |
| codex | 无 vendor | `github.com/openai/codex`（Apache-2.0）是 CLI（Rust）的开源仓库，但 (a) 本机实装为闭源分发的 npm 包装 + 228MB Rust 二进制，与开源仓库修订无已验证的对应关系；(b) 桌面控制关键组件（`@oai/cua`、`@oai/cua-repl`、`@oai/sky`、`@oai/browser-desktop`、SkyComputerUseService）均**不在**开源仓库内（见 [agents/codex/evidence/inventory.md §11](../agents/codex/evidence/inventory.md)）。 |
| claude-code | 无 vendor | 宿主二进制、`@ant/*` monorepo 包、ComputerUseSwift、app-cu-helper、chrome-native-host、Claude in Chrome 扩展全部专有。 |
| cursor | 无 vendor | `cursor-computer-use` 扩展虽随包携带完整 TS 源码（`src/`），但其分发物属于专有产品的一部分，未附开源许可证，不构成可 vendor 的上游。 |
| 其余 agent | 见各自目录 | goose（Apache-2.0 的 goose-mcp 子集）、minimax-code/synara（MIT 的 cua-driver contract 子集）、qoder（Apache-2.0 的 qwen-node-repl）、mimo（mi 开源插件）等有可验证开源上游的已 vendor；devin/grok 等专有的在其 README 说明。判定细节以各目录 README/PROVENANCE 为准。 |

### 2. schemas/（接口数据）

工具面/对象面的规范化 JSON。约定：

- 每个工具（或对象类型）给出：`name`、`description`（语义摘要，中文）、参数
  （JSON Schema 风格 `parameters`）、返回形状 `returns`、错误码 `errors`；
- 对象面（SDK 绑定对象）以 `objects` + `members` 枚举成员，标注平台/后端限制；
- **每个文件头部必须有 `_provenance` 字段**：

```json
{
  "_provenance": {
    "status": "实测+文档",
    "evidence": ["agents/zcode/computer-use.md §3.2", "agents/zcode/evidence/inventory.md §2.2"],
    "note": "手写整理的接口事实，非反编译产物；个别推断字段在字段级 note 标注"
  }
}
```

`status` 取值：`实测`（本机文件/二进制/日志直接可见）、`文档`（随包官方文档/类型声明）、
`推断`（旁证推导，需复核）。混合时写 `实测+文档` 等，并把推断细节放进字段级 `note`。

### 3. reference/（重构参考实现）

基于分册**行为规格**自行撰写的 cleanroom 骨架，**不是**任何一方产品的反编译产物。

约定：

- **TypeScript 优先**（`.ts`，仅用可擦除语法：类型标注 / interface / type alias；
  Node ≥ 22.6 / 26 原生 type-stripping 可直接运行，无需编译步骤）；
- 实现分册记录的**协议形状与核心机制**（观察→动作→验证循环、租约、防重放、
  ref 句柄、tier 权限门、AX diff……），不要求连真实服务——每个 reference 自带
  一个内存 mock（broker / 服务 / 页面）来驱动自测；
- 每个模块的中文注释标注**对应哪家产品的哪个机制**，并引用分册相对路径作为机制出处
  （例：`机制出处：agents/zcode/computer-use.md §6.3（CONTROLLER_BUSY 永不重试）`）；
- 每个 `reference/` 目录**必须有一个 `test.mjs`**（纯 Node 断言脚本，零外部依赖），
  覆盖该产品分册记录的核心行为。

---

## 合规声明

1. 本目录**不含**任何专有整文件、二进制、打包 JS、npm 内部包内容或凭据；
2. `schemas/` 是**手写整理的接口事实**（来自只读静态逆向与随包文档），不是任何专有源码的复制；
3. `reference/` 是 **cleanroom 重构实现**：仅依据分册描述的公开可观察行为撰写，
   注释引用的是本仓库自己的逆向文档，而非原产品代码；
4. 与仓库根 [LICENSE](../LICENSE)（MIT）一致，本目录全部内容按 MIT 提供，
   与被逆向的各产品无隶属关系。

---

## 目录索引

### 本轮详注的四个 agent（schemas + reference 均带自测）

| 路径 | 内容 | 对应分册 |
|---|---|---|
| [zcode/schemas/computer-tools.json](zcode/schemas/computer-tools.json) | 14 个 computer 工具（wire 名/tier/参数/返回/错误码） | agents/zcode/computer-use.md §3.2 |
| [zcode/schemas/browser-api.json](zcode/schemas/browser-api.json) | 浏览器对象面（api.json manifest v11 成员枚举）+ 绑定对象方法签名 + wire 命令 | agents/zcode/browser-use.md §3 |
| [zcode/reference/](zcode/reference/) | computer-use-client 风格 SDK 重构 + 内存 mock broker（观察→动作→验证闭环自测） | agents/zcode/computer-use.md |
| [codex/schemas/cua-surface.json](codex/schemas/cua-surface.json) | `@oai/cua` tinyskyAlt 统一 `cua` 面（桌面半边 + 浏览器半边 + Target 接口 + computer.* 逃逸口 + Sky 传输形状） | agents/codex/computer-use.md §3 |
| [codex/schemas/mcp-tools.json](codex/schemas/mcp-tools.json) | cua_repl 的 js / js_reset / turn_ended 三 MCP 工具与环境面 | agents/codex/computer-use.md §2 |
| [codex/reference/](codex/reference/) | tinyskyAlt 风格统一 cua 全局对象 + AX diff 模拟器 + JSON-RPC 帧协议 + mini REPL | agents/codex/computer-use.md |
| [claude-code/schemas/computer-tools.json](claude-code/schemas/computer-tools.json) | 42 个桌面 CU 工具（display-scope / app-scoped / teach 三控制域） | agents/claude-code/computer-use.md §3 |
| [claude-code/schemas/browser-tools.json](claude-code/schemas/browser-tools.json) | 23 个浏览器 BU 工具（tabs_* / read_page / computer(action) / browser_batch 等） | agents/claude-code/browser-use.md §2 |
| [claude-code/schemas/control-domains.json](claude-code/schemas/control-domains.json) | 三控制域 + tier 分级 + 授权/租约/权限模式模型 | agents/claude-code/computer-use.md §2、§6 |
| [claude-code/reference/](claude-code/reference/) | MCP server 骨架（stdio JSON-RPC，全工具注册 + 内存模拟器 + tier 权限门） | agents/claude-code/computer-use.md |
| [cursor/schemas/computer-tools.json](cursor/schemas/computer-tools.json) | 16 个 CU 工具（macOS companion）+ Windows 变体 + refusal 契约 | agents/cursor/computer-use.md §3 |
| [cursor/schemas/browser-tools.json](cursor/schemas/browser-tools.json) | 16 个 BU 工具（含 browser_lock）+ data-cursor-ref 机制 + CDP 拒绝列表 | agents/cursor/browser-use.md §3、§7 |
| [cursor/reference/](cursor/reference/) | MCP provider 工具注册面 + ref 句柄分配/校验器 + 合成 DOM 事件派发器 | agents/cursor/browser-use.md §4–§5 |

### 其余 agent 目录（同一规范整理，细节见各自 README）

| 路径 | 说明 |
|---|---|
| [kimi-code/](kimi-code/README.md)、[minimax-code/](minimax-code/README.md)、[qoder/](qoder/README.md)、[synara/](synara/README.md) | agents/ 分册的其余四个 agent（qoder 含 qwen-node-repl vendor，minimax/synara 含 cua-driver contract vendor） |
| [devin/](devin/README.md)、[goose/](goose/README.md)、[grok/](grok/README.md)、[mimo/](mimo/README.md) | 扩展整理的补充 agent（goose 含 goose-mcp vendor，mimo 含 mi 插件 vendor） |

---

## 如何运行 reference 自测

零依赖、零安装（Node ≥ 22.6，本机验证于 Node v26.7.0；`.ts` 由 Node 原生 type-stripping 直接执行）：

```bash
# 逐个运行
node source/zcode/reference/test.mjs
node source/codex/reference/test.mjs
node source/claude-code/reference/test.mjs
node source/cursor/reference/test.mjs

# 一键全跑
for d in source/*/reference; do node "$d/test.mjs" || exit 1; done
```

每个 `test.mjs` 是纯 Node 断言脚本（`node:assert/strict`），输出逐项 `ok` 与末行
`ALL PASSED`；任何断言失败即非零退出。
