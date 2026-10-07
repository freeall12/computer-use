# PROVENANCE —— vendor/ 搬运来源与合规声明

## 1. 上游标识

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/bytedance/UI-TARS-desktop |
| 修订 | commit `2ff41a9e515828c5bd5b276e493d73aa0bdf4a3a`（2026-09-24 14:48 +0800，shallow clone HEAD，2026-10-07 取证） |
| 版本 | 桌面端 `ui-tars-desktop` 0.2.4（apps/ui-tars）；`@agent-tars/cli` 0.3.0（multimodal/agent-tars/cli） |
| 上游许可证 | **Apache-2.0**（全文见本目录 [`LICENSE-apache-2.0.txt`](LICENSE-apache-2.0.txt)，逐字节取自上游根 LICENSE，sha256 `c71d239d…35d0ab4`） |
| 搬运方式 | `cp` 原样拷贝，**零修改**；保留上游目录相对路径（映射见 §2）；逐文件 SHA-256 见 §3 |
| 特别区分 | **UI-TARS 系列模型权重不在 Apache-2.0 范围内**——BYTEDANCE UI-TARS LICENSE（HuggingFace `bytedance-research/UI-TARS-*` 仓库附带）另有限制条款；本目录只搬运代码，不含任何模型权重 |

## 2. 文件清单与路径映射

| 本仓库路径 | 上游路径（相对仓库根） | 行数 | 内容 |
|---|---|---|---|
| `gui-agent/shared/src/utils/actions.ts` | `multimodal/gui-agent/shared/src/utils/actions.ts` | 244 | 动作名/参数名归一表：`unifyActionType`（~50 别名 → 标准动作）+ `unifyActionInputName`（start_box→start 等）+ `serializeAction` |
| `gui-agent/shared/src/utils/coordinateNormalizer.ts` | `multimodal/gui-agent/shared/src/utils/coordinateNormalizer.ts` | 49 | `normalizeActionCoords`：point/start/end 三字段坐标归一化 |
| `gui-agent/action-parser/src/DefaultActionParser.ts` | `multimodal/gui-agent/action-parser/src/DefaultActionParser.ts` | 109 | 解析入口 `parsePrediction`：Thought/Action 抽取 + 错误信封 |
| `gui-agent/action-parser/src/ActionParserHelper.ts` | `multimodal/gui-agent/action-parser/src/ActionParserHelper.ts` | 572 | 函数式动作字符串 → `BaseAction`：粗糙解析（`<\|box_start\|>`/`<point>`/`<bbox>` 预处理、正则匹配）+ `standardizeAction` 归一 |
| `gui-agent/action-parser/src/FomatParsers.ts` | `multimodal/gui-agent/action-parser/src/FomatParsers.ts` | 427 | 输出格式链：XML / Omni / UnifiedBC（`Thought:`+`Action:`）/ BCComplex / 浏览器专格式五种解析器 |
| `gui-agent/agent-sdk/src/GUIAgent.ts` | `multimodal/gui-agent/agent-sdk/src/GUIAgent.ts` | 211 | Agent TARS 代的 GUI Agent：注册单一 `browser_vision_control` 工具；`onAfterToolCall` 动作后补截图 → `environment_input` 事件 |
| `gui-agent/agent-sdk/src/ToolCallEngine.ts` | `multimodal/gui-agent/agent-sdk/src/ToolCallEngine.ts` | 237 | PE 式工具调用引擎：模型**纯文本**输出 → 正则解析 → 合成 `browser_vision_control` tool call；`finished` 即停 |
| `gui-agent/operator-nutjs/src/NutJSOperator.ts` | `multimodal/gui-agent/operator-nutjs/src/NutJSOperator.ts` | 364 | 桌面执行器：nut-js 截图（grab→RGB→JPEG）+ 16 动作坐标派发（归一坐标 × 屏幕宽高 → `straightTo` 移动→点击/滚轮/按键；Windows type 走剪贴板粘贴） |
| `sdk/src/GUIAgent.ts` | `packages/ui-tars/sdk/src/GUIAgent.ts` | 605 | 桌面版 v1 SDK 主循环：while(true){截图→VLM→解析→execute}；maxLoopCount/pause/resume/abort、三级 retry（model/screenshot/execute）、`call_user`/`finished` 终态 |

