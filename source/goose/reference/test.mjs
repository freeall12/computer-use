// test.mjs —— goose-computer-extension.ts 的行为自测（纯 Node 断言，零依赖）
// 运行：node --experimental-strip-types test.mjs   （Node >= 22.6）
//       或 Node >= 23.6 可直接：node test.mjs
// 覆盖机制出处：agents/goose/computer-use.md §3–§6
import assert from 'node:assert/strict';
import {
  shellWordsSplit,
  createMockPeekabooBackend,
  GooseComputerExtension,
  seedScreenshotCache,
  __setMockFile,
  __lastScreenshotPaths,
  READ_ONLY_COMMANDS,
} from './goose-computer-extension.ts';

const CACHE = '/tmp/goose-mock-cache';
const NOW = () => new Date('2026-10-06T12:00:00');
const TS = '20261006_120000'; // 与 cachePath 的 %Y%m%d_%H%M%S 格式一致
const SEE_PLAIN = `${CACHE}/see_${TS}.png`;
const SEE_ANNOTATED = `${CACHE}/see_${TS}_annotated.png`;
const CAPTURE = `${CACHE}/peekaboo_capture_${TS}.png`;

// ── 1. shell_words 分词 ────────────────────────────────────────────────────
{
  assert.deepEqual(
    shellWordsSplit('type "hello world" --return'),
    ['type', 'hello world', '--return'],
    '双引号短语应合并为单参数'
  );
  assert.deepEqual(shellWordsSplit('click --on B1'), ['click', '--on', 'B1']);
  assert.deepEqual(shellWordsSplit('  a   b '), ['a', 'b'], '多空白切分');
  assert.deepEqual(shellWordsSplit('hotkey --keys cmd,c'), ['hotkey', '--keys', 'cmd,c']);
  assert.throws(() => shellWordsSplit('type "unclosed'), '未闭合引号应抛错');
  assert.ok(READ_ONLY_COMMANDS.has('see'), '只读白名单应含 see');
}

// ── 2. 脚手架：权限策略 ────────────────────────────────────────────────────
const isReadOnly = (c) => READ_ONLY_COMMANDS.has(c.trim().split(/\s+/)[0]);
const autoPolicy = {
  mode: 'auto',
  toolLevel: () => 'ask_before',
  isReadOnly,
  askUser: () => 'allow_once',
};
const denyPolicy = {
  mode: 'approve',
  toolLevel: () => 'ask_before',
  isReadOnly,
  askUser: () => 'deny_once',
};
const neverPolicy = {
  mode: 'auto',
  toolLevel: (_ext, tool) => (tool === 'computer_control' ? 'never_allow' : 'ask_before'),
  isReadOnly,
  askUser: () => 'allow_once',
};

function makeExt(backendOpts, policy = autoPolicy) {
  const { backend, state } = createMockPeekabooBackend(backendOpts);
  const ext = new GooseComputerExtension({ backend, policy, cacheDir: CACHE, now: NOW });
  return { ext, state };
}

// ── 3. see 流程：--path/--json-output 注入、annotated 优先、audience 注解 ───
{
  seedScreenshotCache(CACHE, TS); // peekaboo 自身负责落盘；测试预置其产物
  const { ext, state } = makeExt({});
  const r = await ext.callTool('computer_control', { command: 'see --app Safari --annotate' });
  assert.equal(r.isError, false, 'see 不应报错');
  assert.equal(
    state.lastActions[0],
    `see --app Safari --annotate --path ${SEE_PLAIN} --json-output`,
    'see 应自动追加 --path 与 --json-output'
  );
  const img = r.content.find((c) => c.type === 'image');
  assert.ok(img, 'see 应返回 image 块');
  assert.equal(img.mimeType, 'image/png');
  assert.equal(r.content[0].audience?.[0], 'assistant', '文本块应带 audience=[assistant]');
  const paths = __lastScreenshotPaths();
  assert.equal(paths.at(-1), SEE_ANNOTATED, 'see 应优先返回 *_annotated 变体');
  assert.ok(!paths.includes(SEE_PLAIN), '存在 annotated 时不应返回 plain 版');
}

