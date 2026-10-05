/**
 * source/zcode/reference 自测 —— 「观察 → 动作 → 验证」闭环 + 安全语义形状。
 * 运行：node source/zcode/reference/test.mjs
 */
import assert from "node:assert/strict";
import { createMockCuaBackend, BROKER_RESPONSE_AMBIGUOUS_MESSAGE } from "./mock-broker.ts";
import {
  setupComputerUseRuntime, ComputerUseError,
  COMPUTER_METHOD_NAMES, normalizeKeyChord, resolveTextRange,
} from "./computer-use-client.ts";

let passed = 0;
const ok = (msg) => { passed += 1; console.log("  ok", `${passed}.`, msg); };

// ---------------------------------------------------------------- 1. 装配
const backend = createMockCuaBackend();
setupComputerUseRuntime({ globals: globalThis, bridge: backend.bridge, backoffMs: [0, 0, 0, 0, 0] });
let agent = globalThis.agent.computerUse; // 产品形态：模型经 agent.computerUse.* 使用
assert.equal(agent.computer && typeof agent.computer.left_click, "function");
assert.deepEqual([...COMPUTER_METHOD_NAMES].sort(), [
  "get_app_state", "key", "left_click", "left_click_drag", "list_apps", "list_windows",
  "paste", "perform_action", "request_access", "scroll", "select_text", "set_value",
  "stop_computer_control", "type",
]);
ok("runtime 装配 + 14 工具逃逸口齐全");

// ------------------------------------------------- 2. getApp：绑定即隐藏观察 + 身份收敛
let app = await agent.getApp({ name: "备忘录" });
assert.deepEqual(app.appRef, { pid: 4127, bundle_id: "com.apple.Notes", window_id: 8613 });
const bindCall = backend.calls.find((c) => c.method === "get_app_state");
assert.equal(bindCall.input.disable_diffing, true, "绑定观察必须全量");
assert.equal(bindCall.input.tree_shown_to_model, false, "绑定观察不进模型台账");
assert.equal(app.treeSeen, false, "绑定不等于给模型看过树");
// elements() 是原型方法 → 不可枚举（§8 R2）
assert.ok(!Object.keys(app).includes("elements"));
// 绑定观察属于 App 实例之外（bindObserve）——App 级尚无观察时元素索引必须被拒（先观察纪律）
await assert.rejects(() => app.click(0), (e) => e.code === "STALE_STATE" && /fresh observation/u.test(e.message));
ok("getApp 绑定观察参数与身份收敛正确；未观察前元素索引被拒");

// ------------------------------------------------- 3. 观察：整树 → diff
const text1 = await app.getAXState();
assert.ok(text1.includes("# full tree") && text1.includes("新建"), "首个观察强制整树");
assert.equal(app.treeSeen, true);
const text2 = await app.getAXState();
assert.ok(text2.includes("# diff"), "无变化的再观察走 diff 路径");
ok("观察机制：绑定后首观察整树、后续 diff");

// ------------------------------------------------- 4. 观察 → 动作 → 验证 闭环
const els = await app.elements();
assert.equal(app.treeSeen, false, "elements() 静默观察清台账，下次强制整树");
const xinjian = els.find((e) => e.name === "新建");
await app.click(xinjian.index);
const text3 = await app.getAXState();
assert.ok(text3.includes("未命名笔记 1"), "点击「新建」后树里出现新笔记");
ok("闭环：elements → click → 再观察验证界面变化");

// ------------------------------------------------- 5. 效果证据 [effect_evidence unchanged]
const els2 = await app.elements();
const share = els2.find((e) => e.name === "分享");
await app.performSecondaryAction(share.index, "AXPress");
const text4 = await app.getAXState();
assert.ok(text4.startsWith("[effect_evidence unchanged]"), "AX 受理但界面未变要显式标注");
ok("效果证据：unchanged 标注（§4.2）");

