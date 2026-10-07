// stagehand-mini.mjs —— Stagehand v4 act/observe/extract 三原语形状的 cleanroom 骨架
//
// 本文件不是上游代码的转写或翻译。它按 agents/stagehand 分册记录的行为规格，
// 用纯 Node JavaScript（零依赖）重写"半自动混合范式"的最小可运行形状：
//   - 确定性代码为主干：Action 对象直执行、缓存命中无 LLM 重放、选择器解析走确定性表
//   - AI 只做逃生舱：自然语言指令 → AX 快照 + 结构化推理 → elementId → xpath → 确定性执行
//   - self-heal：执行失败后重推选择器重试一次（agents/stagehand/browser-use.md §3）
//   - 服务端缓存形状：键含指令 + DOM 状态，命中重放，重放失败回退全推理
//
// 机制出处（上游 commit fdd17958，路径相对仓库根）：
//   act 双分派            packages/extension/services/actService.ts:104-113
//   推理管线              同上 :152-246（快照→prompt→LLM→elementId→xpath→执行）
//   twoStep 二段          同上 :194-245
//   self-heal             同上 :375-396, 399-464
//   缓存重放/回退          同上 :123-150, 249-284；cacheService.ts:206-333
//   observe 默认指令       observeService.ts:21-22
//   observe→Action 归一化  observeService.ts:113-156
//   extract+URL 回填       extractService.ts:123-131, 167-174
//   extract 二次 metadata  inference.ts:146-159
//   变量 %key% 替换        actService.ts:506-519
//   AX 行格式 [id] role    extension/understudy/a11y/snapshot/treeFormatUtils.ts:8-16
//   elementId=帧序-节点ID  extension/understudy/a11y/snapshot/capture.ts:851
//   支持的执行方法表       extension/types/private/handlers.ts:2-14
//   模型三路分派           extension/services/llmService.ts:13-33
//   客户端模型反向 RPC     packages/sdk-ts/src/stagehand.ts:200-205

import { createHash } from "node:crypto";

/** AX 快照行格式：`[帧序-backendNodeId] role: name`（上行缩进两级） */
export function formatTreeLine(node, level = 0) {
  const indent = "  ".repeat(level);
  const label = `[${node.elementId}] ${node.role}${node.name ? `: ${node.name}` : ""}`;
  const kids = (node.children ?? []).map((c) => formatTreeLine(c, level + 1)).join("\n");
  return kids ? `${indent}${label}\n${kids}` : `${indent}${label}`;
}

/** 由扁平节点表构建 AX 树文本 + xpath 映射（模拟 captureHybridSnapshot 的产物） */
export function buildSnapshot(nodes) {
  const byId = new Map(nodes.map((n) => [n.elementId, { ...n, children: [] }]));
  const roots = [];
  for (const n of nodes) {
    const wrapped = byId.get(n.elementId);
    if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId).children.push(wrapped);
    else roots.push(wrapped);
  }
  const combinedTree = roots.map((r) => formatTreeLine(r)).join("\n");
  const xpathMap = Object.fromEntries(nodes.map((n) => [n.elementId, n.xpath]));
  const urlMap = Object.fromEntries(nodes.filter((n) => n.url).map((n) => [n.elementId, n.url]));
  return { combinedTree, xpathMap, urlMap };
}

export const DEFAULT_OBSERVE_INSTRUCTION =
  "Find elements that can be used for any future actions in the page.";

/** 确定性执行器：method + xpath + args → 对 mock DOM 的变异（对应 performUnderstudyMethod） */
export class MockDom {
  constructor(nodes) {
    this.nodes = nodes; // [{elementId, role, name, xpath, url?, parentId?, interactive}]
    this.events = [];
  }
  /** 确定性选择器解析：xpath → 节点；解析不到即抛错（驱动 self-heal/缓存回退） */
  resolve(xpath) {
    const hit = this.nodes.find((n) => n.xpath === xpath);
    if (!hit) throw new Error(`selector not found: ${xpath}`);
    return hit;
  }
  execute(method, xpath, args) {
    const node = this.resolve(xpath);
    if (!node.interactive) throw new Error(`element not actionable: ${xpath}`);
    this.events.push({ method, xpath, args, elementId: node.elementId });
    if (method === "fill" || method === "type") node.value = args[0];
    if (method === "selectOptionFromDropdown") node.value = args[0];
    return node;
  }
  /** 模拟页面改版：整体替换节点表（缓存/self-heal 用例） */
  redesign(nodes) {
    this.nodes = nodes;
  }
}

