// test.mjs —— browser-use-mini.ts 的行为自测（纯 Node 断言，零依赖）
// 运行：node test.mjs   （Node >= 23.6 原生支持 strip-types；22.6-23.5 加 --experimental-strip-types）
// 覆盖机制出处：agents/browser-use/evidence/inventory.md §B-§F（注释标 INV 编号）
import assert from 'node:assert/strict';
import {
  parseHtml,
  isInteractive,
  DomTreeSerializer,
  BrowserSessionMini,
  AgentMini,
  buildDefaultRegistry,
  replaceSecrets,
  redact,
} from './browser-use-mini.ts';

const PAGE_HTML = `
<div id="app">
  Welcome to Acme
  <form>
    <input type="text" name="user" placeholder="Enter name" />
    <input type="password" name="pw" />
    <button type="submit">Sign in</button>
  </form>
  <a href="/about">About us</a>
  <div role="button" onclick="pay()">Pay now</div>
  <span>plain text, not interactive</span>
  <input type="file" name="attachment" />
</div>`;

// ── 1. 可交互判定（INV D5） ──
{
  const root = parseHtml(PAGE_HTML);
  const flat = [];
  const collect = (n) => {
    flat.push(n);
    n.children.forEach(collect);
  };
  collect(root);
  const tags = Object.fromEntries(flat.map((n) => [n.tag + (n.attrs['name'] ?? n.attrs['role'] ?? n.text ?? ''), n]));
  assert.ok(isInteractive(tags['inputuser']), '表单控件可交互');
  assert.ok(isInteractive(tags['buttonSign in']), 'button 可交互');
  assert.ok(isInteractive(tags['aAbout us']), 'a 可交互');
  assert.ok(isInteractive(tags['divbutton']), 'role=button + onclick 可交互');
  assert.ok(!isInteractive(tags['spanplain text, not interactive']), '纯文本不可交互');
  assert.ok(isInteractive(tags['inputattachment']), 'file input 可交互（但禁点击，见用例 5）');
}

// ── 2. 状态采集：[index] 文本树 + selector_map 台账（INV D4/D6） ──
const session = new BrowserSessionMini([
  { targetId: 't1', url: 'https://app.acme.com/login', title: 'Acme Login', html: PAGE_HTML, clicks: [], typed: [], fileInputs: [] },
]);
const state1 = session.getState();
assert.match(state1.domState.text, /\[1\]<input type=text name=user placeholder=Enter name \/>/, '索引句柄 + 属性内联（无引号，与上游格式一致）');
assert.match(state1.domState.text, /\*\[\d+\]/, '首采所有元素标 * 新元素');
assert.match(state1.domState.text, /\[\d+\]<button type=submit \/>/, 'button 编入索引');
assert.match(state1.domState.text, /Welcome to Acme/, '纯文本保留在树中');
assert.ok(state1.domState.selectorMap.size >= 5, `台账应含全部可交互元素，实际 ${state1.domState.selectorMap.size}`);
assert.equal(state1.screenshot, 'b64-clean-screenshot-stub', '每步带干净截图 stub（INV B3）');

// 第二次采集同一页面：无 * 星号（无新元素）
const state1b = session.getState();
assert.ok(!/\*\[\d+\]/.test(state1b.domState.text), '同页二采不应有 * 新元素标记');

// ── 3. Agent 循环：规划→click→input→done（INV B1/B9） ──
{
  const s = new BrowserSessionMini([
    { targetId: 't1', url: 'https://app.acme.com/login', title: 'Acme', html: PAGE_HTML, clicks: [], typed: [], fileInputs: [] },
  ]);
  const plan = [
    [
      { name: 'input', params: { index: 1, text: 'alice@example.com' } },
      { name: 'click', params: { index: 3 } }, // Sign in
    ],
    [{ name: 'done', params: { success: true, text: 'logged in', data: { ok: true } } }],
  ];
  const agent = new AgentMini('log into acme', () => plan.shift() ?? [{ name: 'done', params: { success: false, text: 'stuck' } }], s);
  const result = agent.run();
  assert.equal(result.isDone, true, '循环以 done 终止');
  assert.equal(result.steps, 2, '两步完成');
  assert.deepEqual(result.data, { ok: true }, '结构化输出透传（INV B9）');
  const page = s.pages[0];
  assert.deepEqual(page.clicks, [{ backendId: page.clicks[0]?.backendId, via: 'cdp-mouse' }], '点击走 CDP 鼠标通道 stub（INV E1）');
  assert.equal(page.typed[0]?.text, 'alice@example.com', '打字落到目标元素（INV E3）');
}

