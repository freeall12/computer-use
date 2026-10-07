// browser-use-mini.ts —— cleanroom 参考实现：browser-use 核心机制的最小可用骨架
//
// 本文件**不是**上游 browser_use/（Python）代码的转写或翻译，而是按分册记录的行为规格
// 用 TypeScript 重写的形状演示。机制出处逐条标注 evidence/inventory.md 编号（下称 INV）：
//
//   [INV D1-D3] DOM 三源合一（此处以 mock 的 layout/ax/input 三层数据模拟 CDP 合并）
//   [INV D4]    selector_index 从 1 递增 + selector_map 句柄台账（serializer.py:753-761）
//   [INV D5]    可交互判定：表单控件/role/onclick/tabindex（clickable_elements.py:6-177）
//   [INV D6]    序列化文本树 [i]<tag attr=val /> + *新元素 + |SCROLL|（system_prompt.md:41-56）
//   [INV D10]   状态采集失败/导航后清空句柄台账，宁空勿错（session.py:1630-1666）
//   [INV D11]   multi_act 双守卫：terminates_sequence 静态短路 + URL/焦点运行时比对
//   [INV F1-F2] <secret>占位符</secret> 执行期替换，明文不过模型（registry/service.py:434-480）
//   [INV F3-F4] allowed_domains 导航围栏，命中黑名单回 about:blank（security_watchdog.py:35-73）
//   [INV E6]    upload 白名单（available ∪ session downloads）（tools/service.py:864-912）
//   [INV B9]    done 终态动作：结构化输出 + 自动附会话下载（tools/service.py:2008-2037）

// ─────────────────────────── DOM 模型 ───────────────────────────

export interface DomNode {
  backendId: number; // 对应 CDP backendNodeId（INV D2 的合并键）
  tag: string;
  attrs: Record<string, string>;
  text?: string; // 直接子文本
  children: DomNode[];
  // mock 的"另两个 CDP 源"（真实实现来自 DOMSnapshot 与 AX 树）：
  axRole?: string | null; // Accessibility.getFullAXTree 的 role（INV D1/D2）
  inputValue?: string | null; // DOMSnapshot 的实时输入值，JS/autofill 只写 property 的场景（INV D2）
  scrollable?: boolean;
}

export interface InteractiveElement {
  index: number; // selector_index，模型可见句柄（INV D4）
  node: DomNode;
  isNew: boolean; // *[n] 星号标记（INV D6）
}

export interface DomState {
  selectorMap: Map<number, DomNode>;
  text: string;
}

// ── 极简 HTML 解析（仅覆盖自测页面的良构子集：<tag attr=val>text</tag>，可嵌套） ──
export function parseHtml(html: string): DomNode {
  let backend = 0;
  const root: DomNode = { backendId: backend++, tag: '#root', attrs: {}, children: [] };
  const stack: DomNode[] = [root];
  const tokenRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[1] !== undefined) {
      if (m[0].startsWith('</')) {
        stack.pop();
      } else {
        const attrs: Record<string, string> = {};
        const attrRe = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
        let a: RegExpExecArray | null;
        while ((a = attrRe.exec(m[2])) !== null) attrs[a[1]] = a[2] ?? '';
        const node: DomNode = { backendId: backend++, tag: m[1].toLowerCase(), attrs, children: [] };
        stack[stack.length - 1].children.push(node);
        if (!m[3]) stack.push(node); // 非自闭合
      }
    } else if (m[4] !== undefined && m[4].trim()) {
      const parent = stack[stack.length - 1];
      parent.text = (parent.text ?? '') + m[4].trim();
    }
  }
  return root;
}

// ── 可交互判定（INV D5，简化规则集） ──
export function isInteractive(node: DomNode): boolean {
  const tag = ['a', 'button', 'input', 'select', 'textarea'].includes(node.tag);
  const role = ['button', 'link', 'combobox', 'tab', 'menuitem'].includes(node.attrs['role'] ?? node.axRole ?? '');
  const hook = ['onclick', 'tabindex'].some((k) => k in node.attrs);
  return tag || role || hook;
}

// ─────────────────────────── 序列化器（INV D4/D6） ───────────────────────────

export class DomTreeSerializer {
  private selectorMap = new Map<number, DomNode>();
  private counter = 1;
  private previous: Map<number, DomNode>; // 上一轮台账，用于 *新元素 判定

  constructor(previousSelectorMap?: Map<number, DomNode>) {
    this.previous = previousSelectorMap ?? new Map();
  }

  serialize(root: DomNode): DomState {
    const lines: string[] = [];
    this.walk(root, 0, lines);
    return { selectorMap: this.selectorMap, text: lines.join('\n') };
  }

  private prevIds(): Set<number> {
    return new Set([...this.previous.values()].map((n) => n.backendId));
  }

