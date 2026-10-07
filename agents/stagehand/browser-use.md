# Browserbase Stagehand：Browser Use（浏览器控制）完整逆向

> 分析基线：上游 `browserbase/stagehand` v4（commit `fdd17958`，2026-10-06，MIT）；本机无安装（纯 SDK，见 [evidence/inventory.md §A](evidence/inventory.md)）。
> 本分册回答：三原语怎么工作？"确定性代码 + AI 逃生舱"与全自动 agent 差在哪？

## 1. 结论先行

1. **判定：半自动"生产派"，不是 agent**。v4 没有任何任务循环——官方迁移文档原话"v4 has no equivalent object… There is no `Agent`"（`docs/v4/migrations/browser-use.mdx:5`）；v3 的内置 `agent()` 编排器在 v4 被移除，控制流交还开发者（`docs/v4/migrations/v3.mdx`）。
2. **AI 只出现在三个逃生舱原语里**：act/observe/extract 接受自然语言；其余 77 个 RPC 方法（goto/locator/screenshot/cookies…）全是确定性代码，零推理。
3. **观察不走截图**：页面感知 = CDP `Accessibility.getFullAXTree` + `DOM.getDocument` 合成的带 ID 文本树 `[帧序-backendNodeId] role: name`；截图仅在 `extract({screenshot:true})` 可选附加。
4. **动作执行不走像素**：LLM 只回一个 elementId + 方法名，xpath 由快照 map 确定性解析，执行走 understudy 方法表（click/fill/…11 个 Playwright 语义动作）。
5. **自愈 + 缓存双保险**：执行失败且 selfHeal:on → 重推选择器重试一次；重复动作走服务端缓存，命中后无 LLM 确定性重放。
6. **运行时在浏览器扩展里**：SDK 是瘦客户端，推理与执行发生在 MV3 service worker（`chrome.debugger` 驱动 CDP），JSON-RPC over CDP 通信。

## 2. 架构一图

```
开发者代码（控制流 owner —— v4 无内置 agent 循环）
 └─ SDK 瘦客户端  act/observe/extract + Page/Locator（Playwright 形状）
     └─ JSON-RPC over CDP  Runtime.evaluate→__stagehandReceiveFromHost ／ ←Runtime.addBinding 回包
         └─ Stagehand Runtime（MV3 扩展 service worker，chrome.debugger 权限）
             ├─ 三原语 service（act/observe/extract/cache/llm）
             ├─ understudy 层（自研 Playwright 形状驱动：Locator/Frame/Page/深选择器）
             └─ CDP → 页面：Accessibility.getFullAXTree + DOM 执行
 模型三路：{source:"client"} 反向 RPC ／ BYO key AI SDK 直连 ／ Browserbase Model Gateway
```

## 3. 三原语语义表

| 原语 | 输入 | 输出 | 回退行为（失败语义） |
|---|---|---|---|
| `act(instruction \| Action)` | 自然语言串，或 observe 返回的 Action 对象 | `{data:{success,message,actionDescription,actions[]}, metadata:{usage,cache}}`；actions=实际执行的选择器序列，可回存重放 | 选不出元素→success:false；执行失败+selfHeal:on→重快照重推重试一次（默认关，文档措辞推断，evidence §J）；缓存重放失败→missReason=replay_failed 回退全推理；twoStep→自动二段推理补完 |
| `observe(instruction?)` | 可选自然语言；缺省"找出所有可用于未来动作的元素" | `Action[]`（selector=`xpath=…`+method+arguments），可直接喂 `act(Action)` 或 `page.locator()` | elementId 解析不出 xpath→该元素丢弃 warn；dragAndDrop 目标 ID 非法→丢弃 |
| `extract(instruction, schema?)` | 自然语言 + Zod/JSON Schema（缺省 `{extraction:string}`） | schema 校验后的结构化数据 + `metadata.completed`（二次推理判定） | 链接字段先回数字 ID 后从 urlMap 回填真实 URL；非对象 schema 包 `{value}` 解包；`screenshot:true` 旁路缓存（键不含像素） |

证据：act 双分派 `actService.ts:104-113`；管线 `:152-246`；self-heal `:399-464`；observe 默认指令 `observeService.ts:21-22`；URL 回填 `extractService.ts:167-174`；二次 metadata `inference.ts:146-159`。

## 4. 混合范式对照表（vs 已测 12 家全自动）

| 决策点 | Stagehand v4（半自动生产派） | browser-use 等全自动 agent |
|---|---|---|
| 控制流 owner | **开发者代码**（模型只在逃生舱出现） | agent 循环（每步推理选动作） |
| 推理频率 | 仅 act/observe/extract 调用处；确定性步骤零 token | 每一步都是推理调用 |
| 任务表达 | 无 task 概念；流程 = 普通代码（可 review/diff/版本化） | `Agent(task="…").run()` 一句话 |
| 动作载体 | 11 个方法表动作 + 77 个确定性 API（CDP 执行） | 模型每步从工具面现选 |
| 页面感知 | AX 树文本 + elementId（无截图） | 截图/set-of-marks/DOM 混合 |
| 失败恢复 | self-heal 重试一次 + 缓存重放回退 | 循环内反思/重规划 |
| 生产形态 | npm/pip/go 包，run 在你的进程与浏览器里 | 独立框架运行时 |
| 官方自我定位 | "The SDK for browser agents"（工具箱） | "Autonomous agent" |

对照锚点：官方迁移指南逐条教"把 browser-use 的 task 拆成确定性步骤 + 逃生舱步骤"（`docs/v4/migrations/browser-use.mdx:10-17`）——这正是两个物种的分界线。

## 5. self-heal 与缓存：AI 步骤的"确定性化"双保险

