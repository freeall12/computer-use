# vendor/qwen-node-repl — 上游来源与修订说明

## 上游仓库

- **仓库**：<https://github.com/QwenLM/qwen-code>（Apache-2.0）
- **许可证**：Apache License 2.0（全文见 `node-repl/LICENSE`）
- **搬运日期**：2026-10-06

## 搬运的修订版本

| 项 | 值 |
| --- | --- |
| 版本 | Qoder 0.4.3 内置 node-repl v0.1.4 的上游基线 |
| 上游提交 | `b1ac3e297023a27dea8b4836fb86f0a4b4bd8b49`（2026-09-10，commit message 以 `docs(daemon): add a REST integration entry point…` 开头） |
| 证据 | Qoder.app `Contents/Resources/node-repl/UPSTREAM.md` 原文记载："源仓库 /Users/jiffies/code/qwen-code-cu/qwen-code，commit b1ac3e297023a27dea8b4836fb86f0a4b4bd8b49，原目录 packages/qwen_node_repl，Apache-2.0"（`agents/qoder/evidence/inventory.md` §2 内核上游条目） |
| 目录名差异 | Qoder 的 UPSTREAM.md 写"原目录 packages/qwen_node_repl"；在上游 commit b1ac3e29 处该包目录名为 **`packages/node-repl`**（package.json name 与目录名在此后演进过/或本地 fork 曾改名）。内容对应关系以包结构（runtime/kernel.mjs、mcp-server.ts、protocol.ts、security-policy.ts、cell-transform.ts）为准 |

## 搬运的子集

`node-repl/` = 上游 `packages/node-repl/` 在 commit b1ac3e29 的**全部 40 个 blob**（源码级，无 dist 构建产物）：

- `src/runtime/kernel.mjs` / `module-loader.mjs` —— 每 cell 用户代码内核与模块加载器
  （Qoder 侧同构物：`ELECTRON_RUN_AS_NODE=1 --experimental-vm-modules` 子进程内的内核）
- `src/kernel-manager.ts` —— 内核生命周期管理（Qoder 侧衍生出"≤8 会话/30min 闲置回收"池化）
- `src/mcp-server.ts` —— node-repl MCP 工具封装
- `src/protocol.ts` —— supervisor↔kernel 协议（与 KimiCU node-repl 的 kernel-protocol v1 同思路）
- `src/cell-transform.ts` —— cell 代码变换（top-level await/绑定持久化的编译层）
- `src/security-policy.ts` —— 安全策略（Qoder 侧对应"禁静态 import、禁 process 模块、readableRoots=[cwd]"）
- 其余：tokenizer / output-adapter / debug-log / win-path + 各自测试 + 冒烟脚本

## 与 Qoder 集成层的关系

Qoder 在此基线上做了产品化改造（**改造内容不在本仓库**，均为 Qoder 专有）：
turn 上下文注入 `_meta["com.qoder/turnContext"]`、内核池、`@qoder-space/computer-use-sdk` 的
`nodeRepl.rpc("kimi-cu" 式 trusted-service)` 桥、`QODER_CU_RUNTIME_APP_PATH` 环境注入等。
本目录仅提供内核基线，用于对照研究"JS 内核 + 工具 RPC"这一层机制。

## 合规声明

- Apache-2.0 允许再分发；LICENSE 全文随包保留。
- 未搬运 Qoder 专有代码（asar 内 out/**、@qoder-space/*、@ali/* 均不入仓库）。
- 未修改上游文件内容。