// ── 4. <secret> 占位符协议（INV F1/F2） ──
{
  const sensitive = { PASSWORD: 'hunter2!', scoped: { 'SECRET': 'domain-secret' } };
  // 4a. 执行期替换
  assert.equal(replaceSecrets('<secret>PASSWORD</secret>', sensitive, 'https://x.example.com/login'), 'hunter2!');
  // 4b. 域作用域：匹配域内可用
  assert.equal(replaceSecrets('<secret>SECRET</secret>', { '*.example.com': { SECRET: 'domain-secret' } }, 'https://a.example.com/p'), 'domain-secret');
  // 4c. 域外占位符不可用 → 原样保留（不替换）
  assert.equal(replaceSecrets('<secret>SECRET</secret>', { '*.example.com': { SECRET: 'x' } }, 'https://evil.io/'), '<secret>SECRET</secret>');
  // 4d. 历史回显脱敏
  assert.equal(redact('typed hunter2! ok', sensitive), 'typed <secret>PASSWORD</secret> ok');

  // 端到端：模型输出占位符，页面收到明文，历史只见掩码
  const s = new BrowserSessionMini([
    { targetId: 't1', url: 'https://app.acme.com/login', title: 'Acme', html: PAGE_HTML, clicks: [], typed: [], fileInputs: [] },
  ]);
  const agent = new AgentMini(
    'login',
    () => [{ name: 'input', params: { index: 2, text: '<secret>PASSWORD</secret>' } }],
    s,
    undefined,
    sensitive,
  );
  const result = agent.run(1);
  assert.equal(s.pages[0].typed[0]?.text, 'hunter2!', '执行层收到真实值');
  assert.ok(!result.history.join().includes('hunter2!'), '历史不得出现明文（INV F2）');
  assert.ok(result.history.join().includes('Typed <sensitive>'), '历史只见掩码');
}

// ── 5. 句柄失效与文件输入禁点（INV D10/E2） ──
{
  const s = new BrowserSessionMini([
    { targetId: 't1', url: 'https://app.acme.com/login', title: 'Acme', html: PAGE_HTML, clicks: [], typed: [], fileInputs: [] },
  ]);
  s.getState();
  const reg = buildDefaultRegistry();
  // 导航后旧索引全部失效
  s.navigate('https://app.acme.com/other');
  const stale = reg.execute({ name: 'click', params: { index: 1 } }, s, { sensitiveData: {}, availableFiles: new Set() });
  assert.match(stale.error ?? '', /not available - page may have changed/, '导航后旧句柄拒绝（INV D10）');
  // file input 禁点击
  s.navigate('https://app.acme.com/login');
  const st = s.getState();
  const fileIdx = [...st.domState.selectorMap.entries()].find(([, n]) => n.attrs['type'] === 'file')?.[0];
  assert.ok(fileIdx, 'file input 在台账中');
  const refused = reg.execute({ name: 'click', params: { index: fileIdx } }, s, { sensitiveData: {}, availableFiles: new Set() });
  assert.match(refused.error ?? '', /upload_file/, 'file input 禁点击并指路 upload_file（INV E2）');
}

// ── 6. 上传白名单（INV E6） ──
{
  const s = new BrowserSessionMini([
    { targetId: 't1', url: 'https://app.acme.com/upload', title: 'Up', html: PAGE_HTML, clicks: [], typed: [], fileInputs: [] },
  ]);
  const st = s.getState();
  const fileIdx = [...st.domState.selectorMap.entries()].find(([, n]) => n.attrs['type'] === 'file')?.[0];
  const reg = buildDefaultRegistry();
  const denied = reg.execute({ name: 'upload_file', params: { index: fileIdx, path: '/etc/passwd' } }, s, {
    sensitiveData: {},
    availableFiles: new Set(['/tmp/report.pdf']),
  });
  assert.match(denied.error ?? '', /not in available_file_paths/, '白名单外文件拒绝');
  const ok = reg.execute({ name: 'upload_file', params: { index: fileIdx, path: '/tmp/report.pdf' } }, s, {
    sensitiveData: {},
    availableFiles: new Set(['/tmp/report.pdf']),
  });
  assert.ok(ok.extractedContent?.includes('Uploaded'), '白名单内放行');
}

