/**
 * 示例 1：连接本机 automation-repl 并校验工具面。
 * 期望输出 ["js"] —— 这是共享 js 运行时的标志性形状。
 *
 * 运行前：确认 CU/BU 插件开关（mimocode.jsonc → mcp.node_repl）。
 */
import { MimoAutomationClient, DEFAULT_LAUNCHER } from "../src/mimo-client.js";

const client = new MimoAutomationClient({
  // 按需覆盖命令；默认走宿主注册的固定入口。
  command: [DEFAULT_LAUNCHER],
  env: { CCU_LOG_LEVEL: "warn" },
});

await client.start();
console.log("tools/list =", await client.toolSurface());
await client.stop();
