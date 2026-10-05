/**
 * mock Sky 服务 —— 模拟 SkyComputerUseService 的**可观察行为**：
 * AX 树 + 自动 diff（带行数预算）+ Skyshot 形状 + 动作（错误内嵌新鲜 diff）+ 审批面。
 *
 * 行为规格出处（agents/codex/computer-use.md）：
 * - AX diff / 行数预算 / 删除以 ID 区间表达：§4.1 与 evidence §4（Swift 符号
 *   axTreeDiffingRemovedElementIDRanges、AccessibilityDifferenceLineBudgetExceeded）
 * - Skyshot（AX 文本 + 截图一次返回）与 appSpecificInstructions 首次访问前缀：§4.1–§4.2
 * - 动作全 Promise<void>，失败信息内嵌新鲜 AX diff 引导重新索引：§0 特征 4、§4.1 指令硬约束
 * - mac 无 launch/activate 原语，startApp 隐式拉起：§5.3
 * - getAppPolicy / AppApprovalStore：§6.1
 * - paste 走系统剪贴板并恢复用户原剪贴板：§3.3
 */

export interface AxNode {
  id: number;
  role: string;
  name: string;
  value?: string;
  settable?: boolean;
  actions?: string[];
}

interface SimApp {
  pid: number;
  name: string;
  bundleId: string;
  running: boolean;
  tree: AxNode[];
  firstAccessDone: boolean;
  lastCapture: string[] | null; // diff 基线 = 上次捕获的行集
}

const MAX_DIFF_LINES = 40; // AccessibilityDifferenceLineBudgetExceeded 的预算形状

