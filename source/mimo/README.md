# source/mimo — 小米 MiMo 自动化面整理源码

本目录是 Xiaomi MiMo（`Xiaomi MiMo AI.app` + `@mi/mimo-computer-use` 0.7.11）CU/BU 协议面的**三层整理产物**：规范化 schema + 自写参考实现 + 开源上游归档。逆向证据与结论见姊妹目录 `agents/mimo/`。

## 版本基线

| 组件 | 版本 | 本机路径 |
| --- | --- | --- |
| 宿主应用 Xiaomi MiMo AI（MiMo Desktop） | 26.914.142245（`com.xiaomi.mimo.desktop-ai`） | `/Applications/Xiaomi MiMo AI.app` |
| 自动化运行时 `@mi/mimo-computer-use`（CU+BU 共体，**专有**） | 0.7.11 | `~/Library/Application Support/MiMo Automation/Runtime/0.7.11/products/*/node_modules/@mi/mimo-computer-use` |
| 插件 SDK `@mimo-ai/plugin`（**MIT 开源**） | 0.1.14 | `~/.config/mimocode/node_modules/@mimo-ai/plugin` |
| Browser Bridge 扩展 / Native host | 0.7.11（`com.xiaomi.mimo.browser`） | `~/Library/Application Support/MiMo Automation/Browser Bridge/` |
| 伴生 App | MiMo Computer Use.app / MiMo Browser Use.app 0.7.11 | `~/Applications/`、`~/Library/Application Support/MiMo Automation/Applications/` |

分析日期 2026-10-06，macOS arm64，全程只读静态分析。

## 三层来源说明

```
source/mimo/
├── README.md              ← 本文：基线与来源说明
├── schemas/
│   └── tools.json         ← 手写整理的工具面规范化 JSON（每条目标注证据来源）
├── reference/             ← 自行重构的参考客户端骨架（TypeScript，原创代码）
│   ├── README.md          ← 协议形状与可运行性说明
│   ├── package.json / tsconfig.json
│   ├── src/types.ts       ← js 工具参数 / SkyState / @mimo/sky 10 方法 / agent.browsers / 宿主 env 契约
│   ├── src/mcp-client.ts  ← 极简 MCP stdio 客户端（JSON-RPC 2.0）
│   ├── src/mimo-client.ts ← 高层客户端（工具面校验 + js 单元执行 + sky 封装）
│   └── examples/          ← list-tools.ts / sky-ground.ts
└── vendor/
    ├── README.md          ← 开源上游归档说明 + 专有组件红线清单
    └── mimo-ai-plugin/    ← @mimo-ai/plugin 0.1.14（MIT，GitHub XiaomiMiMo/MiMo-Code，原样归档）
```

- **schemas/tools.json**：手工整理，非官方 schema。覆盖：产品面 `js` 工具、`@mimo/sky` 10 方法与 SkyState、锁屏 8 工具、浏览器四后端与扩展传输契约、宿主引擎 15 个内置工具、端点与身份信任链。字段 `source` 标注来源路径。
- **reference/**：按可观察协议形状重构，**零专有代码**。可对本机运行中的 `automation-repl` 实际调用（`tools/list` 应返回 `["js"]`）；类型检查独立于 MiMo 环境可跑。
- **vendor/**：仅收录确认开源的上游（`@mimo-ai/plugin`，MIT，其 LICENSE 致谢 opencode —— MiMoCode 谱系的直接证据）。`@mi/mimo-computer-use` 本体为专有（restricted registry），只做文档级记录，绝不 vendor。

## 许可证归属

- 本目录全部原创内容（schemas、reference/、各 README）：随仓库根 LICENSE。
- `vendor/mimo-ai-plugin/`：MIT License，版权归 MiMo Code, Xiaomi Corporation（并致谢 opencode），归档仅为研究取证，未修改任何字节。

## 可运行性

| 层 | 状态 |
| --- | --- |
| `npx tsc --noEmit`（reference/） | 可独立通过（需 `npm i -D typescript tsx @types/node`） |
| `examples/list-tools.ts` | 需本机装有 Xiaomi MiMo AI 且 `mcp.node_repl` 已注册（CU/BU 任一开启）；期望输出 `["js"]` |
| `examples/sky-ground.ts` | 同上，且需已授予签名 App 辅助功能 + 屏幕录制权限（TCC 由 `MiMo Computer Use.app` 持有） |
| 浏览器面 | 本机 BU 开关关闭（env=0、无 provider.json）—— 参考客户端会得到无 `agent` 全局的 fail-closed 行为，这与真实产品行为一致，属预期 |

## 合规声明

只读分析；解包产物在 /tmp，不入仓；专有打包 JS/二进制未整文件复制；引用 ≤10 行/处并标注路径；未触碰凭据（mimocode.jsonc 中的第三方 token 字段为空值，仅记录键名）。
