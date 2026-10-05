/**
 * 内存 mock broker —— 模拟 ZCode CUA 链路中「宿主工具层（node-repl-host）+ Helper」
 * 两层的**可观察行为**，供 reference/computer-use-client.ts 的 cleanroom 重构做自测。
 *
 * 本文件是参考实现，不含任何上游代码；行为规格全部来自本仓库逆向分册：
 * - 14 工具面 / tier 分层 / MCP annotations：agents/zcode/computer-use.md §3.2、
 *   agents/zcode/evidence/inventory.md §2.10
 * - kill switch 闩锁与两豁免（request_access / stop_computer_control）：§6.4
 * - CONTROLLER_BUSY 控制器租约（永不重试，details.owner）：§6.3
 * - CUA_NOT_READY 冷启动契约（retryable 且非 possibly_sent 才重试）：§6.3、evidence §2.4
 * - broker_response_ambiguous（响应丢失，retryable=false）：§6.3、evidence §2.9
 * - FrameRegistry（16 帧 + 墓碑 + latestActionableFrameId 隐式绑定）：§4.2
 * - snapshotCache diff 基线（Helper 管「数据有没有变」）：§4.1
 * - 坐标点击归一为「窗口相对派发」：§5.1
 * - 子代理禁用（runtime_scope=subagent 直接抛错）：§6.6
 */

export interface SimElement {
  id: string;
  index: number;
  kind: string;
  name: string;
  value?: string;
  pressable?: boolean;
  editable?: boolean;
  focused?: boolean;
  actions?: string[];
}

export interface WireError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface MockBackendOptions {
  sessionId?: string;
  runtimeScope?: "main" | "subagent";
}

const T1_INPUT = new Set([
  "left_click", "scroll", "left_click_drag", "type",
  "set_value", "select_text", "key", "perform_action", "paste",
]);
const KILL_SWITCH_EXEMPT = new Set(["request_access", "stop_computer_control"]);

const BROKER_RESPONSE_AMBIGUOUS_MESSAGE =
  "The Helper may have accepted this action, but its response was lost. " +
  "Do not replay it automatically; observe the target state first.";

function signature(elements: SimElement[]): string {
  // Helper 侧 diff 基线：上次捕获的元素签名（id/kind/name/value 足以判定变化）
  return elements
    .map((e) => `${e.id}:${e.kind}:${e.name}:${e.value ?? ""}`)
    .join("\n");
}

