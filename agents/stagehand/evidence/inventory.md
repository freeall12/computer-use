# evidence/inventory.md —— Stagehand 证据映射

> 基线：上游 clone `/tmp/stagehand-src`，commit `fdd179582b6b1f9e43c3d18ad27917cf2e66631e`（2026-10-06 17:40 UTC-7，shallow HEAD）。
> 路径相对 `packages/`（monorepo）。版本：workspace 4.0.0 / sdk-ts 4.1.0 / extension 1.0.2 / protocol 2.0.0。
> 方法：只读静态分析；未修改本机任何文件；本机无 stagehand 安装。

## A. 仓库与许可证

| 证据 | 位置 |
|---|---|
| MIT，"Copyright (c) 2024 Browserbase Inc." | 根 `LICENSE:1-2`（全文 21 行） |
| `"license": "MIT"` | 根 `package.json:7` |
| monorepo 布局 cli/docs/evals/examples/extension/integrations/protocol/sdk-go/sdk-python/sdk-ts | `ls packages/` + `pnpm-workspace.yaml` |
| 版本号 | `packages/sdk-ts/package.json:3`（4.1.0）、`packages/extension/package.json:3`（1.0.2）、`packages/protocol/package.json:3`（2.0.0）、根 `package.json:2`（workspace 4.0.0） |
| v4 = "protocol-first monorepo"，TS/Python/Go 共享核心 | 根 `CHANGELOG.md` "## TypeScript SDK 4.0.0" Major Changes 段 |

## B. 运行时架构：瘦客户端 + 浏览器内扩展

| 结论 | 证据 |
|---|---|
| SDK 是瘦客户端，AI 逻辑在浏览器扩展里 | `sdk-ts/src/stagehand.ts:193`（RPCClient 挂在 browser.cdpClient 上）、`:208-211`（stagehandInit 只发参数）；扩展承担全部推理与执行（`extension/services/*`） |
| 扩展是 MV3 service worker，权限 debugger/offscreen/scripting/tabs | `extension/manifest.json`（`"manifest_version": 3`、permissions、background.service_worker、content_scripts all_frames ISOLATED world） |
| 扩展经 CDP `chrome.debugger` 驱动页面（扩展内自带 CDP 客户端） | `extension/understudy/frame.ts:95-118`（`Accessibility.getFullAXTree`）、`extension/understudy/browserWebSocketTransport`（service-worker.ts:35 注入 `browserWebSocketFactory`） |
| 传输 = JSON-RPC over CDP：SDK 侧 `Runtime.evaluate` 调 `globalThis.__stagehandReceiveFromHost(JSON)` 送指令 | `sdk-ts/src/cdpClient.ts:112-121`（stagehandMessageExpression）、`:413-429`（Runtime.evaluate, awaitPromise:false, returnByValue:true） |
| 回程走 CDP Runtime.addBinding `__stagehandSendToHost` | `protocol/schema-registry.ts:124`（`STAGEHAND_SEND_TO_HOST_BINDING = "__stagehandSendToHost"`）、`sdk-ts/src/cdpClient.ts:383-390`（Runtime.addBinding） |
| 扩展装载：CDP `Extensions.loadUnpacked`（本地）或 `Extensions.getExtensions` 发现预装（Browserbase） | `sdk-ts/src/cdpClient.ts:752-780`（loadUnpacked，失败提示 `--load-extension`）、`:629-645`（discoverInstalledStagehandExtensionId）、`sdk-ts/src/browser/factories.ts:99,136,172,205`（extensionDir/extensionId/preloadedExtension 三模式） |
| 附着到扩展 service worker：`Target.attachToTarget` + `Runtime.enable` | `sdk-ts/src/cdpClient.ts:361-391`（waitForServiceWorker → attachToTarget flatten:true） |
| 协议版本协商，不匹配快速失败 | `sdk-ts/src/cdpClient.ts:8-11`（negotiateRuntimeCompatibility）、`:113-115`（RUNTIME_INCOMPATIBLE_REMEDIATION）、`protocol/schemas.ts:1594-1600`（RuntimeDescriptorSchema，serverInfo.name 必须 "stagehand"） |
| SDK 可把回调函数序列化送进扩展批量执行 | `sdk-ts/src/stagehand.ts:162-165`（Function.prototype.toString 校验）、`cdpClient.ts:94-110`（callbackBatchExpression） |

