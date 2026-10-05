# source/grok — Grok（xAI）CU/BU 工具面整理

> 本目录是 Grok Bot 桌面端（0.66.0）CU/BU 工具面的**规范化整理与 cleanroom 参考实现**，供自研同类 agent 时对齐协议形状。
> 来源产物：`/Applications/Grok Bot.app`（asar + Swift sidecar 二进制静态逆向）；分析文档见 [../../agents/grok/README.md](../../agents/grok/README.md)。

## 版本基线

| 组件 | 版本 | 说明 |
|---|---|---|
| Grok Bot 桌面端 | 0.66.0（sandBuiltAt 2026-10-01） | Electron 42.1.0，签名 TeamID `DCNK4UB866`（Anysphere） |
| CU sidecar | CUGrokBotService 1.0.0 | Swift `CUCore`，Mach-O universal，min macOS 14.0 |
| Grok CLI | 1.0.46 | 无 CU/BU，不在本目录整理范围 |
| 整理基线日期 | 2026-10-06 | 本机静态逆向 |

## 三层来源说明（仓库统一结构）

```
source/grok/
├── README.md            # 本文件
├── schemas/tools.json   # 【schemas 层】手写整理的规范化工具面 JSON（非原始 dump）
└── reference/           # 【reference 层】cleanroom 重写的 TypeScript 参考客户端骨架
```

- **vendor 层：空（有意为之）**。Grok Bot 的 CU/BU 栈（asar 内 JS 与 Swift CUCore sidecar）是 Anysphere/xAI 的**专有代码，无开源上游**，按仓库红线绝不 vendor。其协议可考的同源开源项目是 trycua/cua（MIT，CUA_* 环境变量命名与 Cursor 分册的 sidecar 溯源佐证），但本目录不搬运其代码；需要通用 CU 底座时直接参考仓库 MiniMax/Synara 分册对 cua-driver 的记录。
- **schemas 层**：`schemas/tools.json` 按"名称/语义/参数 schema/返回/错误码"手工整理，每字段带 `provenance`（`observed` = 二进制内嵌原文直录 / `inferred` = 由调用方代码或错误文本推断）。两套本地工具面（`computer_*` MCP catalog 与 `computer_use_*` RPC 面）+ 云端 proto 动作面。
- **reference 层**：`reference/` 为从零撰写的 TypeScript 骨架，实现三条协议形状：① Unix socket 行分隔 JSON-RPC 客户端（对齐 local-cua 类的调用协议）；② sidecar `--mcp-stdio` 的 MCP server 目录形状（tools/list 应答结构）；③ 云端 `ComputerUseAction` 批量编码器。**能跑通协议形状（类型检查 + 本地 echo/假 sidecar 冒烟），不连接真实服务。**

## 可运行性说明

```bash
cd reference && npx tsc --noEmit   # 类型检查（零依赖：node 内置模块的最小声明在 types-node.d.ts）
cd .. && node reference/demo.mjs   # 冒烟：内存假 sidecar + 协议往返，8/8 检查通过（2026-10-06 实测）
```

无第三方依赖（仅 Node 内置模块；`npx tsc` 为一次性类型检查器，非运行时依赖）。`demo.mjs` 启动一个内存假 sidecar（回显协议应答），验证帧格式、service.json 发现、无会话拒绝（session_required）、control 会话生命周期与 companion 模式拒绝升级——即 sidecarClient.ts 所实现调用序列的可执行规约。

## 许可证归属

- 本目录全部文件为本研究项目的 cleanroom 整理与重写，随仓库 LICENSE（见仓库根）分发。
- 上游专有代码零复制：所有字段语义均以自然语言/JSON Schema 重述；正文中引用的二进制字符串片段每处 ≤10 行且注明出处（见 agents/grok/evidence/inventory.md）。
- 专有名称（computer_use_* 等）作为协议互操作所必需的接口标识符引用，不构成版权材料复制。
