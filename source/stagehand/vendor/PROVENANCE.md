# PROVENANCE —— vendor/ 搬运来源与合规声明

## 1. 上游标识

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/browserbase/stagehand |
| 修订 | commit `fdd179582b6b1f9e43c3d18ad27917cf2e66631e`（2026-10-06 17:40 UTC-7，shallow clone HEAD） |
| 版本 | workspace 4.0.0；sdk-ts / sdk-python / sdk-go 4.1.0；extension 1.0.2；protocol 2.0.0 |
| 上游许可证 | **MIT**（全文见本目录 [`LICENSE.txt`](LICENSE.txt)，逐字节取自上游根 LICENSE；"Copyright (c) 2024 Browserbase Inc."） |
| 搬运方式 | `cp` 原样拷贝，**零修改**；目录按上游 monorepo 结构平铺（`packages/` 前缀省略），路径映射见 §2；逐文件 SHA-256 见 §3 |

## 2. 文件清单与路径映射（三原语核心实现子集）

v4 架构 = **瘦客户端 SDK + 浏览器内扩展 Runtime**（MV3 service worker）。三原语（act/observe/extract）的完整实现分布在两侧，本目录两侧各取核心：

| 本仓库路径 | 上游路径（相对仓库根） | 行数 | 内容 |
|---|---|---|---|
| `sdk-ts/stagehand.ts` | `packages/sdk-ts/src/stagehand.ts` | 411 | **SDK 客户端入口**：`Stagehand.create()`、`act/observe/extract` 客户端重载、`model.generate` 反向 RPC 注册（`llm.generate`）、extract 的 Zod→JSON Schema 序列化、生命周期/失败语义 |
| `extension/services/actService.ts` | `packages/extension/services/actService.ts` | 574 | **act 全文**：指令串 vs Action 对象双分派、快照→推理→确定性执行管线、twoStep 二段推理、self-heal 重推选择器、缓存命中→无 LLM 确定性重放 |
| `extension/services/observeService.ts` | `packages/extension/services/observeService.ts` | 191 | **observe 全文**：默认指令、元素→`xpath=` Action 归一化、dragAndDrop 目标二次解析 |
| `extension/services/extractService.ts` | `packages/extension/services/extractService.ts` | 213 | **extract 全文**：JSON Schema 驱动抽取、可选视口截图、URL 数字 ID→真实链接回填、二次 metadata 推理 |
| `extension/services/cacheService.ts` | `packages/extension/services/cacheService.ts` | 396 | **服务端缓存拦截器**：CDP AX 原始树上报、API 服务端算键/Redis 存取、HIT/MISS 元数据、任何失败降级直执行 |
| `extension/services/llmService.ts` | `packages/extension/services/llmService.ts` | 36 | **模型三路分派**：client 引用→反向 RPC；带 apiKey→AI SDK 直连；否则→Browserbase Model Gateway |
| `extension/inference.ts` | `packages/extension/inference.ts` | 247 | act/observe/extract 三张 Zod 推理响应 schema + `json_schema` 结构化生成调用 |
| `extension/prompt.ts` | `packages/extension/prompt.ts` | 337 | 三原语 system/user prompt 构造（含用户附加指令、变量表） |
| `extension/llm/clientLlmClient.ts` | `packages/extension/llm/clientLlmClient.ts` | 19 | 客户端模型引用的请求/校验（SDK 侧 `model: {source:"client"}` 的对端） |
| `extension/llm/gatewayClient.ts` | `packages/extension/llm/gatewayClient.ts` | 62 | Model Gateway 的 OpenAI Responses 适配（`x-bb-*` 头鉴权、剥离 model 字段的 fetch） |
| `LICENSE.txt` | `LICENSE` | 21 | 上游 MIT 许可证全文 |

**未搬运**（超出三原语核心范围）：SDK 的 CDP 传输层（`cdpClient.ts` 889 行，见分册 evidence 转述）、RPC 客户端、Page/Locator 客户端类、扩展的 understudy 层（自研 Playwright 形状驱动，`understudy/` 4900+ 行）、AX 快照管线（`a11y/snapshot/capture.ts` 934 行）、WebMCP、批处理、CLI/Python/Go SDK、文档站。需要完整实现请回上游对应 commit 自取。

**注意**：本子集不可独立编译——上游文件 import `@browserbasehq/stagehand-protocol/*`（私有 workspace 包）与 zod/v4；搬运目的是**行为取证与审计**，不是构建。

## 3. 完整性校验（SHA-256，2026-10-07 对 upstream commit `fdd17958` 核对一致）

| 文件 | SHA-256 |
|---|---|
| `sdk-ts/stagehand.ts` | `b39da1538eb8fa011e14fe063166f54bc32e771d8fb978f6501a90eb65768db4` |
| `extension/services/actService.ts` | `e67fea018a6e710d024086a466d510e0eac96c3bad31ba18513a11563c62dc62` |
| `extension/services/cacheService.ts` | `927196861d1e4b1c3fae9ceeafc1700c672fde714481d4cfff5b0050e0f1893e` |
| `extension/services/extractService.ts` | `deac01797d3e26e0fb5711dbd907a821eae63d250f33d26c1bdb0b6d525a4fea` |
| `extension/services/llmService.ts` | `20d1830cb992bc8c4d6346d128e2e571984993dddc55879d9ccdb4992b760c72` |
| `extension/services/observeService.ts` | `24ec7cfb79a2de0d745e71f253be670e58069943e953a2c467c84251e1f58431` |
| `extension/inference.ts` | `3db65e55cc4e36b9d727ceeee7c64c481d4f8bd6efd2cc400df747d4c2277f08` |
| `extension/prompt.ts` | `9db8cc70e8bbd333cae0d324623f628c89fb43afb51b78ae38eae6d8d8e38a99` |
| `extension/llm/clientLlmClient.ts` | `788cb13e9a1fe2c8307ceae03ea37603a193e7916c1255ca7851f36c6998977c` |
| `extension/llm/gatewayClient.ts` | `637c0675b3f7beb63f9329c596be71b40aa1a277066011eba063f074827d21d1` |
| `LICENSE.txt` | `fac7e7cd1cfc504054ee1fc53c38e0f3099d7357917e85a73792f6511fe0ea96` |

复验命令：`git clone --depth 1 https://github.com/browserbase/stagehand`（或指定 commit）后 `shasum -a 256` 对应文件比对。

## 4. 为什么可以 vendor

- 上游整仓 MIT（§1 LICENSE 全文随附），允许再分发，条件为保留版权与许可声明（本文件 + LICENSE.txt 即承担）；
- 本目录不含上游未开源组件——Stagehand 无服务端闭源部分被搬运（缓存/网关的**服务端**闭源，客户端只按 HTTP 契约调用，未搬运任何非公开代码）；
- 最小归属声明：

```
Copyright (c) 2024 Browserbase Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, subject to the MIT License terms at
https://opensource.org/licenses/MIT（全文见 LICENSE.txt）
```

本仓库对 vendor 文件只做**只读研究用途**的原样搬运，未修改、未构建、未再分发衍生品。

## 5. 关联

- 行为分析与证据映射：[`../../agents/stagehand/evidence/inventory.md`](../../../agents/stagehand/evidence/inventory.md)
- 协议工具面规范化 JSON：[`../schemas/tools.json`](../schemas/tools.json)
- cleanroom 参考实现（非本目录代码的转写）：[`../reference/`](../reference/)