## C. 三原语（act / observe / extract）

### C1. act

| 结论 | 证据 |
|---|---|
| 双分派：Action 对象 → 纯确定性执行，字符串 → 推理管线 | `extension/services/actService.ts:104-113`（`typeof actInstruction !== "string"` → `takeDeterministicAction` 直执行）；官方文档同义转述 `packages/docs/v4/basics/act.mdx:25` |
| 推理管线：等 DOM 静默 → captureSnapshot → buildActPrompt → inference.act → elementId→xpath → 执行 | `actService.ts:120,152-196`（waitForDomNetworkQuiet、runActPipeline） |
| LLM 响应 schema：`{action:{elementId,description,method,arguments}, twoStep}`，elementId 格式 `^\d+-\d+$`（帧序-backendNodeId） | `extension/inference.ts:60-85`（ActInferenceSchema）、`:39-43`（ObservationSchema 同格式） |
| elementId→xpath 由快照的 xpathMap 确定性解析，`selector: "xpath=${xpath}"` | `actService.ts:466-504`（normalizeActInferenceElement，:499 拼装） |
| 确定性执行 = understudy 方法表分发（Playwright locator 语义） | `extension/handlers/handlerUtils/actHandlerUtils.ts:47-99`（performUnderstudyMethod）、`:118-136`（METHOD_HANDLER_MAP：click/fill/type/press/scrollTo/nextChunk/prevChunk/selectOptionFromDropdown/hover/doubleClick/dragAndDrop） |
| 支持方法枚举 11 个 | `extension/types/private/handlers.ts:2-14`（SupportedUnderstudyAction） |
| twoStep：首动作后重快照，diff 树上第二次推理补完 | `actService.ts:194-245`（diffCombinedTrees + buildStepTwoPrompt） |
| 变量 `%key%` 替换发生在执行参数，不进 prompt 明文 | `actService.ts:506-519`（substituteVariablesInArguments）、`:354-355`（placeholderArgs 与 resolvedArgs 分离） |
| usage 聚合（多次推理累加） | `actService.ts:87-89,542-563` |
| 无 Loops/无内置任务循环：v4 移除 v3 的 agent() 编排器 | `packages/docs/v4/migrations/v3.mdx`（"`agent()` … wrapped act/extract/observe in a loop … Now, that built-in orchestrator is gone. v4 exposes discrete tools and leaves the control flow to you."） |

### C2. observe

| 结论 | 证据 |
|---|---|
| 缺省指令："Find elements that can be used for any future actions…" | `extension/services/observeService.ts:21-22` |
| 输出 Action[]，selector 归一化为 `xpath=…`，可直接喂 act(Action)/page.locator | `observeService.ts:113-156`（:151 `selector: \`xpath=${sourceXpath}\``） |
| elementId 解析不出 xpath → 元素丢弃并 warn | `observeService.ts:117-124` |
| dragAndDrop 目标 ID 校验 `^\d+-\d+$` + 二次 xpath 解析 | `observeService.ts:127-148` |
| 结果可入缓存（cacheValue = actions） | `observeService.ts:183` |

### C3. extract

