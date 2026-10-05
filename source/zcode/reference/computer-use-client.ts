/**
 * computer-use-client 风格 SDK —— cleanroom 重构参考实现。
 *
 * 蓝本**行为规格**来自本仓库逆向分册（不复制任何上游代码）：
 * - 双层 API（高层绑定对象 Target 12 成员 + 低层 14 工具逃逸口）：agents/zcode/computer-use.md §3.1–§3.3
 * - getApp 绑定流程（字段猜测/备用重试、绑定即隐藏观察、身份收敛、窗口钉住校验、
 *   不可枚举 elements()）：§3.4
 * - 观察机制（diff 基线台账 tree_shown_to_model、state_id 台账、FrameRegistry、效果证据）：§4
 * - 动作机制（a11y/event 双路径、keysym 归一、selectText 本地消歧）：§5
 * - 安全模型（possibly_sent 防重放、CONTROLLER_BUSY、kill switch、子代理禁用、fail-closed）：§6
 * - 错误码全景与 retry 推导：§7
 *
 * 运行环境：Node ≥ 22.6（原生 type-stripping，无需编译）。零外部依赖。
 */

// ---------------------------------------------------------------------------
// 桥接器：node-repl 宿主注入 Worker 全局的对象（分册 §2.2）
// ---------------------------------------------------------------------------

export const BRIDGE_SYMBOL = Symbol.for("zcode.node-repl.computer-use-bridge");

export interface CuaBridge {
  call(method: string, args: unknown): Promise<any>;
  generation: number;
  assertAvailable(): void;
  documentationRoot?: string;
}

/** 14 个存活工具（agents/zcode/evidence/inventory.md §2.2） */
export const COMPUTER_METHOD_NAMES: readonly string[] = Object.freeze([
  "list_apps", "list_windows", "get_app_state",
  "left_click", "scroll", "left_click_drag",
  "type", "set_value", "select_text", "key",
  "perform_action", "paste",
  "request_access", "stop_computer_control",
]);

// ---------------------------------------------------------------------------
// 错误模型（分册 §6.3、§7、evidence §2.3）
// ---------------------------------------------------------------------------

/** 永不重试的错误码 */
export const NEVER_RETRY_CODES: ReadonlySet<string> = new Set([
  "CONTROLLER_BUSY", "CONTROL_STOPPED", "PERMISSION_DENIED", "NOT_AUTHORIZED",
  "VERSION_MISMATCH", "ACTION_UNAVAILABLE", "NOT_SETTABLE", "NOT_SELECTABLE",
]);
/** 只许「先观察再决定」的错误码 */
export const REOBSERVE_CODES: ReadonlySet<string> = new Set([
  "ELEMENT_UNAVAILABLE", "STALE_STATE", "STRUCTURED_STATE_UNAVAILABLE",
]);

/**
 * broker 码 → SDK 码映射。分册点名了 7 条（evidence §2.3）；
 * 其余为参考实现的同形补全（上游完整 16 项映射表未逐项披露，标注为推断）。
 * 未知 broker 码一律 INTERNAL——绝不静默成功（分册 §7）。
 */
export const ERROR_CODE_BY_BROKER: Record<string, string> = {
  permission_denied: "PERMISSION_DENIED",
  controller_busy: "CONTROLLER_BUSY",
  broker_unavailable: "HELPER_UNAVAILABLE",
  stale_socket: "HELPER_UNAVAILABLE",
  unimplemented: "ACTION_UNAVAILABLE",
  method_not_found: "INTERNAL",
  invalid_request: "INVALID_APP",
  // ---- 参考实现补全（推断）----
  app_not_found: "APP_NOT_FOUND",
  ambiguous_app: "AMBIGUOUS_APP",
  launch_failed: "LAUNCH_FAILED",
  element_unavailable: "ELEMENT_UNAVAILABLE",
  stale_state: "STALE_STATE",
  not_settable: "NOT_SETTABLE",
  not_selectable: "NOT_SELECTABLE",
  foreground_required: "FOREGROUND_REQUIRED",
  control_stopped: "CONTROL_STOPPED",
  screen_locked: "SCREEN_LOCKED",
  timeout: "TIMEOUT",
  version_mismatch: "VERSION_MISMATCH",
  stale_frame: "STALE_STATE", // 帧过期/被替换/非可动作：fail-closed（§6.5）
};