export class SimServiceError extends Error {
  code: string;
  data?: unknown;
  constructor(message: string, code: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export function createSkySim() {
  let pidSeq = 500;
  let nodeSeq = 0;
  const apps = new Map<string, SimApp>(); // key: bundleId
  /** 事件流水（测试断言用）：paste 借还剪贴板、click 命中的节点等 */
  const events: string[] = [];
  let lastClickedNode: string | null = null;
  let userClipboard = "user-secret-clipboard";

  function seedNotes(): SimApp {
    const app: SimApp = {
      pid: ++pidSeq, name: "Notes", bundleId: "com.apple.Notes", running: false,
      tree: [], firstAccessDone: false, lastCapture: null,
    };
    app.tree = [
      { id: ++nodeSeq, role: "button", name: "New Note", actions: ["press"] },
      { id: ++nodeSeq, role: "button", name: "Share", actions: ["press"] },
      { id: ++nodeSeq, role: "textfield", name: "Search", value: "", settable: true },
      { id: ++nodeSeq, role: "textArea", name: "Body", value: "", settable: true, actions: ["confirm"] },
    ];
    return app;
  }
  const notes = seedNotes();
  apps.set(notes.bundleId, notes);

  function resolveApp(target: any): SimApp {
    const t = typeof target === "string" ? { name: target } : (target ?? {});
    for (const app of apps.values()) {
      if (t.pid != null && app.pid === t.pid) return app;
      if (t.bundleId != null && app.bundleId === t.bundleId) return app;
      if (t.bundle_id != null && app.bundleId === t.bundle_id) return app;
      if (t.name != null && (app.name === t.name || app.bundleId === t.name)) return app;
      if (t.windowId != null) return app; // mock 只有一个窗口
    }
    throw new SimServiceError(`The target app is not running: ${JSON.stringify(target)}`, "app_not_found");
  }

  function renderLine(node: AxNode, index: number): string {
    const val = node.value != null && node.value !== "" ? ` value=${JSON.stringify(node.value)}` : "";
    const set = node.settable ? " settable" : "";
    const acts = node.actions?.length ? ` actions=${node.actions.join("|")}` : "";
    return `[${index}] ${node.role} name=${JSON.stringify(node.name)}${val}${set}${acts}`;
  }

  /** 全量渲染 */
  function fullText(app: SimApp): string {
    const lines = app.tree.map(renderLine);
    app.lastCapture = lines.slice();
    return ["# accessibility tree (full)", ...lines].join("\n");
  }

  /** diff 渲染：增/改逐行，删除以行表达（axTreeDiffingRemovedElementIDRanges 语义的行版近似） */
  function diffText(app: SimApp): string {
    const current = app.tree.map(renderLine);
    const prev = app.lastCapture;
    if (prev === null) return fullText(app);
    const prevSet = new Set(prev);
    const currentSet = new Set(current);
    const addedOrChanged = current.filter((l) => !prevSet.has(l));
    const removed = prev.filter((l) => !currentSet.has(l)).map((l) => `removed: ${l}`);
    const lines: string[] = [];
    if (addedOrChanged.length === 0 && removed.length === 0) {
      lines.push("(no changes since last capture)");
    }
    lines.push(...addedOrChanged, ...removed);
    if (lines.length > MAX_DIFF_LINES) {
      throw new SimServiceError(
        "AccessibilityDifferenceLineBudgetExceeded: diff exceeds the line budget",
        "ax_diff_line_budget_exceeded",
      );
    }
    app.lastCapture = current.slice();
    return ["# accessibility tree (diff)", ...lines].join("\n");
  }

  /** 失败信息内嵌新鲜 diff —— Codex 对 stale 索引的核心对策（§0 特征 4） */
  function staleIndexError(app: SimApp, what: string): SimServiceError {
    return new SimServiceError(
      `${what}\nFresh AX diff:\n${diffText(app)}\nRe-derive element indices from the latest get_app_state before acting.`,
      "stale_index",
    );
  }

  function getAppState(app: SimApp, disableDiff: boolean): unknown {
    if (!app.running) throw new SimServiceError("app session is not started; call start_app first", "app_not_running");
    let text = disableDiff ? fullText(app) : diffText(app);
    if (!app.firstAccessDone) {
      app.firstAccessDone = true;
      // 「text prefixed with app-specific guidance on first access when available」（§4.1）
      text = `[guidance: ${app.name} supports New Note / Share buttons and two text fields]\n${text}`;
    }
    // Skyshot：AX 文本 + 截图打包为一个观察原子（§4.2；mock 截图为占位字节）
    return {
      app: { pid: app.pid, bundleId: app.bundleId, displayName: app.name },
      skyshot: { text, screenshot: { mimeType: "image/jpeg", bytes: Buffer.from(`jpeg-${app.bundleId}`) } },
    };
  }

  function pressEffect(app: SimApp, node: AxNode) {
    if (node.name === "New Note") {
      app.tree.push({ id: ++nodeSeq, role: "staticText", name: `Untitled Note ${app.tree.filter((n) => n.role === "staticText").length + 1}` });
    }
    // Share：AX 受理但树不变（供 diff/no-change 断言）
  }

  const handlers: Record<string, (req: any) => unknown> = {
    list_apps() {
      return { apps: [...apps.values()].filter((a) => a.running).map((a) => ({ pid: a.pid, name: a.name, bundle_id: a.bundleId })) };
    },
    get_app_policy(req: any) {
      // 目标策略层：decision/risk/allowPersistentApproval（§6.1）
      return {
        decision: "allowed", risk: "low", allowPersistentApproval: true,
        target: { bundleIdentifier: resolveApp(req.app).bundleId, displayName: resolveApp(req.app).name },
      };
    },
    /** startApp：拉起会话（如未运行）+ 立即返回 key window 状态 —— mac 无独立 launch 原语（§5.3） */
    start_app(req: any) {
      const app = resolveApp(req.app ?? req);
      if (!app.running) {
        app.running = true;
        events.push(`start_app:${app.bundleId}`);
      }
      return getAppState(app, true);
    },
    get_app_state(req: any) {
      const app = resolveApp(req.app);
      return getAppState(app, req.disableDiff === true);
    },
    click(req: any) {
      const app = resolveApp(req.app);
      const node = app.tree[req.index];
      if (!node) throw staleIndexError(app, `Element ${req.index} not found in the current tree.`);
      lastClickedNode = node.name;
      events.push(`click:${node.name}`);
      app.tree.forEach((n) => delete (n as any).focused);
      if (node.actions?.includes("press")) pressEffect(app, node);
      return { ok: true }; // 动作全 Promise<void>：错误才携带信息，成功无载荷
    },
    set_value(req: any) {
      const app = resolveApp(req.app);
      const node = app.tree[req.index];
      if (!node) throw staleIndexError(app, `Element ${req.index} not found in the current tree.`);
      if (!node.settable) throw new SimServiceError(`element ${req.index} is not settable`, "not_settable");
      node.value = String(req.value ?? "");
      return { ok: true };
    },
    select_text(req: any) {
      const app = resolveApp(req.app);
      const node = app.tree[req.index];
      if (!node) throw staleIndexError(app, `Element ${req.index} not found in the current tree.`);
      if (!node.settable) throw new SimServiceError(`element ${req.index} has no selectable text`, "not_selectable");
      return { ok: true };
    },
    perform_secondary_action(req: any) {
      const app = resolveApp(req.app);
      const node = app.tree[req.index];
      if (!node) throw staleIndexError(app, `Element ${req.index} not found in the current tree.`);
      if (!(node.actions ?? []).includes(String(req.action))) {
        throw new SimServiceError(
          `action ${JSON.stringify(req.action)} is not advertised by element ${req.index} (advertised: ${(node.actions ?? []).join("|") || "none"})`,
          "action_unavailable",
        );
      }
      pressEffect(app, node);
      return { ok: true };
    },
    type_text(req: any) {
      const app = resolveApp(req.app);
      const node = req.index != null ? app.tree[req.index] : app.tree.find((n) => n.role === "textArea");
      if (!node) throw staleIndexError(app, `Element ${req.index} not found in the current tree.`);
      if (!node.settable) throw new SimServiceError("cannot type into a non-text element", "not_settable");
      node.value = (node.value ?? "") + String(req.text ?? "");
      return { ok: true };
    },
    press_key(req: any) {
      events.push(`press_key:${req.key}`);
      return { ok: true };
    },
    scroll() { return { ok: true }; },
    drag() { return { ok: true }; },
    /** paste：借系统剪贴板 → 键入 → 恢复用户原剪贴板（§3.3） */
    paste(req: any) {
      const app = resolveApp(req.app);
      const node = req.index != null ? app.tree[req.index] : app.tree.find((n) => n.role === "textArea");
      if (!node) throw staleIndexError(app, `Element ${req.index} not found in the current tree.`);
      const original = userClipboard;
      events.push("clipboard:borrow");
      userClipboard = String(req.text ?? "");
      node.value = (node.value ?? "") + String(req.text ?? "");
      events.push("paste");
      userClipboard = original;
      events.push("clipboard:restore");
      return { ok: true };
    },
    get_screenshot(req: any) {
      const app = resolveApp(req.app);
      return { skyshot: { screenshot: { mimeType: "image/jpeg", bytes: Buffer.from(`jpeg-${app.bundleId}`).toString("base64") } } };
    },
  };

  return {
    handlers,
    events,
    /** 测试操控：模拟「模型没预料到的树变化」 */
    test: {
      removeNodeAt(appKey: string, index: number) {
        const app = apps.get(appKey)!;
        app.tree.splice(index, 1);
        app.lastCapture = null;
      },
      addNode(appKey: string, node: Omit<AxNode, "id">) {
        apps.get(appKey)!.tree.push({ id: ++nodeSeq, ...node });
      },
      lastClickedNode: () => lastClickedNode,
      clipboard: () => userClipboard,
      isRunning: (appKey: string) => apps.get(appKey)!.running,
    },
  };
}

export type SkySim = ReturnType<typeof createSkySim>;
