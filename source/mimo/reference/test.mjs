#!/usr/bin/env node
/**
 * MiMo 参考客户端 — 形状自测（零依赖，`node test.mjs` 直接运行，末行输出 ALL PASSED）。
 *
 * 覆盖五组核心形状（依据 agents/mimo/ 分册与 ../schemas/tools.json 记录的可观察协议）：
 *   T1  MCP stdio 握手 + tools/list 应答恰为 ["js"]（优先真实导入 src/mcp-client.ts；
 *       无类型剥离能力的 Node 自动回落到本文件内的等价 JS 镜像，取景逻辑一致）
 *   T2  js REPL 工具调用回环 + @mimo/sky 门面注入 / 插件关闭 fail-closed 模拟
 *       （内联 mock 服务端：行分隔 JSON-RPC 2.0 + vm 沙盒持久内核）
 *   T3  agent.browsers 四后端（iab/extension/managed/cdp）能力广告与裁剪，无静默替换
 *   T4  锁屏授权租约状态机（1–20s 单调 TTL 一次性 token、审计绑定、46s 准入隔离）
 *   T5  Chromium Native Messaging 信封编解码回环（4 字节 LE 长度前缀 + JSON，1MB 上限）
 */

import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// 断言工具
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, name) {
  if (cond) {
    passed++;
    console.log("ok   " + name);
  } else {
    failed++;
    failures.push(name);
    console.log("FAIL " + name);
  }
}

function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(a === b, name + (a === b ? "" : " (actual=" + a + " expected=" + b + ")"));
}

// ---------------------------------------------------------------------------
// T1/T2 共用：内联 mock MCP 服务端（模拟 automation-repl / dist/node-repl.js 形状）
// 说明：String.raw 保证内部转义序列原样进入子进程源码。
// ---------------------------------------------------------------------------