// ------------------------------------------------- 6. setValue / pressKey / keysym 归一
assert.equal(normalizeKeyChord("enter"), "return");
assert.equal(normalizeKeyChord("Control_L+a"), "ctrl+a");
assert.equal(normalizeKeyChord("super+c"), "cmd+c");
const els3 = await app.elements();
const body = els3.find((e) => e.name === "正文");
await app.click(body.index);
await app.setValue(body.index, "hello");
await app.pressKey("Return");
const text5 = await app.getAXState();
assert.ok(text5.includes("hello"), "Return 把正文提交为新笔记");
const bodyLine = text5.split("\n").find((l) => l.includes('name="正文"'));
assert.ok(bodyLine && !bodyLine.includes("value="), "提交后正文清空（空值不渲染 value 键）");
const keyCall = [...backend.calls].reverse().find((c) => c.method === "key");
assert.equal(keyCall.input.text, "return");
ok("setValue/pressKey 闭环 + keysym 归一上送 wire");

// ------------------------------------------------- 7. 坐标路径与 FrameRegistry fail-closed
const shot = await app.getScreenshot();
assert.ok(shot instanceof Uint8Array);
const fid1 = backend.host.lastFrameId();
await app.click({ type: "coordinate", x: 10, y: 20 }); // 隐式绑定最新可动作帧
await app.getScreenshot(); // 帧被替换 → 旧帧进墓碑
const fid2 = backend.host.lastFrameId();
assert.notEqual(fid1, fid2);
await assert.rejects(
  () => agent.computer.left_click({ app_ref: { ...app.appRef }, target: { type: "coordinate", x: 1, y: 1, frame_id: fid1 } }),
  (e) => e instanceof ComputerUseError && e.code === "STALE_STATE",
  "过期帧 fail-closed",
);
ok("坐标帧：隐式绑定最新帧 + 过期帧 STALE_STATE");

// ------------------------------------------------- 8. 消失元素 fail-closed
const els4 = await app.elements();
const victim = els4[els4.length - 1];
backend.host.removeElementAt(victim.index);
await assert.rejects(
  () => app.click(victim.index),
  (e) => e.code === "ELEMENT_UNAVAILABLE" && e.retry === "reobserve",
);
ok("消失元素 ELEMENT_UNAVAILABLE（fail-closed，不静默）");

// ------------------------------------------------- 9. 防重放：possibly_sent ⇒ actionSent ⇒ 只许先观察
const els5 = await app.elements();
const btn = els5.find((e) => e.name === "新建");
backend.host.pushFault({
  code: "broker_response_ambiguous",
  message: BROKER_RESPONSE_AMBIGUOUS_MESSAGE,
  details: { request_delivery_state: "possibly_sent" },
});
const before = backend.calls.filter((c) => c.method === "left_click").length;
await assert.rejects(() => app.click(btn.index), (e) => {
  assert.ok(e instanceof ComputerUseError);
  assert.equal(e.actionSent, true, "possibly_sent ⇒ actionSent=true");
  assert.equal(e.retry, "reobserve", "actionSent ⇒ retry=reobserve");
  assert.equal(e.dispatchStatus, "possibly_sent");
  return true;
});
const after = backend.calls.filter((c) => c.method === "left_click").length;
assert.equal(after, before + 1, "SDK 不自动重放（只发一次 wire）");
ok("防重放：possibly_sent 不自动重试，只引导重观察");

// ------------------------------------------------- 10. CONTROLLER_BUSY：永不重试 + owner 上报
backend.host.setBusyOwner("sess_other");
await assert.rejects(() => app.click(btn.index), (e) => {
  assert.equal(e.code, "CONTROLLER_BUSY");
  assert.equal(e.retry, "never");
  assert.equal(e.details.owner, "sess_other");
  return true;
});
backend.host.setBusyOwner(null);
ok("租约：CONTROLLER_BUSY 永不重试并携带 owner");

// ------------------------------------------------- 11. kill switch 闩锁与两豁免
await agent.stop("任务完成");
await assert.rejects(() => app.getAXState(), (e) => e.code === "CONTROL_STOPPED");
const ra = await agent.requestAccess(); // 豁免工具仍可用
assert.equal(ra.ready, true);
ok("kill switch：闩锁后 fail-hard，request_access 豁免");

