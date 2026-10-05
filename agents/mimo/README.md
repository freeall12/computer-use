# Xiaomi MiMo 桌面端 Computer Use / Browser Use 逆向分析

> 分析对象：`/Applications/Xiaomi MiMo AI.app`（`com.xiaomi.mimo.desktop-ai`，版本 26.914.142245，Electron）及其自动化运行时根 `~/Library/Application Support/MiMo Automation/`（运行时 0.7.11）。
> 分析日期：2026-10-06。方法：只读静态分析（asar 解包至 /tmp、npm 运行时包/配置读取、codesign 校验），未运行被分析对象、未抓包、未触碰凭据。
> 文档为原创撰写；对专有源码仅做不超过 10 行/处的引用并标注文件路径。

## TL;DR

1. **产品形态**：`Xiaomi MiMo AI` 不是套壳，是小米的完整 Agent IDE——Electron 桌面客户端内嵌自研 **MiMoCode 编码引擎**（编码代理 + 日常对话 + Office 文件助手三工作流；Projects/Git/Terminal/定时自动化/插件市场齐备），外加一个随包分发的 Python「evolve 自进化」实验性 harness。引擎是 **Claude Code 工具协议同构端**（Read/Write/Edit/Bash/task/actor 工具命名、CC 式系统 prompt、AGENTS.md/SKILL.md 生态），模型访问双协议（anthropic `v1/messages` + openai `chat/completions`），默认模型 `xiaomi/mimo-v2.5(-pro)`，网关 `api.xiaomimimo.com/v1` 与分区域 `token-plan-{cn,sgp,ams}.xiaomimimo.com/v1`。
2. **CU/BU 都有、都是一等公民、同一运行时**：本体是 npm 包 **`@mi/mimo-computer-use` 0.7.11**（小米内部 registry `pkgs.d.xiaomi.net`，restricted），自述「Cross-platform computer-use MCP server … **inspired by Codex Desktop's sky executor**」——**对 OpenAI Codex Desktop computer use 的清洁室复刻**，八家分册中把对标复刻做得最明示的一家（产品文档自带 vs Codex 逐项比较）。
3. **产品面 = 一个持久 `js` REPL MCP 工具**（`tools/list` 恰为 `["js"]`）：桌面 10 操作收进内核预注入的 **`@mimo/sky`** 门面，浏览器收进 **`@mimo/browser-use` 的 `agent.browsers`** 四后端（iab / extension / managed Chrome for Testing / raw CDP）。CU、BU、Record & Replay 三个产品共用此内核；离散 `computer_*`/`browser_*` 工具面只是研究 A/B fixture。
4. **CU 执行层是自研 Swift 免聚焦引擎 "sky-mac"**（AX 树 + per-pid CGEvent + SkyLight 私有 SPI 坐标点击不抬窗 + ScreenCaptureKit 窗口截屏 + 对截屏不可见的虚拟光标），Windows 为清洁室 Window2 后端（UIA + SendInput）；TCC 由 Developer ID 签名的伴生 app `MiMo Computer Use.app`（`com.xiaomi.mimo.computeruse`，Beijing Xiaomi Co., Ltd / Team `DG75VEYT9V`）持有，启动链四重签名校验。独家**锁屏操作**子系统：SecurityAgentPlugins 授权插件 + 内核审计 token 钉死 socket + 1–20 秒一次性授权租约（本机已 opt-in）。
5. **本机可用性：CU ✅ 已启用**（env=1，stable 0.7.11 已选定，宿主技能已装）；**BU ⭕ 能力完整但未启用**（曾有插件安装尝试，当前 env=0、无 IAB provider、宿主无对应技能——负证据五面俱全）。
6. **安全模型**：fail-closed 插件门 + `js` 路径唯一性（禁 AppleScript/旁路）+ CCU_SAFETY_MODE 四档确认（enforce 走 MCP elicitation）+ 签名信任链 + 浏览器侧白名单 CDP/租约/turn 级 tab 回收。宿主另有严格边界：权限引导只能由签名 App 的 GUI 做，MCP 不暴露任何权限工具。

## 1. 信息源与判据