/**
 * mock LLM：按指令关键词在 AX 树里确定性选元素（扮演 `model: {source:"client"}`，
 * 即 SDK 侧注册的 generate 回调，见 stagehand.ts:200-205）。
 * 每次调用记录 prompt，供测试断言"变量占位符不泄漏明文"。
 */
export class MockLLM {
  constructor() {
    this.calls = [];
    this.inputTokens = 0;
    this.outputTokens = 0;
    // 测试钩子：第 n 次 act 推理改答错误元素（模拟站点改版 → 触发 self-heal）
    this.poisonNth = 0;
    this.poisoned = false;
  }
  generate({ systemPrompt, messages }) {
    const content = messages[0].content;
    const userText = typeof content === "string" ? content : (Array.isArray(content) ? content[0].text : content.text);
    this.calls.push({ systemPrompt, userText });
    this.inputTokens += Math.ceil(userText.length / 4);
    this.outputTokens += 40;
    const kind = /respond with JSON matching the "Act" schema/i.test(systemPrompt)
      ? "act"
      : /respond with JSON matching the "Observation" schema/i.test(systemPrompt)
        ? "observe"
        : /respond with JSON matching the "Extraction" schema/i.test(systemPrompt)
          ? "extract"
          : "metadata";
    return {
      outputFormat: "json_schema",
      structuredContent:
        kind === "act"
          ? this.actResponse(userText)
          : kind === "observe"
            ? { elements: this.observeResponse(userText) }
            : kind === "extract"
              ? { value: this.extractResponse(userText), completed: true }
              : { progress: "done", completed: true },
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  }
  /** 从 "Instruction: ..." 与 DOM 文本中按关键词匹配目标行 */
  matchLines(userText) {
    const instruction = userText.match(/Instruction: (.*)/)?.[1] ?? "";
    const keywords = instruction.toLowerCase().match(/[a-z0-9%_]+/g) ?? [];
    return userText
      .split("\n")
      .filter((l) => /^\s*\[[\d-]+\]/.test(l))
      .map((l) => ({ line: l.trim(), id: l.trim().match(/^\[([\d-]+)\]/)?.[1] }))
      .filter(({ line }) => {
        const low = line.toLowerCase();
        return keywords.some((k) => k.length > 2 && low.includes(k));
      });
  }
  parseRole(line) {
    return line.replace(/^\[[\d-]+\]\s*/, "").split(":")[0].trim().toLowerCase();
  }
  actResponse(userText) {
    const hits = this.matchLines(userText);
    if (this.poisoned && this.calls.length <= this.poisonNth) {
      // 故意选非交互的 banner 节点 → 选择器可解析但执行失败 → 触发 self-heal
      return {
        action: {
          elementId: "0-1",
          description: "stale target",
          method: "click",
          arguments: [],
        },
        twoStep: false,
      };
    }
    if (hits.length === 0) return { action: null, twoStep: false };
    const id = hits[hits.length - 1].id;
    const twoStep = /login form|sign in and|fill .* and/i.test(userText.match(/Instruction: (.*)/)?.[1] ?? "");
    const method = /dropdown|select/i.test(hits[hits.length - 1].line) ? "selectOptionFromDropdown" : "click";
    const argsMatch = userText.match(/arguments: \[(.*?)\]/);
    return {
      action: { elementId: id, description: "matched target", method, arguments: argsMatch ? [argsMatch[1]] : [] },
      twoStep,
    };
  }
  observeResponse(userText) {
    const instruction = userText.match(/Instruction: (.*)/)?.[1] ?? "";
    const elementLines = userText
      .split("\n")
      .filter((l) => /^\s*\[[\d-]+\]/.test(l))
      .map((l) => l.trim());
    const INTERACTIVE = new Set(["button", "textbox", "link", "checkbox", "menuitem", "combobox"]);
    const hits = /any future actions/i.test(instruction)
      ? elementLines.filter((l) => INTERACTIVE.has(this.parseRole(l)))
      : this.matchLines(userText).map((h) => h.line);
    return hits.map((line) => ({
      elementId: line.match(/^\[([\d-]+)\]/)?.[1],
      description: line.replace(/^\[[\d-]+\]\s*/, ""),
      method: "click",
      arguments: [],
    }));
  }
  extractResponse(userText) {
    // "链接以 ID 返回"契约：只收 link 角色行（prompt.ts：链接字段返回元素 ID）
    const linkLines = userText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\[[\d-]+\] link:/.test(l));
    return {
      title: linkLines.length ? "links" : "",
      links: linkLines.map((l) => l.match(/^\[([\d-]+)\]/)?.[1]),
    };
  }
}

