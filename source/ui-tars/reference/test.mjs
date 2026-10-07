// test.mjs —— vision-gui-agent.ts 的行为自测（纯 Node 断言，零依赖）
// 运行：node test.mjs   （Node >= 22.6；.ts 由原生 type-stripping 直接执行）
// 覆盖机制出处：agents/ui-tars/computer-use.md §2-§6
import assert from 'node:assert/strict';
import {
  parseCoordLiteral,
  parseActionCallString,
  parsePrediction,
  serializeAction,
  unifyActionType,
  unifyActionInputName,
  calculateRealCoords,
  MockOperator,
  runVisionLoop,
} from './vision-gui-agent.ts';

let n = 0;
const ok = (msg) => { n += 1; console.log(`ok ${n} - ${msg}`); };

// ── 1. 坐标字面量：四种格式归一 ──────────────────────────────────────────────
{
  // ① <|box_start|>(x,y)<|box_end|> —— 标签已在 parseActionCallString 预处理剥离，字面量层只剩 (x,y)
  assert.deepEqual(parseCoordLiteral('(637,964)'), { raw: { x: 637, y: 964 } }, '裸 (x,y) 对');
  // ② <point>x y</point>
  assert.deepEqual(parseCoordLiteral("<point>510 150</point>"), { raw: { x: 510, y: 150 } }, 'point 格式');
  // ③ <bbox>x1 y1 x2 y2</bbox> —— 中心即点击点
  const bbox = parseCoordLiteral('<bbox>637 964 641 968</bbox>');
  assert.deepEqual(bbox.raw, { x: 639, y: 966 }, 'bbox 取中心');
  assert.deepEqual(bbox.referenceBox, { x1: 637, y1: 964, x2: 641, y2: 968 }, 'bbox 保留 referenceBox');
  // ④ [x1, y1, x2, y2]（桌面版 MANUAL.ACTION_SPACES 的 bbox 写法）
  assert.deepEqual(parseCoordLiteral('[130, 226, 132, 228]').raw, { x: 131, y: 227 }, '四元组数组取中心');
  assert.equal(parseCoordLiteral('hello'), null, '非法字面量 → null');
  ok('坐标字面量：point/bbox/裸对/四元组四格式 + 非法拒绝');
}

// ── 2. 动作名/参数名归一表 ──────────────────────────────────────────────────
{
  assert.equal(unifyActionType('left_single'), 'click');
  assert.equal(unifyActionType('left_double'), 'double_click');
  assert.equal(unifyActionType('LEFT_CLICK'), 'click', '大小写不敏感');
  assert.equal(unifyActionInputName('click', 'start_box'), 'start');
  assert.equal(unifyActionInputName('drag', 'end_point'), 'end');
  assert.equal(unifyActionInputName('navigate', 'content'), 'url', 'navigate 的 content 特判为 url');
  ok('动作别名（left_single→click 等）与参数别名（start_box→start）归一');
}

// ── 3. 动作字符串解析：标签剥离 + 参数提升 ──────────────────────────────────
{
  const a = parseActionCallString("click(start_box='<|box_start|>(279,81)<|box_end|>')");
  assert.equal(a.type, 'click');
  assert.deepEqual(a.inputs.start.raw, { x: 279, y: 81 });
  assert.equal(a.inputs.start_box, undefined, 'start_box 已提升为 start');

  const b = parseActionCallString("click(point='<point>510 150</point>')");
  assert.deepEqual(b.inputs.start.raw, { x: 510, y: 150 }, 'point= 文本替换为 start_box= 后提升为 start（上游同款）');

  const c = parseActionCallString("drag(start_box='<point>458 328</point>', end_point='<point>350 309</point>')");
  assert.equal(c.type, 'drag');
  assert.deepEqual(c.inputs.start.raw, { x: 458, y: 328 });
  assert.deepEqual(c.inputs.end.raw, { x: 350, y: 309 }, 'end_point→end 提升成立');

  const d = parseActionCallString("hotkey(key='ctrl c')");
  assert.equal(d.inputs.key, 'ctrl c');

  const e = parseActionCallString("type(content='Hello, world!')");
  assert.equal(e.inputs.content, 'Hello, world!');

  assert.equal(parseActionCallString('not an action'), null, '非函数式文本 → null');
  const typo = parseActionCallString('finisked()');
  assert.equal(typo.type, 'finisked', '拼写错动作语法合法即通过解析（上游 unifyActionType 对未知名透传）');
  ok('解析：box 标签剥离、point= 提升、drag 双点、hotkey/type 参数、未知名透传');
}

// ── 4. 整响应解析：Thought/Action 切分 + 多动作 ─────────────────────────────
{
  const resp = parsePrediction(
    "Thought: 我需要点击这个按钮\nAction: click(start_box='(100,200)')",
  );
  assert.equal(resp.thought, '我需要点击这个按钮');
  assert.equal(resp.actions.length, 1);
  assert.deepEqual(resp.actions[0].inputs.start.raw, { x: 100, y: 200 });

  const none = parsePrediction('Thought: 只说不做');
  assert.equal(none.actions.length, 0);
  assert.equal(none.error, 'There is no GUI action detected');
  ok('整响应：Thought 提取、无动作报错');
}

