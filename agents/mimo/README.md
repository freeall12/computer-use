# Xiaomi MiMo（小米）· Codex sky 明示清洁室复刻 + Claude Code 形状宿主，单 `js` 工具缝合

> 一句话结论：**宿主引擎是 Claude Code 工具协议同构端，CU/BU 运行时是对 Codex Desktop 的明示复刻（产品文档自带 vs Codex 逐项比较）；模型只见一个持久 `js` REPL 工具，桌面与浏览器全在内核注入的对象图里。**

| 项 | 值 |
|---|---|
| 载体 | `Xiaomi MiMo AI.app` 26.914.142245（Electron）＋ `@mi/mimo-computer-use` 0.7.11（内部 npm restricted）＋ 签名伴生 app `MiMo Computer Use.app`（Team `DG75VEYT9V`） |
| 形态 | 单一 `js` REPL MCP 工具 · 伴生 app 持 TCC · 四重签名校验启动链 |
| CU 工具面 | `@mimo/sky` 门面 10 方法 · 免聚焦优先（SkyLight SPI 点击不抬窗） |
| BU 工具面 | `agent.browsers` 四后端（iab / extension / managed / raw CDP）· 无离散工具 |
| 安全模型 | fail-closed 插件门 · SAFETY_MODE 四档（enforce 走 elicitation）· 独家锁屏授权租约 |
| 本机可用 | ✅ CU 已启用（env=1）；⚙️ BU 能力完整未启用（env=0，负证据五面俱全）（2026-10 基线） |

## 架构一图

```
Xiaomi MiMo AI.app（Electron 26.914.142245）= MiMo Desktop Agent IDE
 MiMoCode 引擎：CC 同构工具协议；模型双协议 anthropic-messages + openai
 │ 插件开关 → 写 mimocode.jsonc：mcp.node_repl = automation-repl + CU/BU env
 ▼ stdio MCP（模型只见一个 js 工具，tools/list = ["js"]）
@mi/mimo-computer-use 0.7.11（"inspired by Codex Desktop's sky executor"）
 ├─ CU：@mimo/sky 门面 10 方法 → sky-mac（Swift AX/per-pid CGEvent/SkyLight 免聚焦/SCK）
 ├─ BU：agent.browsers 四后端（iab / extension / managed / raw CDP）
 └─ safety：CCU_SAFETY_MODE 四档 + MCP elicitation
        │ 四重签名校验后 exec 签名 App          │ Native Messaging（com.xiaomi.mimo.browser）
        ▼                                       ▼
 MiMo Computer Use.app（TCC 持有者+锁屏插件）    Browser Bridge MV3 扩展 → CDP 1.3
 ▼ https://api.xiaomimimo.com/v1（+ token-plan-{cn,sgp,ams}；模型 xiaomi/mimo-v2.5 系列）
```

## 与 Codex 对照表（本册最大价值：最明示的清洁室复刻）

| 维度 | Codex Desktop（对照源） | MiMo 复刻侧 |
|---|---|---|
| 自述 | — | "inspired by Codex Desktop's sky executor"、"reproduces OpenAI Codex Desktop's computer-use capability"；无 OpenAI 二进制依赖 |
| 工具面形状 | `js` REPL + 对象图 | 同构：`js` + `agent.browsers`；10 方法 schema 对齐 `SkyComputerUseClient` |
| 观察哲学 | 无 OCR，AX 树 + 截图交视觉模型 | 刻意对齐（无 OCR，含中文） |
| 离散工具 | 无 | 离散 `computer_*`/`browser_*` 只是研究 A/B fixture（`codex-parity`/`codex10`），不与 `js` 并注册 |
| 验证手段 | — | A/B fixture + `codex-plugin-probe.mjs` 只读探针，把本机 Codex 安装当只读基线 |
| 呈现差异 | parity 返回紧凑 completion | MiMo 变更动作附带同事务原子观察 |
| 谱系旁线 | — | 宿主另是 Claude Code 同构端；与 trycua/qwen 系无关联（唯一交集 `@nut-tree-fork/nut-js` 输入兜底） |

## CU/BU 能力矩阵

| 维度 | Computer Use | Browser Use |
|---|---|---|
| 模型可见面 | `@mimo/sky` 10 方法（经 `js`） | `agent.browsers` 对象图（get/getForUrl/getDefault） |
| 作用域 | 本机整个桌面（Windows 清洁室 Window2；其余 nut.js 兜底） | 宿主 IAB / 用户真实浏览器扩展 / Chrome for Testing / raw CDP |
| 观察 | AX 树（index 化）+ SCK 窗口截图 + diff；无 OCR | aria-snapshot + 截图 + 内联动作反馈；预览帧不进模型上下文 |
| 动作 | AX 语义与免聚焦坐标双路由；「动作即观察」 | CDP 合成输入 + locator + 上传 chooser 序列 |
| 反馈 | 变更动作返回同事务下一观察（dispatchStatus/axRevision…） | 变更单元格内联返回 tab 观察 + URL + tab 列表 |
| 安全 | 签名信任链 + elicitation + 锁屏授权租约 | 白名单 CDP + tab 租约 + turn 级 tab 回收 |

> **独家锁屏操作**（超出 Codex 对标面）：SecurityAgentPlugins 授权插件 + 内核审计 token 钉死 socket + 1–20 秒一次性授权租约（本机已 opt-in）——链路图见 [computer-use.md §4.1](computer-use.md)。

## 传输与端点（静态记录）

| 类别 | 端点 |
|---|---|
| LLM 网关 | `https://api.xiaomimimo.com/v1`；分区域 `token-plan-{cn,sgp,ams}.xiaomimimo.com/v1`（**国区 cn**） |
| 模型 | `xiaomi/mimo-v2.5` / `mimo-v2.5-pro` / `mimo-v2-pro` / `mimo-v2-flash`（+TTS） |
| 内部 npm | `https://pkgs.d.xiaomi.net/artifactory/api/npm/mi-npm/`（@mi scope，restricted） |
| 账号/平台 | `account.xiaomi.com`；`platform.xiaomimimo.com`（插件市场）；`mimo.xiaomi.com/coder/` |
| 扩展商店 | `chromewebstore.google.com/detail/browser-bridge/hdegpkcbaiojkelbocodjnnaglojjlam`（+备用 ID） |
| 内置远端 MCP | 企查查 `agent.qcc.com/mcp`（10 流）、北大法宝、bilibili、github/lark/notion 等 |

> **命名防混淆**：`~/.config/mimocode/` 与 `MiMo Computer Use`/`MiMo Automation`（Application Support）均属小米 MiMo（与 MiniMax 无关）；小米**开源** MiMo reasoning 模型是同产品线的云端模型消费方，本册对象是本机应用；与 qwen 系无代码级关联。

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | 启用链、TCC、sky 门面 10 方法、sky-mac 驱动层、锁屏子系统、安全模型 |
| [browser-use.md](browser-use.md) | `agent.browsers` 契约、Browser Bridge 扩展协议、四后端、观察/动作、安全 |
| [evidence/inventory.md](evidence/inventory.md) | 结论→证据路径映射（含置信度标注） |

> 低置信度复核点：Chrome Web Store 上架现状；IAB provider descriptor 字段（本机 provider.json 不存在）；Record & Replay 第三产品线（本机未实装）；Windows Window2 后端行为（本机 macOS）；`mimo-v2.5` 与开源模型的版本对应。
>
> 分册基线：应用 26.914.142245 / 运行时与伴生 App 0.7.11 / 插件 SDK @mimo-ai/plugin 0.1.14（MIT，唯一公开开源件）。
