/**
 * mini DOM —— 供 ref 句柄与合成事件模块做形状自测的最小 DOM 假体。
 *
 * 覆盖 cursor 浏览器机制所需的最小面：
 * - 组合 DOM 遍历（含开放 shadow root）——agents/cursor/browser-use.md §4.1
 * - 属性 get/set（data-cursor-ref 挂在属性上）
 * - 事件派发与记录（合成 DOM 事件的可观察面；isTrusted 恒为 false 是该路线的已知局限，§5）
 * - preventDefault（dragstart 被页面脚本阻止 → 报错建议换 browser_evaluate，§5 drag）
 */

export interface RecordedEvent {
  type: string;
  target: string; // 元素描述（tag + ref/name）
  detail?: Record<string, unknown>;
  defaultPrevented: boolean;
}

let elementSeq = 0;

export class MiniElement {
  readonly tagName: string;
  attributes = new Map<string, string>();
  children: MiniElement[] = [];
  shadowRoot: MiniElement | null = null;
  parent: MiniElement | null = null;
  focused = false;
  readonly eventLog: RecordedEvent[] = [];
  readonly id = `el${++elementSeq}`;

  constructor(tagName: string, attrs: Record<string, string | boolean | undefined> = {}, text = "") {
    this.tagName = tagName.toLowerCase();
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      this.attributes.set(k, v === true ? "" : String(v));
    }
    if (text) this.children.push(text as unknown as MiniElement); // 文本节点用字符串占位
  }

  get textContent(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }

  appendChild(child: MiniElement): MiniElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  attachShadow(): MiniElement {
    this.shadowRoot = new MiniElement("#shadow-root");
    this.shadowRoot.parent = this;
    return this.shadowRoot;
  }
  remove() {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    }
  }

  /**
   * 组合 DOM 遍历：light DOM + 开放 shadow root（对应扩展的
   * querySelectorAllIncludingOpenShadowRoots —— browser-use.md §4.1）
   */
  *descendants(): Generator<MiniElement> {
    for (const child of this.children) {
      if (typeof child === "string") continue;
      yield child;
      yield* child.descendants();
    }
    if (this.shadowRoot) yield* this.shadowRoot.descendants();
  }

  dispatchEvent(event: { type: string; detail?: Record<string, unknown> }): RecordedEvent {
    // 事件沿祖先冒泡记录（形状级：真实 DOM 的冒泡/捕获路径此处不模拟）
    const record: RecordedEvent = {
      type: event.type,
      target: `${this.tagName}${this.getAttribute("data-cursor-ref") ? `[${this.getAttribute("data-cursor-ref")}]` : ""}(${this.textContent.slice(0, 12)})`,
      detail: event.detail,
      defaultPrevented: false,
    };
    this.eventLog.push(record);
    (event as any)._prevent = () => { record.defaultPrevented = true; };
    return record;
  }
}

export function el(tagName: string, attrs?: Record<string, string | boolean | undefined>, text?: string): MiniElement {
  return new MiniElement(tagName, attrs, text);
}

/** 构造一个带 shadow DOM 的页面根，供自测 */
export function buildTestPage(): MiniElement {
  const root = el("body");
  const heading = root.appendChild(el("h1", {}, "Shop"));
  const search = root.appendChild(el("input", { type: "textbox", placeholder: "Search products", name: "q" }));
  const signIn = root.appendChild(el("button", { role: "button" }, "Sign in"));
  const card = root.appendChild(el("div", { class: "card" }));
  const shadow = card.attachShadow();
  shadow.appendChild(el("button", { role: "button" }, "Buy now")); // shadow DOM 里的可交互元素
  const plain = root.appendChild(el("span", {}, "plain text"));
  return root;
}