// ── 5. serializeAction 往返（引擎 → tool call 参数的往返语义） ───────────────
{
  const first = parseActionCallString("click(start_box='<point>510 150</point>')");
  const round = parseActionCallString(serializeAction(first));
  assert.deepEqual(round, first, '序列化后再解析应等价');
  assert.equal(serializeAction(first), "click(start='(510, 150)')");
  ok('serializeAction 往返一致');
}

// ── 6. 坐标派发：normalized×屏幕 与 raw 直用 ────────────────────────────────
{
  const screen = { screenWidth: 1280, screenHeight: 800, scaleX: 2, scaleY: 2 };
  assert.deepEqual(calculateRealCoords({ normalized: { x: 0.5, y: 0.5 } }, screen), { x: 640, y: 400 });
  assert.deepEqual(calculateRealCoords({ raw: { x: 279, y: 81 } }, screen), { x: 279, y: 81 }, 'raw 不再乘 scale');
  assert.throws(() => calculateRealCoords({}, screen), '双空坐标抛错');

  const op = new MockOperator(screen);
  await op.execute([{ type: 'click', inputs: { point: { normalized: { x: 0.5, y: 0.5 } } } }]);
  await op.execute([{ type: 'double_click', inputs: { point: { raw: { x: 100, y: 50 } } } }]);
  assert.equal(op.dispatched.length, 2);
  assert.deepEqual(op.dispatched[0].at, { x: 640, y: 400 });
  assert.match(op.dispatched[1].action, /^double_click\(/);
  ok('坐标派发：normalized 换算 + raw 直用 + 派发记录');
}

// ── 7. 主循环：click → finished 正常收束 ────────────────────────────────────
{
  const op = new MockOperator();
  const script = [
    "Thought: 点击登录按钮\nAction: click(start_box='(640,400)')",
    "Thought: 任务完成\nAction: finished()",
  ];
  const result = await runVisionLoop('登录网站', {
    operator: op,
    model: { invoke: async () => script.shift() },
  });
  assert.equal(result.status, 'end');
  assert.equal(result.loopCount, 2);
  assert.equal(op.dispatched.length, 1);
  assert.deepEqual(op.dispatched[0].at, { x: 640, y: 400 });
  assert.equal(result.history.length, 2);
  ok('主循环：截图→VLM→解析→派发→finished 即 END');
}

// ── 8. call_user 人在回路 ───────────────────────────────────────────────────
{
  const op = new MockOperator();
  let calls = 0;
  const result = await runVisionLoop('解不开的验证码', {
    operator: op,
    model: { invoke: async () => { calls += 1; return "Thought: 需要人工\nAction: call_user()"; } },
  });
  assert.equal(result.status, 'call_user');
  assert.equal(calls, 1, 'call_user 后循环终止，不再请求模型');
  assert.equal(op.dispatched.length, 0);
  ok('call_user：移交人工并停机');
}

// ── 9. maxLoopCount 熔断（-100004） ─────────────────────────────────────────
{
  const op = new MockOperator();
  const result = await runVisionLoop('永不完成的任务', {
    operator: op,
    model: { invoke: async () => "Thought: 继续\nAction: click(start_box='(1,1)')" },
    maxLoopCount: 5,
  });
  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, -100004, 'REACH_MAXLOOP_ERROR');
  assert.equal(result.loopCount, 5);
  ok('maxLoopCount 熔断：错误码 -100004');
}

// ── 10. 截图失败：重试恢复 + 连续失败熔断（-100000） ────────────────────────
{
  const opFailOnce = new MockOperator(undefined, { failFirstScreenshots: 1 });
  const result1 = await runVisionLoop('恢复路径', {
    operator: opFailOnce,
    model: { invoke: async () => 'Action: finished()' },
    screenshotRetries: 2,
  });
  assert.equal(result1.status, 'end', '首拍失败后重试成功');

  const opFailAll = new MockOperator(undefined, { failFirstScreenshots: 99 });
  const result2 = await runVisionLoop('永久黑屏', {
    operator: opFailAll,
    model: { invoke: async () => 'Action: finished()' },
  });
  assert.equal(result2.status, 'error');
  assert.equal(result2.errorCode, -100000, 'SCREENSHOT_RETRY_ERROR：连续失败熔断');
  ok('截图链路：单次失败可恢复、连续失败熔断');
}

// ── 11. AbortSignal → user_stopped ──────────────────────────────────────────
{
  const op = new MockOperator();
  const controller = new AbortController();
  const model = {
    invoke: async () => {
      controller.abort();
      return "Thought: 点击\nAction: click(start_box='(10,10)')";
    },
  };
  const result = await runVisionLoop('中途叫停', { operator: op, model }, controller.signal);
  assert.equal(result.status, 'user_stopped');
  ok('AbortSignal：USER_STOPPED 终态');
}

console.log(`\nALL PASSED (${n} checks)`);
