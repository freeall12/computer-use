// test.mjs —— self-operating-loop.ts 的行为自测（纯 Node 断言，零依赖）
// 运行：node source/self-operating-computer/reference/test.mjs （Node >= 22.6，原生 type-stripping）
// 覆盖机制出处：agents/self-operating-computer/computer-use.md §2–§7
import assert from "node:assert/strict";
import {
  cleanJson,
  parseModelOutput,
  MockScreenCapturer,
  MockPyAutoGui,
  ocrLocate,
  somLocate,
  operate,
  buildSystemPrompt,
  platformKeys,
  getNextAction,
  runSelfOperatingLoop,
  MockConfig,
  ModelError,
} from "./self-operating-loop.ts";

let passed = 0;
const ok = (msg) => {
  passed += 1;
  console.log("  ok", `${passed}.`, msg);
};

// ── 1. clean_json：剥围栏（上游 apis.py:1117-1139）───────────────────────────
{
  assert.equal(cleanJson('```json\n[{"a":1}]\n```'), '[{"a":1}]');
  assert.equal(cleanJson('```\n[{"a":1}]\n```'), '[{"a":1}]');
  assert.equal(cleanJson('  [{"a":1}]  '), '[{"a":1}]');
  ok("cleanJson 剥 ```json/``` 围栏");
}

// ── 2. 动作语法解析：4 操作 JSON 数组（上游 prompts.py:11-196 内嵌语法）───────
{
  const ops = parseModelOutput(`[
    {"thought":"s","operation":"click","text":"search"},
    {"thought":"s","operation":"write","content":"Google Chrome"},
    {"thought":"s","operation":"press","keys":["enter"]},
    {"thought":"s","operation":"done","summary":"opened"}
  ]`);
  assert.equal(ops.length, 4);
  assert.deepEqual(ops.map((o) => o.operation), ["click", "write", "press", "done"]);
  assert.deepEqual(ops[2].keys, ["enter"]);
  ok("四操作数组 click/write/press/done 解析");
}

// ── 3. system prompt：平台自适应键位 + 三档变体（上游 prompts.py:210-257）────
{
  const mac = platformKeys("Darwin");
  assert.equal(mac.cmd, "command");
  assert.equal(mac.osSearch, '["command", "space"]'); // Spotlight
  const win = platformKeys("Windows");
  assert.equal(win.cmd, "ctrl");
  assert.equal(win.osSearch, '["win"]'); // Linux 同参
  const pMac = buildSystemPrompt("gpt-4", "open chrome", "Darwin");
  assert.match(pMac, /pyautogui/);
  assert.match(pMac, /json\.loads/); // 输出契约写进 prompt
  assert.match(pMac, /Objective: open chrome/);
  assert.match(buildSystemPrompt("gpt-4-with-som", "x", "Darwin"), /~x/); // SoM 档
  assert.match(buildSystemPrompt("gpt-4-with-ocr", "x", "Darwin"), /nothing to click/); // OCR 档
  assert.match(buildSystemPrompt("gpt-4", "x", "Windows"), /"win"/);
  ok("平台键位（command+Spotlight vs ctrl/win）与 som/ocr/standard 三档变体");
}

// ── 4. OCR 定位：文本→边界框中心百分比（上游 ocr.py:81-98）───────────────────
{
  // 1440x900 图，"Search" 文本框 (720,180)-(1080,270) → 中心 (900,225) → (0.625, 0.25)
  const loc = ocrLocate([{ text: "Search", box: [[720, 180], [1080, 180], [1080, 270], [720, 270]] }], "Search", 1440, 900);
  assert.equal(loc.x, 0.625);
  assert.equal(loc.y, 0.25);
  // 子串匹配（上游 ocr.py:53 `if search_text in text`）
  const loc2 = ocrLocate([{ text: "Search Google", box: [[0, 0], [100, 0], [100, 20], [0, 20]] }], "Search", 100, 100);
  assert.equal(loc2.x, 0.5);
  assert.throws(() => ocrLocate([], "missing", 100, 100), /not found in the image/); // 上游 :65 同文案异常
  ok("OCR 文本→中心百分比（round 3 位）+ 未命中抛异常");
}

