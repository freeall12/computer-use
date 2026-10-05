# PROVENANCE —— vendor/ 搬运来源与合规声明

## 1. 上游标识

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/block/goose （Cargo.toml `repository` 字段现为 https://github.com/aaif-goose/goose ） |
| 修订 | commit `5bd5e548e2930ad155cb95877f62f7c7a65bec33`（2026-10-05 17:20 UTC，shallow clone HEAD） |
| 版本 | workspace 1.53.0 |
| 上游许可证 | **Apache-2.0**（全文见本目录 [`LICENSE-apache-2.0.txt`](LICENSE-apache-2.0.txt)，逐字节取自上游根 LICENSE） |
| 搬运方式 | `cp` 原样拷贝，**零修改**；仅做文件名平铺（`<module>/mod.rs` → `<module>.mod.rs`），路径映射见 §2；逐文件 SHA-256 完整性见 §3（已核对与上游一致） |

## 2. 文件清单与路径映射

| 本仓库路径 | 上游路径（相对仓库根） | 行数 | 内容 |
|---|---|---|---|
| `goose-mcp/lib.rs` | `crates/goose-mcp/src/lib.rs` | 101 | feature gate（`computer-controller` 等）+ `BUILTIN_EXTENSIONS` 注册表 + in-process duplex spawn —— builtin extension 容器 |
| `goose-mcp/computercontroller.mod.rs` | `crates/goose-mcp/src/computercontroller/mod.rs` | 888 | **Computer Controller extension 全文**：`computer_control`（Peekaboo CLI 透传）+ `xlsx_tool`/`docx_tool`/`pdf_tool` + 内嵌命令手册 instructions |
| `goose-mcp/peekaboo.mod.rs` | `crates/goose-mcp/src/peekaboo/mod.rs` | 85 | Peekaboo 安装检测 + brew 自动安装（`steipete/tap/peekaboo`） |
| `goose-platform-ext.mod.rs` | `crates/goose/src/agents/platform_extensions/mod.rs` | 318 | `PLATFORM_EXTENSIONS` 注册表（developer/analyze/todo/apps/chatrecall/extensionmanager/scheduler/summon/summarize/code_execution/orchestrator） |
| `goose-permission/goose_mode.rs` | `crates/goose-provider-types/src/goose_mode.rs` | 32 | `GooseMode { Auto, Approve, SmartApprove, Chat }` |
| `goose-permission/permission.rs` | `crates/goose-provider-types/src/permission.rs` | 23 | `Permission { AlwaysAllow, AllowOnce, Cancel, DenyOnce, AlwaysDeny }` + `PrincipalType` |
| `goose-permission/config-permission.rs` | `crates/goose/src/config/permission.rs` | 590 | `PermissionLevel` 三级 + `permission.yaml` 持久化 `PermissionManager`（`user`/`smart_approve` 类别） |

**未搬运**（超出 CU/BU 范围）：办公三件套的独立实现文件（`docx_tool.rs`/`pdf_tool.rs`/`xlsx_tool.rs`，被 `computercontroller.mod.rs` 内联调用其类型，逻辑全文在上游）、autovisualiser/memory/tutorial、goose 内核其余部分、桌面端 UI、文档站。需要完整实现时请回到上游仓库对应 commit 自取。

**关于 browser use**：Goose 无内置浏览器控制源码可搬（零内置，见 agents/goose/browser-use.md）；官方收录的浏览器扩展均为第三方 MCP server（Playwright MCP 等），各自许可证与上游不同，不属于"goose 上游子集"，故不在本 vendor 范围。

## 3. 完整性校验（SHA-256，2026-10-06 对 upstream commit `5bd5e548` 核对一致）

| 文件 | SHA-256 |
|---|---|
| `goose-mcp/lib.rs` | `36531f99bd530ef706262d0f450a3d14c909abb32273200900df7bf3efab8347` |
| `goose-mcp/computercontroller.mod.rs` | `5546fe4f82a9a42457afc0ebb61a99ca7f5ff3e61db785d22a775fa75d582264` |
| `goose-mcp/peekaboo.mod.rs` | `9f9f89806103cdfe96bbbf1bbab26bba068ab9e64a25101c3a58feae4fb04119` |
| `goose-platform-ext.mod.rs` | `e77c162a0ee747c33b50b29de835ad8a6513a5d3dd01f323fec5dfeee32800fa` |
| `goose-permission/goose_mode.rs` | `d5b0ae31b4882085b572ca7b595f9153f595c417f797d4ef6a50bcba1e7ebdd7` |
| `goose-permission/permission.rs` | `8eced3d168f3727ceaef1f56f5b990431d0b02b87656bf51e63549bab922fdd5` |
| `goose-permission/config-permission.rs` | `5f57b0fbb777a049968601433a73fb0da02f3b32ef97d73d73c3ca9b3c6200a3` |
| `LICENSE-apache-2.0.txt` | `44459b86c2e96fdbfd8a6b5c33d30d4b04b5293fcb2ec96fe4dcc4e0f90b8962` |

复验命令：`git clone --depth 1 https://github.com/block/goose`（或指定 commit）后 `shasum -a 256` 对应文件比对。

## 4. 为什么可以 vendor

- 上游整仓 Apache-2.0（§1 LICENSE 全文随附）；
- Apache-2.0 §4 允许再分发，条件为本文件式的 NOTICE/归属保留（见 §4）；
- 本目录不含上游未开源组件（goose 无此情况；Peekaboo 为外部运行时依赖，未搬运其代码，仅记录其 MIT 许可证与 brew 安装公式名）。

## 5. Apache-2.0 归属与 NOTICE 要求

上游根目录无独立 `NOTICE` 文件，且所搬运源文件头部不带逐文件版权注释——归属由本文件与随附的 `LICENSE-apache-2.0.txt`（上游 LICENSE 原文）承担。按 Apache-2.0 §4 的再分发条件，最小归属为：

```
Copyright 2025 Block, Inc. (AAIF / ai-oss-tools@block.xyz)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

本仓库对 vendor 文件只做**只读研究用途**的原样搬运，未修改、未构建、未再分发衍生品。

## 6. 关联

- 行为分析与证据映射：[`../../agents/goose/evidence/inventory.md`](../../../agents/goose/evidence/inventory.md) §C §E
- 工具面规范化 JSON：[`../schemas/tools.json`](../schemas/tools.json)
- cleanroom 参考实现（非本目录代码的转写）：[`../reference/`](../reference/)