| 结论 | 证据 |
|---|---|
| Zod schema 在 SDK 侧转 JSON Schema 过线，扩展侧 z.fromJSONSchema 还原 | `sdk-ts/src/stagehand.ts:299`（z.toJSONSchema）、`extension/services/extractService.ts:123` |
| 缺省 schema `{extraction: string}` | `protocol/schemas.ts:1670-1673`（DefaultExtractDataSchema） |
| 非对象 schema 包 `{value: …}` 再解包 | `extractService.ts:124-130,175-177` |
| 链接字段：LLM 只回 DOM 数字 ID，抽取后从 urlMap 回填真实 URL | `extractService.ts:22-28`（transformUrlStringsToNumericIds）、`:131,167-174`（injectUrls） |
| `options.screenshot:true` 附视口 PNG（图像块），并旁路缓存（缓存键不含像素） | `extractService.ts:75-79`（注释）、`:108-110,133-139` |
| 完成度判定 = 第二次 metadata 推理 `{progress, completed}` | `extension/inference.ts:23-32,146-159`（ExtractMetadataSchema + 二次 generateStructured） |

## D. 观察输入：混合 DOM+AX 快照

| 结论 | 证据 |
|---|---|
| 每帧 `Accessibility.getFullAXTree`（CDP），与 `DOM.getDocument` 混合 | `extension/understudy/frame.ts:95-118`、`extension/understudy/a11y/snapshot/capture.ts:42-59`（五步流程注释：scoped 快照→session DOM 索引→逐帧切片+AX→iframe 前缀→合并） |
| 树文本行格式 `[帧序-backendNodeId] role: name [selected|checked]`，两空格缩进 | `extension/understudy/a11y/snapshot/treeFormatUtils.ts:8-22`（formatTreeLine） |
| 帧序-backendNodeId 拼装点 | `capture.ts:851`（`${page.getOrdinal(parent)}-${ownerBackendNodeId}`）、`:753-758`（parseEncodedBackendNodeId） |
| iframe 子树注入父 iframe 行下（单棵合并树） | `treeFormatUtils.ts:24-61`（injectSubtrees）、`capture.ts:895-934`（mergeFramesIntoSnapshot） |
| locator 作用域快照（focusLocator 缩小树）与 ignoreLocators 排除区间 | `capture.ts:77-118`（tryScopedSnapshot/exclusion intervals）、`extension/understudy/a11y/snapshot/a11yTree.ts:55-101`（子树收窄） |
| URL map：AX 节点 url 属性 → elementId 映射（extract 回填用） | `a11yTree.ts:239-249`（extractUrlFromAXNode）、`:107-115` |
| diff：行级集合差，忽略缩进 | `treeFormatUtils.ts:76-105`（diffCombinedTrees） |

## E. self-heal 与缓存

| 结论 | 证据 |
|---|---|
| selfHeal 是实例级 init 参数 | `protocol/schemas.ts:1645`（`selfHeal: z.boolean().optional()`，位于 StagehandInitParamsSchema 1623-1657） |
| 执行失败 + selfHeal:on → 重快照、以 `method + description` 重推选择器、重试一次 | `actService.ts:375-396`（分支）、`:399-464`（selfHealAction；:412-416 指令重构）、`:456-459`（"after self-heal" 失败语义） |
| 缓存 = 服务端（Stagehand API + Redis）；客户端上报原始 AX 树，服务端算键（DOM shaping/hashing、URL 归一化） | `extension/services/cacheService.ts:22-35`（设计注释） |
| 需要 Browserbase apiKey + sessionId 才启用；实例级默认 + 每请求覆盖 | `cacheService.ts:62-73`（buildCacheContext）、`:232`（`caching ?? context?.defaultCaching ?? true`） |
| 缓存键字段：method+url+cdpTree+data（instruction/schema/variables/timeout） | `cacheService.ts:84-119`（buildActCacheData 等）、`:243-249`（baseRequest） |
| locator/ignoreLocators 请求旁路缓存（服务端键契约覆盖不了作用域） | `cacheService.ts:121-128`（shouldBypassCacheForLocatorScope）、`:128`（act 调用处 bypass） |
| HIT → act 无 LLM 确定性重放（selfHeal 关）；重放失败 → missReason="replay_failed" → 全推理回退 | `actService.ts:132`（onHit: replayCachedActions）、`:249-284`（replayCachedActions 注释与 throw 语义）、`cacheService.ts:266-289`（hitMetadata/missMetadata） |
| 缓存任何环节失败静默降级直执行，绝不破坏动作 | `cacheService.ts:33-35`（注释）、`:256-263`（读失败 warn）、`:322-329`（写失败 warn） |
| threshold 可按请求覆盖（命中所需次数） | `cacheService.ts:340-348`（withCacheThreshold）、`protocol/schemas.ts:682-688`（CachingSchema） |
| 官方文档佐证重放语义 | `packages/docs/v4/best-practices/caching.mdx:336`、`v4/basics/act.mdx:583`（"Replaying an Action skips model inference, the page snapshot, and the DOM-settle wait, and it does not consult the server-side cache"） |
| 区域端点 api.stagehand.browserbase.com 等 4 区 | `extension/clients/stagehandApi.ts:4-15` |