const METHODS_ALLOWED = new Set([
  "click", "fill", "type", "press", "scrollTo", "nextChunk", "prevChunk",
  "selectOptionFromDropdown", "hover", "doubleClick", "dragAndDrop",
]);

export class MiniStagehand {
  constructor({ dom, model, selfHeal = false, cache = true }) {
    this.dom = dom;
    this.model = model; // MockLLM 实例（对应 generate 回调）
    this.selfHeal = selfHeal;
    this.cacheEnabled = cache;
    this.cacheStore = new Map(); // key → Action[]（模拟 API 侧 Redis）
    this.snapshot = () => buildSnapshot(dom.nodes);
  }

  snapshot_() { return this.snapshot(); }

  /**
   * 缓存键：指令 + DOM 结构指纹。cleanroom 简化：指纹剥离 elementId（真实系统由
   * API 服务端对原始 CDP AX 树做 shaping/hashing，见 cacheService.ts:23-31），
   * 使得仅属性变化（xpath 变了、角色/文案没变）时键仍命中，重放才会失败回退。
   */
  treeHash(tree) {
    const shape = tree.replace(/\[[\d-]+\]/g, "[]");
    return createHash("sha256").update(shape).digest("hex").slice(0, 16);
  }

  zeroUsage() {
    return { inputTokens: 0, outputTokens: 0, inferenceTimeMs: 0 };
  }

  substituteVariables(args, variables) {
    if (!variables) return args;
    return args.map((a) => {
      let out = String(a);
      for (const [k, v] of Object.entries(variables)) out = out.split(`%${k}%`).join(String(v));
      return out;
    });
  }