  private walk(node: DomNode, depth: number, lines: string[]): void {
    for (const child of node.children) {
      const pad = '\t'.repeat(depth);
      if (child.scrollable) lines.push(`${pad}|SCROLL| <${child.tag}>`);
      if (isInteractive(child)) {
        const index = this.counter++;
        this.selectorMap.set(index, child);
        const isNew = !this.prevIds().has(child.backendId) ? '*' : '';
        const attrs = Object.entries({ ...child.attrs, ...(child.inputValue != null ? { value: child.inputValue } : {}) })
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
        lines.push(`${pad}${isNew}[${index}]<${child.tag}${attrs ? ' ' + attrs : ''} />`);
      } else if (child.tag !== 'script' && child.tag !== 'style') {
        if (child.text) lines.push(`${pad}${child.text}`);
      }
      this.walk(child, child.children.length ? depth + 1 : depth, lines);
    }
  }
}

// ─────────────────────────── 会话（mock CDP 执行层） ───────────────────────────

export interface MockPage {
  targetId: string;
  url: string;
  title: string;
  html: string;
  clicks: { backendId: number; via: string }[];
  typed: { backendId: number; text: string; actualValue: string | null }[];
  fileInputs: { backendId: number; path: string | null }[];
}

export interface StateSummary {
  url: string;
  title: string;
  tabs: { targetId: string; url: string; title: string }[];
  domState: DomState;
  screenshot: string; // stub：真实实现为 Page.captureScreenshot base64（INV browser-use.md 观察节）
  stateError?: string;
}

export class BrowserSessionMini {
  pages: MockPage[] = [];
  focusTargetId: string;
  allowedDomains: string[] | null; // INV F3
  private selectorMap = new Map<number, DomNode>();
  private rootCache = new Map<string, DomNode>(); // backendId 跨步稳定的前提：每页只解析一次（真实实现 backendNodeId 由 Chrome 稳定分配）
  lastSummary: StateSummary | null = null;
  downloads: string[] = []; // 会话下载清单（INV E7）
  blockedNavigations: string[] = [];

  constructor(pages: MockPage[], allowedDomains: string[] | null = null) {
    this.pages = pages;
    this.focusTargetId = pages[0].targetId;
    this.allowedDomains = allowedDomains;
  }

  private page(): MockPage {
    return this.pages.find((p) => p.targetId === this.focusTargetId)!;
  }

  private root(page: MockPage): DomNode {
    let root = this.rootCache.get(page.targetId);
    if (!root) {
      root = parseHtml(page.html);
      this.rootCache.set(page.targetId, root);
    }
    return root;
  }

  // 域匹配：精确或 *.suffix 通配（INV F3/F4 简化版）
  urlAllowed(url: string): boolean {
    if (url.startsWith('about:')) return true;
    if (!this.allowedDomains) return true;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
    return this.allowedDomains.some((pat) =>
      pat.startsWith('*.') ? host === pat.slice(2) || host.endsWith(pat.slice(1)) : host === pat,
    );
  }

  navigate(url: string, newTab = false): { ok: boolean; error?: string } {
    // 导航围栏：前置拦截 + （真实实现还在完成后捕获重定向，INV F4）
    if (!this.urlAllowed(url)) {
      this.blockedNavigations.push(url);
      this.page().url = 'about:blank'; // 命中黑名单 → 回 about:blank（INV F4）
      this.rootCache.delete(this.page().targetId);
      return { ok: false, error: `Navigation to ${url} blocked by security policy` };
    }
    if (newTab) {
      this.pages.push({ targetId: 't' + (this.pages.length + 1), url, title: url, html: '', clicks: [], typed: [], fileInputs: [] });
      this.focusTargetId = 't' + this.pages.length;
    } else {
      this.page().url = url;
      this.rootCache.delete(this.page().targetId);
    }
    // 真实实现：导航后清空句柄缓存（session.py:1244 _cached_selector_map.clear()，INV D10）
    this.selectorMap = new Map();
    return { ok: true };
  }

  switchTab(tabId: string): boolean {
    if (!this.pages.some((p) => p.targetId === tabId)) return false;
    this.focusTargetId = tabId;
    return true;
  }

  // 状态采集：每步重建 DOM（清旧台账，INV D10）+ 干净截图 stub
  getState(): StateSummary {
    const page = this.page();
    const dom = new DomTreeSerializer(this.selectorMap).serialize(this.root(page));
    // 真实实现：序列化完成后整体回填缓存（session.py update_cached_selector_map，INV D4）
    this.selectorMap = dom.selectorMap;
    const summary: StateSummary = {
      url: page.url,
      title: page.title,
      tabs: this.pages.map((p) => ({ targetId: p.targetId, url: p.url, title: p.title })),
      domState: dom,
      screenshot: 'b64-clean-screenshot-stub',
    };
    this.lastSummary = summary;
    return summary;
  }