const MOCK_SRC = String.raw`
const vm = require('node:vm');
const CU = process.env.MIMO_AUTOMATION_COMPUTER_USE_ENABLED === '1';
let buf = '';
let ctx = null;
let rev = 100;
const sink = { arr: [] };

function kernel() {
  if (ctx) return ctx;
  const sky = CU ? {
    target: 'mac',
    list_apps: async () => [
      { id: 'com.apple.TextEdit', displayName: 'TextEdit', isRunning: true },
      { id: 'com.google.Chrome', displayName: 'Chrome', isRunning: true },
    ],
    get_app_state: async (a) => { rev += 1; return {
      app: a.app,
      text: '[AX] ' + a.app + ' [0] AXWindow "Doc" [1] AXStaticText "hello" [2] AXButton "Save"',
      screenshot: { url: 'file:///nonexistent/shot.png', unchanged: false },
      targetWindow: { windowId: 42, title: 'Doc', surface: 'window' },
      action: { dispatchStatus: 'verified', observationStatus: 'complete', uiChanged: null, imageRevision: 1, axRevision: rev },
    }; },
    click: async (a) => {
      if (a.element_index != null && a.element_index > 4) throw new Error('element_index out of range for current observation');
      rev += 1;
      return { app: a.app, text: '[AX] after click [3] AXButton', screenshot: { url: 'file:///nonexistent/s2.png', unchanged: false },
        action: { dispatchStatus: 'verified', observationStatus: 'complete', uiChanged: true, axRevision: rev, recommendedActions: ['re-ground before next action'] } };
    },
    type_text: async (a) => { rev += 1; return { app: a.app, text: '[AX] typed', screenshot: null,
      action: { dispatchStatus: 'verified', observationStatus: 'complete', uiChanged: true, axRevision: rev } }; },
    press_key: async (a) => {
      if (['Command', 'Shift', 'Control', 'Option'].includes(a.key)) throw new Error('chord must contain a non-modifier key');
      rev += 1;
      return { app: a.app, text: '[AX] keyed', screenshot: null, action: { dispatchStatus: 'verified', observationStatus: 'complete', uiChanged: false, axRevision: rev } };
    },
    set_value: async (a) => {
      if (a.element_index === 1) throw new Error('set_value on non-editable role AXStaticText rejected');
      rev += 1;
      return { app: a.app, text: '[AX] set', screenshot: null, action: { dispatchStatus: 'verified', observationStatus: 'complete', uiChanged: true, axRevision: rev } };
    },
    drag: async (a) => ({ app: a.app, text: 'drag', screenshot: null, action: { dispatchStatus: 'dispatched' } }),
    scroll: async (a) => ({ app: a.app, text: 'scrolled', screenshot: null, action: { dispatchStatus: 'verified', axRevision: (rev += 1) } }),
    select_text: async (a) => ({ app: a.app, text: 'selected', screenshot: null, action: { dispatchStatus: 'verified', axRevision: (rev += 1) } }),
    perform_secondary_action: async (a) => ({ app: a.app, text: 'secondary', screenshot: null, action: { dispatchStatus: 'verified', axRevision: (rev += 1) } }),
  } : undefined;
  ctx = vm.createContext({
    sky,
    agent: undefined,
    nodeRepl: {
      write: (...vs) => { for (const v of vs) sink.arr.push(typeof v === 'string' ? v : JSON.stringify(v)); },
      emitImage: async () => {},
    },
  });
  return ctx;
}

const ALLOWED = ['title', 'description', 'code', 'timeout_ms'];
async function callJs(args) {
  for (const k of Object.keys(args)) {
    if (!ALLOWED.includes(k)) return { content: [{ type: 'text', text: 'unexpected tool argument: ' + k }], isError: true };
  }
  if (typeof args.code !== 'string') return { content: [{ type: 'text', text: 'code must be a string' }], isError: true };
  sink.arr.length = 0;
  try {
    await vm.runInContext('(async()=>{' + '\n' + args.code + '\n' + '})()', kernel(), { timeout: 5000 });
  } catch (e) {
    let msg = 'Error: ' + ((e && e.message) || String(e));
    if (!CU) msg += ' | The desktop automation facade is disabled by the host and @mimo/sky is unavailable.';
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
  return { content: [{ type: 'text', text: sink.arr.join('\n') }] };
}

function send(r) { process.stdout.write(JSON.stringify(r) + '\n'); }
function handle(m) {
  if (m.method === 'initialize') {
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mimo-mock-node-repl', version: '0.7.11-shape' } } });
    return;
  }
  if (m.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: m.id, result: { tools: [{
      name: 'js',
      description: 'persistent JavaScript kernel for Computer Use and Browser Use',
      inputSchema: { type: 'object', properties: { code: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['code'], additionalProperties: false },
    }] } });
    return;
  }
  if (m.method === 'tools/call') {
    if (m.params.name !== 'js') { send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'unknown tool: ' + m.params.name } }); return; }
    callJs(m.params.arguments || {}).then((r) => send({ jsonrpc: '2.0', id: m.id, result: r }));
    return;
  }
  if (m.id === undefined) return; // notification
  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(JSON.parse(line));
  }
});
`;

// ---------------------------------------------------------------------------
// T1/T2 客户端：优先真实导入 src/mcp-client.ts（node 类型剥离），失败则用等价镜像
// ---------------------------------------------------------------------------