// ── 7. 导航围栏（INV F3/F4） ──
{
  const s = new BrowserSessionMini(
    [{ targetId: 't1', url: 'https://app.acme.com/', title: 'A', html: '', clicks: [], typed: [], fileInputs: [] }],
    ['*.acme.com'],
  );
  const reg = buildDefaultRegistry();
  const blocked = reg.execute({ name: 'navigate', params: { url: 'https://evil.io/phish' } }, s, { sensitiveData: {}, availableFiles: new Set() });
  assert.ok(blocked.error, '域外导航被拦');
  assert.equal(s.pages[0].url, 'about:blank', '命中后回 about:blank（INV F4）');
  assert.ok(s.blockedNavigations.includes('https://evil.io/phish'), '拦截记录');
  const allowed = reg.execute({ name: 'navigate', params: { url: 'https://docs.acme.com/guide' } }, s, { sensitiveData: {}, availableFiles: new Set() });
  assert.ok(allowed.extractedContent?.startsWith('Navigated'), '白名单域放行（子域通配）');
}

// ── 8. multi_act 双守卫（INV D11） ──
{
  const s = new BrowserSessionMini([
    { targetId: 't1', url: 'https://app.acme.com/', title: 'A', html: PAGE_HTML, clicks: [], typed: [], fileInputs: [] },
  ]);
  s.getState();
  const agent = new AgentMini('x', () => [], s);
  // 8a. terminates_sequence 静态短路：navigate 之后的队列作废
  const r1 = agent.multiAct([
    { name: 'navigate', params: { url: 'https://app.acme.com/login' } },
    { name: 'click', params: { index: 1 } },
  ]);
  assert.equal(r1.aborted, true, 'navigate 后静态短路');
  assert.equal(r1.results.length, 1, '短路时只执行了 1 个动作');
  // 8b. 动作失败即停
  const r2 = agent.multiAct([
    { name: 'click', params: { index: 999 } },
    { name: 'done', params: {} },
  ]);
  assert.equal(r2.results.length, 1, '失败即停，后续不执行');
  assert.ok(r2.results[0].error, '失败动作返回 error');
}

// ── 9. 标签页：switch + new_tab（INV E5） ──
{
  const s = new BrowserSessionMini(
    [
      { targetId: 't1', url: 'https://app.acme.com/', title: 'A', html: '', clicks: [], typed: [], fileInputs: [] },
      { targetId: 't2', url: 'https://docs.acme.com/', title: 'D', html: '', clicks: [], typed: [], fileInputs: [] },
    ],
    ['*.acme.com'],
  );
  const reg = buildDefaultRegistry();
  const sw = reg.execute({ name: 'switch', params: { tab_id: 't2' } }, s, { sensitiveData: {}, availableFiles: new Set() });
  assert.match(sw.extractedContent ?? '', /Switched to tab #t2/, '切换标签页');
  assert.equal(s.focusTargetId, 't2');
  const bad = reg.execute({ name: 'switch', params: { tab_id: 'zz' } }, s, { sensitiveData: {}, availableFiles: new Set() });
  assert.ok(bad.error, '无效 tab_id 报错（保留具体原因的形状）');
  const nt = reg.execute({ name: 'navigate', params: { url: 'https://app.acme.com/new', new_tab: true } }, s, { sensitiveData: {}, availableFiles: new Set() });
  assert.ok(nt.extractedContent, 'new_tab 兼起新建标签（INV E5）');
  assert.equal(s.pages.length, 3, '标签页数量 +1');
  assert.equal(s.focusTargetId, 't3', '焦点跟随新标签');
}

console.log('browser-use reference self-test: 9/9 groups OK');
console.log('ALL PASSED');
