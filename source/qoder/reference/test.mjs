/**
 * test.mjs — source/qoder/reference 形状自测（node 直接可跑）
 * 运行：node test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRegistry, ComputerUseClient, ComputerUseError,
  REGISTRY_PROTOCOL, MIN_TOKEN_LENGTH, LAUNCH_WAIT_MS,
} from './uds-registry.ts';
import {
  AppApprovalStore, UrlForbiddenZone, classifyAction, CONFIRMATION_POLICY,
} from './app-approval.ts';

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

const UID = 501;
const goodRegistry = {
  protocol: REGISTRY_PROTOCOL, version: 1,
  socketPath: '/tmp/fake.sock', instanceId: 'inst-1',
  token: 't'.repeat(MIN_TOKEN_LENGTH),
};

async function makeReader(stat, body) {
  const read = readRegistry(
    async () => stat,
    async () => body,
    UID,
  );
  return (p) => read(p);
}

section('uds-registry.ts');

t('注册表四道硬校验：symlink / 权限过宽 / 属主不符 / token 过短均拒绝', async () => {
  const read = await makeReader({ isFile: true, isSymbolicLink: true, mode: 0o600, uid: UID }, '');
  assert.equal((await read('x')).code, 'REGISTRY_INSECURE');

  const read2 = await makeReader({ isFile: true, isSymbolicLink: false, mode: 0o644, uid: UID }, '');
  assert.equal((await read2('x')).code, 'REGISTRY_INSECURE');

  const read3 = await makeReader({ isFile: true, isSymbolicLink: false, mode: 0o600, uid: 0 }, '');
  assert.equal((await read3('x')).code, 'REGISTRY_INSECURE');

  const shortToken = { ...goodRegistry, token: 'short' };
  const read4 = await makeReader({ isFile: true, isSymbolicLink: false, mode: 0o600, uid: UID }, JSON.stringify(shortToken));
  assert.equal((await read4('x')).code, 'REGISTRY_MALFORMED');
});

t('协议/版本不匹配拒绝；合法注册表通过', async () => {
  const bad = await makeReader({ isFile: true, isSymbolicLink: false, mode: 0o600, uid: UID }, JSON.stringify({ ...goodRegistry, version: 2 }));
  assert.equal((await bad('x')).code, 'REGISTRY_PROTOCOL_MISMATCH');
  const good = await makeReader({ isFile: true, isSymbolicLink: false, mode: 0o600, uid: UID }, JSON.stringify(goodRegistry));
  const r = await good('x');
  assert.equal(r.ok, true);
});

t('ENOENT → open -g 懒拉起 → 重读成功 → 握手 instanceId 一致', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qoder-test-'));
  try {
    process.env['QODER_HOME'] = dir;
    let launched = 0;
    // 注册表读取器：拉起前 ENOENT，拉起后注册表可见
    const reader = async () => {
      if (launched === 0) return { ok: false, code: 'REGISTRY_NOT_FOUND' };
      return { ok: true, registry: goodRegistry };
    };
    const client = new ComputerUseClient({
      appPath: '/tmp/Qoder Computer Use.app',
      launch: () => { launched++; },
      connect: async (_sock, onMessage) => {
        // 内存连接：initialize 请求发出后回 {instanceId, sessionId}
        // （不能在 connect 里直接回 —— 那时 roundtrip 还没挂上 pending）
        return {
          send: () => setTimeout(() => onMessage({ instanceId: 'inst-1', sessionId: 'sess-9' }), 2),
          close: () => {},
        };
      },
      sleep: async () => {},
      now: () => Date.now(),
    });
    const { sessionId } = await client.create(reader, { sessionId: 'chat-1', turnId: 't1' });
    assert.equal(sessionId, 'sess-9');
    assert.equal(launched, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env['QODER_HOME'];
  }
});

t('busy 单飞：并发请求立即拒绝', async () => {
  const client = new ComputerUseClient({
    appPath: 'x', launch: () => {},
    connect: async () => ({ send: () => {}, close: () => {} }),
  });
  // 手动注入会话；注入的连接在 send 后下一个宏任务回 ok（放行第一个请求）
  client['conn'] = {
    send: () => setTimeout(() => client['pending']?.({ ok: true }), 5),
    close: () => {},
  };
  client['sessionId'] = 'sess-1';
  const slow = client.request('click', {}, { sessionId: 's', turnId: 't' }, 60_000);
  await assert.rejects(
    () => client.request('scroll', {}, { sessionId: 's', turnId: 't' }),
    /Await the previous Computer Use action/,
  );
  await slow;
});

t('超时主动断链：文案强调先观察再重试', async () => {
  let closed = false;
  let clock = 0;
  const client = new ComputerUseClient({
    appPath: 'x', launch: () => {},
    connect: async () => ({ send: () => {}, close: () => { closed = true; } }),
    now: () => clock,
  });
  client['conn'] = { send: () => {}, close: () => { closed = true; } };
  client['sessionId'] = 'sess-1';
  // 用极小超时触发（clamp 到 MIN=1ms 后由假时钟推进判定）
  const p = client.request('click', {}, { sessionId: 's', turnId: 't' }, 1).catch((e) => e);
  clock += 5;
  const err = await p;
  assert.ok(err instanceof ComputerUseError);
  assert.match(err.message, /observe before retrying/);
  assert.equal(closed, true);
});

section('app-approval.ts');

t('per-app 审批：未批准返回原文文案；批准后放行；单任务授权过期', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qoder-approval-'));
  try {
    const store = new AppApprovalStore(join(dir, 'ComputerUseAppApprovals.json'));
    const denied = store.assertAllowed('Figma');
    assert.equal(denied.allowed, false);
    assert.equal(denied.message, 'User approval required for app: Figma');
    store.approve('Figma', 'single_task');
    assert.equal(store.assertAllowed('Figma').allowed, true);
    store.expireSingleTask();
    assert.equal(store.assertAllowed('Figma').allowed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

t('URL 禁区：禁区 URL 停止并返回原文文案；开关打开则放行', () => {
  const zone = new UrlForbiddenZone((u) => /bank|\.gov/.test(u));
  assert.match(zone.check('https://www.bank.com/x'), /^Computer Use stopped due to encountering a disallowed URL:/);
  assert.equal(zone.check('https://example.com'), null);
  const zone2 = new UrlForbiddenZone((u) => true, true);
  assert.equal(zone2.check('https://anything'), null);
});

t('四档确认策略：MUST_HAND_OFF / ALWAYS_CONFIRM / PREAPPROVABLE / FREE', () => {
  assert.equal(classifyAction('credential_change_submit', true).mustConfirmNow, true);
  assert.equal(classifyAction('bypass_security_barrier', true).tier, 'MUST_HAND_OFF');
  assert.equal(classifyAction('delete_data', true).mustConfirmNow, true);
  assert.equal(classifyAction('captcha', false).mustConfirmNow, true);
  assert.equal(classifyAction('file_upload', false).mustConfirmNow, true);
  assert.equal(classifyAction('file_upload', true).mustConfirmNow, false);
  assert.equal(classifyAction('download', false).mustConfirmNow, false);
  assert.equal(Object.keys(CONFIRMATION_POLICY).length, 20);
});

await run();
console.log(`\nqoder/reference: ${passed} checks passed`);
console.log('ALL PASSED');