| 信息源 | 路径 | 用途 |
| --- | --- | --- |
| 应用包 | `/Applications/Xiaomi MiMo AI.app/Contents/Resources/app.asar`（~101MB，非 node_modules 部分解包至 /tmp/mimo-asar） | 宿主引擎/插件开关/端点证据 |
| 自动化运行时 | `~/Library/Application Support/MiMo Automation/`（Runtime/0.7.11、Computer Use、Browser Bridge、Browser Provider、Launchers、Applications/MiMo Browser Use.app） | CU/BU 一手运行时（含完整包文档 README.md 1638 行） |
| 伴生 App | `~/Applications/MiMo Computer Use.app`（codesign 验证） | TCC/锁屏/原生 helper 实装 |
| 引擎配置 | `~/.config/mimocode/`（mimocode.jsonc、plugins、skills、@mimo-ai/plugin） | MCP 接线、宿主技能、开源插件 SDK |
| 应用数据 | `~/Library/Application Support/Xiaomi MiMo AI/`（engine-config、presentation-host、automation-default-install.json） | 内置工具、IAB socket、安装痕迹 |
| 状态目录 | `~/Library/Application Support/MiMo Computer Use/lock-control-enabled` | 锁屏操作 opt-in 证明 |

> **命名防混淆**：① `~/.config/mimocode/` 与 `MiMo Computer Use`/`MiMo Automation`（Application Support）**均属小米 MiMo**（MiniMax 分册已勘误过此点）；② 小米**开源**的 MiMo reasoning 模型（GitHub XiaomiMiMo org）与本分册的应用产品同产品线，但本册对象是本机应用产品（应用经 `xiaomi/mimo-v2.5` 等模型 ID 调用云端 MiMo 模型）；③ 与 qwen 系无代码级关联（Qoder 分册的 qwen-code 引擎不在此应用中）。

