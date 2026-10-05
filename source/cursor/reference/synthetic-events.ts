/**
 * 合成 DOM 事件派发器 —— 注入 JS 合成事件的 cleanroom 重构（纯形状，不用 jsdom）。
 *
 * 行为规格出处（agents/cursor/browser-use.md §5）：
 * - 所有交互动作的实现形态：在页面上下文派发合成事件（Pointer/Mouse/Keyboard/DragEvent +
 *   DataTransfer），**不用 CDP Input**（"CDP Input.* methods are focus-sensitive in
 *   Electron webviews"——主进程硬拒，见 provider.ts 的拒绝列表）；
 * - click：定位 → scrollIntoView（需要时）→ 修饰键处理 → 合成 PointerEvent/MouseEvent 序列
 *   （带 dropdown 智能关闭逻辑——此处以事件序列形状表达）；
 * - type/fill：blur 旧焦点 → element.focus() → 失败则 element.click() 再 focus → 设值
 *   （含 contenteditable 分支）；
 * - drag：new DataTransfer() → pointerover/pointerenter/mousedown/pointerdown → dragstart
 *   （被 preventDefault 则报错并建议改用 browser_evaluate）→ drag → 对 drop 目标派发
 *   dragenter/dragover/drop，坐标取元素几何中心；
 * - 已知局限：合成事件 isTrusted=false，对检测合成事件的站点无效（推断的局限）。
 */

import { MiniElement } from "./dom.ts";

export interface EventRecorder {
  readonly events: Array<{ type: string; target: string }>;
}

function emit(el: MiniElement, type: string, detail?: Record<string, unknown>) {
  const record = el.dispatchEvent({ type, detail });
  return record;
}

function pointerProps(button: string, modifiers: string[]): Record<string, unknown> {
  return { button: button === "right" ? 2 : button === "middle" ? 1 : 0, buttons: 1, modifiers };
}

/** 点击：完整 Pointer/Mouse 序列（§5 click） */
export function synthClick(el: MiniElement, opts: { button?: string; modifiers?: string[]; doubleClick?: boolean; offsetX?: number; offsetY?: number; holdDurationMs?: number } = {}) {
  const button = opts.button ?? "left";
  const modifiers = opts.modifiers ?? [];
  const doOnce = (type: string, extra: Record<string, unknown> = {}) => emit(el, type, { ...pointerProps(button, modifiers), ...opts.offsetX != null ? { offsetX: opts.offsetX } : {}, ...extra });
  doOnce("pointerover");
  doOnce("pointerenter");
  doOnce("pointermove");
  if (opts.holdDurationMs != null && opts.holdDurationMs > 0) {
    // holdDurationMs：按住后释放的形状（长按）
    doOnce("pointerdown");
    doOnce("mousedown");
    doOnce("pointerup", { holdDurationMs: opts.holdDurationMs });
    doOnce("mouseup");
  } else {
    doOnce("pointerdown");
    doOnce("mousedown");
    doOnce("pointerup");
    doOnce("mouseup");
  }
  doOnce("click");
  if (opts.doubleClick) {
    doOnce("pointerdown");
    doOnce("mousedown");
    doOnce("pointerup");
    doOnce("mouseup");
    doOnce("click");
    doOnce("dblclick");
  }
}

/** 设值：blur → focus（失败兜底 click）→ input/change（§5 type/fill） */
export function synthSetValue(el: MiniElement, value: string) {
  emit(el, "blur");
  el.focused = true;
  const focusOk = el.focused;
  if (!focusOk) synthClick(el); // 聚焦失败兜底：先 click 再 focus（§5）
  el.setAttribute("value", value);
  emit(el, "input", { value });
  emit(el, "change", { value });
}

/** 键入：逐字符 keydown/keypress/input/keyup（换行=回车、制表=Tab） */
export function synthType(el: MiniElement, text: string) {
  synthSetValue(el, "");
  el.focused = true;
  let acc = "";
  for (const ch of text) {
    const key = ch === "\n" ? "Enter" : ch === "\t" ? "Tab" : ch;
    emit(el, "keydown", { key });
    if (ch !== "\n" && ch !== "\t") { acc += ch; emit(el, "keypress", { key }); el.setAttribute("value", acc); emit(el, "input", { value: acc }); }
    else emit(el, "input", { key });
    emit(el, "keyup", { key });
  }
}

/** 按键 */
export function synthPressKey(el: MiniElement, key: string) {
  emit(el, "keydown", { key });
  emit(el, "keypress", { key });
  emit(el, "keyup", { key });
}

/** 滚轮/滚动 */
export function synthScroll(el: MiniElement, direction: string, amount: number) {
  emit(el, "wheel", { direction, amount });
  emit(el, "scroll", { direction, amount });
}

/** select：设值 + change（下拉选择） */
export function synthSelectOption(el: MiniElement, values: string[]) {
  el.setAttribute("value", values.join(","));
  emit(el, "input", { values });
  emit(el, "change", { values });
}

/**
 * HTML5 拖拽：完整 DragEvent 链（§5 drag）。
 * dragstart 被 preventDefault → 抛错并建议改用 browser_evaluate。
 */
export function synthDrag(source: MiniElement, target: MiniElement): void {
  const dataTransfer = { items: [] as unknown[], getData: () => "" };
  const props = { dataTransfer, pointerId: 1 };
  emit(source, "pointerover", props);
  emit(source, "pointerenter", props);
  emit(source, "mousedown", props);
  const start = emit(source, "pointerdown", props);
  void start;
  const dragStart = emit(source, "dragstart", props);
  if (dragStart.defaultPrevented) {
    throw new Error("dragstart was prevented by the page; HTML5 drag cannot be synthesized. Use browser_evaluate to perform the action instead.");
  }
  emit(source, "drag", props);
  emit(target, "dragenter", props);
  emit(target, "dragover", props);
  emit(target, "drop", props);
  emit(source, "dragend", props);
  emit(source, "mouseup", props);
  emit(source, "pointerup", props);
}

/** 汇总某元素事件序列里的 type 列表（测试断言用） */
export function eventTypes(el: MiniElement): string[] {
  return el.eventLog.map((e) => e.type);
}
