# source/stagehand/ —— Stagehand（Browserbase）三原语三层源码

> 对应分册：[agents/stagehand/](../../agents/stagehand/README.md)（总览）、[computer-use.md](../../agents/stagehand/computer-use.md)、[browser-use.md](../../agents/stagehand/browser-use.md)、[evidence/inventory.md](../../agents/stagehand/evidence/inventory.md)。

## 版本基线

| 项 | 值 |
|---|---|
| 上游 | `github.com/browserbase/stagehand` |
| 版本 | workspace 4.0.0（sdk-ts/python/go 4.1.0，extension 1.0.2，protocol 2.0.0） |
| 修订 | commit `fdd179582b6b1f9e43c3d18ad27917cf2e66631e`（2026-10-06，shallow clone HEAD） |
| 许可证 | **MIT**（上游整仓，"Copyright (c) 2024 Browserbase Inc."） |
| 语言 | TypeScript（pnpm monorepo：sdk-ts / extension / protocol / cli / sdk-python / sdk-go） |
| 本机安装 | 无（纯 SDK/库形态，本目录三层全部基于上游源码与官方文档） |

## 三层结构

```
source/stagehand/
├── schemas/tools.json   三原语协议面规范化 JSON（act/observe/extract + 模型三路 + 缓存 + 云端）
├── reference/           cleanroom 形状骨架（纯 Node 零依赖，mock DOM + mock LLM）
└── vendor/              上游 MIT 源码"三原语核心实现子集"原样搬运（附 PROVENANCE + LICENSE 全文）
```

### 1. vendor/（MIT 开源搬运）

Stagehand v4 是**瘦客户端 + 浏览器内扩展 Runtime** 双侧架构，三原语的实现横跨两侧。搬运范围 = act/observe/extract 的最小核心子集：

- **客户端侧** `sdk-ts/stagehand.ts`：三原语入口、Zod→JSON Schema、客户端模型反向 RPC 注册；
- **扩展侧** `extension/services/`（act/observe/extract/cache/llm 五个 service）+ `inference.ts`（三张推理响应 schema）+ `prompt.ts`（三套 prompt）+ `llm/`（客户端引用与 Gateway 两个适配）。

每个文件与上游逐字节一致（目录按上游 `packages/` 结构平铺），SHA-256 校验见 PROVENANCE §3。子集不可独立编译（import 私有 workspace 包与 zod），定位是行为取证与审计。

### 2. schemas/tools.json（接口数据，手写整理）

从上游 Zod schema 与源码手工转写：三原语的输入/输出/回退行为、Action 对象与 11 个支持方法、Locator 形状、模型抽象三路分派、服务端缓存契约、80 个 RPC 方法族统计、Browserbase 云端区域端点。每条带 `source` 字段（文件:行号，基于 commit `fdd17958`）。

`_provenance.status = 文档`（上游开源源码即"文档"级事实；本机无安装，无"实测"成分）。

### 3. reference/（cleanroom 参考实现）

`stagehand-mini.mjs`：纯 Node JavaScript（零依赖）重写三原语**形状**，机制出处逐条注释在文件头：

- **mock DOM**：AX 树（`[帧序-backendNodeId] role: name` 行格式）+ xpath/url 映射 + 确定性执行器（非交互元素执行即失败）；
- **mock LLM**：扮演 `{source:"client"}` 客户端模型引用，按关键词在树上确定性选元素；
- **act 双分派**：Action 对象直执行（零推理）/ 字符串走"快照→推理→elementId→xpath→确定性执行"管线；self-heal 重试一次；twoStep 二段推理；
- **缓存形状**：指令+DOM 结构指纹为键（指纹剥离 elementId，模拟服务端 DOM shaping），命中无 LLM 重放，重放失败 `missReason=replay_failed` 回退全推理；
- **observe** 默认指令收集全部可交互元素为 Action[]；**extract** 二次 metadata 推理 + URL 数字 ID 回填真实链接；变量 `%key%` 占位符替换。

`test.mjs` 9 组断言覆盖上述全部行为，`node test.mjs` 输出 `ALL PASSED (9 assertions)`。

**不是**上游代码的转写或翻译——仅按分册记录的行为规格重写。

## 许可证归属

| 目录 | 归属 | 许可证 |
|---|---|---|
| `vendor/` | Browserbase Inc.（上游 stagehand 仓库） | MIT（全文见 `vendor/LICENSE.txt`） |
| `schemas/tools.json` | 本仓库手写整理（事实来自 MIT 上游） | 随本仓库 LICENSE |
| `reference/` | 本仓库 cleanroom 撰写 | 随本仓库 LICENSE |
| Vercel AI SDK / zod（上游运行时依赖，未 vendor） | 各自上游 | Apache-2.0 / MIT（仅记录，不含其代码） |