| 机制 | 触发 | 行为 | 证据 |
|---|---|---|---|
| self-heal | act 执行抛错且 selfHeal:on | 重快照→以 `method+description` 重组指令重推选择器→重试一次；再失败才报错 | `actService.ts:375-396,399-464` |
| act 缓存命中 | 同指令 + 同 DOM 键 | **无 LLM** 确定性重放缓存的选择器序列（selfHeal 强制关）；重放失败→回退全推理并重写缓存 | `actService.ts:123-150,249-284`；`caching.mdx:336` |
| observe/extract 缓存 | 同上 | 命中直接返回 Action[]/数据，usage 记零 | `observeService.ts:72-81`、`extractService.ts:90-93` |
| 键与门控 | 服务端算键 | 客户端上报原始 AX 树+URL+参数；键算法（DOM shaping/hashing/URL 归一化）在 Browserbase 服务端；需 apiKey+sessionId；locator 作用域旁路 | `cacheService.ts:22-35,62-73,121-128` |
| 降级红线 | 缓存任何环节失败 | 静默降级直执行，绝不破坏动作 | `cacheService.ts:33-35,256-263,322-329` |

> 设计要点：**缓存放的是"选择器序列"而不是"答案"**——重放是真实 DOM 操作，比记 LLM 文本更抗漂移；回退链 = 重放失败→全推理→self-heal，三层递进。

## 6. CDP 通道与扩展运行时

| 环节 | 机制 | 证据 |
|---|---|---|
| 扩展装载 | 本地 Chrome：CDP `Extensions.loadUnpacked`（需支持该域的构建）；Browserbase：预装发现 | `cdpClient.ts:752-780,629-645` |
| 附着 | `Target.attachToTarget` 扩展 service worker + `Runtime.enable` + `Runtime.addBinding` | `cdpClient.ts:361-391` |
| 请求方向 | `Runtime.evaluate` 调 `__stagehandReceiveFromHost(JSON)`（awaitPromise:false） | `cdpClient.ts:112-121,413-429` |
| 响应方向 | 扩展经 CDP binding `__stagehandSendToHost` 回包 | `schema-registry.ts:124` |
| 版本协商 | RuntimeDescriptor 协议主版本不匹配即初始化失败 | `cdpClient.ts:8-11,113-115` |
| 页面驱动 | 扩展内自持 CDP 客户端（`chrome.debugger`）：AX 树、DOM 执行、截图、PDF | `frame.ts:95-118`、manifest.json |

> 为什么放扩展里：官方 README 称"runs as an extension next to the browser, cutting round-trip latency on every action"（`README.md:300`）——推理与执行同进程侧，快照不用跨网络拉回宿主。

## 7. 模型抽象（三路分派）

| 路线 | 配置 | 推理发生地 | 证据 |
|---|---|---|---|
| 客户端模型引用 | `model:{source:"client"}` + SDK 注册 generate 回调 | 宿主进程（反向 RPC `llm.generate`）——本地模型/自建网关的接入口 | `stagehand.ts:200-205`、`clientLlmClient.ts` |
| BYO key | `model:{modelName:"openai/\|anthropic/\|google/\|groq/\|cerebras/…", apiKey}` | 扩展内 Vercel AI SDK 直连 | `llmService.ts:13-33`、`aiSdkClient.ts:143-169` |
| Model Gateway | 无 model，或 model 无 apiKey（需 Browserbase 会话） | Browserbase 服务端自动选型（OpenAI Responses 端点，`x-bb-*` 头） | `gatewayClient.ts:23-62`、docs models.mdx:63-71 |

结构化输出统一走 `response_format: json_schema`，非 JSON 返回即抛错（`inference.ts:94-125`）。

## 8. 与 Playwright 的兼容层

| 面 | 形状 | 差异 |
|---|---|---|
| Locator | `page.locator(selector)` → click/hover/fill/count/isChecked/inputValue/isVisible/innerText/textContent/scrollTo/centroid/highlight/sendClickEvent/type/selectOption/setInputFiles + first/nth | API 面复刻 Playwright；实现是扩展内自研 understudy（`>>` 跨 iframe 跳步、Shadow DOM 穿透），非 Playwright 代码 |
| Page | goto/reload/goBack/goForward/click(x,y)/hover/scroll/type/keyPress/dragAndDrop/screenshot/pdf/evaluate/waitForSelector/on… | 无 `@playwright/test`（无 fixtures/expect/runner）；自动等待需显式补（migrations/playwright.mdx:80） |
| 透传边界 | **没有 interop**：不能把 Playwright Page 递给 act()，迁移=移植 | migrations/playwright.mdx:7 |
| 协议面 | 80 个 RPC：page 31 / context 17 / locator 17 / stagehand 8 / response 6 / llm 1 | schema-registry.ts 计数 |

## 9. Browserbase 云集成面（可选拓展，静态记录）

| 能力 | 端点/入口 | 说明 |
|---|---|---|
| 云会话 | `browserbase.launch/connect`（SDK 内走 @browserbasehq/sdk `/v1/sessions`） | keepAlive 控制所有权；扩展预装 |
| Stagehand API 四区域 | `api.stagehand.browserbase.com`（+use1/euc1/apse1） | 供缓存与 Model Gateway，非页面流量 |
| Model Gateway | `{apiUrl}/llm`（OpenAI Responses 形状） | 自动选型在服务端，算法闭源 |
| Search/Fetch | `browserbase.search(query)` / `browserbase.fetch(url,{format:"markdown"})` | 免浏览器加值服务（4.1.0 新增） |
| 不依赖云的部分 | 三原语+确定性 API 全量可用 | 本地 Chrome + BYO key 即完整闭环 |