// ── 5. SoM 定位：标签→百分比，miss 触发 fallback 语义（上游 label.py:23-33）──
{
  assert.deepEqual(somLocate("~34", { "~34": { x: 0.5, y: 0.55 } }), { x: 0.5, y: 0.55 });
  assert.throws(() => somLocate("~99", {}), /Failed to get click position/);
  ok("SoM 标签映射与 miss 异常");
}

// ── 6. 输入合成（pyautogui 形状）：逐字符写 / combo 按键 / 画圈点击 ──────────
{
  const gui = new MockPyAutoGui(1440, 900);
  gui.write("hi\\n"); // 上游 operating_system.py:12 把字面 \n 反转为真换行
  assert.deepEqual(gui.log.slice(0, 3), ["write:h", "write:i", "write:\n"]);
  gui.press(["command", "space"]);
  assert.deepEqual(gui.keyDownList, [["command", "space"]]); // 全按下→抬起（combo）
  assert.ok(gui.log.includes("keyDown:command") && gui.log.includes("keyUp:space"));
  gui.clickAtPercentage(0.5, 0.1); // 上游 :49-50：int(1440*0.5)=720, int(900*0.1)=90
  assert.ok(gui.log.includes("click:720,90"));
  assert.ok(gui.log.some((l) => l.startsWith("circle:"))); // 装饰性画圈（上游 :54-59）
  ok("write 逐字符 / press combo 语义 / 百分比→像素 + 画圈装饰点击");
}

// ── 7. 动作分派：done 停止 / unknown 停止（上游 operate.py:134-187）──────────
{
  const gui = new MockPyAutoGui();
  const doneEv = operate(
    [{ thought: "t", operation: "done", summary: "opened chrome" }],
    gui,
  );
  assert.equal(doneEv.length, 1);
  assert.deepEqual(doneEv[0], { kind: "done", summary: "opened chrome" });
  const unkEv = operate([{ thought: "t", operation: "search", query: "chrome" }], new MockPyAutoGui());
  assert.equal(unkEv[0].kind, "unknown"); // 未知操作 → 立即停（上游 :172-179）
  ok("done 打印 summary 后终止 / unknown 操作终止循环");
}

// ── 8. OCR 档端到端：click{text} 在分派前解析为百分比（上游 apis.py:368-409）─
{
  const gui = new MockPyAutoGui(1000, 1000);
  const events = operate(
    [{ thought: "t", operation: "click", text: "Submit" }],
    gui,
    [{ text: "Submit", box: [[100, 200], [300, 200], [300, 240], [100, 240]] }],
    undefined,
    { width: 1000, height: 1000 },
  );
  assert.equal(events[0].kind, "action");
  assert.equal(events[0].detail, "x=0.2,y=0.22"); // 中心 (200,220) → 0.2/0.22
  assert.ok(gui.log.includes("click:200,220"));
  ok("click{text} → OCR 坐标回填 → 像素点击");
}

// ── 9. 兜底链：模型输出坏 JSON → 换 system prompt 重试 → 封顶（上游 apis.py:1077-1090）──
{
  const messages = [
    { role: "system", content: buildSystemPrompt("claude-3", "open chrome", "Darwin") },
  ];
  let calls = 0;
  const flaky = {
    model: "claude-3",
    async respond(msgs) {
      calls += 1;
      if (calls === 1) throw new ModelError("bad output");
      assert.equal(msgs[0].role, "system");
      assert.match(msgs[0].content, /Objective: open chrome/); // fallback 重写 system 且保留 objective
      return '[{"thought":"t","operation":"done","summary":"ok"}]';
    },
  };
  const ops = await getNextAction(flaky, messages, "frame:1");
  assert.equal(ops[0].operation, "done");
  assert.equal(calls, 2);
  // 封顶差异：上游是无界递归重试（apis.py:142）；参考实现 maxFallbacks 封顶后抛出
  const alwaysBad = { model: "gpt-4", async respond() { throw new ModelError("x"); } };
  await assert.rejects(() => getNextAction(alwaysBad, [{ role: "system", content: "Objective: t" }], "f", 1), ModelError);
  ok("失败→重写 system prompt 重试（封顶 2 次，上游为无界递归）");
}

