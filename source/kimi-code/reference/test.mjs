/**
 * test.mjs — source/kimi-code/reference 形状自测（node 直接可跑）
 * 运行：node test.mjs
 */
import assert from 'node:assert/strict';
import { UdsFrameCodec, UDS_PROTOCOL, MAX_FRAME_BYTES, KimiCuMcpServer, CU_TOOL_NAMES } from './mcp-server.ts';
import { WebBridgeCodec, WEBBRIDGE_COMMANDS, hostMatches, bindAddressWarning } from './webbridge-codec.ts';

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

section('mcp-server.ts');

t('UDS 帧编解码往返 + 半帧粘包处理', () => {
  const codec = new UdsFrameCodec();
  const hello = { type: 'hello', token: 'tok', protocol: UDS_PROTOCOL, versions: [1], client_name: 'test', observation_context: 'ctx-1' };
  const buf = Buffer.concat([codec.encode(hello), codec.encode({ type: 'invoke', method: 'list_apps' })]);
  const first = codec.decode(buf.subarray(0, 7)); // 半帧
  assert.equal(first.messages.length, 0);
  const { messages } = codec.decode(Buffer.concat([first.rest, buf.subarray(7)]));
  assert.equal(messages.length, 2);
  assert.equal(messages[0].type, 'hello');
  assert.equal(MAX_FRAME_BYTES, 8 * 1024 * 1024);
});

t('tools/list 注册 18 个 CU 工具', () => {
  const srv = new KimiCuMcpServer();
  const res = srv.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.result.tools.length, 18);
  assert.deepEqual(res.result.tools.map((x) => x.name), [...CU_TOOL_NAMES]);
});

t('get_app_state 产生 snapshot_id；无 snapshot_id 的 index 动作被拒', () => {
  const srv = new KimiCuMcpServer();
  const obs = srv.handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_app_state', arguments: { app: 'Notes', observation_context: 'ctx-A' } } });
  const payload = JSON.parse(obs.result.content[0].text);
  assert.ok(payload.snapshot_id.startsWith('snap-ctx-A'));
  assert.throws(() => srv.callTool('click', { index: 1 }), /snapshot_id is stale or belongs to another observation context/);
});

t('携带有效 snapshot_id 的点击：Button 可验证 / StaticText → verification_required:screenshot', () => {
  const srv = new KimiCuMcpServer();
  const obs = srv.callTool('get_app_state', { app: 'Notes', observation_context: 'ctx-A' });
  const sid = JSON.parse(obs.content[0].text).snapshot_id;
  const btn = JSON.parse(srv.callTool('click', { index: 1, snapshot_id: sid }).content[0].text);
  assert.equal(btn.verified, true);
  const st = JSON.parse(srv.callTool('click', { index: 2, snapshot_id: sid }).content[0].text);
  assert.equal(st.verified, false);
  assert.equal(st.verification_required, 'screenshot');
});

t('跨 observation_context 的 snapshot_id 被拒', () => {
  const srv = new KimiCuMcpServer();
  const sid1 = JSON.parse(srv.callTool('get_app_state', { app: 'A', observation_context: 'ctx-1' }).content[0].text).snapshot_id;
  // 切换观察上下文后，旧上下文的快照 id 立即失效
  srv.callTool('get_app_state', { app: 'A', observation_context: 'ctx-2' });
  assert.throws(() => srv.callTool('click', { index: 1, snapshot_id: sid1 }), /another observation context/);
  assert.throws(() => srv.callTool('set_value', { index: 0, value: 'x', snapshot_id: 'snap-other-9' }), /another observation context/);
});

t('set_value：settable 元素写入 / 非 settable 拒绝', () => {
  const srv = new KimiCuMcpServer();
  const sid = JSON.parse(srv.callTool('get_app_state', { app: 'A', observation_context: 'c' }).content[0].text).snapshot_id;
  assert.equal(JSON.parse(srv.callTool('set_value', { index: 0, value: 'hello', snapshot_id: sid }).content[0].text).verified, true);
  assert.equal(JSON.parse(srv.callTool('set_value', { index: 1, value: 'x', snapshot_id: sid }).content[0].text).error, 'element_not_settable');
});

t('未知字段 → KIMI_CU_UNKNOWN_FIELD；camelCase 别名归一', () => {
  const srv = new KimiCuMcpServer();
  assert.throws(() => srv.callTool('click', { bogus_field: 1 }), /KIMI_CU_UNKNOWN_FIELD/);
  const sid = JSON.parse(srv.callTool('get_app_state', { app: 'A', observation_context: 'c' }).content[0].text).snapshot_id;
  // elementIndex → index 别名可接受
  const r = srv.callTool('click', { elementIndex: 1, snapshot_id: sid });
  assert.equal(JSON.parse(r.content[0].text).ok, true);
});

section('webbridge-codec.ts');

t('信封：请求编码/解码 + 未知命令拒绝', () => {
  const codec = new WebBridgeCodec();
  const body = codec.encodeRequest({ action: 'navigate', args: { url: 'https://www.kimi.com' }, session: 'k26-research' });
  const req = codec.decodeRequest(body);
  assert.equal(req.action, 'navigate');
  assert.equal(req.session, 'k26-research');
  assert.throws(() => codec.decodeRequest('{"action":"nope","session":"s"}'), /unknown command/);
  assert.equal(WEBBRIDGE_COMMANDS.length, 16);
});

t('信封：成功/失败形状', () => {
  const codec = new WebBridgeCodec();
  assert.deepEqual(codec.ok({ tabId: 7 }), { ok: true, data: { tabId: 7 } });
  const f = codec.fail('BROWSER_TAB_REQUIRED', 'no tab bound');
  assert.equal(f.ok, false);
  assert.equal(f.error.code, 'BROWSER_TAB_REQUIRED');
});

t('host 匹配：忽略 path、www 归一；不同 host 不匹配', () => {
  assert.equal(hostMatches('https://kimi.com/a', 'https://www.kimi.com/b'), true);
  assert.equal(hostMatches('https://kimi.com', 'https://example.com'), false);
});

t('回环治理：非回环绑定给出明文警告', () => {
  assert.equal(bindAddressWarning('http://127.0.0.1:10086'), null);
  assert.match(bindAddressWarning('http://0.0.0.0:10086'), /any client on the network/);
});

await run();
console.log(`\nkimi-code/reference: ${passed} checks passed`);
console.log('ALL PASSED');
