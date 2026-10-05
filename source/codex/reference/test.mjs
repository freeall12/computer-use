/**
 * source/codex/reference 自测 —— 统一 cua 面 + AX diff 模拟器 + 帧协议 + mini REPL。
 * 运行：node source/codex/reference/test.mjs
 */
import assert from "node:assert/strict";
import {
  encodeFrame, decodeFrame, createPipePair, serveSky,
  SkyClient, SkyComputerUseAPIVersionMismatch, SERVER_API_VERSION,
} from "./sky-transport.ts";
import { createSkySim } from "./sky-sim.ts";
import { createCuaGlobal, createCuaRepl } from "./cua-global.ts";

let passed = 0;
const ok = (msg) => { passed += 1; console.log("  ok", `${passed}.`, msg); };

// ------------------------------------------------- 1. 帧协议：4B 长度前缀 + 8MiB 上限
const frame = encodeFrame({ hello: "sky" });
assert.equal(frame.readUInt32LE(0), frame.length - 4);
assert.deepEqual(decodeFrame(frame), { hello: "sky" });
assert.throws(() => encodeFrame({ big: "x".repeat(8 * 1024 * 1024) }), /exceeds the .*-byte limit/u);
ok("帧编解码 roundtrip + 8MiB 上限");

// ------------------------------------------------- 2. ping API 版本强校验
const [clientEnd, serverEnd] = createPipePair();
const sim = createSkySim();
const server = serveSky(serverEnd, { request: (type, req) => sim.handlers[type](req) });
const badClient = new SkyClient(clientEnd, { clientApiVersion: SERVER_API_VERSION - 1, turnMetadata: { sessionId: "s", turnId: "t" } });
await assert.rejects(() => badClient.ping(), /incompatibleClientVersion/u, "服务端拒绝版本不匹配");
// 客户端侧的 serverApiVersion 强校验：用桩端点回一个不匹配的版本号
const stubEnd = { rawFrames: [], onMessage: null, send(msg) { queueMicrotask(() => stubEnd.onMessage({ jsonrpc: "2.0", id: msg.id, result: { serverApiVersion: 999 } })); } };
const stubClient = new SkyClient(stubEnd, { clientApiVersion: SERVER_API_VERSION, turnMetadata: { sessionId: "s", turnId: "t" } });
await assert.rejects(() => stubClient.ping(), SkyComputerUseAPIVersionMismatch);
const goodClient = new SkyClient(clientEnd, { clientApiVersion: SERVER_API_VERSION, turnMetadata: { sessionId: "sess_codex", turnId: "turn_1" } });
assert.equal(await goodClient.ping(), SERVER_API_VERSION);
ok("ping 版本强校验：服务端拒绝 + 客户端硬失败 / 匹配通过");

// ------------------------------------------------- 3. 请求信封带轮次元数据与截止时间
const cua = createCuaGlobal(goodClient);
await cua.initialize();
const env = server.receivedEnvelopes[server.receivedEnvelopes.length - 1];
assert.ok(env.codexTurnMetadata && env.deadlineUnixMilliseconds && env.requestType === "list_apps",
  "每个请求携带 codexTurnMetadata + deadlineUnixMilliseconds + requestType");
ok("request 信封：会话/轮次元数据 + 截止时间齐备");

// ------------------------------------------------- 4. getApp 隐式拉起（startApp）
assert.equal(sim.test.isRunning("com.apple.Notes"), false, "初始未运行");
const app = await cua.getApp("Notes");
assert.equal(sim.test.isRunning("com.apple.Notes"), true, "getApp 隐式拉起（mac 无 launch 原语）");
assert.equal(app.appRef.bundleId, "com.apple.Notes");
assert.ok(app.boundStateText.includes("[guidance:") && app.boundStateText.includes("New Note"),
  "start_app 返回带指引的整树（绑定即观察）");
ok("getApp = startApp：拉起会话 + 立即返回 key window 状态");

// ------------------------------------------------- 5. AX diff：全量 → 无变化 diff → 动作后 diff
const full = await app.getAXState({ disableDiffing: true });
assert.ok(full.includes("accessibility tree (full)") && full.includes("New Note"));
const noChange = await app.getAXState();
assert.ok(noChange.includes("(no changes since last capture)"));
await app.click(0); // [0]=「New Note」：AX 受理后树里新增一条笔记
const diff = await app.getAXState();
assert.ok(diff.includes("accessibility tree (diff)") && diff.includes("Untitled Note"), "diff 只含变化行");
ok("AX diff 模拟器：full / no-change / after-action 三态");