export type RetryHint = "reobserve" | "retry" | "never";

export class ComputerUseError extends Error {
  code: string;
  /** 默认 false 是故意的保守方向（evidence §2.3） */
  actionSent = false;
  dispatchStatus?: string;
  details: Record<string, unknown>;
  retry: RetryHint;

  constructor(init: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    actionSent?: boolean;
    dispatchStatus?: string;
  }) {
    super(init.message);
    this.name = "ComputerUseError";
    this.code = init.code;
    this.actionSent = init.actionSent ?? false;
    this.dispatchStatus = init.dispatchStatus;
    this.details = Object.freeze({ method: init.details?.method, ...(init.details ?? {}) });
    // retry 推导公式：agents/zcode/evidence/inventory.md §2.3
    this.retry = this.actionSent
      ? "reobserve"
      : NEVER_RETRY_CODES.has(init.code)
        ? "never"
        : REOBSERVE_CODES.has(init.code)
          ? "reobserve"
          : "retry";
  }
}

// Helper 冷启动契约（evidence §2.4）
const NOT_READY_KIND = "CUA_NOT_READY";
const NOT_READY_MAX_ATTEMPTS = 6;
const NOT_READY_BACKOFF_MS = [250, 500, 750, 1000, 1500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 杂项：目标/键归一/文本范围
// ---------------------------------------------------------------------------

export interface ElementTarget { type: "element"; index: number }
export interface CoordinateTarget { type: "coordinate"; x: number; y: number; frame_id?: number }
export type ActionTarget = ElementTarget | CoordinateTarget;

function looksLikeBundleId(s: string): boolean {
  // 「含点且无空格/斜杠」——agents/zcode/computer-use.md §3.4
  return typeof s === "string" && s.includes(".") && !s.includes(" ") && !s.includes("/");
}

function normalizeTarget(t: ActionTarget | number, frameId: number | null): ActionTarget {
  if (typeof t === "number") return { type: "element", index: t };
  if (t.type === "coordinate") {
    return { type: "coordinate", x: t.x, y: t.y, ...(t.frame_id != null ? { frame_id: t.frame_id } : frameId != null ? { frame_id: frameId } : {}) };
  }
  return { type: "element", index: t.index };
}

/** keysym 别名归一（§3.3 pressKey 备注：enter→return、super→cmd、Control_L→ctrl…） */
export function normalizeKeyChord(chord: string): string {
  const ALIAS: Record<string, string> = {
    enter: "return", escape: "escape", esc: "escape",
    super: "cmd", win: "cmd", meta: "cmd",
    control_l: "ctrl", control_r: "ctrl", ctrl_l: "ctrl",
    alt_l: "alt", alt_r: "alt", option: "alt", option_l: "alt",
    shift_l: "shift", shift_r: "shift",
  };
  return chord
    .split("+")
    .map((k) => ALIAS[k.toLowerCase()] ?? k.toLowerCase())
    .join("+");
}

function dirAlias(d: string): string {
  const m: Record<string, string> = { u: "up", d: "down", l: "left", r: "right" };
  return m[d] ?? d; // scroll 的 dir 接受 u/d/l/r 缩写（§3.3）
}

/**
 * selectText 的本地文本范围解析（§3.2/§3.3：内容匹配、prefix/suffix 消歧、
 * 多义即抛 NOT_SELECTABLE 并报候选数）。
 */
export function resolveTextRange(
  value: string,
  text: string,
  opts: { prefix?: string; suffix?: string; selectionType?: "text" | "cursor_before" | "cursor_after" } = {},
): { range: [number, number]; candidates: number } {
  const starts: number[] = [];
  let i = value.indexOf(text);
  while (i !== -1) { starts.push(i); i = value.indexOf(text, i + 1); }
  let hits = starts;
  if (opts.prefix != null) hits = hits.filter((s) => value.slice(Math.max(0, s - opts.prefix!.length), s) === opts.prefix);
  if (opts.suffix != null) hits = hits.filter((s) => value.slice(s + text.length, s + text.length + opts.suffix!.length) === opts.suffix);
  if (hits.length !== 1) {
    const err = new ComputerUseError({
      code: "NOT_SELECTABLE",
      message: `text ${JSON.stringify(text)} matches ${hits.length} candidates; disambiguate with prefix/suffix`,
      details: { candidates: hits.length },
    });
    (err as any).candidates = hits.length;
    throw err;
  }
  const start = hits[0];
  const sel = opts.selectionType ?? "text";
  if (sel === "cursor_before") return { range: [start, 0], candidates: 1 };
  if (sel === "cursor_after") return { range: [start + text.length, 0], candidates: 1 };
  return { range: [start, text.length], candidates: 1 };
}

// ---------------------------------------------------------------------------
// 会话：桥接调用 + not-ready 重试 + 错误映射（分册 §2.2、§6.3、§7）
// ---------------------------------------------------------------------------

class CuaSession {
  private bridge: CuaBridge;
  private opts: { backoffMs?: number[] };
  private generationAtSetup: number;

  constructor(bridge: CuaBridge, opts: { backoffMs?: number[] } = {}) {
    this.bridge = bridge;
    this.opts = opts;
    this.generationAtSetup = bridge.generation;
  }

  private assertAvailable() {
    // 双重校验：generation 匹配（防 kernel 复用旧绑定）+ 子代理禁用（§2.2、§6.6）
    this.bridge.assertAvailable();
    if (this.bridge.generation !== this.generationAtSetup) {
      throw new ComputerUseError({
        code: "STALE_STATE",
        message: "Computer Use binding is stale after kernel reset; re-run setupComputerUseRuntime and rebind",
        details: { method: "bridge" },
      });
    }
  }

  /** 单次工具调用：CUA_NOT_READY 按退避原样重试（最多 6 次），错误映射为 ComputerUseError */
  async call(method: string, args: Record<string, unknown> = {}): Promise<any> {
    const backoff = this.opts.backoffMs ?? NOT_READY_BACKOFF_MS;
    for (let attempt = 0; ; attempt++) {
      this.assertAvailable();
      const res = await this.bridge.call(method, args);
      if (res && res.ok === false) throw this.toError(res.error, method);
      const result = res && res.ok === true ? res.result : res;
      if (result && typeof result === "object" && result.kind === NOT_READY_KIND) {
        // 非 error 信封的冷启动信号：retryable 才重试；绝不与 possibly_sent 混淆（evidence §2.4）
        if (result.retryable === false || attempt >= Math.min(NOT_READY_MAX_ATTEMPTS, backoff.length + 1) - 1) {
          throw new ComputerUseError({
            code: "HELPER_UNAVAILABLE",
            message: `Helper is not ready (${result.reasonCode ?? "unknown"}); retry after a brief wait`,
            details: { method, reasonCode: result.reasonCode ?? null },
          });
        }
        await sleep(backoff[Math.min(attempt, backoff.length - 1)]);
        continue; // 原样重放同一调用
      }
      return result;
    }
  }

  private toError(brokerErr: any, method: string): ComputerUseError {
    const brokerCode = String(brokerErr?.code ?? "unknown");
    let code = ERROR_CODE_BY_BROKER[brokerCode] ?? "INTERNAL";
    // 响应丢失被显式建模：参考实现给独立 SDK 码（上游确切码未证实，语义见 §6.3）
    if (brokerCode === "broker_response_ambiguous") code = "BROKER_RESPONSE_AMBIGUOUS";
    const d = brokerErr?.details ?? {};
    const dstat = (d.request_delivery_state ?? d.dispatch_status) as string | undefined;
    return new ComputerUseError({
      code,
      message: String(brokerErr?.message ?? brokerCode),
      details: { method, brokerCode, ...(d.owner != null ? { owner: d.owner } : {}) },
      actionSent: dstat === "possibly_sent",
      dispatchStatus: dstat,
    });
  }
}

// ---------------------------------------------------------------------------
// 绑定对象 App（Target 12 成员 + paste；分册 §3.3、§4、§5）
// ---------------------------------------------------------------------------

interface ElementRow {
  index: number; kind: string; name: string; value?: string;
  pressable?: boolean; editable?: boolean; focused?: boolean; actions?: string[];
}

function fingerprint(elements: ElementRow[] | null): string | null {
  if (!elements) return null;
  return elements.map((e) => `${e.index}:${e.kind}:${e.name}:${e.value ?? ""}`).join("|");
}

function validateStructuredState(result: any) {
  // 观察收据缺任一关键字段 → STRUCTURED_STATE_UNAVAILABLE，禁止从散文猜（§6.5）
  const missing = ["state_id", "elements", "app", "window"].filter((k) => result?.[k] === undefined);
  if (missing.length) {
    throw new ComputerUseError({
      code: "STRUCTURED_STATE_UNAVAILABLE",
      message: `structured state is missing required fields: ${missing.join(", ")}`,
      details: { method: "get_app_state", missing },
    });
  }
}

export interface ObserveOptions { disableDiffing?: boolean }

export class App {
  /** 收敛后的身份（pid/bundle_id/window_id）——测试与调试用 */
  readonly appRef: { pid: number; bundle_id: string; window_id?: number };
  stateId: string | null = null;
  frameId: number | null = null;
  treeSeen = false;
  /** 与 treeSeen 分工：treeSeen 管 diff 基线（模型见没见过树），本字段管「有没有可作索引依据的观察」 */
  private lastObservedAt = false;

  private session: CuaSession;

  constructor(session: CuaSession, appRef: App["appRef"]) {
    this.session = session;
    this.appRef = appRef;
  }

  private lastElements: ElementRow[] | null = null;
  private pendingEffectFingerprint: string | null = null;

  /** 观察核心：负责 diff 台账不变量与效果证据（§4.1–§4.2） */
  private async observe(opts: { yieldsTree?: boolean; includeScreenshot?: boolean; disableDiffing?: boolean } = {}) {
    const yieldsTree = opts.yieldsTree !== false;
    const args: Record<string, unknown> = { app_ref: { ...this.appRef } };
    // SDK 不变量（§4.1）：本 cell 还没给模型看过树 → 强制整树
    if (yieldsTree && this.treeSeen !== true) args.disable_diffing = true;
    if (opts.disableDiffing) args.disable_diffing = true;
    // 只截图的观察不能把自己算成基线（§4.1）
    if (!yieldsTree) args.tree_shown_to_model = false;
    if (opts.includeScreenshot) args.include_screenshot = true;

    const result = await this.session.call("get_app_state", args);
    validateStructuredState(result);
    // 窗口钉住校验：Helper 静默降级 → STALE_STATE，不信 note（§3.4/§6.5）
    if (result.window?.window_id_fallback === true) {
      throw new ComputerUseError({
        code: "STALE_STATE",
        message: "Helper silently fell back to the frontmost window (window_id_fallback); refusing to bind",
        details: { method: "get_app_state" },
      });
    }
    if (yieldsTree) { this.stateId = result.state_id; this.treeSeen = true; }
    if (result.image_ref?.frame_id != null) this.frameId = result.image_ref.frame_id;
    this.lastElements = result.elements ?? null;

    // 效果证据寄存取出：AX 受理但界面逐字节未变 → 显式标注（§4.2）
    let text: string = result.text ?? "";
    if (yieldsTree && this.pendingEffectFingerprint !== null) {
      if (fingerprint(this.lastElements) === this.pendingEffectFingerprint) {
        text = "[effect_evidence unchanged]\n" + text;
      }
      this.pendingEffectFingerprint = null;
    }
    this.lastObservedAt = true;
    return { text, result };
  }

  /** 动作核心：成功后寄存动作前指纹，供下一次观察比较 */
  private async action(method: string, args: Record<string, unknown>) {
    const result = await this.session.call(method, { app_ref: { ...this.appRef }, ...args });
    this.pendingEffectFingerprint = fingerprint(this.lastElements);
    return result;
  }

  /** 元素索引目标要求新鲜观察（§6.5：无新鲜观察 → STALE_STATE） */
  private ensureFreshForElementTarget(t: ActionTarget | number) {
    const norm = normalizeTarget(t as any, this.frameId);
    if (norm.type === "element" && !this.lastObservedAt) {
      // §6.5：元素索引解析时无新鲜观察 → STALE_STATE（SKILL 纪律：先观察再动作）
      throw new ComputerUseError({
        code: "STALE_STATE",
        message: "element index requires a fresh observation; call getAXState() first",
        details: { method: "element target" },
      });
    }
  }

  // ---- Target 12 成员（§3.3） ----

  /** 观察并返回树文本（模型面负责展示；此处返回字符串） */
  async getAXState(options: ObserveOptions = {}): Promise<string> {
    const { text } = await this.observe({ disableDiffing: options.disableDiffing });
    return text;
  }

  /** 返回窗口栅格 PNG；失败时错误信息带原因并禁止模型抢焦点（§3.3） */
  async getScreenshot(_options: ObserveOptions = {}): Promise<Uint8Array> {
    const { result } = await this.observe({ yieldsTree: false, includeScreenshot: true });
    const ref = result.image_ref;
    if (!ref || ref.actionable !== true) {
      throw new ComputerUseError({
        code: "SCREENSHOT_UNAVAILABLE", // 参考实现建模的码；上游为「带原因的类型化错误」（§3.3）
        message: `screenshot unavailable: ${result.non_actionable_reason ?? "no actionable frame"}. Do not activate the app; use the accessibility path instead.`,
        details: { method: "get_app_state" },
      });
    }
    return result.screenshot_bytes ?? new Uint8Array();
  }

  /** 两开观察；失图时附标注静默丢图修复（§3.3） */
  async getAXStateAndScreenshot(options: ObserveOptions = {}): Promise<{ state: string; screenshot?: Uint8Array }> {
    const { text, result } = await this.observe({ includeScreenshot: true, disableDiffing: options.disableDiffing });
    const ref = result.image_ref;
    if (!ref || ref.actionable !== true) {
      return { state: `${text}\n[screenshot unavailable: ${result.non_actionable_reason ?? "no actionable frame"}]` };
    }
    return { state: text, screenshot: result.screenshot_bytes ?? new Uint8Array() };
  }

  /** 不可枚举逃逸口：静默观察拿回元素表（含被裁剪行）；观察不展示 → 强制下次整树（§3.3/§4.1） */
  async elements(): Promise<ElementRow[]> {
    const { result } = await this.observe({ yieldsTree: false });
    this.treeSeen = false; // 静默观察清台账：下次观察强制整树
    return result.elements ?? [];
  }

  async click(target: ActionTarget | number, opts: {
    mouseButton?: "left" | "right" | "middle"; clickCount?: number;
    modifiers?: string; strategy?: "auto" | "event"; return_state?: string;
  } = {}) {
    this.ensureFreshForElementTarget(target);
    return this.action("left_click", {
      target: normalizeTarget(target as any, this.frameId),
      ...(opts.mouseButton ? { mouse_button: opts.mouseButton } : {}),
      ...(opts.clickCount ? { click_count: opts.clickCount } : {}),
      ...(opts.modifiers ? { modifiers: opts.modifiers } : {}),
      ...(opts.strategy ? { strategy: opts.strategy } : {}),
      ...(opts.return_state ? { return_state: opts.return_state } : {}),
    });
  }

  async drag(from: ActionTarget | number, to: ActionTarget | number, opts: { modifiers?: string } = {}) {
    this.ensureFreshForElementTarget(from);
    this.ensureFreshForElementTarget(to);
    return this.action("left_click_drag", {
      from_target: normalizeTarget(from as any, this.frameId),
      to: normalizeTarget(to as any, this.frameId),
      ...(opts.modifiers ? { modifiers: opts.modifiers } : {}),
    });
  }

  async pressKey(key: string, opts: { repeat?: number; holdSeconds?: number; strategy?: "auto" | "event" } = {}) {
    return this.action("key", {
      text: normalizeKeyChord(key),
      ...(opts.repeat != null ? { repeat: opts.repeat } : {}),
      ...(opts.holdSeconds != null ? { hold_seconds: opts.holdSeconds } : {}),
      ...(opts.strategy ? { strategy: opts.strategy } : {}),
    });
  }

  async scroll(target: ActionTarget | number, direction: string, pages = 1, opts: { strategy?: "auto" | "event" } = {}) {
    this.ensureFreshForElementTarget(target);
    return this.action("scroll", {
      target: normalizeTarget(target as any, this.frameId),
      scroll_direction: dirAlias(direction),
      scroll_amount: Math.max(0, Math.min(100, pages)),
      ...(opts.strategy ? { strategy: opts.strategy } : {}),
    });
  }

  async selectText(index: number, text: string, opts: {
    prefix?: string; suffix?: string; selectionType?: "text" | "cursor_before" | "cursor_after";
  } = {}) {
    if (!this.lastObservedAt) {
      throw new ComputerUseError({ code: "STALE_STATE", message: "selectText requires a fresh observation", details: { method: "select_text" } });
    }
    const el = this.lastElements?.find((e) => e.index === index);
    if (!el || !el.editable) {
      throw new ComputerUseError({ code: "NOT_SELECTABLE", message: `element ${index} is not a selectable text field`, details: { method: "select_text" } });
    }
    const { range } = resolveTextRange(el.value ?? "", text, opts);
    return this.action("select_text", { target: { type: "element", index }, text_range: range });
  }

  async setValue(index: number, value: string) {
    if (!this.lastObservedAt) {
      throw new ComputerUseError({ code: "STALE_STATE", message: "setValue requires a fresh observation", details: { method: "set_value" } });
    }
    // 本地乐观更新：selectText 的内容匹配依据「最新已知值」（§3.3 本地算 range 的前提）
    const cached = this.lastElements?.find((e) => e.index === index);
    if (cached) cached.value = value;
    return this.action("set_value", { target: { type: "element", index }, value });
  }

  async typeText(text: string) {
    return this.action("type", { text });
  }

  /** action 不在元素广告列表 → 本地直接抛 ACTION_UNAVAILABLE，不发 wire（§3.3） */
  async performSecondaryAction(index: number, action: string) {
    if (!this.lastObservedAt) {
      throw new ComputerUseError({ code: "STALE_STATE", message: "performSecondaryAction requires a fresh observation", details: { method: "perform_action" } });
    }
    const el = this.lastElements?.find((e) => e.index === index);
    if (!el || !(el.actions ?? []).includes(action)) {
      throw new ComputerUseError({
        code: "ACTION_UNAVAILABLE",
        message: `action ${JSON.stringify(action)} is not advertised by element ${index} (advertised: ${(el?.actions ?? []).join("|") || "none"})`,
        details: { method: "perform_action" },
      });
    }
    return this.action("perform_action", { target: { type: "element", index }, action });
  }

  async paste(text: string, opts: { format?: "text" | "md" | "html" } = {}) {
    return this.action("paste", { text, ...(opts.format ? { format: opts.format } : {}) });
  }
}

// ---------------------------------------------------------------------------
// getApp 绑定流程（§3.4）
// ---------------------------------------------------------------------------

function alternateAppRef(ref: Record<string, unknown>): Record<string, unknown> | null {
  // 猜错字段时换字段重试一次：bundle_id ↔ name ↔ app_path（§3.4）
  if (ref.bundle_id != null) return { name: ref.bundle_id };
  if (ref.name != null && looksLikeBundleId(ref.name)) return { bundle_id: ref.name };
  if (ref.app_path != null) return { name: String(ref.app_path) };
  return null;
}

async function bindObserve(session: CuaSession, ref: Record<string, unknown>): Promise<any> {
  // 绑定即观察一次：全量但不展示、不进台账、不占 diff 基线（§3.4）
  const result = await session.call("get_app_state", { app_ref: ref, disable_diffing: true, tree_shown_to_model: false });
  validateStructuredState(result);
  if (result.window?.window_id_fallback === true) {
    throw new ComputerUseError({
      code: "STALE_STATE",
      message: "Helper silently fell back to the frontmost window; refusing to bind",
      details: { method: "get_app_state" },
    });
  }
  return result;
}

async function getApp(session: CuaSession, target: string | Record<string, unknown>): Promise<App> {
  const ref0 = typeof target === "string"
    ? (looksLikeBundleId(target) ? { bundle_id: target } : { name: target })
    : { ...target };
  let result: any;
  try {
    result = await bindObserve(session, ref0);
  } catch (e) {
    // 备用字段重试：仅当错误文本匹配语义核心且未 actionSent（§3.4）
    if (e instanceof ComputerUseError && !e.actionSent && /target app is not running/u.test(e.message)) {
      const alt = alternateAppRef(ref0);
      if (alt) result = await bindObserve(session, alt);
      else throw e;
    } else {
      throw e;
    }
  }
  // 身份收敛：本地化名/模糊名只在第一跳解决（§3.4、§5.2）
  const appRef: App["appRef"] = {
    pid: result.app.pid,
    bundle_id: result.app.bundle_id,
    ...(result.window?.window_id != null ? { window_id: result.window.window_id } : {}),
  };
  const app = new App(session, appRef);
  app.treeSeen = false; // 绑定观察不进模型台账
  // elements() 是原型方法 → 对 Object.keys 不可见（§8 R2：Target 可枚举附加成员数必须为 0）
  return app;
}

// ---------------------------------------------------------------------------
// 运行时装配（§10 实操样例）
// ---------------------------------------------------------------------------

export interface SetupOptions {
  globals: Record<string, any>;
  bridge: CuaBridge;
  /** 测试注入：把 not-ready 退避压成 0ms */
  backoffMs?: number[];
}

/**
 * 把 `agent.computerUse`（SDK）装配到给定 globals 上。
 * 真实产品经 BRIDGE_SYMBOL 从 Worker 全局取桥接器；本参考实现允许显式注入，
 * 便于用 mock broker 跑闭环自测。
 */
export function setupComputerUseRuntime(options: SetupOptions) {
  const { globals, bridge } = options;
  if (!bridge || typeof bridge.call !== "function") {
    throw new Error("Computer Use runtime bridge is unavailable");
  }
  const session = new CuaSession(bridge, { backoffMs: options.backoffMs });

  // 低层逃逸口：14 个工具的透传（§3.1「逃逸口」）
  const computer = Object.freeze(
    Object.fromEntries(COMPUTER_METHOD_NAMES.map((m) => [m, (args: Record<string, unknown> = {}) => session.call(m, args)])),
  );

  const agentComputerUse = {
    /** list_apps 展示版 */
    getState: async () => (await session.call("list_apps", {})).apps,
    getApp: (target: string | Record<string, unknown>) => getApp(session, target),
    listApps: () => session.call("list_apps", {}),
    computer,
    requestAccess: (capabilities?: Record<string, unknown>) => session.call("request_access", { capabilities }),
    stop: (reason?: string) => session.call("stop_computer_control", { reason }),
  };
  // 未文档化的窗口绑定入口：不可枚举（§3.3）
  Object.defineProperty(agentComputerUse, "getWindow", {
    value: (target: Record<string, unknown>, windowId: number) => getApp(session, { ...target, window_id: windowId }),
    enumerable: false,
  });

  (globals.agent ??= {});
  globals.agent.computerUse = agentComputerUse;
  return agentComputerUse;
}
