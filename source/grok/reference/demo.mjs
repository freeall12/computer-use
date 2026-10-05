/**
 * demo.mjs — 协议形状冒烟（零依赖，Node 内置模块）。
 *
 * 场景：内存假 sidecar（回显协议应答）→ service.json 发布 → 客户端（JS 复刻
 * sidecarClient.ts 的调用序列）完成 ping/tools/list/tools/call/control 会话。
 * 运行：node demo.mjs
 */
import * as net from 'node:net';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const APP_SUPPORT = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-cu-demo-'));
const SOCKET_PATH = path.join(APP_SUPPORT, 'cu.sock');
const SERVICE_JSON = path.join(APP_SUPPORT, 'service.json');

// ---------- 假 sidecar（内存）：实现 ping/tools/list/tools/call/control/* ----------
const server = net.createServer((socket) => {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const req = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      let res;
      switch (req.method) {
        case 'ping':
          res = { id: req.id, result: 'ok' };
          break;
        case 'tools/list':
          res = { id: req.id, result: { tools: [{ name: 'computer_screenshot' }, { name: 'computer_click' }] } };
          break;
        case 'tools/call':
          if (req.name === 'computer_use_screenshot') res = { id: req.id, result: { image_base64: 'ZmFrZQ==', snapshot_id: 'snap-1' } };
          else if (req.sessionId === undefined) res = { id: req.id, error: 'An active remote control session is required before computer_use_click can send input.', errorCode: 'session_required' };
          else res = { id: req.id, result: { ok: true } };
          break;
        case 'control/start':
          if (req.mode !== 'remote') res = { id: req.id, error: 'control/start requires remote mode' };
          else res = { id: req.id, result: 'started', sessionId: `sess-${randomUUID().slice(0, 8)}` };
          break;
        case 'control/release':
          res = { id: req.id, result: 'released' };
          break;
        default:
          res = { id: req.id, error: `Unknown RPC method: ${req.method}` };
      }
      socket.write(`${JSON.stringify(res)}\n`);
    }
  });
});
await new Promise((resolve) => server.listen(SOCKET_PATH, resolve));

// 假"拉起"：立即发布 service.json（真实实现为 /usr/bin/open -g <助手.app> + 就绪轮询）
async function launch() {
  await fs.writeFile(SERVICE_JSON, JSON.stringify({ rpcSocketPath: SOCKET_PATH }));
}

// ---------- 客户端（复刻 sidecarClient.ts 序列）----------
async function connectOnce(frame, timeoutMs = 2000) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('RPC timed out')); }, timeoutMs);
    let buffer = '';
    socket.on('connect', () => socket.write(`${JSON.stringify(frame)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      socket.destroy();
      resolve(JSON.parse(buffer.slice(0, nl)));
    });
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

const results = [];
function check(name, cond) {
  results.push([name, cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

await launch();

// 1) 就绪 ping（service.json → rpcSocketPath → ping）
const state = JSON.parse(await fs.readFile(SERVICE_JSON, 'utf8'));
const ping = await connectOnce({ id: 'p1', method: 'ping', requestID: randomUUID() });
check('service.json published & ping roundtrip', state.rpcSocketPath === SOCKET_PATH && ping.result === 'ok');

// 2) tools/list
const listing = await connectOnce({ id: 't1', method: 'tools/list', requestID: randomUUID() });
check('tools/list exposes computer_* catalog entries', listing.result.tools.length === 2);

// 3) 无会话时输入被拒（session_required → use_different_tool 语义）
const denied = await connectOnce({ id: 'c1', method: 'tools/call', requestID: randomUUID(), name: 'computer_use_click', arguments: { method: 'coordinate', x: 10, y: 10, button: 'left', count: 1 } });
check('input without control session refused (session_required)', denied.errorCode === 'session_required' && denied.result === undefined);

// 4) control/start(remote) → sessionId → 输入放行 → release
const start = await connectOnce({ id: 's1', method: 'control/start', requestID: randomUUID(), mode: 'remote' });
check('control/start(remote) returns sessionId', typeof start.sessionId === 'string' && start.sessionId.length > 0);
const shot = await connectOnce({ id: 'c2', method: 'tools/call', requestID: randomUUID(), name: 'computer_use_screenshot', arguments: {} });
check('computer_use_screenshot returns snapshot', shot.result.snapshot_id === 'snap-1');
const click = await connectOnce({ id: 'c3', method: 'tools/call', requestID: randomUUID(), name: 'computer_use_click', arguments: { method: 'coordinate', x: 10, y: 10, button: 'left', count: 1 }, mode: 'remote', sessionId: start.sessionId });
check('input allowed within active session', click.result?.ok === true);
const release = await connectOnce({ id: 'r1', method: 'control/release', requestID: randomUUID(), mode: 'remote', sessionId: start.sessionId });
check('control/release ok', release.result === 'released');

// 5) companion 模式起会话必须被拒（错误以帧内 error 字段返回）
const companionStart = await connectOnce({ id: 's2', method: 'control/start', requestID: randomUUID(), mode: 'companion' });
check('control/start(companion) refused', companionStart.error === 'control/start requires remote mode');

server.close();
await fs.rm(APP_SUPPORT, { recursive: true, force: true });

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
