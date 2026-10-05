/**
 * test.mjs — source/minimax-code/reference 形状自测（node 直接可跑）
 * 运行：node test.mjs
 */
import assert from 'node:assert/strict';
import { HostBindingGate } from './binding-gate.ts';
import { CuaLeaseServer, isMutatingRequest, RELEASED_TURN_CACHE_LIMIT } from './lease-fencing.ts';
import {
  verifiedFill, clickEffect, scrollEffect, verifyState, setAdvanceClock,
  VERIFIED_FILL_SAMPLE_COUNT, MAX_VERIFY_PREDICATES,
} from './effect-verification.ts';

let passed = 0;
const steps = [];
function section(name) {
  steps.push(() => console.log(name));
}
function t(name, fn) {
  steps.push(async () => {
    await fn(); // async 测试体必须等待，失败即时暴露
    passed++;
    console.log(`  ok  ${name}`);
  });
}
async function run() {
  for (const step of steps) await step();
}

// ---------- binding-gate ----------
section('binding-gate.ts');
const officialPlugin = {
  name: 'computer-use', source: 'official', hostCapabilities: ['computer.use'],
  bindings: [{
    bindingId: 'computer-control', logicalToolName: 'computer.control',
    hostCapability: { id: 'computer.use', version: 1 },
    requiredSkills: ['computer-use'], allowedSurfaces: ['interactive'],
  }],
};

t('未启用时工具目录不含 computer_* 工具（fail-closed）', () => {
  const gate = new HostBindingGate();
  const native = [{ name: 'read' }, { name: 'computer_click', execute: async () => 1 }];
  const catalog = gate.assembleToolCatalog('s1', native, [{ name: 'computer_click', execute: async () => 1 }]);
  assert.deepEqual(catalog.map((x) => x.name), ['read']);
});

t('official 插件准入 + 会话激活后工具可见', () => {
  const gate = new HostBindingGate();
  gate.setTrustedPlugins([officialPlugin]);
  assert.equal(gate.isEnabled(), true);
  gate.setSessionActive('s1', true);
  const catalog = gate.assembleToolCatalog('s1', [{ name: 'read' }], [{ name: 'computer_click' }]);
  assert.deepEqual(catalog.map((x) => x.name), ['read', 'computer_click']);
});

t('未加载 requiredSkills 时执行被拒（SKILL_REQUIRED 语义）', async () => {
  const gate = new HostBindingGate();
  gate.setTrustedPlugins([officialPlugin]);
  gate.setSessionActive('s1', true);
  const r = await gate.execute('s1', { name: 'computer_click', execute: async () => 1 }, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'skill_required');
  assert.equal(r.skill, 'computer-use');
});

t('插件吊销后 enabled=false 且在途调用被 abort', async () => {
  const gate = new HostBindingGate();
  gate.setTrustedPlugins([officialPlugin]);
  gate.setSessionActive('s1', true);
  gate.markSkillLoaded('computer-use');
  let aborted = false;
  const p = gate.execute('s1', {
    name: 'computer_click',
    execute: (_i, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')); })),
  }, {});
  gate.setTrustedPlugins([]); // 吊销
  await p.catch(() => {});
  assert.equal(aborted, true);
  assert.equal(gate.isEnabled(), false);
});

// ---------- lease-fencing ----------
section('lease-fencing.ts');
t('generation 不匹配拒绝（computer_generation_mismatch）', () => {
  const srv = new CuaLeaseServer();
  srv.bumpGeneration();
  const res = srv.handleRequest({ version: 1, requestId: 'r1', kind: 'click', sessionId: 'a', turnId: 't1', generation: 0, payload: {} });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, 'computer_generation_mismatch');
});

t('观察类请求不占租约', () => {
  const srv = new CuaLeaseServer();
  const g = srv.bumpGeneration();
  assert.equal(isMutatingRequest('desktop_state'), false);
  const res = srv.handleRequest({ version: 1, requestId: 'r2', kind: 'desktop_state', sessionId: 'a', turnId: 't1', generation: g, payload: {} });
  assert.equal(res.ok, true);
  assert.equal(srv.leaseHolder(), null);
});

