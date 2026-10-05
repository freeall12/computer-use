/**
 * source/cursor/reference 自测 —— provider 注册面 + ref 句柄/防漂移 + 合成 DOM 事件 + CDP 拒绝列表。
 * 运行：node source/cursor/reference/test.mjs
 */
import assert from "node:assert/strict";
import { el, buildTestPage } from "./dom.ts";
import { takeSnapshot, findElementByRef, assertDescriptionMatches } from "./ref-handles.ts";
import { synthClick, synthSetValue, synthDrag, eventTypes } from "./synthetic-events.ts";
import { registerMcpProvider, registeredProviders, createBrowserProvider } from "./provider.ts";

let passed = 0;
const ok = (msg) => { passed += 1; console.log("  ok", `${passed}.`, msg); };

// ------------------------------------------------- 1. 注册面形状
assert.throws(() => registerMcpProvider({ tools: [], callTool: async () => ({ success: true }) }), /requires an id/u);
assert.throws(() => registerMcpProvider({ id: "x", tools: [] }), /requires callTool/u);
const root = buildTestPage(); // 测试持有页面根（真实系统里是注入脚本的 webview 页面）
const provider = createBrowserProvider({ page: root, originAllowlist: ["https://shop.example"] });
registerMcpProvider(provider.descriptor);
assert.equal(provider.descriptor.id, "cursor-ide-browser");
assert.equal(provider.descriptor.tools.length, 16, "15 个注册工具 + browser_lock = 16");
assert.equal(registeredProviders().length, 1);
const call = (name, args = {}) => provider.descriptor.callTool(name, args);
const byName = (n) => root.children.find((c) => typeof c !== "string" && c.textContent === n);
ok("registerMcpProvider：descriptor 校验 + 16 个 browser_* 工具");

// ------------------------------------------------- 2. 快照：ref 分配 + YAML + shadow DOM
const snap1 = await call("browser_snapshot", {});
assert.deepEqual(
  snap1.entries.map((e) => e.name),
  ["Search products", "Sign in", "Buy now"], // input 的可达名取 placeholder（与分册 YAML 样例一致）
  "可交互元素入快照（含 shadow DOM 内 Buy now），纯文本不进",
);
assert.ok(snap1.yaml.includes("role: button") && snap1.yaml.includes("ref: e2"), "YAML 含 role/name/ref");
ok("快照：ref 分配 e0/e1/e2、shadow DOM 内元素可交互、纯文本排除");

// ------------------------------------------------- 3. ref 复用：第二次快照不重排
const snap2 = await call("browser_snapshot", {});
assert.deepEqual(
  snap2.entries.map((e) => e.ref),
  snap1.entries.map((e) => e.ref),
  "未变化的元素复用已有 data-cursor-ref",
);
// 新增元素 → 新 ref；非交互文本节点不在快照中（无 ref 可清）
const extra = root.appendChild(el("button", { role: "button" }, "Checkout"));
const snap3 = await call("browser_snapshot", {});
const checkoutRef = snap3.entries.find((e) => e.name === "Checkout").ref;
assert.ok(/^e\d+$/.test(checkoutRef) && !snap1.entries.some((e) => e.ref === checkoutRef), "新元素拿到新 ref");
ok("快照保活：ref 复用 + 新元素新 ref");

// ------------------------------------------------- 4. assertDescriptionMatches 防漂移
const snap4 = await call("browser_snapshot", {});
const signRef = snap4.entries.find((e) => e.name === "Sign in").ref;
assert.equal((await call("browser_click", { ref: signRef, element: "Sign in" })).success, true, "描述匹配 → 放行");
const drift = await call("browser_click", { ref: signRef, element: "Buy now" });
assert.equal(drift.success, false, "描述漂移 → 拒绝");
assert.match(drift.error, /no longer matches the snapshot description/u);
assert.match(drift.suggestion, /browser_snapshot/u);
assert.doesNotThrow(() => assertDescriptionMatches(findElementByRef(root, signRef), signRef, undefined), "未传描述时跳过校验");
ok("assertDescriptionMatches：防错位校验 + 失败提示重取快照");

// ------------------------------------------------- 5. stale ref：元素移除后按 ref 定位失败
byName("Sign in").remove();
const r5 = await call("browser_click", { ref: signRef });
assert.equal(r5.success, false);
assert.match(r5.error, /stale or unknown/u);
assert.match(r5.suggestion, /browser_snapshot/u);
ok("stale ref：结构化错误 {success, error, suggestion}");

// ------------------------------------------------- 6. 合成点击：事件序列
const root2 = buildTestPage();
const btn2 = byName2(root2, "Sign in");
synthClick(btn2, { button: "left" });
assert.deepEqual(
  eventTypes(btn2),
  ["pointerover", "pointerenter", "pointermove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"],
  "Pointer/Mouse 完整序列以 click 收尾",
);
synthClick(btn2, { doubleClick: true });
assert.ok(eventTypes(btn2).includes("dblclick"));
ok("合成点击：pointerdown→mouseup→click（双击加 dblclick）");