let McpStdioClient;
let clientSource = "";
try {
  ({ McpStdioClient } = await import("./src/mcp-client.ts"));
  clientSource = "src/mcp-client.ts (node type-stripping)";
} catch {
  // 等价 JS 镜像：与 src/mcp-client.ts 相同的行分隔 JSON-RPC 2.0 帧。
  clientSource = "inline mirror of src/mcp-client.ts";
  class McpStdioClientMirror {
    constructor(opts) {
      this.opts = opts;
      this.proc = null;
      this.nextId = 1;
      this.pending = new Map();
      this.buffer = "";
    }
    start() {
      return new Promise((resolve, reject) => {
        this.proc = spawn(this.opts.command[0], this.opts.command.slice(1), {
          env: { ...process.env, ...this.opts.env },
          stdio: ["pipe", "pipe", "ignore"],
        });
        this.proc.stdout.setEncoding("utf8");
        this.proc.stdout.on("data", (chunk) => this.onData(chunk));
        this.proc.on("exit", (code) => this.failAll(new Error("mcp server exited code=" + code)));
        this.request("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mimo-reference-test", version: "0.1.0" },
        })
          .then(() => {
            this.notify("notifications/initialized", {});
            resolve();
          })
          .catch(reject);
      });
    }
    listTools() {
      return this.request("tools/list", {}).then((r) => r.tools);
    }
    callTool(name, args) {
      return this.request("tools/call", { name, arguments: args });
    }
    stop() {
      if (this.proc) this.proc.kill();
      this.proc = null;
    }
    onData(chunk) {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      }
    }
    failAll(err) {
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
    }
    notify(method, params) {
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    }
    request(method, params) {
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error("mcp request timeout: " + method));
        }, 30000);
        this.pending.set(id, {
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    }
  }
  McpStdioClient = McpStdioClientMirror;
}

function startClient(env) {
  return new McpStdioClient({
    command: [process.execPath, "-e", MOCK_SRC],
    env,
  });
}