  // 句柄 O(1) 回查：仅缓存台账，索引失效即 null（INV D4/D10）
  getElementByIndex(index: number): DomNode | null {
    return this.selectorMap.get(index) ?? null;
  }

  // mock CDP 执行层（真实：Input.dispatchMouseEvent 等，INV E1）
  click(node: DomNode): void {
    this.page().clicks.push({ backendId: node.backendId, via: 'cdp-mouse' });
  }
  type(node: DomNode, text: string): { actualValue: string | null } {
    const actualValue = text.toUpperCase() === text ? text : text.replace(/\s+/g, ' '); // mock 页面重格式化
    node.inputValue = actualValue;
    this.page().typed.push({ backendId: node.backendId, text, actualValue });
    return { actualValue };
  }
  upload(node: DomNode, path: string): void {
    this.page().fileInputs.push({ backendId: node.backendId, path });
  }
}

// ─────────────────────────── 动作注册表 + <secret> 替换（INV F1/F2） ───────────────────────────

export interface SensitiveData {
  [patternOrKey: string]: string | Record<string, string>;
}

export function replaceSecrets(text: string, sensitive: SensitiveData, currentUrl: string): string {
  const matchesDomain = (pattern: string): boolean => {
    try {
      const host = new URL(currentUrl).hostname;
      return pattern.startsWith('*.') ? host === pattern.slice(2) || host.endsWith(pattern.slice(1)) : currentUrl.includes(pattern);
    } catch {
      return false;
    }
  };
  return text.replace(/<secret>(.*?)<\/secret>/g, (all, key: string) => {
    for (const [k, v] of Object.entries(sensitive)) {
      if (typeof v === 'string') {
        if (k === key) return v; // 旧格式 {key: value}
      } else if (matchesDomain(k) && key in v) {
        return v[key]; // 域作用域 {'*.example.com': {key: value}}（INV F1：当前页不匹配则占位符不可用）
      }
    }
    return all; // 未知/越权占位符原样保留，不替换
  });
}

export function redact(value: string, sensitive: SensitiveData): string {
  let out = value;
  for (const [k, v] of Object.entries(sensitive)) {
    if (typeof v !== 'string') continue;
    out = out.replaceAll(v, `<secret>${k}</secret>`); // 历史回显防护（INV F2）
  }
  return out;
}

export interface Action {
  name: string;
  params: Record<string, unknown>;
}

interface RegisteredAction {
  run: (params: Record<string, unknown>, session: BrowserSessionMini, ctx: RunContext) => ActionResult;
  terminatesSequence?: boolean; // INV D11 静态短路
}

export interface ActionResult {
  extractedContent?: string;
  error?: string;
  isDone?: boolean;
  success?: boolean;
  data?: unknown;
}

export interface RunContext {
  sensitiveData: SensitiveData;
  availableFiles: Set<string>; // 上传白名单 = 用户文件 ∪ 会话下载（INV E6）
}

export class RegistryMini {
  private actions = new Map<string, RegisteredAction>();

