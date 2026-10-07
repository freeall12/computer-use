// test.mjs —— stagehand-mini 骨架自测（纯 Node ≥18，零依赖）
// 运行：node test.mjs   期望输出：ALL PASSED (N assertions)

import assert from "node:assert/strict";
import { MiniStagehand, MockLLM, MockDom, buildSnapshot } from "./stagehand-mini.mjs";

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok  ${name}`);
    })
    .catch((e) => {
      console.error(`FAIL  ${name}\n      ${e.message}`);
      process.exitCode = 1;
    });
}

const LOGIN_PAGE = [
  { elementId: "0-1", role: "banner", name: "header", xpath: "/html/body/header", parentId: null },
  { elementId: "0-2", role: "textbox", name: "email input", xpath: "//input[@id='email']", parentId: "0-1", interactive: true },
  { elementId: "0-3", role: "textbox", name: "password input", xpath: "//input[@id='password']", parentId: "0-1", interactive: true },
  { elementId: "0-4", role: "button", name: "sign in button", xpath: "//button[@id='submit']", parentId: "0-1", interactive: true },
];

const main = async () => {
  console.log("# stagehand-mini 三原语骨架自测");

  await ok("快照：AX 行格式 [id] role: name + xpath 映射", () => {
    const snap = buildSnapshot(LOGIN_PAGE);
    assert.match(snap.combinedTree, /\[0-2\] textbox: email input/);
    assert.equal(snap.xpathMap["0-4"], "//button[@id='submit']");
  });

  await ok("act(Action)：确定性对象直执行，零 LLM 调用", async () => {
    const dom = new MockDom(LOGIN_PAGE.map((n) => ({ ...n })));
    const llm = new MockLLM();
    const sh = new MiniStagehand({ dom, model: llm, selfHeal: false });
    const r = await sh.act({ selector: "xpath=//input[@id='email']", description: "fill email", method: "fill", arguments: ["a@b.c"] });
    assert.equal(r.data.success, true);
    assert.equal(llm.calls.length, 0, "deterministic act must not call the model");
    assert.equal(r.data.actions[0].method, "fill");
  });

  await ok("act(字符串)：推理管线 elementId→xpath→确定性执行", async () => {
    const dom = new MockDom(LOGIN_PAGE.map((n) => ({ ...n })));
    const llm = new MockLLM();
    const sh = new MiniStagehand({ dom, model: llm });
    const r = await sh.act("click the sign in button");
    assert.equal(r.data.success, true);
    assert.equal(r.data.actions[0].selector, "xpath=//button[@id='submit']");
    assert.equal(llm.calls.length, 1, "AI escape hatch runs exactly one inference");
  });

  await ok("变量：%key% 占位符进 prompt，明文只落执行参数", async () => {
    const dom = new MockDom(LOGIN_PAGE.map((n) => ({ ...n })));
    const llm = new MockLLM();
    const sh = new MiniStagehand({ dom, model: llm });
    const r = await sh.act(
      { selector: "xpath=//input[@id='password']", description: "fill password", method: "fill", arguments: ["%password%"] },
      { variables: { password: "s3cret!" } },
    );
    assert.equal(r.data.success, true);
    assert.equal(dom.events[0].args[0], "s3cret!");
  });

  await ok("缓存：二次同指令 HIT，无新推理、确定性重放", async () => {
    const dom = new MockDom(LOGIN_PAGE.map((n) => ({ ...n })));
    const llm = new MockLLM();
    const sh = new MiniStagehand({ dom, model: llm });
    await sh.act("click the sign in button");
    const before = llm.calls.length;
    const r2 = await sh.act("click the sign in button");
    assert.equal(r2.metadata.cache.status, "HIT");
    assert.equal(llm.calls.length, before, "cache hit must skip inference");
    assert.ok(r2.metadata.cache.tokensSaved.input > 0);
  });

  await ok("缓存失效：DOM 改版后重放失败 → miss(replay_failed) → 全推理回退", async () => {
    const dom = new MockDom(LOGIN_PAGE.map((n) => ({ ...n })));
    const llm = new MockLLM();
    const sh = new MiniStagehand({ dom, model: llm });
    await sh.act("click the sign in button");
    dom.redesign([
      ...LOGIN_PAGE.filter((n) => n.elementId !== "0-4").map((n) => ({ ...n })),
      { elementId: "0-9", role: "button", name: "sign in button", xpath: "//button[@data-v2='submit']", parentId: "0-1", interactive: true },
    ]);
    const r2 = await sh.act("click the sign in button");
    assert.equal(r2.data.success, true, "falls back to full inference and succeeds");
    assert.equal(r2.metadata.cache.status, "MISS");
    assert.equal(r2.metadata.cache.missReason, "replay_failed");
    assert.equal(r2.data.actions[0].selector, "xpath=//button[@data-v2='submit']");
  });

  await ok("self-heal：推理结果执行失败 → 重快照重推 → 重试成功", async () => {
    const dom = new MockDom(LOGIN_PAGE.map((n) => ({ ...n })));
    const llm = new MockLLM();
    llm.poisoned = true;
    llm.poisonNth = 1; // 第一次 act 推理给坏元素；self-heal 的第二次推理恢复正常
    const sh = new MiniStagehand({ dom, model: llm, selfHeal: true });
    const r = await sh.act("click the sign in button");
    assert.equal(r.data.success, true, "self-heal recovers");
    assert.ok(llm.calls.length >= 2, "self-heal adds a second inference");
  });

  await ok("observe：默认指令返回可交互元素 Action[]，xpath 已归一化", async () => {
    const dom = new MockDom(LOGIN_PAGE.map((n) => ({ ...n })));
    const sh = new MiniStagehand({ dom, model: new MockLLM() });
    const r = await sh.observe();
    assert.ok(r.data.length >= 2);
    for (const a of r.data) assert.match(a.selector, /^xpath=/);
    const r2 = await sh.observe("find the email input");
    assert.ok(r2.data.some((a) => a.selector === "xpath=//input[@id='email']"));
  });

  await ok("extract：结构化数据 + 二次 metadata.completed + URL ID 回填真实链接", async () => {
    const nodes = [
      ...LOGIN_PAGE.map((n) => ({ ...n })),
      { elementId: "0-5", role: "link", name: "invoice #1042", xpath: "//a[@id='inv1042']", url: "https://x.co/inv/1042", interactive: true },
      { elementId: "0-6", role: "link", name: "invoice #1043", xpath: "//a[@id='inv1043']", url: "https://x.co/inv/1043", interactive: true },
    ];
    const sh = new MiniStagehand({ dom: new MockDom(nodes), model: new MockLLM() });
    const r = await sh.extract("extract invoice links", { urlField: "links" });
    assert.equal(r.metadata.completed, true);
    assert.deepEqual(r.data.links, ["https://x.co/inv/1042", "https://x.co/inv/1043"]);
  });

  console.log(`\nALL PASSED (${passed} assertions)`);
};

main();
