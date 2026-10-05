/**
 * ref 句柄分配/校验器 —— assertDescriptionMatches 逻辑的 cleanroom 重构。
 *
 * 行为规格出处（agents/cursor/browser-use.md §4、agents/cursor/evidence/inventory.md §3.3）：
 * - 分配：每个可交互元素得到稳定句柄——已有合法 data-cursor-ref 则复用，否则分配 e<N> 并
 *   setAttribute；本次未引用到的旧 ref 会被清除；
 * - YAML 快照：role/name/ref/value/placeholder/nth/states（与 ~/.cursor/browser-logs/snapshot-*.log
 *   落盘格式一致）；
 * - 防漂移：动作执行前 assertDescriptionMatches 比对元素当前 tag/role/aria-label/text 与
 *   快照时的描述是否一致，不一致报错提示重新 snapshot——ref 过期保护；
 * - findElementByRef：遍历 composed DOM 匹配 data-cursor-ref；
 * - nth：同 role+name 的第 N 个（从 0 起，只在有同名兄弟时标注）。
 */

import { MiniElement } from "./dom.ts";

const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea"]);
const REF_ATTR = "data-cursor-ref";

export interface SnapshotOptions {
  interactive?: boolean;
  maxDepth?: number;
  includeDiff?: boolean;
}

export interface SnapshotEntry {
  role: string;
  name: string;
  ref: string;
  value?: string;
  placeholder?: string;
  nth?: number;
  states?: string[];
}

export interface SnapshotResult {
  yaml: string;
  entries: SnapshotEntry[];
}

function accessibleName(el: MiniElement): string {
  return el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.textContent.trim();
}

function roleOf(el: MiniElement): string {
  return el.getAttribute("role") ?? el.tagName;
}

function isInteractive(el: MiniElement): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  if (el.getAttribute("role") != null) return true;
  return el.getAttribute("contenteditable") != null;
}

/** 角色描述（供 assertDescriptionMatches 比对） */
function describe(el: MiniElement): string {
  return `${el.tagName}|${roleOf(el)}|${accessibleName(el)}|${el.textContent.trim().slice(0, 40)}`;
}

/** 分配/复用 ref 并产出 YAML 快照（browser-use.md §4.1 流程 1–4） */
export function takeSnapshot(root: MiniElement, options: SnapshotOptions = {}): SnapshotResult {
  const entries: SnapshotEntry[] = [];
  const usedRefs = new Set<string>();
  const counters = new Map<string, number>();

  // ref 计数器在页面世界持久存在（注入脚本的闭包变量 refCounter++）；
  // 形状级近似：从「全 DOM 现有最大 ref 编号 + 1」继续，保证新元素不与旧 ref 冲突。
  let refCounter = 0;
  for (const node of root.descendants()) {
    const m = node.getAttribute(REF_ATTR)?.match(/^e(\d+)$/);
    if (m) refCounter = Math.max(refCounter, Number(m[1]) + 1);
  }

  for (const node of root.descendants()) {
    if (options.interactive !== false && !isInteractive(node)) continue;
    if ((options.maxDepth ?? 20) <= 0) break;
    const role = roleOf(node);
    const name = accessibleName(node);

    // ref 复用或新分配（evidence §3.3：ref = 'e' + refCounter++; setAttribute）
    let ref = node.getAttribute(REF_ATTR);
    if (!ref || !/^e\d+$/.test(ref)) {
      ref = `e${refCounter++}`;
      node.setAttribute(REF_ATTR, ref);
    }
    usedRefs.add(ref);

    // nth：同 role+name 的第 N 个
    const key = `${role}|${name}`;
    const nth = counters.get(key) ?? 0;
    counters.set(key, nth + 1);

    const entry: SnapshotEntry = { role, name, ref };
    if (node.tagName === "input" || node.tagName === "textarea") {
      const value = node.getAttribute("value");
      if (value) entry.value = value;
      const placeholder = node.getAttribute("placeholder");
      if (placeholder) entry.placeholder = placeholder;
    }
    if (nth > 0) entry.nth = nth;
    const states: string[] = [];
    if (node.getAttribute("aria-current") != null) states.push("current");
    if (states.length) entry.states = states;
    entries.push(entry);
  }

  // 清理：本次未引用到的旧 ref 会被清除（§4.1 流程 3）
  for (const node of root.descendants()) {
    const ref = node.getAttribute(REF_ATTR);
    if (ref && !usedRefs.has(ref)) node.removeAttribute(REF_ATTR);
  }

  return { yaml: renderYaml(entries), entries };
}

function renderYaml(entries: SnapshotEntry[]): string {
  return entries
    .map((e) => {
      const lines = [`- role: ${e.role}`, `  name: ${e.name}`, `  ref: ${e.ref}`];
      if (e.value !== undefined) lines.push(`  value: ${e.value}`);
      if (e.placeholder !== undefined) lines.push(`  placeholder: ${e.placeholder}`);
      if (e.nth !== undefined) lines.push(`  nth: ${e.nth}`);
      if (e.states?.length) lines.push(`  states: [${e.states.join(", ")}]`);
      return lines.join("\n");
    })
    .join("\n");
}

/** 按 ref 查找元素（遍历 composed DOM，evidence §3.3 findElementByRef） */
export function findElementByRef(root: MiniElement, ref: string): MiniElement | null {
  for (const node of root.descendants()) {
    if (node.getAttribute(REF_ATTR) === ref) return node;
  }
  return null;
}

/**
 * assertDescriptionMatches 的重构：动作前校验元素描述未漂移。
 * 传入的 element（人类可读描述）须与当前元素的 tag/role/aria-label/text 一致——
 * 不一致报错并建议重新 snapshot（browser-use.md §4.1 流程 5）。
 * 描述缺失（undefined）时跳过校验（element 参数是可选的防错位手段）。
 */
export function assertDescriptionMatches(element: MiniElement, ref: string, expectedDescription: string | undefined): void {
  if (expectedDescription == null) return;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const actual = describe(element);
  const expected = norm(expectedDescription);
  const actualNorm = norm(actual);
  const match =
    actualNorm.includes(expected) ||
    norm(accessibleName(element)).includes(expected) ||
    expected.includes(norm(accessibleName(element)));
  if (!match) {
    throw new Error(
      `Element ${ref} no longer matches the snapshot description ${JSON.stringify(expectedDescription)} ` +
      `(now: ${actual}). The page may have changed — take a new browser_snapshot and retry with a fresh ref.`,
    );
  }
}