// ------------------------------------------------- 6. stale 索引：错误内嵌新鲜 diff
await assert.rejects(
  () => app.click(99),
  (e) => /Element 99 not found/u.test(e.message) && /Fresh AX diff:/u.test(e.message) && /Re-derive element indices/u.test(e.message),
  "Codex 对 stale 索引的对策 = 错误内嵌新鲜 diff + 流程纪律",
);
// 索引位移会静默点错节点——这正是流程纪律存在的原因
await app.getAXState({ disableDiffing: true });
sim.test.removeNodeAt("com.apple.Notes", 1); // Share 被移除，后续索引整体前移
await app.getAXState(); // 模型若没重新观察，仍以为 [1] 是 Share
await app.click(1);
assert.equal(sim.test.lastClickedNode(), "Search", "索引位移后 click(1) 落到了 Search——演示 stale-index 危险");
ok("stale-index 危险演示 + 错误内嵌新鲜 diff");

// ------------------------------------------------- 7. 未广告动作拒绝（索引从最新观察动态解析）
const st6 = await app.getAXState({ disableDiffing: true });
const idxOf = (text, name) => {
  const line = text.split("\n").find((l) => l.includes(`name="${name}"`));
  const m = line?.match(/^\[(\d+)\]/);
  return m ? Number(m[1]) : -1;
};
const newNoteIdx = idxOf(st6, "New Note");
const bodyIdx = idxOf(st6, "Body");
await assert.rejects(() => app.performSecondaryAction(newNoteIdx, "show-menu"), /not advertised/u);
await app.performSecondaryAction(newNoteIdx, "press");
ok("performSecondaryAction 只许广告过的动作");

// ------------------------------------------------- 8. paste 借还剪贴板
await app.setValue(bodyIdx, "");
await app.paste("pasted-text", { format: "text" });
const afterPaste = await app.getAXState({ disableDiffing: true });
assert.ok(afterPaste.includes("pasted-text"));
assert.equal(sim.test.clipboard(), "user-secret-clipboard", "粘贴后恢复用户原剪贴板");
assert.deepEqual(
  sim.events.slice(-3), ["clipboard:borrow", "paste", "clipboard:restore"],
  "借还顺序：borrow → paste → restore",
);
ok("paste：借系统剪贴板并恢复用户剪贴板");

// ------------------------------------------------- 9. get_app_policy 审批面
const policy = await cua.computer.get_app_policy({ app: { name: "Notes" } });
assert.equal(policy.decision, "allowed");
assert.equal(policy.risk, "low");
assert.equal(policy.allowPersistentApproval, true);
ok("getAppPolicy：allowed/low/allowPersistentApproval");

// ------------------------------------------------- 10. 逃逸口 snake_case 面
const macSurface = Object.keys(cua.computer).sort();
for (const m of ["click", "drag", "get_app_state", "list_apps", "paste", "perform_secondary_action", "press_key", "scroll", "select_text", "set_value", "type_text"]) {
  assert.ok(macSurface.includes(m), `computer.${m} 应存在`);
}
assert.ok(!macSurface.includes("launch_app") && !macSurface.includes("activate_window"), "mac 无 launch/activate 原语");
ok("cua.computer 逃逸口：mac snake_case 面（无 launch/activate）");

// ------------------------------------------------- 11. mini REPL：完成值 / 持久绑定 / js_reset
const repl = createCuaRepl(cua);
assert.equal(await repl.js("2 + 3"), 5, "末表达式完成值");
await repl.js("const x = 41");
assert.equal(await repl.js("x + 1"), 42, "顶层绑定跨调用存活");
const listed = await repl.js("return await cua.listApps();"); // 含 await：走 async IIFE，需显式 return
assert.equal(listed.apps.length, 1);
repl.js_reset(); // 重置工作内存；世界状态不动
assert.equal(await repl.js("typeof x"), "undefined", "js_reset 丢弃 bindings");
const stillThere = await repl.js("return await cua.listApps()");
assert.equal(stillThere.apps[0].bundle_id, "com.apple.Notes", "js_reset 不关 app（世界状态保留）");
ok("mini REPL：完成值 / 持久绑定 / js_reset 只清内存不清世界");

console.log(`\nALL PASSED (${passed} checks) — source/codex/reference`);