// kill switch 已闩锁毒化旧世界 —— 后续用例切换到新世界（模拟新会话/新 cell 重新开始）
const backend2 = createMockCuaBackend();
setupComputerUseRuntime({ globals: globalThis, bridge: backend2.bridge, backoffMs: [0, 0, 0, 0, 0] });
agent = globalThis.agent.computerUse;
app = await agent.getApp({ name: "备忘录" });

// ------------------------------------------------- 12. 子代理禁用 + generation 失配
const subBackend = createMockCuaBackend({ runtimeScope: "subagent" });
const subAgent = setupComputerUseRuntime({ globals: {}, bridge: subBackend.bridge, backoffMs: [0, 0, 0, 0, 0] });
await assert.rejects(() => subAgent.listApps(), /not available in subagent/u);
ok("子代理在桥接层直接禁用");

// ------------------------------------------------- 13. CUA_NOT_READY 原样重试
const nrBackend = createMockCuaBackend();
nrBackend.host.setNotReady(2);
const nrAgent = setupComputerUseRuntime({ globals: {}, bridge: nrBackend.bridge, backoffMs: [0, 0, 0, 0, 0] });
const app2 = await nrAgent.getApp("备忘录");
const gsCalls = nrBackend.calls.filter((c) => c.method === "get_app_state").length;
assert.equal(gsCalls, 3, "2 次 not-ready + 1 次成功（同一调用原样重放）");
assert.equal(app2.appRef.pid, 4127);
ok("CUA_NOT_READY 冷启动：按退避原样重试后成功");

// ------------------------------------------------- 14. 备用 app_ref 字段重试（身份猜错）
// name 字段拿到 bundle-id 串 → 「not running」→ SDK 换 bundle_id 字段重试一次（§3.4）
const app3 = await agent.getApp({ name: "com.apple.Notes" });
assert.equal(app3.appRef.bundle_id, "com.apple.Notes");
ok("getApp 备用字段重试：bundle-id 串冒充 name 时自动换字段");

// ------------------------------------------------- 15. 窗口钉住校验
backend2.host.setWindowFallback(true);
await assert.rejects(
  () => agent.getApp({ name: "备忘录" }),
  (e) => e.code === "STALE_STATE" && /frontmost/u.test(e.message),
  "Helper 静默降级到最前窗口必须拒绝绑定",
);
backend2.host.setWindowFallback(false);
ok("窗口钉住校验：window_id_fallback ⇒ STALE_STATE");

// ------------------------------------------------- 16. selectText 本地消歧
const els6 = await app.elements();
const body2 = els6.find((e) => e.name === "正文");
await app.setValue(body2.index, "cat catalog cat");
await assert.rejects(
  () => app.selectText(body2.index, "cat"),
  (e) => e.code === "NOT_SELECTABLE" && e.message.includes("3 candidates"),
  "多义匹配报候选数",
);
await app.selectText(body2.index, "cat", { suffix: "alog" }); // 唯一命中第 2 处
const selCall = [...backend2.calls].reverse().find((c) => c.method === "select_text");
assert.deepEqual(selCall.input.text_range, [4, 3]);
let zeroCand = -1;
try { resolveTextRange("abc", "x"); } catch (e) { zeroCand = e.candidates; }
assert.equal(zeroCand, 0, "无匹配也走 NOT_SELECTABLE（0 候选）");
ok("selectText：本地消歧/候选数/range 计算");

// ------------------------------------------------- 17. event 策略的前台门控
backend2.host.setForeground(false);
await assert.rejects(
  () => app.click(btn.index, { strategy: "event" }),
  (e) => e.code === "FOREGROUND_REQUIRED",
);
backend2.host.setForeground(true);
ok("event 策略：后台 app 直接拒，什么都不发");

// ------------------------------------------------- 18. generation 失配（放在最后：会毒化会话）
backend2.host.bumpGeneration();
await assert.rejects(() => agent.listApps(), /stale after kernel reset/u);
ok("generation 失配：拒绝复用旧绑定（防 kernel 复用）");

console.log(`\nALL PASSED (${passed} checks) — source/zcode/reference`);