  register(name: string, opts: { terminatesSequence?: boolean }, run: RegisteredAction['run']): void {
    this.actions.set(name, { run, terminatesSequence: opts.terminatesSequence });
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  terminatesSequence(name: string): boolean {
    return this.actions.get(name)?.terminatesSequence ?? false;
  }

  execute(action: Action, session: BrowserSessionMini, ctx: RunContext): ActionResult {
    const registered = this.actions.get(action.name);
    if (!registered) return { error: `Unknown action: ${action.name}` };
    return registered.run(action.params, session, ctx);
  }
}

// 默认动作面（对应上游 22 动作的代表性子集，schema 见 ../schemas/tools.json）
export function buildDefaultRegistry(): RegistryMini {
  const registry = new RegistryMini();

  registry.register('navigate', { terminatesSequence: true }, (params, session) => {
    const r = session.navigate(String(params['url'] ?? ''), Boolean(params['new_tab']));
    return r.ok ? { extractedContent: `Navigated to ${params['url']}` } : { error: r.error };
  });

  registry.register('click', {}, (params, session) => {
    const node = session.getElementByIndex(Number(params['index']));
    if (!node) return { error: `Element index ${params['index']} not available - page may have changed.` };
    if (node.tag === 'input' && node.attrs['type'] === 'file')
      return { error: 'File inputs must be handled using upload_file action.' }; // INV E2
    session.click(node);
    return { extractedContent: `Clicked <${node.tag}>` };
  });

  registry.register('input', {}, (params, session, ctx) => {
    const node = session.getElementByIndex(Number(params['index']));
    if (!node) return { error: `Element index ${params['index']} not available - page may have changed.` };
    const raw = String(params['text'] ?? '');
    const hadSecret = /<secret>.*?<\/secret>/.test(raw); // INV F1：模型只见键名
    const text = replaceSecrets(raw, ctx.sensitiveData, session.lastSummary?.url ?? ''); // 执行期替换（INV F1）
    const { actualValue } = session.type(node, text);
    if (hadSecret) return { extractedContent: 'Typed <sensitive>' }; // INV F2：敏感值不回显
    // INV E3：回读不符 → 给模型追加警告
    if (actualValue !== null && actualValue !== text) {
      return { extractedContent: `Typed '${text}'; actual value differs: ${actualValue}` };
    }
    return { extractedContent: `Typed '${text}'` };
  });

  registry.register('upload_file', {}, (params, session, ctx) => {
    const path = String(params['path'] ?? '');
    if (!ctx.availableFiles.has(path)) return { error: `File ${path} not in available_file_paths` }; // INV E6
    const node = session.getElementByIndex(Number(params['index']));
    if (!node) return { error: `Element index ${params['index']} not available.` };
    session.upload(node, path);
    return { extractedContent: `Uploaded ${path}` };
  });

  registry.register('switch', { terminatesSequence: true }, (params, session) => {
    const ok = session.switchTab(String(params['tab_id'] ?? ''));
    return ok ? { extractedContent: `Switched to tab #${params['tab_id']}` } : { error: `Failed to switch to tab` };
  });

  registry.register('done', {}, (params, _session, _ctx) => {
    return {
      isDone: true,
      success: params['success'] !== false,
      extractedContent: String(params['text'] ?? ''),
      data: params['data'],
    }; // INV B9（真实实现另附会话下载清单）
  });

  return registry;
}

// ─────────────────────────── Agent 主循环（INV B1/B3/D11） ───────────────────────────

export type Planner = (state: StateSummary, step: number) => Action[];

export interface AgentResult {
  isDone: boolean;
  steps: number;
  history: string[];
  data?: unknown;
}

export class AgentMini {
  task: string;
  llm: Planner; // 真实实现为 BaseChatModel.ainvoke(messages, output_format)（INV C1）
  session: BrowserSessionMini;
  registry: RegistryMini;
  sensitiveData: SensitiveData;
  availableFiles: string[];
  maxFailures: number;

  constructor(
    task: string,
    llm: Planner,
    session: BrowserSessionMini,
    registry: RegistryMini = buildDefaultRegistry(),
    sensitiveData: SensitiveData = {},
    availableFiles: string[] = [],
    maxFailures = 5,
  ) {
    this.task = task;
    this.llm = llm;
    this.session = session;
    this.registry = registry;
    this.sensitiveData = sensitiveData;
    this.availableFiles = availableFiles;
    this.maxFailures = maxFailures;
  }

  // multi_act：双守卫版批量执行（INV D11）
  multiAct(actions: Action[]): { results: ActionResult[]; aborted: boolean } {
    const results: ActionResult[] = [];
    const preUrl = this.session.getState().url;
    const preFocus = this.session.focusTargetId;
    for (let i = 0; i < actions.length; i++) {
      if (i > 0) {
        // 运行时守卫：页面 URL 或焦点 target 变了 → 剩余队列作废（INV D11）
        const now = this.session.getState();
        if (now.url !== preUrl || this.session.focusTargetId !== preFocus) {
          return { results, aborted: true };
        }
      }
      const action = actions[i];
      const result = this.registry.execute(action, this.session, {
        sensitiveData: this.sensitiveData,
        availableFiles: new Set([...this.availableFiles, ...this.session.downloads]),
      });
      results.push(result);
      if (result.error) return { results, aborted: false }; // 失败即停（max_failures 简化）
      if (this.registry.terminatesSequence(action.name) && i < actions.length - 1) return { results, aborted: true }; // INV D11
      if (result.isDone) break;
    }
    return { results, aborted: false };
  }

  run(maxSteps = 10): AgentResult {
    const history: string[] = [];
    for (let step = 1; step <= maxSteps; step++) {
      // Phase 1：观察（INV B3——截图每步都拍，此处 stub）
      const state = this.session.getState();
      // Phase 2a：LLM 决策（结构化输出即动作计划，INV B9）
      const actions = this.llm(state, step);
      // Phase 2b：执行
      const { results } = this.multiAct(actions);
      for (const r of results) history.push(redact(r.extractedContent ?? r.error ?? '', this.sensitiveData));
      // Phase 3：完成判定
      const done = results.find((r) => r.isDone);
      if (done) return { isDone: true, steps: step, history, data: done.data };
    }
    return { isDone: false, steps: maxSteps, history };
  }
}