// ── 4. list：自动 --json；自动安装成功/失败两分支 ───────────────────────────
{
  const { ext, state } = makeExt({});
  const r = await ext.callTool('computer_control', { command: 'list apps' });
  assert.equal(r.isError, false);
  assert.ok(state.lastActions[0].includes('--json'), 'list 应自动追加 --json');
  const parsed = JSON.parse(r.content[0].text);
  assert.equal(parsed.apps[0].name, 'Safari', 'mock list --json 应返回结构化输出');
}
{
  const { ext } = makeExt({ installed: false }); // autoInstall 桩成功
  const r = await ext.callTool('computer_control', { command: 'see' });
  assert.equal(r.isError, false, '自动安装成功后 see 应正常');
}
{
  const failing = {
    isInstalled: () => false,
    autoInstall: () => ({ ok: false, message: 'brew not found' }),
    run: () => ({ exitCode: 1, stdout: '', stderr: '' }),
  };
  const ext = new GooseComputerExtension({ backend: failing, policy: autoPolicy, cacheDir: CACHE });
  const r = await ext.callTool('computer_control', { command: 'see' });
  assert.equal(r.isError, true, '自动安装失败应报错');
  assert.match(r.content[0].text, /brew install steipete\/tap\/peekaboo/, '错误应带手动安装提示');
  assert.match(r.content[0].text, /Screen Recording and Accessibility/, '错误应提示 TCC 两权限');
}

// ── 5. 空命令 / 未知元素点击失败信封 ────────────────────────────────────────
{
  const { ext } = makeExt({});
  const r0 = await ext.callTool('computer_control', { command: '   ' });
  assert.equal(r0.isError, true, '空命令应报错');
  assert.match(r0.content[0].text, /Command cannot be empty/);
  const r1 = await ext.callTool('computer_control', { command: 'click --on Z99' });
  assert.equal(r1.isError, true, '未知元素点击应失败');
  assert.match(r1.content[0].text, /peekaboo click failed \(exit 1\)/, '失败信封应含命令名与退出码');
}

// ── 6. capture_screenshot：动作后补拍 image --mode frontmost ───────────────
{
  __setMockFile(CAPTURE); // 补拍产物由 peekaboo 写盘，测试预置
  const { ext, state } = makeExt({});
  const r = await ext.callTool('computer_control', { command: 'click --on B1', capture_screenshot: true });
  assert.equal(r.isError, false);
  assert.equal(state.lastActions[0], 'click --on B1', 'click 命令应原样透传');
  assert.ok(
    state.lastActions.includes(`image --mode frontmost --path ${CAPTURE}`),
    'capture_screenshot=true 应补拍 image --mode frontmost'
  );
  assert.ok(r.content.some((c) => c.type === 'image'), '补拍应产出 image 块');
}

// ── 7. 12000 字符截断 ───────────────────────────────────────────────────────
{
  const big = {
    isInstalled: () => true,
    autoInstall: () => ({ ok: true }),
    run: () => ({ exitCode: 0, stdout: 'x'.repeat(13000), stderr: '' }),
  };
  const ext = new GooseComputerExtension({ backend: big, policy: autoPolicy, cacheDir: CACHE });
  const r = await ext.callTool('computer_control', { command: 'list apps --json' });
  assert.match(r.content[0].text, /\[Output truncated\. 13000 total chars\.\]/, '应截断并附标记');
  assert.ok(r.content[0].text.length < 12100, '文本长度应 ≤ 12000 + 标记');
}

// ── 8. 权限模型（GooseMode × PermissionLevel × smart_approve）───────────────
{
  const { ext: extS } = makeExt({}, { ...autoPolicy, mode: 'smart_approve' });
  const ok = await extS.callTool('computer_control', { command: 'see --app Safari' });
  assert.equal(ok.isError, false, 'smart_approve 下只读(see)应自动放行');

  const { ext: extD } = makeExt({}, { ...denyPolicy, mode: 'smart_approve' });
  const denied = await extD.callTool('computer_control', { command: 'click --on B3' });
  assert.match(denied.content[0].text, /permission denied: user decision: deny_once/, 'smart_approve 非只读应询问并被拒');

  const { ext: extC } = makeExt({}, { ...autoPolicy, mode: 'chat' });
  const chat = await extC.callTool('computer_control', { command: 'see' });
  assert.match(chat.content[0].text, /chat mode: all tools disabled/, 'chat 模式应禁一切工具');

  const { ext: extN } = makeExt({}, neverPolicy);
  const never = await extN.callTool('computer_control', { command: 'see' });
  assert.match(never.content[0].text, /never_allow/, 'permission.yaml never_allow 应硬拒');

  const allowPolicy = { ...denyPolicy, toolLevel: () => 'always_allow' };
  const { ext: extA } = makeExt({}, allowPolicy);
  const allowed = await extA.callTool('computer_control', { command: 'click --on B1' });
  assert.equal(allowed.isError, false, 'always_allow 名单应跳过询问');
}

// ── 9. 工具注册面：单工具透传，无浏览器工具 ─────────────────────────────────
{
  const { ext } = makeExt({});
  assert.deepEqual(ext.tools.map((t) => t.name), ['computer_control'], '唯一 CU 工具');
  const unknown = await ext.callTool('browser_navigate', { url: 'https://example.com' });
  assert.equal(unknown.isError, true, '未知工具应报错（Goose 无内置浏览器工具）');
}

console.log('all goose reference tests passed');
