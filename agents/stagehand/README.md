# Stagehand（Browserbase）· "Playwright + AI 逃生舱"的浏览器 Agent SDK

> 一句话结论：**v4 把 v3 的内置 agent 循环拆掉了——控制流归开发者代码，AI 只在 act/observe/extract 三个逃生舱原语里出现，其余全是确定性浏览器自动化**。
> 基线：上游 `browserbase/stagehand` workspace 4.0.0（sdk-ts 4.1.0），commit `fdd17958`（2026-10-06），**MIT**。本机无安装（纯 SDK），全部分析基于上游源码与官方文档。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 载体 | npm/pip/go SDK（`@browserbasehq/stagehand` 4.1.0）+ 浏览器内 MV3 扩展 Runtime 1.0.2 |
| 形态 | 库（嵌入你的进程）+ 浏览器扩展（推理与执行在 service worker 里） |
| CU 工具面 | **0 个**（无桌面控制，浏览器-only，见判定书） |
| BU 工具面 | 3 原语（act/observe/extract）+ 77 个确定性 API（goto/locator/cookies…，共 80 个 RPC） |
| 安全模型 | 浏览器沙箱边界 · 变量占位符防泄漏 · 缓存/自愈全降级 |
| 本机可用 | ❌未安装（2026-10 基线；npx 即可起） |

## TL;DR

1. **半自动"生产派"，与已测 12 家全自动 agent 是不同物种**：v4 无 task 概念、无 agent 循环（官方迁移文档："There is no `Agent`"）；每步推理只在逃生舱调用处发生，确定性步骤零 token。
2. **act 双分派是范式核心**：传字符串→"AX 快照→结构化推理→elementId→xpath→确定性执行"；传 Action 对象（observe 的返回值）→**零推理直执行**。自动化脚本随时间"沉淀"为纯代码。
3. **观察不走截图**：页面感知 = CDP `Accessibility.getFullAXTree` + `DOM.getDocument` 合成的 `[帧序-backendNodeId] role: name` 文本树；截图仅 extract 可选附加。
4. **自愈 + 缓存双保险**：selfHeal:on 时执行失败重推选择器重试一次；服务端缓存（Browserbase API+Redis）按"指令+DOM 键"命中后**无 LLM 确定性重放**选择器序列，重放失败回退全推理。
5. **运行时在浏览器里**：SDK 是瘦客户端，JSON-RPC over CDP（`Runtime.evaluate`→扩展 binding 回包）；推理与页面执行同侧，省跨网络往返。
6. **模型三路抽象**：`{source:"client"}` 反向 RPC（本地模型接入口）／BYO key AI SDK 直连（openai/anthropic/google/groq/cerebras）／Browserbase Model Gateway 自动选型。
7. **Playwright 是形状不是依赖**：v4 零 Playwright 包，`page.locator().click()` 等 API 面为自研 understudy 层复刻（`>>` 跨 iframe、Shadow DOM 穿透），与 Playwright 无 interop。
8. **vendor 可行**：MIT 整仓，三原语核心实现子集已按 PROVENANCE 搬运；cleanroom 骨架 + 9 断言自测 ALL PASSED。

## 架构分层图

```
开发者代码（控制流 owner，v4 无内置循环）
 └─ SDK 瘦客户端  Stagehand.act/observe/extract + Page/Locator（Playwright 形状）
     └─ JSON-RPC over CDP  Runtime.evaluate→__stagehandReceiveFromHost ／ ←addBinding 回包
         └─ Stagehand Runtime（MV3 扩展 service worker，chrome.debugger）
             ├─ 三原语 service（act/observe/extract）+ cacheService（服务端缓存拦截）
             ├─ understudy（自研 Playwright 形状驱动：Locator/Page/深选择器/AX 快照）
             └─ CDP → 页面  Accessibility.getFullAXTree + Input/DOM 执行
 模型三路：client 反向 RPC ／ AI SDK 直连 ／ Browserbase Model Gateway（{api}/llm）
 可选云：Browserbase 会话（/v1/sessions）+ Search/Fetch + 四区域 Stagehand API
```

## 能力矩阵（对照锚点）

| 能力 | Stagehand v4 | 对照：browser-use 系全自动 | 对照：Goose（MCP 外挂派） |
|---|---|---|---|
| 任务循环 | ❌ 无（控制流=开发者代码） | ✅ Agent(task).run() | 循环在 goose 内核 |
| 自然语言动作 | ✅ act/observe/extract 三原语 | ✅ 每步 | 经 MCP 工具间接 |
| 确定性 API | ✅ 77 个（Playwright 形状） | 弱（少量绕过用） | 取决于所挂 MCP server |
| 页面感知 | AX 树文本 + elementId | 截图/set-of-marks | 见各自分册 |
| self-heal | ✅ 重推选择器重试一次 | 循环内反思 | ❌ |
| 动作缓存重放 | ✅ 服务端缓存，无 LLM 重放 | ❌ | ❌ |
| CU 桌面控制 | ❌（唯一零 CU 被测对象） | ❌ | ✅ Peekaboo 透传 |
| 许可证 | **MIT**（可 vendor） | MIT | Apache-2.0 |

## 快速验证

```bash
git clone --depth 1 https://github.com/browserbase/stagehand /tmp/stagehand-src
cd /tmp/stagehand-src && git log -1 --format='%H'     # fdd17958…（2026-10-06）
head -3 LICENSE                                        # MIT, Copyright (c) 2024 Browserbase Inc.
ls packages/                                           # sdk-ts extension protocol cli sdk-python sdk-go …
sed -n '104,113p' packages/extension/services/actService.ts   # act 双分派：非字符串→确定性直执行
grep -rn "getFullAXTree" packages/extension/understudy/frame.ts # :104 AX 观察源
node source/stagehand/reference/test.mjs               # 本仓库骨架自测 → ALL PASSED
```

## 文档结构

- [computer-use.md](computer-use.md) — CU 判定书：零桌面控制判定、负证据排查、三个易误判点
- [browser-use.md](browser-use.md) — 三原语语义表、混合范式对照、自愈/缓存、CDP 通道、模型抽象、Playwright 兼容层、云集成面
- [evidence/inventory.md](evidence/inventory.md) — 全部 文件:行号 证据映射 + 低置信点
- [../../source/stagehand/](../../source/stagehand/README.md) — vendor（MIT 子集）/ schemas / cleanroom reference