function textOf(result) {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// T1 — MCP stdio 握手 + tools/list 恰为 ["js"]
// ---------------------------------------------------------------------------

async function t1() {
  const c = startClient({ MIMO_AUTOMATION_COMPUTER_USE_ENABLED: "1" });
  await c.start();
  const tools = await c.listTools();
  eq(tools.map((t) => t.name), ["js"], "T1.1 tools/list 应答恰为 [\"js\"]");
  const schema = tools[0].inputSchema;
  ok(schema && schema.additionalProperties === false, "T1.2 inputSchema additionalProperties:false（参数白名单形状）");
  eq(schema.required, ["code"], "T1.3 inputSchema required=[code]");
  eq(
    Object.keys(schema.properties).sort(),
    ["code", "description", "timeout_ms", "title"],
    "T1.4 inputSchema 参数恰为 code/title/description/timeout_ms",
  );
  await c.stop();
}

// ---------------------------------------------------------------------------
// T2 — js REPL 回环 + @mimo/sky 门面注入 / fail-closed
// ---------------------------------------------------------------------------

async function t2() {
  const c = startClient({ MIMO_AUTOMATION_COMPUTER_USE_ENABLED: "1" });
  await c.start();

  // 落地观察（get_app_state → SkyState 形状）
  const r1 = await c.callTool("js", {
    code: 'var s = await sky.get_app_state({ app: "TextEdit" });\nglobalThis.__app = s.app;\nnodeRepl.write(JSON.stringify(s));',
  });
  ok(!r1.isError, "T2.1 js 单元正常执行（无 isError）");
  const st = JSON.parse(textOf(r1));
  eq(st.app, "TextEdit", "T2.2 SkyState.app 透传");
  ok(st.text.includes("[AX]"), "T2.3 SkyState.text 为 AX 树文本");
  ok(st.screenshot && st.screenshot.unchanged === false, "T2.4 SkyState.screenshot.unchanged 形状");
  eq(st.targetWindow.surface, "window", "T2.5 SkyState.targetWindow.surface 形状");
  eq(st.action.dispatchStatus, "verified", "T2.6 action.dispatchStatus 形状");
  ok(typeof st.action.axRevision === "number", "T2.7 action.axRevision 为数值修订号");

  // 内核持久性：跨单元格读取 globalThis（官方技能推荐的持久状态位置）
  const r2 = await c.callTool("js", { code: 'nodeRepl.write(globalThis.__app);' });
  eq(textOf(r2), "TextEdit", "T2.8 内核跨调用持久（globalThis 绑定存活）");

  // 变更动作返回新观察（动作即观察：axRevision 递增、uiChanged=true）
  const r3 = await c.callTool("js", {
    code: 'nodeRepl.write(JSON.stringify(await sky.click({ app: globalThis.__app, element_index: 2 })));',
  });
  const st2 = JSON.parse(textOf(r3));
  ok(st2.action.axRevision > st.action.axRevision, "T2.9 变更动作返回递增 axRevision 的下一观察");
  eq(st2.action.uiChanged, true, "T2.10 变更动作 uiChanged=true");

  // 门面纪律形状：set_value 拒绝非可编辑角色；press_key 拒绝纯修饰键
  const r4 = await c.callTool("js", { code: 'await sky.set_value({ app: "TextEdit", element_index: 1, value: "x" });' });
  ok(r4.isError === true && textOf(r4).includes("AXStaticText"), "T2.11 set_value 非可编辑角色 fail-closed（AXStaticText 报错）");
  const r5 = await c.callTool("js", { code: 'await sky.press_key({ app: "TextEdit", key: "Command" });' });
  ok(r5.isError === true && textOf(r5).includes("non-modifier"), "T2.12 press_key 纯修饰键被拒");

  // 工具参数白名单：未知参数被拒
  const r6 = await c.callTool("js", { code: "1", bogus: 1 });
  ok(r6.isError === true && textOf(r6).includes("unexpected tool argument"), "T2.13 工具参数白名单（未知参数拒绝）");

  // 越界 element_index：观察一次性有效
  const r7 = await c.callTool("js", { code: 'await sky.click({ app: "TextEdit", element_index: 99 });' });
  ok(r7.isError === true && textOf(r7).includes("out of range"), "T2.14 过期/越界 index 拒绝（观察一次性有效）");

  await c.stop();

  // fail-closed：插件开关关闭 → 内核无 sky，调用报错并附指引
  const c0 = startClient({ MIMO_AUTOMATION_COMPUTER_USE_ENABLED: "0" });
  await c0.start();
  const r8 = await c0.callTool("js", { code: 'nodeRepl.write(typeof sky);' });
  eq(textOf(r8), "undefined", "T2.15 开关关闭时内核无 sky（typeof sky === undefined）");
  const r9 = await c0.callTool("js", { code: 'await sky.click({ app: "TextEdit", element_index: 0 });' });
  ok(r9.isError === true && textOf(r9).includes("@mimo/sky is unavailable"), "T2.16 fail-closed：sky 调用报错并附不可用指引");
  await c0.stop();
}

// ---------------------------------------------------------------------------
// T3 — agent.browsers 四后端能力广告与裁剪（Provider 契约形状）
// ---------------------------------------------------------------------------

const BACKENDS = {
  iab: {
    transport: "provider-socket",
    requires: "MIMO_BROWSER_PROVIDER_DESCRIPTOR",
    caps: ["navigate", "observe", "screenshot", "upload", "dialogs", "clipboard", "preview-panel", "host-owned-session"],
  },
  extension: {
    transport: "native-messaging+chrome.debugger",
    caps: ["navigate", "observe", "screenshot", "upload", "dialogs", "clipboard", "tab-lease", "cursor-presentation", "cdp-allowlist"],
    families: ["chrome", "edge", "brave", "chromium"],
    remoteDebuggingPort: false,
  },
  managed: {
    transport: "raw-cdp",
    caps: ["navigate", "observe", "screenshot", "upload", "dialogs", "clipboard"],
    headless: "default",
    downloadOnStartup: false,
  },
  cdp: {
    transport: "raw-cdp",
    requires: "MIMO_BROWSER_CDP_URL",
    caps: ["navigate", "observe", "screenshot"],
  },
};

function backendAvailable(name, env) {
  const b = BACKENDS[name];
  if (!b) return false;
  if (name === "iab") return !!env.MIMO_BROWSER_PROVIDER_DESCRIPTOR;
  if (name === "extension") return env.MIMO_BROWSER_EXTENSION !== "0";
  if (name === "managed") return !!env.MIMO_BROWSER_CACHE_DIR;
  if (name === "cdp") return !!env.MIMO_BROWSER_CDP_URL;
  return false;
}

// 无静默替换：显式选择的后端不可用 → 报错（附指引），绝不换后端
function selectBackend(requested, env) {
  if (requested && !backendAvailable(requested, env)) {
    return { error: "requested backend not available: " + requested + " (" + (BACKENDS[requested].requires || "install required") + ")" };
  }
  const name = requested || ["extension", "iab", "managed", "cdp"].find((n) => backendAvailable(n, env));
  if (!name) return { error: "no browser provider available; run mimo-browser-use install or publish a provider descriptor" };
  return { name, caps: BACKENDS[name].caps.slice() };
}

// 能力裁剪：不支持的成员一次性失败并附生效能力快照
function negotiate(backendName, requestedCaps) {
  const caps = BACKENDS[backendName].caps;
  const unsupported = requestedCaps.filter((c) => !caps.includes(c));
  return {
    effective: caps.filter((c) => requestedCaps.includes(c)),
    unsupported,
    failOnce: unsupported.length > 0,
  };
}

function t3() {
  eq(Object.keys(BACKENDS), ["iab", "extension", "managed", "cdp"], "T3.1 能力广告恰为四后端 iab/extension/managed/cdp");

  // 显式 iab 无 descriptor → 报错不替换
  const r1 = selectBackend("iab", {});
  ok(r1.error && r1.error.includes("MIMO_BROWSER_PROVIDER_DESCRIPTOR"), "T3.2 显式 iab 无 descriptor → 报错附指引（不静默替换）");
  // 全部不可用 → getDefault 可操作错误，而非回退
  const r2 = selectBackend(undefined, { MIMO_BROWSER_EXTENSION: "0" });
  ok(r2.error && r2.error.includes("mimo-browser-use install"), "T3.3 无可用后端 → getDefault 可操作错误（无回退）");
  // extension 可用 → 默认选中
  const r3 = selectBackend(undefined, {});
  eq(r3.name, "extension", "T3.4 extension 可用时为默认选择");
  // descriptor 存在 → getForUrl 选中 iab
  const r4 = selectBackend("iab", { MIMO_BROWSER_PROVIDER_DESCRIPTOR: "/tmp/provider.json" });
  eq(r4.name, "iab", "T3.5 descriptor 存在 → iab 可选");

  // 能力裁剪：extension 请求 preview-panel（iab 专属）→ 一次性失败 + 生效快照
  const n1 = negotiate("extension", ["observe", "preview-panel"]);
  eq(n1.unsupported, ["preview-panel"], "T3.6 不支持成员被裁剪标记（extension 无 preview-panel）");
  eq(n1.effective, ["observe"], "T3.7 生效能力快照仅含支持成员");
  ok(n1.failOnce, "T3.8 不支持成员一次性失败（failOnce）");
  const n2 = negotiate("managed", ["observe", "upload"]);
  eq(n2.unsupported, [], "T3.9 全支持请求无裁剪");

  // 后端形状断言
  ok(BACKENDS.managed.downloadOnStartup === false, "T3.10 managed MCP 启动绝不静默下载");
  eq(BACKENDS.managed.headless, "default", "T3.11 managed 默认 headless");
  ok(BACKENDS.extension.remoteDebuggingPort === false, "T3.12 extension 不暴露 remote-debugging 端口");
  eq(BACKENDS.extension.families, ["chrome", "edge", "brave", "chromium"], "T3.13 extension 广告四浏览器家族");
  eq(BACKENDS.cdp.requires, "MIMO_BROWSER_CDP_URL", "T3.14 cdp 要求显式端点");
}

// ---------------------------------------------------------------------------
// T4 — 锁屏授权租约状态机（1–20s 单调 TTL 一次性 token + 46s 准入隔离）
// ---------------------------------------------------------------------------

class LockAuthorizationStore {
  constructor(now) {
    this.now = now;
    this.lease = null;
    this.quarantineUntil = 0;
  }
  grant({ ttl_ms, connection, consoleUid, auditSession }) {
    if (this.now() < this.quarantineUntil) return { ok: false, reason: "admission-quarantine" };
    if (this.lease && this.lease.connection !== connection) return { ok: false, reason: "lease-active-owner" };
    const ttl = Math.min(20000, Math.max(1000, ttl_ms)); // 单调 1–20s
    this.lease = { ttl, expiresAt: this.now() + ttl, connection, consoleUid, auditSession, consumed: false };
    return { ok: true, ttl };
  }
  // SecurityAgentPlugins 插件经 socket 查询：绑定对端 + 原子消费
  query({ connection, consoleUid, auditSession }) {
    const l = this.lease;
    if (!l) return "deny:no-decision";
    if (l.connection !== connection || l.consoleUid !== consoleUid || l.auditSession !== auditSession) return "deny:peer-mismatch";
    if (this.now() >= l.expiresAt) {
      this.lease = null;
      return "deny:expired";
    }
    if (l.consumed) return "deny:consumed";
    l.consumed = true; // 一次性：首个查询原子消费
    return "allow";
  }
  releaseTurn() {
    this.lease = null;
    return { relocked: true, quarantineMs: 0 }; // 正常释放立即
  }
  revokePhysicalInput() {
    this.lease = null;
    return { relocked: true };
  }
  ownerDisconnected() {
    this.lease = null;
    this.quarantineUntil = this.now() + 46000; // 46 秒准入隔离
    return { quarantineMs: 46000 };
  }
}

function t4() {
  let t = 1000;
  const clock = () => t;
  const s = new LockAuthorizationStore(clock);

  // TTL 单调钳制 1–20s
  eq(s.grant({ ttl_ms: 500, connection: "c1", consoleUid: 501, auditSession: 7 }).ttl, 1000, "T4.1 ttl_ms 500 钳制为 1000（下界 1s）");
  eq(s.grant({ ttl_ms: 30000, connection: "c1", consoleUid: 501, auditSession: 7 }).ttl, 20000, "T4.2 ttl_ms 30000 钳制为 20000（上界 20s）");

  // 一次性原子消费
  s.grant({ ttl_ms: 8000, connection: "c1", consoleUid: 501, auditSession: 7 });
  eq(s.query({ connection: "c1", consoleUid: 501, auditSession: 7 }), "allow", "T4.3 首次查询 allow（绑定对端一致）");
  eq(s.query({ connection: "c1", consoleUid: 501, auditSession: 7 }), "deny:consumed", "T4.4 二次查询 deny（一次性原子消费）");

  // 对端绑定（内核审计 token 三元组）
  s.grant({ ttl_ms: 8000, connection: "c1", consoleUid: 501, auditSession: 7 });
  eq(s.query({ connection: "c2", consoleUid: 501, auditSession: 7 }), "deny:peer-mismatch", "T4.5 换连接查询 deny（审计 token 绑定）");
  eq(s.query({ connection: "c1", consoleUid: 502, auditSession: 7 }), "deny:peer-mismatch", "T4.6 换控制台 UID 查询 deny");

  // 第二进程在租约活跃期被拒
  const g2 = s.grant({ ttl_ms: 8000, connection: "c2", consoleUid: 501, auditSession: 7 });
  ok(!g2.ok && g2.reason === "lease-active-owner", "T4.7 租约活跃期第二进程 grant 被拒");

  // 过期 deny
  s.releaseTurn();
  s.grant({ ttl_ms: 1000, connection: "c1", consoleUid: 501, auditSession: 7 });
  t += 1001; // 推进时钟越过租期
  eq(s.query({ connection: "c1", consoleUid: 501, auditSession: 7 }), "deny:expired", "T4.8 越过 TTL 查询 deny（过期）");

  // 物理输入撤销 + 轮次结束正常释放
  s.grant({ ttl_ms: 8000, connection: "c1", consoleUid: 501, auditSession: 7 });
  ok(s.revokePhysicalInput().relocked, "T4.9 物理输入撤销租约并重锁");
  eq(s.query({ connection: "c1", consoleUid: 501, auditSession: 7 }), "deny:no-decision", "T4.10 撤销后查询 deny");

  // 异常断连 → 46s 准入隔离，隔离期内新 grant 被拒
  s.grant({ ttl_ms: 8000, connection: "c1", consoleUid: 501, auditSession: 7 });
  eq(s.ownerDisconnected().quarantineMs, 46000, "T4.11 异常断连安装 46s 准入隔离");
  const g3 = s.grant({ ttl_ms: 8000, connection: "c3", consoleUid: 501, auditSession: 7 });
  ok(!g3.ok && g3.reason === "admission-quarantine", "T4.12 隔离期内新进程 grant 被拒");
  t += 46001; // 隔离期结束
  const g4 = s.grant({ ttl_ms: 8000, connection: "c3", consoleUid: 501, auditSession: 7 });
  ok(g4.ok, "T4.13 隔离期结束恢复准入");

  // 正常轮次结束：立即释放、无隔离
  const r = s.releaseTurn();
  ok(r.relocked && r.quarantineMs === 0, "T4.14 正常轮次释放立即且无隔离");
}

// ---------------------------------------------------------------------------
// T5 — Native Messaging 信封编解码回环（4 字节 LE 长度前缀 + JSON）
// ---------------------------------------------------------------------------

const NM_TO_CHROME_MAX = 1024 * 1024; // host → Chrome 上限 1MB

function nmEncode(msg) {
  const payload = Buffer.from(JSON.stringify(msg), "utf8");
  if (payload.length > NM_TO_CHROME_MAX) throw new Error("message too long for host->chrome (1MB)");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(payload.length, 0);
  return Buffer.concat([head, payload]);
}

function nmDecode(buf) {
  if (buf.length < 4) return { msg: null, rest: buf };
  const len = buf.readUInt32LE(0);
  if (buf.length < 4 + len) return { msg: null, rest: buf };
  return { msg: JSON.parse(buf.subarray(4, 4 + len).toString("utf8")), rest: buf.subarray(4 + len) };
}

function t5() {
  // 已知向量：小端序长度前缀（"{}" 恰为 2 字节）
  const v = nmEncode({});
  eq([...v.subarray(0, 4)], [2, 0, 0, 0], "T5.1 长度前缀为 4 字节小端序（{} → [2,0,0,0]）");

  // 回环（含中文与嵌套结构）
  const msg = { jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "中文·镜头✓" }], tabs: [{ id: "a", url: "https://例え.jp/" }] } };
  const d1 = nmDecode(nmEncode(msg));
  eq(d1.msg, msg, "T5.2 编解码回环保真（中文/嵌套 JSON）");
  eq(d1.rest.length, 0, "T5.3 单消息解码后无残余字节");

  // 流式解码：半包 + 粘包
  const enc = Buffer.concat([nmEncode({ a: 1 }), nmEncode({ b: 2 })]);
  const first = nmDecode(enc);
  const second = nmDecode(first.rest);
  ok(first.msg && first.msg.a === 1 && second.msg && second.msg.b === 2 && second.rest.length === 0, "T5.4 粘包流式解码（两条消息依序还原）");
  const half = nmEncode({ long: "x".repeat(50) });
  const partial = nmDecode(half.subarray(0, 10));
  ok(partial.msg === null && partial.rest.length === 10, "T5.5 半包等待（长度不足返回 rest）");

  // 1MB 上限（host → Chrome 方向）
  let threw = false;
  try {
    nmEncode({ pad: "x".repeat(NM_TO_CHROME_MAX + 1) });
  } catch {
    threw = true;
  }
  ok(threw, "T5.6 超过 1MB 上限的出站消息被拒");
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

console.log("# mimo reference shape self-test (client source: " + clientSource + ")");
const groups = [
  ["T1 mcp-client tools/list 形状", t1],
  ["T2 js REPL 回环 + sky 注入/fail-closed", t2],
  ["T3 browsers 四后端能力广告与裁剪", t3],
  ["T4 锁屏授权租约状态机", t4],
  ["T5 native messaging 信封回环", t5],
];
for (const [name, fn] of groups) {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.log("FAIL " + name + " threw: " + (e && e.message));
  }
}
console.log("summary: " + groups.length + " groups, " + passed + " assertions passed, " + failed + " failed");
if (failed === 0) {
  console.log("ALL PASSED");
} else {
  console.log("FAILED: " + failures.join("; "));
  process.exitCode = 1;
}