// ── 10. 主循环闭环：done 终止 + 10 轮上限（上游 operate.py:107-121）──────────
{
  // 10a. 正常完成：截图→click→write→press→done
  const screen = new MockScreenCapturer(["f1", "f2", "f3", "f4"]);
  const gui = new MockPyAutoGui(1440, 900);
  let step = 0;
  const vision = {
    model: "gpt-4-with-ocr",
    async respond() {
      step += 1;
      return [
        '[{"thought":"find","operation":"click","text":"Chrome"}]',
        '[{"thought":"type","operation":"write","content":"hello"}]',
        '[{"thought":"go","operation":"press","keys":["enter"]}]',
        '[{"thought":"end","operation":"done","summary":"objective complete"}]',
      ][step - 1];
    },
  };
  const timeline = await runSelfOperatingLoop({
    objective: "open chrome and search",
    vision,
    screen,
    synth: gui,
    ocr: [{ text: "Chrome", box: [[0, 0], [144, 0], [144, 90], [0, 90]] }],
    imageSize: { width: 1440, height: 900 },
  });
  assert.equal(timeline.length, 4);
  assert.equal(timeline[3].events[0].kind, "done");
  assert.deepEqual(timeline.map((t) => t.events[0].type ?? t.events[0].kind), ["click", "write", "press", "done"]);
  assert.ok(gui.log.includes("click:72,45")); // OCR 中心 (72,45)/(1440,900) → 像素 (72,45)
  ok("观察→动作闭环 4 轮至 done，OCR 坐标真实落点");

  // 10b. 模型永不 done → loop_count>10 强制跳出（防死循环的唯一护栏）
  const loopVision = { model: "gpt-4", async respond() { return '[{"thought":"t","operation":"write","content":"x"}]'; } };
  const t2 = await runSelfOperatingLoop({
    objective: "loop forever",
    vision: loopVision,
    screen: new MockScreenCapturer(),
    synth: new MockPyAutoGui(),
  });
  assert.equal(t2.length, 11); // loop 0..10 共 11 轮
  ok("无 done 时 11 轮硬上限（loop_count > 10 break）");
}

// ── 11. 配置：缺 key 弹窗收集 + 明文落盘复刻（上游 config.py:153-187）────────
{
  const cfg = new MockConfig();
  assert.ok(cfg.requireApiKey("OPENAI_API_KEY", false, () => null)); // 不需要→不问
  assert.ok(cfg.requireApiKey("OPENAI_API_KEY", true, () => "sk-test")); // 弹窗收集
  assert.equal(cfg.env.OPENAI_API_KEY, "sk-test");
  assert.match(cfg.env.__env_file_OPENAI_API_KEY, /^\nOPENAI_API_KEY='sk-test'$/); // 明文 key='…' 格式（上游带前导换行 append）
  assert.ok(cfg.requireApiKey("OPENAI_API_KEY", true, () => { throw new Error("不应再次询问"); }), "已缓存 key 不应再次询问");
  assert.ok(!cfg.requireApiKey("GOOGLE_API_KEY", true, () => null), "取消 → false（上游 sys.exit）");
  ok("缺 key 交互收集 + 明文 .env 追加（安全差距证据）");
}

console.log(`\nALL PASSED (${passed} checks)`);