## F. 模型抽象

| 结论 | 证据 |
|---|---|
| 三路分派：client 引用（反向 RPC）/ BYO key（AI SDK 直连）/ 无 key（Model Gateway） | `extension/services/llmService.ts:13-33` |
| client 引用：SDK 侧注册 `llm.generate` 请求处理器，推理发生在宿主进程 | `sdk-ts/src/stagehand.ts:200-205`（rpcClient.onRequest(StagehandMethods.llmGenerate, model.generate)）、`schema-registry.ts:171-174`、`extension/llm/clientLlmClient.ts:11-19` |
| BYO key：Vercel AI SDK，provider 前缀 openai/anthropic/google/groq/cerebras | `extension/llm/aiSdkClient.ts:1-6`（五个 @ai-sdk/*）、`:131-169`（createAiSdkLanguageModel switch）、`protocol/schemas.ts:182-186`（ModelProviderSchema） |
| Model Gateway：OpenAI Responses 端点 `{apiUrl}/llm`，`x-bb-api-key`/`x-bb-session-id` 头鉴权，无 model 字段时剥离 model（自动选型） | `extension/llm/gatewayClient.ts:23-62`（fetchWithoutModel:23 / createGatewayLanguageModel:45）、docs `v4/configuration/models.mdx:63-71`（三路路由表） |
| 结构化输出统一 `response_format: json_schema`，非 json_schema 返回即抛错 | `extension/inference.ts:94-125`（generateStructured）、`:116-118` |
| prompt 侧：用户附加 systemPrompt 拼入；extract 明令"链接只回元素 ID" | `extension/prompt.ts:27-37`（buildUserInstructionsString）、`:60-62`（additionalInstructions） |

## G. Playwright 兼容层

| 结论 | 证据 |
|---|---|
| v4 无 Playwright 依赖（drives Chromium over CDP） | `packages/sdk-ts/package.json`（grep playwright/puppeteer 零命中）；docs `v4/migrations/playwright.mdx:7`（"no Playwright dependency… There is no interop; moving a flow to Stagehand means porting it"） |
| 客户端 Locator 类 17 个动作方法 + first/nth，Playwright 形状 | `sdk-ts/src/locator.ts:24-176` |
| 客户端 Page 类：goto/reload/goBack/goForward/click/hover/scroll/dragAndDrop/type/keyPress/screenshot/pdf/evaluate/… + page.locator(selector) | `sdk-ts/src/page.ts:90-446`（:416 locator） |
| 协议方法族统计：page 31 / context 17 / locator 17 / stagehand 8 / response 6 / llm 1 = 80 | `protocol/schema-registry.ts`（`name: "` 计数，2026-10-07） |
| 扩展内自研驱动层代号 understudy（Locator/FrameLocator/Page/cookies/pdf/深选择器） | `extension/understudy/`（locator.ts 993 行、deepLocator.ts 273 行、page.ts 2400+ 行） |
| 深选择器：`>>` 跳步 + XPath 跨 iframe 解析 + Shadow DOM 穿透 | `extension/understudy/deepLocator.ts:53-80`（resolveLocatorWithHops）、`capture.ts:67`（pierceShadow 默认 true） |
| v3 血统：actHandlerUtils 文件头注释保留 lib/v3 路径 | `extension/handlers/handlerUtils/actHandlerUtils.ts:1` |
| 官方定位"Playwright-style methods you and your agents already know" | 根 `README.md:296,435` |

## H. Browserbase 云集成面（静态记录）

| 项 | 值 | 证据 |
|---|---|---|
| 会话创建/连接 | browserbase.launch({apiKey,…}) / browserbase.connect(sessionId)；本地 localBrowser.launch（spawn Chrome，50+ 默认 flags） | `sdk-ts/src/browser/factories.ts:71-143,145-228`、`sdk-ts/src/browser/localBrowser.ts:11-47`（DEFAULT_CHROME_FLAGS） |
| Stagehand API 区域 | us-west-2/east-1、eu-central-1、ap-southeast-1 → api[.use1/.euc1/.apse1].stagehand.browserbase.com | `extension/clients/stagehandApi.ts:4-9` |
| API 用途 | 服务端缓存（/v1 stateless routes）+ Model Gateway（{api}/llm） | `cacheService.ts:22-31`、`gatewayClient.ts:13-23` |
| Search/Fetch 加值服务 | browserbase.search(query,numResults?) / browserbase.fetch(url,{format}) | `sdk-ts/src/browser/factories.ts:219-227`、`browserbaseServices.ts:8-22,34-52`、CHANGELOG 4.1.0 |
| keepAlive 所有权语义 | launched+非 keepAlive 归 SDK 释放；connect 别人的会话不拥有 | `factories.ts:268,325-327`（注释） |
| stagehand.close 保留浏览器供再次附着 | CHANGELOG 4.1.0 #2818、`stagehand.ts:309-335` | |

## I. 其余机制（旁证）

| 项 | 证据 |
|---|---|
| WebMCP：发现/调用页面暴露的 MCP 工具（含 OOPIF） | `sdk-ts/src/webmcp.ts:13-45`、`schema-registry.ts`（page.webmcp_* 4 个方法）、CHANGELOG 4.1.0 #2878、docs `v4/basics/webmcp.mdx` |
| 批处理 experimentalBatch：回调序列化到扩展内执行 | `stagehand.ts:133-189`、`cdpClient.ts:94-110` |
| MV3 service worker 保活 heartbeat（offscreen 页面） | `extension/service-worker-lifecycle/heartbeat-manager.ts`、manifest permissions offscreen |
| OTel traces | `extension/tracing.ts`、`protocol/schemas.ts:1608-1621`（TelemetryConfigSchema，endpoint 须以 /v1/traces 结尾） |
| metrics：三原语 token/时长聚合 | `protocol/schemas.ts:626-651`（StagehandMetricsSchema）、`stagehand.ts:129-131` |
| 本机无安装 | `command -v stagehand` 空；无全局 npm 包；分析基线为 /tmp 浅克隆 |

## J. 低置信点

1. **`selfHeal` 的默认值**：schema 里是 optional（`protocol/schemas.ts:1645`），上游 SDK 未在 clone 内显式赋默认值；官方文档写"Turn on selfHeal"（act.mdx:44）暗示默认关，但未见一行式默认值定义。判定"默认关"基于文档措辞，置信中等。
2. **v3 的 Playwright 依赖细节**：本 clone 是 v4 shallow，未回溯 v3 tag 核实 v3 SDK 依赖树里 Playwright 的确切用法（仅从 v4 文档措辞与 actHandlerUtils 的 lib/v3 路径注释推断）。对 v4 结论无影响。
3. **Model Gateway 自动选型算法**：服务端闭源，客户端只见"无 model 字段 → 剥离后转发"（gatewayClient.ts:23-43），选型逻辑不可见，分册只记录契约不记录行为。
4. **服务端缓存的键算法**：客户端只上报原始树（cacheService.ts:367-396），DOM shaping/hashing/URL 归一化全在服务端（闭源）；reference 的"指纹剥离 elementId"是 cleanroom 近似，非上游算法复刻。
