/**
 * 示例 2：落地一个桌面应用并读取观察（@mimo/sky 标准循环的第一步）。
 * 变更动作（click/type_text 等）会返回下一观察；本示例只读不写。
 */
import { MimoAutomationClient } from "../src/mimo-client.js";

const client = new MimoAutomationClient({ env: { CCU_LOG_LEVEL: "warn" } });
await client.start();

const apps = await client.runText(
  `var apps = await sky.list_apps();\nnodeRepl.write(JSON.stringify(apps, null, 2));`,
);
console.log("apps:\n", apps);

// 把 "TextEdit" 换成 list_apps 返回的 id（优先 bundle identifier）。
const state = await client.skyGetAppState("TextEdit");
console.log("AX 文本:\n", state.text.slice(0, 2000));
console.log("action:", state.action);

await client.stop();
