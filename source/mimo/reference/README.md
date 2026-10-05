# MiMo 自动化参考客户端骨架（reference/）

本目录是**自行重构**的参考实现，按逆向得到的协议形状复现小米 MiMo 自动化运行时（`@mi/mimo-computer-use` 0.7.11）的客户端接入面。全部代码为本仓库原创，**不含任何小米专有代码**；仅复现可观察的协议契约。

## 协议形状（本骨架所实现）

1. **传输**：stdio MCP（JSON-RPC 2.0，按行分隔消息），服务端为本机
   `~/Library/Application Support/MiMo Automation/Launchers/bin/automation-repl`
   （宿主写进 `~/.config/mimocode/mimocode.jsonc` 的 `mcp.node_repl` 固定入口）。
2. **工具面**：`tools/list` 恰为 `["js"]` —— 一个持久 Node REPL 工具，参数白名单 `{code, title?, description?, timeout_ms?}`。
3. **内核全局**：`sky`（`@mimo/sky` 桌面门面，CU 开关启用）、`agent`（`@mimo/browser-use`，BU 开关启用）、`nodeRepl.write/emitImage`。开关关闭时对应全局不存在（fail-closed）。
4. **动作语义**：每个变更动作在**同一次原生事务**里返回下一观察（SkyState：AX 文本 + 截图 + action 状态）；index/坐标一次性有效。

## 文件

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | `SkyState` / `Sky` 10 方法 / `agent.browsers` 入口 / `js` 参数 / 宿主 env 契约的类型整理 |
| `src/mcp-client.ts` | 极简 MCP stdio 客户端（initialize → tools/list → tools/call） |
| `src/mimo-client.ts` | 高层客户端：工具面校验、`js` 单元执行、sky 动作封装、浏览器契约读取 |
| `examples/list-tools.ts` | 校验 tools/list == ["js"] |
| `examples/sky-ground.ts` | `sky.list_apps()` + `get_app_state` 只读落地示例 |

## 可运行性

```bash
cd source/mimo/reference
npm i -D typescript tsx @types/node
npx tsc --noEmit            # 类型检查应通过
npx tsx examples/list-tools.ts   # 需本机装有 Xiaomi MiMo AI 且 node_repl 已注册
```

- `examples/list-tools.ts` 在装有 MiMo 且启用自动化的机器上可实际运行；无 MiMo 环境下仅类型检查有意义。
- 浏览器面（`agent.browsers`）的方法契约由运行时 `documentation()` 运行时生成，本骨架只实现选择与透传，未固化完整 tab API（见 schemas/tools.json 的说明）。

## 未复现的部分（诚实边界）

- 服务端内部（sky-mac Swift 引擎、ScreenCaptureKit 捕获、锁屏授权插件）—— 专有/原生层，仅文档级记录。
- MCP elicitation 安全门的完整协商（参考实现未启用 `CCU_SAFETY_MODE=enforce` 流程）。
- Browser Provider descriptor 的 JSON 细节（本机无 provider.json 实例）。