**未搬运**（超出"截图/解析/坐标派发"核心范围）：`@tarko/agent` 框架内核（事件流、MCPAgent）、`packages/agent-infra`（browser/search/mcp-servers 全家）、桌面端 Electron UI、operator-browser/operator-adb/operator-aio、omni-tars/tarko 服务器、测试与示例。需要时回到上游对应 commit 自取。

**依赖说明**：所搬运 TS 文件的 import 指向 workspace 包（`@gui-agent/shared`、`@computer-use/nut-js`、`@tarko/agent` 等），本目录**不构成可独立构建单元**——vendor 层只作规格对照与出处锚定，可运行的重构见 [`../reference/`](../reference/)。

## 3. 完整性校验（SHA-256，2026-10-07 对 upstream commit `2ff41a9e` 核对一致）

| 文件 | SHA-256 |
|---|---|
| `gui-agent/shared/src/utils/actions.ts` | `454a7e3a12d12c760e4cd3a19212afb0988d61364bc81b47792ba8e1f1b91c61` |
| `gui-agent/shared/src/utils/coordinateNormalizer.ts` | `c10ef5bbbe1e25a1f85f2f4d46b9eda51b4faac790c3e0fa98d6e886e70ed91c` |
| `gui-agent/action-parser/src/DefaultActionParser.ts` | `c937e9e65e08e679ac73f942cc9177b346e260d85ed4faecae76c4d43fc92566` |
| `gui-agent/action-parser/src/ActionParserHelper.ts` | `b0af2439e14468ca25f2563fee66fb96f6ffe1eadbbc7812820f3afbec50f6f3` |
| `gui-agent/action-parser/src/FomatParsers.ts` | `fefcdffb43b6d1d9bbc44fd56f4d0bc47b0da716885eee563034aab2fdcfd160` |
| `gui-agent/agent-sdk/src/GUIAgent.ts` | `6d4deef312826f0fb536f1b811f85c414e34bd8b12064d9f31bc7df3e648151e` |
| `gui-agent/agent-sdk/src/ToolCallEngine.ts` | `bad9201dd559bcb7e1fb5a86a89a4d18de90d5918b27e3de4367761104cb526d` |
| `gui-agent/operator-nutjs/src/NutJSOperator.ts` | `f3dda4a214a637a75ad704b40963cfadc70b533ce014f14d21aa45f4473d44fc` |
| `sdk/src/GUIAgent.ts` | `036e14d2cf5db9c3bca830c8e43a8667bf25bfb866832eb3c505356d0a52017d` |
| `LICENSE-apache-2.0.txt` | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |

复验命令：`git clone --depth 1 https://github.com/bytedance/UI-TARS-desktop` 后 `shasum -a 256` 对应文件比对。

## 4. 为什么可以 vendor

- 上游整仓 Apache-2.0（README「License」节自述 + 根 LICENSE 全文随附）；
- Apache-2.0 §4 允许再分发，条件为保留归属与许可证声明（见 §5）；
- 所含文件均为上游**本身就是开源**的组件；UI-TARS 模型权重（独立许可证）未被搬运。

## 5. Apache-2.0 归属

上游文件头部自带声明（例）：

```
Copyright (c) 2025 Bytedance, Inc. and its affiliates.
SPDX-License-Identifier: Apache-2.0
```

按 Apache-2.0 §4 再分发条件，最小归属声明为：

```
Copyright 2025 Bytedance, Inc. and its affiliates

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

本仓库整体以 MIT 发行（见仓库根 LICENSE）；`vendor/` 内 Apache-2.0 文件维持其原许可证，两层许可边界即本目录。