## 2. 架构分层图

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Xiaomi MiMo AI.app (Electron, com.xiaomi.mimo.desktop-ai 26.914.142245)    │
│  = "MiMo Desktop"：完整 Agent IDE（MiMoCode 引擎 + 对话 + Office + 插件市场）│
│                                                                            │
│  主进程 (out/main/*.mjs, 47 chunks)                                        │
│  ├─ MiMoCode 引擎 (node.mjs)：anthropic-messages + openai chat/completions │
│  │    工具: Read/Write/Edit/Bash/Glob/WebSearch + task/actor/ask/js +      │
│  │          会话协作/图像/语音/PDF 等 15 个 engine-tools                    │
│  ├─ 插件开关管理: mimo-computer-use / mimo-browser-use → 写 mimocode.jsonc │
│  │    mcp.node_repl = Launchers/bin/automation-repl + CU/BU env 开关       │
│  └─ presentation-host: control.sock（IAB 呈现/焦点协作）                    │
└──────────────┬─────────────────────────────────┬───────────────────────────┘
               │ stdio MCP（单一 js 工具）          │ Browser Provider descriptor
┌──────────────▼─────────────────────────────┐   │ (provider.json, 本机无)
│ @mi/mimo-computer-use 0.7.11 (小米内部 npm) │   │
│ "inspired by Codex Desktop's sky executor" │   │
│  dist/node-repl.js: tools/list = ["js"]    │   │
│  内核注入 @mimo/sky + @mimo/browser-use    │   │
│  ├─ CU: sky-mac (Swift AX/CGEvent/SkyLight │   │
│  │      SPI/SCK 截屏/虚拟光标) + nut.js 兜底│   │
│  ├─ BU: agent.browsers 四后端               │◄──┘
│  │    iab / extension / managed / raw CDP  │
│  └─ safety: CCU_SAFETY_MODE + elicitation  │
└──────┬──────────────────────┬──────────────┘
       │ App 内嵌校验器         │ Native Messaging (com.xiaomi.mimo.browser,
       ▼                      ▼ JSON-RPC 2.0)
┌──────────────────┐   ┌─────────────────────────────┐
│ MiMo Computer    │   │ Browser Bridge (MV3 扩展)    │
│ Use.app (签名,   │   │  chrome.debugger → CDP 1.3   │
│ Team DG75VEYT9V) │   │  → 用户真实 Chrome/Edge/…    │
│ TCC 持有者:      │   └─────────────────────────────┘
│ 辅助功能+屏幕录制 │   ┌─────────────────────────────┐
│ + CCULockUnlock  │   │ MiMo Browser Use.app         │
│ Authorization    │   │ (状态 GUI + 预览 helper；     │
│ Plugin(锁屏)     │   │  本机已安装未启用)            │
└──────────────────┘   └─────────────────────────────┘
               │ HTTPS (anthropic-messages / chat-completions)
               ▼
   https://api.xiaomimimo.com/v1            (MiMo 开放平台)
   https://token-plan-{cn,sgp,ams}.xiaomimimo.com/v1  (分区域网关, 国区 cn)
   模型: xiaomi/mimo-v2.5 / mimo-v2.5-pro / mimo-v2-pro / mimo-v2-flash (+TTS)
```

## 3. 能力矩阵

| 能力 | Computer Use | Browser Use |
| --- | --- | --- |
| 载体 | `@mi/mimo-computer-use` 0.7.11 自研 sky-mac（Swift）+ 签名伴生 app | 同包 `dist/browser/*` + Browser Bridge MV3 扩展 + native host |
| 模型可见面 | 单一 `js` REPL 工具；桌面操作 = `@mimo/sky` 10 方法 | 同一 `js`；`agent.browsers` 对象图（无离散 browser 工具） |
| 作用域 | 本机整个桌面（macOS 免聚焦优先；Windows 清洁室 Window2；其他 nut.js 兜底） | 四后端：宿主 IAB / 用户真实浏览器扩展 / 托管 Chrome for Testing / raw CDP |
| 观察 | AX 树（index 化）+ ScreenCaptureKit 窗口截图 + diff 修订；无 OCR（刻意对齐 Codex） | aria-snapshot/AX 域 CDP 白名单 + 截图 + 内联动作反馈；预览帧不进模型上下文 |
| 动作 | click/drag/press_key/type_text/set_value/select_text/scroll/perform_secondary_action；AX 语义与 SkyLight 免聚焦坐标双路由 | CDP 合成输入 + locator/语义定位 + 文件上传 chooser 序列 + 对话框/剪贴板策略 |
| 反馈语义 | 「动作即观察」：变更动作返回同事务下一观察（dispatchStatus/axRevision/uiChanged…） | 变更单元格内联返回 tab 观察 + URL + tab 列表（codex/toolSurface 形状） |
| 安全 | 插件门 fail-closed + 签名四重校验 + SAFETY_MODE elicitation + 锁屏授权租约 | 白名单 CDP + tab 租约 + turn 级 tab 回收 + 扩展 ID 钉死 + 无调试端口 |

## 4. 启用链路与进程模型（要点）

宿主把官方插件开关写入 `~/.config/mimocode/mimocode.jsonc` 的单一 `mcp.node_repl` 条目（`automation-repl` 启动器 + `MIMO_AUTOMATION_COMPUTER_USE_ENABLED` / `MIMO_AUTOMATION_BROWSER_USE_ENABLED` 环境变量），CU 侧经固定入口 `Computer Use/bin/mcp` 做四重校验（current 符号链接落点 → Info.plist 通道身份 `stable:stable:com.xiaomi.mimo.computeruse` → `codesign --deep --strict` → TeamIdentifier/Authority 钉死 `DG75VEYT9V:Developer ID Application: Beijing Xiaomi Co., Ltd (DG75VEYT9V)`）后 exec 签名 App 内的 Bootstrap binder，再由 App 内嵌校验器按签名 TS build receipt 核对运行时文件。稳定/开发双通道经原子 `current` 符号链接切换，每次启动重校验，失败即 fail-closed。详情见 [computer-use.md](computer-use.md) 第 3 节。

## 5. 传输与端点（静态记录）

| 类别 | 端点 | 证据 |
| --- | --- | --- |
| LLM 主网关 | `https://api.xiaomimimo.com/v1` | asar 主进程 URL |
| 分区域网关 | `https://token-plan-{cn,sgp,ams}.xiaomimimo.com/v1`（**国区 cn**） | 同上 |
| 模型 | `xiaomi/mimo-v2.5`、`mimo-v2.5-pro`、`mimo-v2-pro`、`mimo-v2-flash`、`mimo-v2.5-tts*` | node.mjs 字符串统计 |
| 协议 | anthropic `v1/messages`（anthropic-beta 头）+ openai `chat/completions` 双栈 | 同上 |
| 内部 npm | `https://pkgs.d.xiaomi.net/artifactory/api/npm/mi-npm/`（@mi scope，restricted） | CU 包 publishConfig |
| CDN/存储 | `mimocode-cdn.xiaomimimo.com`、`mimocode.cnbj1.mi-fds.com` | asar URL |
| 账号 | `account.xiaomi.com/pass/serviceLogin`、`api.account.xiaomi.com`、`iauth.pt.xiaomi.com` | asar URL |
| 平台/官网 | `platform.xiaomimimo.com`（含 console/plugin 插件市场）、`mimo.xiaomi.com/coder/`、`app.xiaomimimo.com/download` | asar URL / package.json |
| 扩展商店 | `chromewebstore.google.com/detail/browser-bridge/hdegpkcbaiojkelbocodjnnaglojjlam`（+备用 ID `dbgblfpnkbjkklfekngphekkapoejffa`） | index.mjs + native host 清单 |
| 内置远端 MCP | `agent.qcc.com/mcp/*/stream`（企查查 10 流）、`apim-gateway.pkulaw.com/mcp-*`（北大法宝）、bilibili API、github-mcp-server、lark-openapi-mcp、figma/notion MCP 指引 | asar URL 提取 |

## 6. 谱系判定

- **对 OpenAI Codex**：CU/BU 运行时是 Codex Desktop computer use 的**清洁室复刻**（自述 inspired by，10 工具 schema 对齐、`js`/`agent.browsers` 形状同构、codex-parity/codex10 A/B fixture、把本机 Codex `SkyComputerUseClient` 当只读基线）；无 OpenAI 二进制依赖。
- **对 Anthropic Claude Code**：宿主引擎是 CC 工具协议同构端（工具命名/系统 prompt/AGENTS.md/SKILL 生态/anthropic-messages 协议），自研运行时非 fork；插件 SDK `@mimo-ai/plugin`（MIT，`github.com/XiaomiMiMo/MiMo-Code`）是唯一公开开源件。
- **对 trycua/cua 系**：无关联（MiniMax/Synara 用的 cua-driver 不在此；唯一交集是 nut-tree-fork 输入兜底依赖）。
- **对 qwen 系**：无代码级关联。
- **对小米开源 MiMo 模型**：同产品线的云端模型消费方（`xiaomi/mimo-v2.5` 系列），本册不覆盖开源模型仓库本身。

## 7. 本册文档

- [computer-use.md](computer-use.md) — CU 完整逆向：载体、启用链、TCC、sky 门面 10 方法、sky-mac 驱动层、锁屏子系统、安全模型
- [browser-use.md](browser-use.md) — BU 完整逆向：agent.browsers 契约、Browser Bridge 扩展协议、四后端、观察/动作、安全
- [evidence/inventory.md](evidence/inventory.md) — 结论→证据路径映射（含置信度标注）

## 8. 低置信度复核点

1. Chrome Web Store 上架现状与两个扩展 ID 的现存对应（本机离线证据只能证明 allowed_origins 钉死关系）。
2. IAB Browser Provider descriptor 的 JSON 字段（本机 provider.json 不存在，从 README + 启动器分支逻辑还原）。
3. `MiMo Record and Replay` 第三产品线（本机未实装，仅包内产物定义）。
4. Windows Window2 后端实际行为（本机 macOS，全部来自包内文档/脚本）。
5. `xiaomi/mimo-v2.5` 与开源 MiMo 模型的版本对应关系（云端侧，无本地证据）。

*分册基线：应用 26.914.142245 / 自动化运行时与伴生 App 0.7.11 / 插件 SDK @mimo-ai/plugin 0.1.14。*