t('变更类请求获取租约；第二会话被拒', () => {
  const srv = new CuaLeaseServer();
  const g = srv.bumpGeneration();
  const r1 = srv.handleRequest({ version: 1, requestId: 'r3', kind: 'click', sessionId: 'a', turnId: 't1', generation: g, payload: {} });
  assert.equal(r1.ok, true);
  assert.equal(srv.leaseHolder(), 'a');
  const r2 = srv.handleRequest({ version: 1, requestId: 'r4', kind: 'type', sessionId: 'b', turnId: 't2', generation: g, payload: {} });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.match(r2.error.message, /Another conversation owns the computer control lease/);
});

t('release 幂等 + FIFO 缓存上限 64', () => {
  const srv = new CuaLeaseServer();
  const g = srv.bumpGeneration();
  srv.handleRequest({ version: 1, requestId: 'r5', kind: 'click', sessionId: 'a', turnId: 't1', generation: g, payload: {} });
  srv.release('a', 't1');
  assert.equal(srv.leaseHolder(), null);
  srv.release('a', 't1'); // 重复释放 no-op
  for (let i = 0; i < RELEASED_TURN_CACHE_LIMIT + 5; i++) srv.release(`s${i}`, `t${i}`);
  assert.ok(srv['releasedTurns'].length <= RELEASED_TURN_CACHE_LIMIT);
});

t('换代后旧租约一并失效', () => {
  const srv = new CuaLeaseServer();
  srv.bumpGeneration();
  srv.handleRequest({ version: 1, requestId: 'r6', kind: 'click', sessionId: 'a', turnId: 't1', generation: 1, payload: {} });
  srv.bumpGeneration();
  assert.equal(srv.leaseHolder(), null);
});

// ---------- effect-verification ----------
section('effect-verification.ts');
t('VERIFIED_FILL：值稳定 → verified=true', () => {
  setAdvanceClock(() => {});
  let v = 'hello';
  const eff = verifiedFill(() => v, 'hello');
  assert.equal(eff.verified, true);
  assert.equal(eff.status, 'confirmed');
  assert.equal(eff.details.samples.length, VERIFIED_FILL_SAMPLE_COUNT);
});

t('VERIFIED_FILL：采样中途被改写 → verified=false + verificationRequired', () => {
  let n = 0;
  const eff = verifiedFill(() => (n++ < 2 ? 'x' : 'y'), 'x');
  assert.equal(eff.verified, false);
  assert.equal(eff.verificationRequired, true);
  setAdvanceClock(null);
});

t('click 效果恒 unverified（反幻觉：先读新状态）', () => {
  const eff = clickEffect();
  assert.equal(eff.verified, false);
  assert.equal(eff.verificationRequired, true);
});

t('scroll：跨域不可验证 → SCROLL_EFFECT_UNVERIFIED；无效果 → NO_SCROLL_EFFECT', () => {
  assert.equal(scrollEffect({ scrollable: true, verifiable: false }).reason, 'SCROLL_EFFECT_UNVERIFIED');
  assert.equal(scrollEffect({ scrollable: true, verifiable: true, actualDelta: 0 }).reason, 'NO_SCROLL_EFFECT');
  assert.equal(scrollEffect({ scrollable: true, verifiable: true, actualDelta: 120 }).verified, true);
});

t('verify_state：谓词 AND + stableSamples + 上限约束', () => {
  const preds = [{ kind: 'element.exists', role: 'button', labelContains: 'OK' }];
  assert.equal(verifyState({ expect: preds, stableSamples: 3 }, () => true).satisfied, true);
  assert.equal(verifyState({ expect: preds }, () => false).satisfied, false);
  assert.throws(() => verifyState({ expect: new Array(MAX_VERIFY_PREDICATES + 1).fill(preds[0]) }, () => true));
  // 3 次采样中第 2 次失败 → 不满足
  let i = 0;
  const r = verifyState({ expect: preds, stableSamples: 3 }, () => ++i !== 2);
  assert.equal(r.satisfied, false);
});

await run();
console.log(`\nminimax-code/reference: ${passed} checks passed`);
console.log('ALL PASSED');