  /** 确定性执行一个 Action；失败抛错（actService.ts:330-397 的形状） */
  async takeDeterministicAction(action, variables) {
    if (!METHODS_ALLOWED.has(action.method)) {
      return { ok: false, message: `method '${action.method}' not supported` };
    }
    try {
      const args = this.substituteVariables(action.arguments ?? [], variables);
      this.dom.execute(action.method, action.selector.replace(/^xpath=/, ""), args);
      return { ok: true, action: { ...action, arguments: action.arguments ?? [] } };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async inferAct(instruction, snapshot, variables) {
    const prompt =
      `System=Act schema. respond with JSON matching the "Act" schema.\n` +
      `Instruction: ${instruction}\nDOM: ${snapshot.combinedTree}` +
      (variables ? `\nvariables: ${JSON.stringify(Object.keys(variables))}` : "");
    const res = await this.model.generate({
      systemPrompt: 'respond with JSON matching the "Act" schema.',
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
    });
    const a = res.structuredContent.action;
    if (!a) return { action: undefined, twoStep: false, usage: this.zeroUsage() };
    const xpath = snapshot.xpathMap[a.elementId];
    if (!xpath) return { action: undefined, twoStep: res.structuredContent.twoStep, usage: this.zeroUsage() };
    return {
      action: { selector: `xpath=${xpath}`, description: a.description, method: a.method, arguments: a.arguments },
      twoStep: res.structuredContent.twoStep,
      usage: this.zeroUsage(),
    };
  }

  /** act：字符串走推理管线，Action 对象直执行（actService.ts:104-113） */
  async act(instruction, options = {}) {
    if (typeof instruction !== "string") {
      const r = await this.takeDeterministicAction(instruction, options.variables);
      return this.wrapAct(r, "deterministic", { cache: { status: "BYPASS" } });
    }
    const snapshot = this.snapshot_();
    const cacheKey = `act:${instruction}:${this.treeHash(snapshot.combinedTree)}`;

    // 缓存拦截：命中 → 无 LLM 确定性重放；重放失败 → miss(replay_failed) → 全推理
    if (this.cacheEnabled && !options.locator) {
      const cached = this.cacheStore.get(cacheKey);
      if (cached) {
        try {
          for (const action of cached) {
            const r = await this.takeDeterministicAction(action, options.variables);
            if (!r.ok) throw new Error(r.message);
          }
          return this.wrapAct(
            { ok: true, actions: cached },
            instruction,
            { cache: { status: "HIT", tokensSaved: { input: 1200, output: 60 } } },
          );
        } catch {
          var missReason = "replay_failed";
        }
        const fresh = await this.runActPipeline(instruction, options);
        fresh.metadata.cache = { status: "MISS", missReason };
        return fresh;
      }
    }

    const fresh = await this.runActPipeline(instruction, options);
    if (this.cacheEnabled && fresh.data.success && fresh.data.actions.length > 0) {
      this.cacheStore.set(cacheKey, fresh.data.actions);
      fresh.metadata.cache = { status: "MISS", missReason: "first_run" };
    }
    return fresh;
  }

  async runActPipeline(instruction, options, isHeal = false) {
    let snapshot = this.snapshot_();
    let inferred = await this.inferAct(instruction, snapshot, options.variables);
    if (!inferred.action) {
      return this.wrapAct({ ok: false, message: "No action found" }, instruction, { cache: { status: "MISS" } });
    }
    let result = await this.takeDeterministicAction(inferred.action, options.variables);

    // self-heal：执行失败且开启 → 重快照重推选择器，重试一次（actService.ts:399-464）
    if (!result.ok && this.selfHeal && !isHeal) {
      snapshot = this.snapshot_();
      inferred = await this.inferAct(`${inferred.action.method} ${instruction}`, snapshot, options.variables);
      if (inferred.action) {
        result = await this.takeDeterministicAction(inferred.action, options.variables);
      }
    } else if (result.ok && inferred.twoStep) {
      // twoStep：二段推理在 diff 树上补第二个动作（actService.ts:194-245）
      const second = await this.inferAct(instruction, snapshot, options.variables);
      if (second.action) {
        const r2 = await this.takeDeterministicAction(second.action, options.variables);
        if (r2.ok) result = { ok: true, actions: [result.action, r2.action] };
      }
    }
    const meta = { cache: { status: "MISS" } };
    return this.wrapAct(result, instruction, meta);
  }

  wrapAct(r, instruction, metadata) {
    const ok = r.ok;
    return {
      data: {
        success: ok,
        message: ok ? `performed: ${instruction}` : (r.message ?? "failed"),
        actionDescription: instruction,
        actions: ok ? (r.actions ?? [r.action].filter(Boolean)) : [],
      },
      metadata: { usage: this.zeroUsage(), ...metadata },
    };
  }

  /** observe：默认指令全量收集，返回 Action[]（observeService.ts:21-22, 113-156） */
  async observe(instruction) {
    const effective = instruction ?? DEFAULT_OBSERVE_INSTRUCTION;
    const snapshot = this.snapshot_();
    const prompt =
      `System=Observation schema. respond with JSON matching the "Observation" schema.\n` +
      `Instruction: ${effective}\nDOM: ${snapshot.combinedTree}`;
    const res = await this.model.generate({
      systemPrompt: 'respond with JSON matching the "Observation" schema.',
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
    });
    const actions = [];
    for (const el of res.structuredContent.elements) {
      const xpath = snapshot.xpathMap[el.elementId];
      if (!xpath) continue; // 解析不出 xpath 的元素丢弃（observeService.ts:117-124）
      actions.push({ selector: `xpath=${xpath}`, description: el.description, method: el.method, arguments: el.arguments });
    }
    return { data: actions, metadata: { usage: this.zeroUsage(), cache: { status: "BYPASS" } } };
  }

  /**
   * extract：结构化抽取 + 二次 metadata 完成；链接字段先回数字 ID、后回填真实 URL
   * （extractService.ts:123-131, 167-174；inference.ts:146-159）
   */
  async extract(instruction, schema) {
    const snapshot = this.snapshot_();
    const prompt =
      `System=Extraction schema. respond with JSON matching the "Extraction" schema.\n` +
      `Instruction: ${instruction}\nDOM: ${snapshot.combinedTree}`;
    const res = await this.model.generate({
      systemPrompt: 'respond with JSON matching the "Extraction" schema.',
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
    });
    let output = res.structuredContent.value;
    // URL 回填：schema 标记 urlField 的数组字段，数字 ID → urlMap 真实链接
    if (schema?.urlField && output[schema.urlField]) {
      output = {
        ...output,
        [schema.urlField]: output[schema.urlField].map((id) => snapshot.urlMap[id] ?? id),
      };
    }
    const meta = await this.model.generate({
      systemPrompt: 'respond with JSON matching the "Metadata" schema.',
      messages: [{ role: "user", content: { type: "text", text: `Instruction: ${instruction}\nData: ${JSON.stringify(output)}` } }],
    });
    return {
      data: output,
      metadata: {
        usage: this.zeroUsage(),
        completed: meta.structuredContent.completed,
        cache: { status: "BYPASS" },
      },
    };
  }
}