export function createMockCuaBackend(options: MockBackendOptions = {}) {
  // ---------- 模拟的 macOS 世界（Helper 持有） ----------
  const app = { pid: 4127, name: "备忘录", bundle_id: "com.apple.Notes" };
  const windowInfo = { window_id: 8613, title: "备忘录" };
  let elementSeq = 0;
  let elements: SimElement[] = [];
  let noteSeq = 0;
  let stateSeq = 0;
  let frameSeq = 0;
  let lastCapture: string | null = null; // Helper 的 snapshotCache(pid, window) 语义
  let foreground = true;
  let windowFallback = false;

  function seedTree() {
    elements = [];
    noteSeq = 0;
    addElement({ kind: "button", name: "新建", pressable: true, actions: ["AXPress"] });
    addElement({ kind: "button", name: "分享", pressable: true, actions: ["AXPress"] });
    addElement({ kind: "textfield", name: "搜索", editable: true, value: "" });
    addElement({ kind: "textArea", name: "正文", editable: true, value: "", actions: ["AXConfirm"] });
    lastCapture = null;
  }
  function addElement(spec: Omit<SimElement, "id" | "index">): SimElement {
    const el: SimElement = { id: `el-${++elementSeq}`, index: elements.length, ...spec };
    elements.push(el);
    reindex();
    return el;
  }
  function reindex() {
    elements.forEach((e, i) => (e.index = i));
  }

  function renderLine(el: SimElement): string {
    const flags = [
      el.pressable ? "pressable" : "",
      el.editable ? "editable" : "",
      el.focused ? "focused" : "",
    ].filter(Boolean).join(",");
    const val = el.value !== undefined && el.value !== "" ? ` value=${JSON.stringify(el.value)}` : "";
    const acts = el.actions && el.actions.length ? ` actions=${el.actions.join("|")}` : "";
    return `${el.index} ${el.kind} name=${JSON.stringify(el.name)}${val}${flags ? " " + flags : ""}${acts}`;
  }

  // ---------- FrameRegistry（宿主侧，evidence §2.x / 分册 §4.2） ----------
  const frames = new Map<number, { pid: number; window_id: number }>();
  const tombstones = new Set<number>();
  let latestActionableFrameId: number | null = null;

  // ---------- 会话状态（宿主工具层持有） ----------
  let stopped = false;
  let stopReason: string | null = null;
  let busyOwner: string | null = null;
  let notReadyRemaining = 0;
  let nextDispatchStatus = "sent";
  const faultQueue: WireError[] = [];
  let generation = 1;
  const calls: Array<{ method: string; input: any }> = [];

  function resolveAppRef(appRef: any): WireError | null {
    if (!appRef || typeof appRef !== "object") {
      return { code: "invalid_request", message: "app_ref is required" };
    }
    if (appRef.pid != null && Number(appRef.pid) !== app.pid) {
      return { code: "app_not_found", message: `The target app is not running (pid ${appRef.pid}).` };
    }
    if (appRef.bundle_id != null && appRef.bundle_id !== app.bundle_id) {
      return { code: "app_not_found", message: "The target app is not running." };
    }
    if (appRef.app_path != null && !appRef.app_path.includes("Notes")) {
      return { code: "app_not_found", message: "The target app is not running." };
    }
    // name 严格匹配显示名；bundle-id 串冒充 name 时同样报「not running」——
    // 这正是 SDK「身份收敛」要修的「观察宽容/输入严格」事故面（分册 §3.4）
    if (appRef.name != null && appRef.name !== app.name) {
      return { code: "app_not_found", message: "The target app is not running." };
    }
    return null;
  }

  function observeResult(input: any) {
    const err = resolveAppRef(input.app_ref);
    if (err) return { error: err };
    const full = input.disable_diffing === true || lastCapture === null;
    let text: string;
    if (full) {
      text = ["# full tree", ...elements.map(renderLine)].join("\n");
    } else {
      const prev = new Set((lastCapture as string).split("\n"));
      const changed = elements.filter((e) => !prev.has(`${e.id}:${e.kind}:${e.name}:${e.value ?? ""}`));
      text = ["# diff", ...changed.map(renderLine)].join("\n");
    }
    lastCapture = signature(elements);
    const result: any = {
      state_id: `st-${++stateSeq}`,
      app: { pid: app.pid, bundle_id: app.bundle_id, name: app.name },
      window: {
        window_id: windowInfo.window_id,
        title: windowInfo.title,
        ...(windowFallback ? { window_id_fallback: true, note: "window could not be resolved; fell back to frontmost" } : {}),
      },
      elements: elements.map((e) => ({ ...e })),
      text,
    };
    if (input.include_screenshot === true) {
      const frameId = ++frameSeq;
      // 同窗口新栅格产生 → 旧「最新可动作帧」被替换进墓碑（§4.2 latestActionableFrameId 语义）
      if (latestActionableFrameId != null) {
        frames.delete(latestActionableFrameId);
        tombstones.add(latestActionableFrameId);
      }
      frames.set(frameId, { pid: app.pid, window_id: windowInfo.window_id });
      if (frames.size > 16) {
        const oldest = frames.keys().next().value as number;
        frames.delete(oldest);
        tombstones.add(oldest);
      }
      latestActionableFrameId = frameId;
      if (foreground) {
        result.image_ref = { frame_id: frameId, width: 1280, height: 800, actionable: true };
      } else {
        // 隐藏（⌘H）窗口：macOS 不渲染 → 栅格 fail-closed（§4.3）
        result.non_actionable_reason = "window is hidden; no surface is rendered";
      }
    }
    return { result };
  }

  function findTarget(input: any, target: any): { el?: SimElement; error?: WireError } {
    if (target?.type === "element") {
      const el = elements.find((e) => e.index === target.index);
      if (!el) return { error: { code: "element_unavailable", message: `Element ${target.index} is no longer present in the latest accessibility tree.` } };
      return { el };
    }
    if (target?.type === "coordinate") {
      const fid = target.frame_id ?? latestActionableFrameId;
      if (fid == null || !frames.has(fid) || tombstones.has(fid)) {
        return { error: { code: "stale_frame", message: "frame is stale, replaced, or not actionable (action_sent=false)" } };
      }
      const frame = frames.get(fid)!;
      // app_ref（调用级参数）与帧真实 owner 不一致 → 拒派发（§6.5 fail-closed 清单）
      if (input?.app_ref?.pid != null && frame.pid !== input.app_ref.pid) {
        return { error: { code: "frame_dispatch_identity_mismatch", message: "app_ref does not own the referenced frame" } };
      }
      return {}; // 坐标命中即视为对窗口派发
    }
    return { error: { code: "invalid_request", message: "target must be {type:'element',index} or {type:'coordinate',x,y}" } };
  }

  function pressEffect(el: SimElement) {
    if (el.name === "新建") {
      addElement({ kind: "staticText", name: `未命名笔记 ${++noteSeq}` });
    }
    // 「分享」按钮：AX 受理但界面不变 —— 供效果证据（[effect_evidence unchanged]）测试
  }

  function dispatch(method: string, input: any): { result?: any; error?: WireError } {
    calls.push({ method, input });

    // CUA_NOT_READY 冷启动：producer 返回**非 error** 结果（evidence §2.4）
    if (notReadyRemaining > 0) {
      notReadyRemaining -= 1;
      return { result: { kind: "CUA_NOT_READY", reasonCode: "broker_not_accepting", retryable: true } };
    }
    // 一次性故障注入（测试用）
    const fault = faultQueue.shift();
    if (fault) return { error: fault };

    // kill switch：任何 backend 读取之前 fail-hard（§6.4），两豁免除外
    if (stopped && !KILL_SWITCH_EXEMPT.has(method)) {
      return { error: { code: "control_stopped", message: `Computer control is stopped (${stopReason ?? "no reason given"}).` } };
    }
    // 控制器租约：另一会话持有输入时，动作类返回 CONTROLLER_BUSY（§6.3）
    if (busyOwner !== null && T1_INPUT.has(method)) {
      return { error: { code: "controller_busy", message: "Another controller owns the input lease.", details: { owner: busyOwner } } };
    }

    switch (method) {
      case "list_apps":
        return { result: { apps: [{ pid: app.pid, name: app.name, bundle_id: app.bundle_id, active: foreground }] } };

      case "list_windows":
        if (resolveAppRef(input.app_ref)) return { error: { code: "app_not_found", message: "The target app is not running." } };
        return {
          result: {
            windows: [{
              window_id: windowInfo.window_id, owner_pid: app.pid, title: windowInfo.title,
              subrole: "AXStandardWindow", text_preview: "", bounds: [0, 0, 1280, 800],
              main: true, focused: true, onscreen: foreground, index: 0,
            }],
          },
        };

      case "get_app_state":
        return observeResult(input);

      case "request_access":
        return { result: { ready: true, accessibility: "granted", screenRecording: "granted" } };

      case "stop_computer_control":
        if (!stopped) { stopped = true; stopReason = input?.reason ?? null; } // 闩锁保留第一个 reason
        return { result: { dispatch_status: "sent", stopped: true } };
    }

    // ---- T1_INPUT 动作类 ----
    if (T1_INPUT.has(method)) {
      if (input.strategy === "event" && !foreground) {
        // event 策略要求目标 app 已在最前——永不主动激活（§5.1）
        return { error: { code: "foreground_required", message: "event strategy requires the target app to be frontmost; nothing was sent" } };
      }
      if (method === "paste" && !foreground) {
        return { error: { code: "foreground_required", message: "paste uses the system pasteboard and requires a foreground app" } };
      }

      if (method === "left_click" || method === "left_click_drag" || method === "scroll" ||
          method === "type" || method === "set_value" || method === "select_text" ||
          method === "key" || method === "perform_action" || method === "paste") {
        if (resolveAppRef(input.app_ref) && input.app_ref) {
          // 动作路径按身份严格匹配（§5.2 身份收敛动机）
          return { error: { code: "app_not_found", message: "The target app is not running." } };
        }
      }

      // 需要 target 的方法先解析目标；type/key/paste 的 target 可选（缺省走焦点元素）
      const TARGETED = new Set(["left_click", "left_click_drag", "scroll", "set_value", "select_text", "perform_action"]);
      let el: SimElement | undefined = undefined;
      if (TARGETED.has(method) || input.target != null) {
        const tErr = findTarget(input, input.target ?? input.from_target);
        if (tErr.error) return { error: tErr.error };
        el = tErr.el;
      }

      switch (method) {
        case "left_click":
          if (el) {
            elements.forEach((e) => (e.focused = false));
            el.focused = true;
            if (el.pressable) pressEffect(el);
          }
          break;
        case "left_click_drag":
          break; // 形状即可
        case "scroll":
          break;
        case "type": {
          const focus = elements.find((e) => e.focused && e.editable);
          if (!focus) return { error: { code: "element_unavailable", message: "no focused editable element" } };
          focus.value = (focus.value ?? "") + String(input.text ?? "");
          break;
        }
        case "set_value": {
          if (!el) return { error: { code: "invalid_request", message: "set_value requires an element target" } };
          if (!el.editable) return { error: { code: "not_settable", message: `element ${el.index} is not settable` } };
          el.value = String(input.value ?? "");
          break;
        }
        case "select_text":
          if (el && !el.editable) return { error: { code: "not_selectable", message: "element is not selectable" } };
          break;
        case "key": {
          const text = String(input.text ?? "");
          const focus = elements.find((e) => e.focused && e.editable);
          if (focus && /return/i.test(text) && (focus.value ?? "").length > 0) {
            // Return 提交：正文入列为一条笔记并清空（供 观察→动作→验证 闭环）
            addElement({ kind: "staticText", name: focus.value! });
            focus.value = "";
          }
          break;
        }
        case "perform_action": {
          if (!el) return { error: { code: "invalid_request", message: "perform_action requires an element target" } };
          if (!(el.actions ?? []).includes(String(input.action))) {
            // 未广告的动作禁止猜测（§3.2 perform_action）
            return { error: { code: "unimplemented", message: `action ${input.action} is not advertised by element ${el.index}` } };
          }
          pressEffect(el);
          break;
        }
        case "paste": {
          const focus = elements.find((e) => e.focused && e.editable);
          if (!focus) return { error: { code: "timeout", message: "no app read the pasted content before the deadline" } };
          focus.value = (focus.value ?? "") + String(input.text ?? "");
          break;
        }
      }
      return { result: { dispatch_status: nextDispatchStatus } };
    }

    return { error: { code: "method_not_found", message: `unknown method ${method}` } };
  }

  // ---------- 桥接器（node-repl 注入进 Worker 的形状） ----------
  const requestMeta = {
    runtimeScope: options.runtimeScope ?? "main",
    sessionId: options.sessionId ?? "sess_mock",
    workspacePath: "/tmp/mock-workspace",
    workspaceKey: "mock",
    turnId: "turn_mock",
    clientMode: "desktop-continuous",
    deliveryKind: "test",
    trace: { traceId: "tr_mock", spanId: "sp_mock" },
  };

  const bridge = {
    generation,
    documentationRoot: "/mock/docs",
    assertAvailable() {
      // 子代理直接禁用（§6.6）——消息措辞对齐 evidence §2.7
      if (requestMeta.runtimeScope === "subagent") {
        throw new Error("Computer Use is not available in subagent");
      }
    },
    async call(method: string, args: any) {
      const out = dispatch(method, args);
      return out.error
        ? { ok: false, error: out.error }
        : { ok: true, result: out.result };
    },
  };

  seedTree();

  // ---------- 测试控制面 ----------
  return {
    bridge,
    requestMeta,
    /** 桥接调用日志（断言 SDK 发出的 wire 参数） */
    calls,
    /** 宿主/Helper 状态操控（仅供自测） */
    host: {
      setNotReady(n: number) { notReadyRemaining = n; },
      setBusyOwner(owner: string | null) { busyOwner = owner; },
      setNextDispatchStatus(s: string) { nextDispatchStatus = s; },
      pushFault(err: WireError) { faultQueue.push(err); },
      setForeground(v: boolean) { foreground = v; },
      setWindowFallback(v: boolean) { windowFallback = v; },
      insertElement(spec: Omit<SimElement, "id" | "index">) { return addElement(spec); },
      removeElementAt(index: number) {
        elements = elements.filter((e) => e.index !== index);
        reindex();
        lastCapture = null; // 外部变化后强制下次全量，模拟「模型没见过的树」
      },
      lastFrameId() { return latestActionableFrameId; },
      bumpGeneration() { generation += 1; bridge.generation = generation; },
      isStopped() { return stopped; },
      resetTree() { seedTree(); },
    },
  };
}

export { BROKER_RESPONSE_AMBIGUOUS_MESSAGE };
