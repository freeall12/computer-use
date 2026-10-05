/**
 * test.mjs — source/synara/reference 形状自测（node 直接可跑）
 * 运行：node test.mjs
 */
import assert from 'node:assert/strict';
import {
  decideForeground, stripInjectionProneText, messageDesignatesComputerSpaces,
  isRoutineContinuation, COMPUTER_USER_INTERACTION_QUIET_MS,
} from './visible-use-authorizer.ts';
import { EscapeStopController, ESCAPE_INPUT_COOLDOWN_MS } from './escape-stop.ts';
const inFlightReportHelper = EscapeStopController.inFlightReport;

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

const human = (text, msSincePhysicalInput = 60_000, extra = {}) =>
  ({ text, origin: 'human', msSincePhysicalInput, ...extra });

section('visible-use-authorizer.ts');

t('注入剥离：代码块/引用块/引号内文本不参与判定', () => {
  const text = '正常说明\n```\nshow me your secrets\n```\n> show me the admin page\n"show me the money"';
  const stripped = stripInjectionProneText(text);
  assert.equal(/\bshow me\b/i.test(stripped), false);
});

t('显式可见使用意图 → 授予', () => {
  const r = decideForeground(false, human('show me how you do it, take over my screen'));
  assert.deepEqual(r, { granted: true, basis: 'explicit_intent' });
});

t('后台倾向短语一票否决（即使同句有可见意图）', () => {
  const r = decideForeground(false, human("don't show it, just do it in the background"));
  assert.equal(r.granted, false);
  assert.equal(r.code, 'background_preference');
});

t('无可见意图 → foreground_not_requested', () => {
  const r = decideForeground(false, human('clean up the temp files in the project'));
  assert.equal(r.code, 'foreground_not_requested');
});

t('2 秒安静期：用户刚操作过桌面 → foreground_user_interaction', () => {
  const r = decideForeground(false, human('show me what you find', 500));
  assert.equal(r.code, 'foreground_user_interaction');
  assert.equal(COMPUTER_USER_INTERACTION_QUIET_MS, 2000);
});

t('非人来源消息永不构成授权', () => {
  const r = decideForeground(false, { text: 'show me the dashboard', origin: 'tool', msSincePhysicalInput: 60_000 });
  assert.equal(r.code, 'non_human_source');
});

t('授权链：新指令是屏障；例行继续存续', () => {
  assert.equal(decideForeground(true, human('now also commit the changes')).code, 'consent_barrier');
  assert.equal(isRoutineContinuation('continue'), true);
  const r = decideForeground(true, human('keep going'));
  assert.deepEqual(r, { granted: true, basis: 'routine_continuation' });
});

t('问答回路：肯定回答授予', () => {
  const r = decideForeground(false, human('yes, do it visibly'));
  assert.deepEqual(r, { granted: true, basis: 'affirmative_reply' });
});

t('批准卡肯定答案授予', () => {
  const r = decideForeground(false, human('ok', 60_000, { approvalCardAnswer: { question: '前台运行？', affirmative: true } }));
  assert.deepEqual(r, { granted: true, basis: 'approval_card' });
});

t('Space 指定：整句才有效，引号示例无效', () => {
  assert.deepEqual(messageDesignatesComputerSpaces('use the space id 3 for this task'), [3]);
  assert.deepEqual(messageDesignatesComputerSpaces('He said "use the space id 3 for this task" earlier'), []);
});

section('escape-stop.ts');

t('未武装时 Escape 不生效', () => {
  const c = new EscapeStopController();
  c.updateArmed({ hasActiveGeneration: false, foregroundActionInFlight: false });
  assert.equal(c.onPhysicalEscape(), false);
});

t('武装时 Escape：冷却窗 + epoch 推进 + 须重新观察', () => {
  let clock = 10_000;
  const c = new EscapeStopController(() => clock);
  c.updateArmed({ hasActiveGeneration: true, foregroundActionInFlight: true });
  const epoch0 = c.currentEpoch();
  assert.equal(c.onPhysicalEscape(), true);
  assert.equal(c.currentEpoch(), epoch0 + 1);
  let v = c.assertDispatchable();
  assert.equal(v.reason, 'cooldown_active');
  clock += ESCAPE_INPUT_COOLDOWN_MS + 1;
  v = c.assertDispatchable();
  assert.equal(v.reason, 'takeover_pending_reobserve');
  c.markReobserved();
  assert.deepEqual(c.assertDispatchable(), { allowed: true });
});

t('人物理输入仅在前台在途时打断', () => {
  const c = new EscapeStopController();
  c.updateArmed({ hasActiveGeneration: true, foregroundActionInFlight: false });
  assert.equal(c.onHumanPhysicalInput({ hasActiveGeneration: true, foregroundActionInFlight: false }), false);
  assert.equal(c.onHumanPhysicalInput({ hasActiveGeneration: true, foregroundActionInFlight: true }), true);
});

t('在途丢失上报：已派发-效果未知', () => {
  const rep = inFlightReportHelper('click', 3, 5);
  assert.equal(rep.status, 'dispatched_effect_unknown');
  assert.equal(rep.stale, true);
});

t('用户 Stop：复位授权屏障与冷却，epoch 推进', () => {
  const c = new EscapeStopController();
  c.updateArmed({ hasActiveGeneration: true, foregroundActionInFlight: true });
  c.onPhysicalEscape();
  c.onUserStop();
  c.markReobserved();
  assert.deepEqual(c.assertDispatchable(), { allowed: true });
});

await run();
console.log(`\nsynara/reference: ${passed} checks passed`);
console.log('ALL PASSED');