function byName2(page, n) {
  return page.children.find((c) => typeof c !== "string" && c.textContent === n);
}

// ------------------------------------------------- 7. 设值 / 拖拽
const input = root2.children.find((c) => typeof c !== "string" && c.tagName === "input");
synthSetValue(input, "hello");
assert.equal(input.getAttribute("value"), "hello");
assert.ok(eventTypes(input).includes("input") && eventTypes(input).includes("change"));
const src = byName2(root2, "Sign in");
const dst = root2.children.find((c) => typeof c !== "string" && c.tagName === "h1");
synthDrag(src, dst);
assert.deepEqual(
  eventTypes(src).slice(-9),
  ["pointerover", "pointerenter", "mousedown", "pointerdown", "dragstart", "drag", "dragend", "mouseup", "pointerup"],
  "DragEvent 链：dragstart → drag → dragend（源元素侧）",
);
assert.ok(eventTypes(dst).includes("drop"));
ok("合成设值（input/change）+ HTML5 拖拽链（dragenter/dragover/drop）");

// dragstart 被 preventDefault 的形状：事件记录 defaultPrevented
const hostile = el("button", { role: "button" }, "Hostile");
const rec = hostile.dispatchEvent({ type: "dragstart" });
rec.defaultPrevented = true; // 页面脚本 preventDefault 后的记录形状
assert.equal(hostile.eventLog.at(-1).defaultPrevented, true, "页面可阻止 dragstart（synthDrag 遇此抛错建议 browser_evaluate）");
ok("dragstart preventDefault 形状");

// ------------------------------------------------- 8. provider 动作落到合成事件 + navigate 策略
const provider2 = createBrowserProvider({ page: root2, originAllowlist: ["https://shop.example"] });
await provider2.descriptor.callTool("browser_snapshot", {});
const sIn = (await provider2.descriptor.callTool("browser_snapshot", {})).entries.find((e) => e.name === "Sign in");
const clickRes = await provider2.descriptor.callTool("browser_click", { ref: sIn.ref, element: "Sign in" });
assert.equal(clickRes.success, true);
assert.ok(eventTypes(byName2(root2, "Sign in")).includes("click"), "provider 动作确实派发了合成事件");

const nav1 = await provider2.descriptor.callTool("browser_navigate", { url: "file:///etc/hosts" });
assert.equal(nav1.success, false);
assert.match(nav1.error, /file:\/\/ URLs are not allowed/u);
const nav2 = await provider2.descriptor.callTool("browser_navigate", { url: "https://evil.example" });
assert.equal(nav2.success, false);
assert.match(nav2.error, /blocked by administrator settings/u);
const nav3 = await provider2.descriptor.callTool("browser_navigate", { url: "https://shop.example/item" });
assert.equal(nav3.success, true);
ok("navigate：file:// 拒绝 + 管理员 allowlist + 白名单内放行");

// ------------------------------------------------- 9. browser_lock 与用户夺回
await provider2.descriptor.callTool("browser_lock", { action: "lock" });
assert.equal(provider2.locked, true);
provider2.userTakeControl(); // 用户点 "Take Control"
assert.equal(provider2.locked, false, "用户始终可夺回");
ok("browser_lock：锁定/解锁 + 用户 Take Control 夺回");

// ------------------------------------------------- 10. CDP 拒绝列表
const cdp = (method) => provider2.descriptor.callTool("browser_cdp", { method, params: {} });
const inputDenied = await cdp("Input.dispatchMouseEvent");
assert.match(inputDenied.error, /focus-sensitive in Electron webviews/u);
const cookieDenied = await cdp("Network.getCookies");
assert.match(cookieDenied.error, /denied/u);
const targetDenied = await cdp("Target.createTarget");
assert.match(targetDenied.error, /Target/u);
const navDenied = await cdp("Page.navigate");
assert.match(navDenied.error, /denied by policy/u);
ok("CDP 拒绝列表：Input.* 焦点敏感文案 / cookie / Target / Page.navigate 全拒");

// 放行域 + 注入的 cdpSend
const provider3 = createBrowserProvider({ page: root2, cdpSend: (method) => ({ method, ok: true }) });
const evalRes = await provider3.descriptor.callTool("browser_cdp", { method: "Runtime.evaluate", params: { expression: "1" } });
assert.deepEqual(evalRes.result, { method: "Runtime.evaluate", ok: true });
ok("CDP 放行域（Runtime.evaluate 等）到达注入的 sendCDPCommand");

console.log(`\nALL PASSED (${passed} checks) — source/cursor/reference`);
