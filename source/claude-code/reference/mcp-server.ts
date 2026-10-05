/**
 * Claude 桌面端 CU/BU 的 MCP server 骨架 —— cleanroom 重构。
 *
 * 蓝本行为规格（agents/claude-code/computer-use.md、browser-use.md）：
 * - 形态：宿主进程内嵌的本地 stdio MCP 服务器（claude --computer-use-mcp /
 *   --claude-in-chrome-mcp），工具名 mcp__computer-use__* / mcp__claude-in-chrome__*：§1、browser-use §1
 * - 三控制域与 tier 权限门：§2、§6.1
 * - 独占锁 / 全屏接管确认 / 会话守卫：§6.3–§6.5
 * - computer_batch（批内坐标参照批前截图、每步前台门控、首错停批）：§3.3
 * - app-scoped 守护（secure_input_active 等）：§5.2
 * - teach 模式：§3.5
 * - 浏览器：tab 组沙箱、navigate 权限、read_page/computer/ref、browser_batch 每项独立权限检查：browser-use §2、§4
 *
 * 本骨架实现 JSON-RPC 2.0 分发（initialize / tools/list / tools/call），执行层接到
 * desktop-sim.ts 的内存假体上；不连真实桌面、不生成真实截图。
 */

import { createDesktopSim, classifyTier, type DesktopSim, type Tier } from "./desktop-sim.ts";

// ---------------------------------------------------------------------------
// 工具注册表
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<unknown>;
}

function content(result: unknown, isError = false) {
  return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }], ...(isError ? { isError: true } : {}) };
}

function requireStr(args: any, key: string): string {
  if (typeof args?.[key] !== "string") throw new Error(`missing required string parameter: ${key}`);
  return args[key];
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface McpServerOptions {
  sessionId: string;
  sim?: DesktopSim;
  onPermissionRequest?: ConstructorParameters<typeof createDesktopSim>[0]["onPermissionRequest"];
}

export function createMcpServer(options: McpServerOptions) {
  const sim = options.sim ?? createDesktopSim({ onPermissionRequest: options.onPermissionRequest });
  const sessionId = options.sessionId;
  const tools: ToolDef[] = [];

  const tool = (name: string, description: string, inputSchema: Record<string, unknown>, handler: (args: any) => Promise<unknown>) => {
    tools.push({ name, description, inputSchema, handler });
  };

  // ---------------- CU：授权与状态（computer-use.md §3.1） ----------------

  tool("request_access", "会话前置门：一次列全部应用整批允许/拒绝；剪贴板/系统键是独立勾选项；不含全屏接管授权", {
    type: "object", required: ["apps"],
    properties: { apps: { type: "array", items: { type: "string" } }, reason: { type: "string" }, clipboardRead: { type: "boolean" }, clipboardWrite: { type: "boolean" }, systemKeyCombos: { type: "boolean" } },
  }, async (args) => {
    const granted: unknown[] = [];
    const denied: string[] = [];
    for (const appName of args.apps ?? []) {
      if (sim.apps.some((a) => a.name === appName)) {
        const rec = { tier: classifyTier(appName), clipboardRead: !!args.clipboardRead, clipboardWrite: !!args.clipboardWrite, systemKeyCombos: !!args.systemKeyCombos };
        sim.granted.set(appName, rec);
        granted.push({ app: appName, ...rec });
      } else {
        denied.push(appName);
      }
    }
    return { granted, denied, screenshotFiltering: "native（合成器排除未授权应用）" };
  });

  tool("list_granted_applications", "列当前白名单 + 授权标志 + 坐标模式，无副作用", { type: "object" }, async () => {
    return { apps: [...sim.granted.entries()].map(([app, g]) => ({ app, ...g })), coordinateMode: "full-resolution-frame" };
  });

  tool("list_apps", "枚举本机已安装+运行中应用（带 pid），供 request_access 选名", { type: "object" }, async () => ({
    apps: sim.apps.map((a) => ({ name: a.name, bundleId: a.bundleId, pid: a.pid, running: true })),
  }));

  tool("open_application", "启动/确保运行；目标必须已在白名单", { type: "object", required: ["app"], properties: { app: { type: "string" } } }, async (args) => {
    if (!sim.granted.has(args.app)) throw new Error(`${args.app} is not in the granted list; call request_access first`);
    sim.setFrontmost(args.app); // display-scope 模式带到前台
    return { ok: true };
  });

  tool("request_full_control", "请求全屏接管", { type: "object" }, async () => {
    // 真实产品在此弹独立确认卡（§6.3）；参考实现直接记录状态
    return { fullControl: true };
  });
  tool("release_full_control", "释放显示器锁、清除全屏批准（releasing is always safe）", { type: "object" }, async () => {
    sim.clearFullControl();
    return { fullControl: false };
  });
  tool("switch_display", "多显示器切换截图目标", { type: "object", properties: { display: { type: "string" } } }, async () => ({ ok: true }));
  tool("app_release", "释放后台应用锁；display-scope 与 app-scoped 同回合不可混用", { type: "object" }, async () => ({ ok: true }));

  // ---------------- CU：观察（§3.2） ----------------

  tool("screenshot", "主屏 JPEG + 宽高 + 坐标系说明；未授权应用被合成器排除", {
    type: "object", properties: { scale: { type: "number", minimum: 0.1, maximum: 1 }, save_to_disk: { type: "boolean" } },
  }, async () => sim.takeScreenshot());

  tool("zoom", "从上一次全屏截图裁剪放大，不重新截屏；点击坐标仍按全屏坐标系", {
    type: "object", required: ["region"], properties: { region: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 }, scale: { type: "number" } },
  }, async (args) => ({ ...sim.takeScreenshot(), croppedRegion: args.region, note: "坐标仍按全分辨率全屏框架" }));

  tool("app_screenshot", "单窗口截图 + 交互元素 AX 摘要（[N] 前缀索引）", { type: "object", required: ["app"], properties: { app: { type: "string" }, window_id: { type: "integer" } } }, async (args) => {
    const app = sim.apps.find((a) => a.name === args.app);
    if (!app) throw new Error(`app not found: ${args.app}`);
    const ax = app.axElements.map((e, i) => `[${i}] ${e.role} "${e.title}"${e.value ? ` value=${JSON.stringify(e.value)}` : ""}`);
    return { ...sim.takeScreenshot(), axElements: ax };
  });

  tool("app_list_windows", "列应用窗口", { type: "object", required: ["app"], properties: { app: { type: "string" } } }, async (args) => {
    const app = sim.apps.find((a) => a.name === args.app);
    if (!app) throw new Error(`app not found: ${args.app}`);
    return { windows: app.windows };
  });

  tool("app_ax_find", "在最近一次 app_screenshot 捕获的 AX 元素里按 role/title_contains 搜索", {
    type: "object", required: ["app"], properties: { app: { type: "string" }, role: { type: "string" }, title_contains: { type: "string" } },
  }, async (args) => {
    const app = sim.apps.find((a) => a.name === args.app);
    if (!app) throw new Error(`app not found: ${args.app}`);
    const hits = app.axElements
      .map((e, i) => ({ index: i, ...e }))
      .filter((e) => (!args.role || e.role === args.role) && (!args.title_contains || e.title.includes(args.title_contains)));
    return { matches: hits.map((e) => `[${e.index}] ${e.role} "${e.title}"`) };
  });

  tool("cursor_position", "相对最近一次截图的像素坐标", { type: "object" }, async () => ({ x: 0, y: 0, coordinateSpace: "last screenshot frame" }));

  // ---------------- CU：display-scope 动作（§3.3 + §6 安全门） ----------------

  /** display-scope 动作的三重门：独占锁 → 全屏接管确认 → 前台 tier 门控（§6.1–§6.4） */
  async function displayActionGate(targetAppName?: string, needsTierGate = true) {
    if (sim.lockHolder !== null && sim.lockHolder !== sessionId) {
      throw new Error("Another Claude session is currently using the computer. Wait until the other session is done.");
    }
    sim.acquireLock(sessionId); // 独占锁：同一时间只允许一个会话控制电脑
    if (!sim.isFullControl(sessionId)) {
      // 首次 display-scope 动作弹独立确认卡；参考实现回调注入（默认允许由 sim 构造决定）
      sim.isFullControl(sessionId); // 形状位：真实产品在此弹「接管屏幕」确认
    }
    if (needsTierGate && targetAppName) {
      const tier = classifyTier(targetAppName);
      if (tier === "read") {
        throw new Error(`"${targetAppName}" is a browser (tier read): clicks and typing are blocked. Use the claude-in-chrome MCP for browser automation.`);
      }
    }
  }

  const frontmostTier = () => classifyTier(sim.frontmost);

  /** display-scope 输入类动作的前台 tier 门（§6.1：靠前台应用门控执行） */
  function inputTierGate(kinds: Array<"click" | "type" | "key">, extra?: { rightClick?: boolean }) {
    const tier = frontmostTier();
    if (kinds.includes("click") && tier === "read") throw new Error(`frontmost app "${sim.frontmost}" is tier read: clicks are blocked. Use the claude-in-chrome MCP for browser automation.`);
    if (tier !== "full") {
      if (kinds.includes("type")) throw new Error(`frontmost app "${sim.frontmost}" is tier ${tier}: typing is blocked${tier === "click" ? "; use the Bash tool for terminals/IDEs" : ""}`);
      if (kinds.includes("key")) throw new Error(`frontmost app "${sim.frontmost}" is tier ${tier}: key presses are blocked`);
      if (extra?.rightClick) throw new Error(`frontmost app "${sim.frontmost}" is tier ${tier}: right-click is blocked`);
    }
  }

  for (const [name, kinds] of [
    ["left_click", ["click"]], ["double_click", ["click"]], ["triple_click", ["click"]],
    ["right_click", ["click"]], ["middle_click", ["click"]], ["left_click_drag", ["click"]],
    ["left_mouse_down", ["click"]], ["left_mouse_up", ["click"]], ["mouse_move", []],
  ] as Array<[string, Array<"click" | "type" | "key">]>) {
    tool(name, `display-scope 动作：${name}（真实移动光标；前台 tier 门控）`, {
      type: "object", properties: { coordinate: { type: "array", items: { type: "number" } }, text: { type: "string" } },
    }, async (args) => {
      await displayActionGate();
      inputTierGate(kinds, { rightClick: name === "right_click" });
      sim.recordAction(`${name}:${JSON.stringify(args.coordinate ?? null)}`);
      return { ok: true };
    });
  }

  tool("type", "打到当前焦点；多行支持；剪贴板授权后多行走剪贴板快速通道", { type: "object", required: ["text"], properties: { text: { type: "string" } } }, async (args) => {
    await displayActionGate();
    inputTierGate(["type"]);
    sim.recordAction(`type:${JSON.stringify(String(args.text).slice(0, 20))}`);
    return { ok: true };
  });

  tool("key", "系统级组合键需 systemKeyCombos 授权", { type: "object", required: ["text"], properties: { text: { type: "string" }, repeat: { type: "integer", minimum: 1, maximum: 100 } } }, async (args) => {
    await displayActionGate();
    inputTierGate(["key"]);
    const g = sim.granted.get(sim.frontmost);
    const SYSTEM_COMBOS = /(^|\+)(cmd|ctrl|super)(\+|$)/;
    if (SYSTEM_COMBOS.test(String(args.text)) && !(g?.systemKeyCombos)) {
      throw new Error(`"${args.text}" looks like a system key combo; request systemKeyCombos grant first`);
    }
    sim.recordAction(`key:${args.text}`);
    return { ok: true };
  });

  for (const [name, schema] of [
    ["hold_key", { text: { type: "string" }, duration: { type: "number", maximum: 100 } }],
    ["scroll", { coordinate: { type: "array" }, scroll_direction: { enum: ["up", "down", "left", "right"] }, scroll_amount: { type: "integer", maximum: 100 } }],
    ["wait", { duration: { type: "number", maximum: 100 } }],
  ] as Array<[string, Record<string, unknown>]>) {
    tool(name, `display-scope 动作：${name}`, { type: "object", properties: schema }, async (args) => {
      await displayActionGate();
      sim.recordAction(`${name}`);
      return { ok: true };
    });
  }

  tool("read_clipboard", "需 clipboardRead grant", { type: "object" }, async () => {
    const g = sim.granted.get(sim.frontmost);
    if (!g?.clipboardRead) throw new Error("clipboardRead was not granted; call request_access with clipboardRead: true");
    return { text: sim.clipboard };
  });
  tool("write_clipboard", "需 clipboardWrite grant", { type: "object", properties: { text: { type: "string" } } }, async (args) => {
    const g = sim.granted.get(sim.frontmost);
    if (!g?.clipboardWrite) throw new Error("clipboardWrite was not granted");
    sim.setClipboard(String(args.text ?? ""));
    return { ok: true };
  });

  tool("computer_batch", "一次往返顺序执行，首个错误即停；批内坐标一律参照批前全屏截图；每步前都跑前台应用门控", {
    type: "object", required: ["actions"], properties: { actions: { type: "array", items: { type: "object" } }, save_to_disk: { type: "boolean" } },
  }, async (args) => {
    const results: unknown[] = [];
    let stepsCompleted = 0;
    for (const step of args.actions ?? []) {
      try {
        // 每步前重查前台应用门控（§6.1：中途弹出不许进的应用即停批）
        await displayActionGate();
        inputTierGate(["click", "type", "key"]);
        sim.recordAction(`batch:${step.tool ?? step.name ?? "action"}`);
        results.push({ ok: true });
        stepsCompleted += 1;
      } catch (e: any) {
        return { stepsCompleted, stoppedAt: stepsCompleted, error: e.message, results };
      }
    }
    return { stepsCompleted, results };
  });

  // ---------------- CU：app-scoped（§3.4，后台不抢焦点） ----------------

  const findApp = (name: string) => sim.apps.find((a) => a.name === name);

  tool("app_click", "后台点击；弹出菜单/右键菜单被拒（会把应用带到前台）→ 用 app_menu", {
    type: "object", required: ["app"], properties: { app: { type: "string" }, coordinate: { type: "array" }, element_index: { type: "integer" }, target: { enum: ["focused"] }, button: { enum: ["left", "right"] }, count: { enum: [1, 2, 3] } },
  }, async (args) => {
    const app = findApp(args.app);
    if (!app) throw new Error(`app not found: ${args.app}`);
    if (args.button === "right") throw new Error("context_menu_rclick_refused: right-click would bring the app to the front; use app_menu");
    if (args.element_index != null && !app.axElements[args.element_index]) throw new Error("element_index out of range of the last app_screenshot capture");
    sim.recordAction(`app_click:${app.name}`);
    return { ok: true };
  });

  tool("app_type", "只许打字到文本控件；secure_input_active 守卫（§5.2）", {
    type: "object", required: ["app", "text"], properties: { app: { type: "string" }, text: { type: "string" }, mode: { enum: ["insert", "replace"] }, disable_substitutions: { type: "boolean" } },
  }, async (args) => {
    const app = findApp(args.app);
    if (!app) throw new Error(`app not found: ${args.app}`);
    if (sim.secureInputActive) throw new Error("secure_input_active: the field is a secure input area; refusing to type");
    if (args.mode === "replace" && !args.overwrite_existing) throw new Error("would_replace_content: confirm with overwrite_existing to replace the whole field");
    app.focusedFieldValue = String(args.text);
    sim.recordAction(`app_type:${app.name}`);
    return { ok: true };
  });

  tool("app_key", "后台只支持 return/escape/backspace/delete/cmd+a；任意 ⌘ 快捷键走 app_menu", { type: "object", required: ["app", "combo"], properties: { app: { type: "string" }, combo: { type: "string" } } }, async (args) => {
    const ALLOWED = new Set(["return", "escape", "backspace", "delete", "cmd+a"]);
    if (!ALLOWED.has(String(args.combo))) throw new Error(`app_key only supports ${[...ALLOWED].join("/")}; use app_menu for ⌘ shortcuts`);
    sim.recordAction(`app_key:${args.combo}`);
    return { ok: true };
  });

  tool("app_scroll", "设滚动条值（每单位≈窗口滚动区间 5%）", { type: "object", required: ["app", "dy"], properties: { app: { type: "string" }, dy: { type: "integer" } } }, async () => ({ ok: true }));

  tool("app_drag", "仅支持的实现（supportsRawInput）", { type: "object", required: ["app"], properties: { app: { type: "string" }, coordinate: { type: "array" }, to_coordinate: { type: "array" } } }, async () => ({ ok: true }));

  tool("app_menu", "后台遍历菜单栏按标题点击；忽略大小写与结尾省略号", { type: "object", required: ["app"], properties: { app: { type: "string" }, path: { type: "array", items: { type: "string" } }, list: { type: ["string", "null"] } } }, async (args) => {
    const app = findApp(args.app);
    if (!app) throw new Error(`app not found: ${args.app}`);
    if (args.list != null) {
      // list 模式：列出菜单栏根，或列出指定根下的条目
      const roots = [...new Set(app.axElements.filter((e) => e.menuPath).map((e) => e.menuPath![0]))];
      const root = args.list === null ? null : String(args.list);
      const items = root === null
        ? roots
        : app.axElements.filter((e) => e.menuPath?.length === 2 && e.menuPath[0] === root).map((e) => e.title);
      return { menu: roots, items };
    }
    const path: string[] = args.path ?? [];
    const norm = (s: string) => s.replace(/…$/, "").replace(/\.{1,3}$/, "").toLowerCase(); // 忽略结尾省略号（含 ASCII 点）
    const hit = app.axElements.find((e) => e.menuPath && e.menuPath.length === path.length && e.menuPath.every((p, i) => norm(p) === norm(path[i])));
    if (!hit) throw new Error(`menu path not found: ${path.join(" > ")}`);
    sim.recordAction(`app_menu:${app.name}:${path.join(">")}`);
    return { ok: true, clicked: hit.title };
  });

  tool("app_batch", "单窗口内顺序执行；ineffective 不停批", { type: "object", required: ["app", "actions"], properties: { app: { type: "string" }, actions: { type: "array" } } }, async (args) => {
    if (sim.secureInputActive) throw new Error("secure_input_active");
    return { stepsCompleted: (args.actions ?? []).length, results: (args.actions ?? []).map(() => ({ ok: true })) };
  });

  tool("app_bring_to_current_space", "把异 Space 窗口拉到当前空间；锁屏时拒绝", { type: "object", required: ["app"], properties: { app: { type: "string" } } }, async (args) => {
    if (sim.screenLocked) throw new Error("screenLocked: refusing while the screen is locked");
    return { ok: true };
  });

  // ---------------- CU：teach mode（§3.5） ----------------

  tool("request_teach_access", "批准后主窗口隐藏，出现全屏 tooltip 覆盖层", { type: "object", required: ["apps"], properties: { apps: { type: "array", items: { type: "string" } }, reason: { type: "string" } } }, async (args) => {
    for (const a of args.apps ?? []) if (!sim.granted.has(a)) throw new Error(`${a} is not granted; include it in request_access first`);
    return { teachMode: true, overlay: "fullscreen tooltip" };
  });

  tool("teach_step", "显示 tooltip 等用户点 Next → 执行 actions → 返回新截图；用户点 Exit 返回 {exited:true}", {
    type: "object", required: ["explanation"], properties: { explanation: { type: "string" }, next_preview: { type: "string" }, anchor: { type: "array" }, actions: { type: "array" } },
  }, async (args) => {
    await displayActionGate();
    if (args.actions?.length) inputTierGate(["click", "type", "key"]);
    // 真实产品在用户点 Exit 时返回 {exited:true}——形状见 schema
    return { exited: false, screenshot: sim.takeScreenshot() };
  });

  tool("teach_batch", "多步排队；中途出错返回 {stepsCompleted, stepFailed}", { type: "object", required: ["steps"], properties: { steps: { type: "array" } } }, async (args) => {
    return { stepsCompleted: (args.steps ?? []).length, results: [] };
  });

  // ---------------- BU：浏览器工具（browser-use.md §2） ----------------

  tool("tabs_context_mcp", "会话入口：返回本会话 MCP 标签组内全部 tab；createIfEmpty 时新开组+空 tab", { type: "object", properties: { createIfEmpty: { type: "boolean" } } }, async (args) => {
    const g = sim.chrome.ensureGroup(sessionId);
    if (g.tabs.length === 0 && args?.createIfEmpty) {
      const t = sim.chrome.createTab(sessionId);
      return { groupId: sessionId, tabs: [t] };
    }
    return { groupId: sessionId, tabs: g.tabs };
  });

  tool("tabs_create_mcp", "在组内新开空 tab", { type: "object", properties: { url: { type: "string" } } }, async (args) => sim.chrome.createTab(sessionId, args?.url));

  tool("tabs_select_mcp", "切换组内活动 tab", { type: "object", required: ["tabId"], properties: { tabId: { type: "string" } } }, async (args) => {
    sim.chrome.getTab(sessionId, requireStr(args, "tabId"));
    return { selected: args.tabId };
  });

  tool("tabs_close_mcp", "只能关本会话组内的 tab", { type: "object", required: ["tabId"], properties: { tabId: { type: "string" } } }, async (args) => {
    if (!sim.chrome.closeTab(sessionId, requireStr(args, "tabId"))) throw new Error(`tab ${args.tabId} is not in this session's tab group`);
    return { closed: args.tabId };
  });

  tool("navigate", "导航；单独调用可省 tabId；browser_batch 内必须显式 tabId；域外动作过逐动作授权", { type: "object", required: ["url"], properties: { url: { type: "string" }, tabId: { type: "string" } } }, async (args) => {
    let tab = args.tabId ? sim.chrome.getTab(sessionId, args.tabId) : undefined;
    if (!tab) tab = sim.chrome.createTab(sessionId);
    const url = /^https?:\/\//.test(args.url) ? args.url : (args.url === "back" || args.url === "forward" ? tab.url : `https://${args.url}`);
    if (!(await sim.chrome.checkPermission("navigate", url))) throw new Error(`navigation to ${url} was refused by the permission prompt`);
    sim.chrome.navigate(tab, url);
    return { tabId: tab.id, url: tab.url, title: tab.title, tabs: sim.chrome.ensureGroup(sessionId).tabs };
  });

  tool("read_page", "可访问性树表示（ref_N 稳定引用）", { type: "object", required: ["tabId"], properties: { tabId: { type: "string" }, filter: { enum: ["interactive", "all"] }, depth: { type: "integer" }, ref_id: { type: "string" }, max_chars: { type: "integer" } } }, async (args) => {
    const tab = sim.chrome.getTab(sessionId, requireStr(args, "tabId"));
    const lines = tab.elements.map((e) => `${e.ref}: ${e.role} "${e.name}"${e.formValue !== undefined ? ` value=${JSON.stringify(e.formValue)}` : ""}`);
    return { tabId: tab.id, url: tab.url, tree: lines.join("\n") };
  });

  tool("find", "按语义找元素，返回 ref_N 引用", { type: "object", required: ["tabId", "query"], properties: { tabId: { type: "string" }, query: { type: "string" } } }, async (args) => {
    const tab = sim.chrome.getTab(sessionId, requireStr(args, "tabId"));
    const q = String(args.query).toLowerCase();
    const hit = tab.elements.find((e) => e.name.toLowerCase().includes(q));
    return hit ? { ref: hit.ref, role: hit.role, name: hit.name } : { ref: null, note: `no element matches ${JSON.stringify(args.query)}` };
  });

  tool("get_page_text", "正文纯文本抽取", { type: "object", required: ["tabId"], properties: { tabId: { type: "string" } } }, async (args) => {
    const tab = sim.chrome.getTab(sessionId, requireStr(args, "tabId"));
    return { text: tab.elements.map((e) => e.name).join("\n") };
  });

  tool("read_console_messages", "控制台消息（建议带 pattern 过滤）", { type: "object", required: ["tabId"], properties: { tabId: { type: "string" }, pattern: { type: "string" } } }, async (args) => {
    const tab = sim.chrome.getTab(sessionId, requireStr(args, "tabId"));
    return { messages: tab.console };
  });

  tool("read_network_requests", "网络请求；跨域可见；换域自动清空", { type: "object", required: ["tabId"], properties: { tabId: { type: "string" } } }, async () => ({ requests: [] }));

  tool("resize_window", "窗口尺寸调整（响应式测试用）", { type: "object", required: ["width", "height"], properties: { width: { type: "integer" }, height: { type: "integer" }, tabId: { type: "string" } } }, async () => ({ ok: true }));

  tool("computer", "浏览器版像素级动作：坐标基于本 tab 视口截图；点击可 ref 代替坐标；tabId 必填", {
    type: "object", required: ["action", "tabId"],
    properties: {
      action: { enum: ["left_click", "right_click", "type", "screenshot", "wait", "scroll", "key", "left_click_drag", "double_click", "triple_click", "zoom", "scroll_to", "hover"] },
      coordinate: { type: "array" }, text: { type: "string" }, ref: { type: "string" }, tabId: { type: "string" },
    },
  }, async (args) => {
    const tab = sim.chrome.getTab(sessionId, requireStr(args, "tabId"));
    if (!(await sim.chrome.checkPermission(`computer.${args.action}`, tab.url, { ref: args.ref }))) {
      throw new Error(`computer.${args.action} on ${tab.url} was refused by the permission prompt`);
    }
    if (args.action === "left_click" && args.ref != null && !tab.elements.some((e) => e.ref === args.ref)) {
      throw new Error(`ref ${args.ref} is stale; call find or read_page again`);
    }
    sim.recordAction(`browser.computer:${args.action}:${args.ref ?? ""}`);
    if (args.action === "screenshot") return sim.takeScreenshot();
    return { ok: true, tabId: tab.id };
  });

  tool("form_input", "按 ref 设表单值：checkbox 用布尔、select 用 option 值或文本", { type: "object", required: ["ref", "value", "tabId"], properties: { ref: { type: "string" }, value: {}, tabId: { type: "string" } } }, async (args) => {
    const tab = sim.chrome.getTab(sessionId, requireStr(args, "tabId"));
    const el = tab.elements.find((e) => e.ref === args.ref);
    if (!el) throw new Error(`ref ${args.ref} is stale; call find or read_page again`);
    el.formValue = args.value;
    sim.recordAction(`form_input:${args.ref}=${JSON.stringify(args.value)}`);
    return { ok: true, ref: el.ref };
  });

  tool("javascript_tool", "页面上下文 REPL 求值：顶层 await 可用、末表达式自动返回、JSON 序列化", { type: "object", required: ["action", "text", "tabId"], properties: { action: { enum: ["javascript_exec"] }, text: { type: "string" }, tabId: { type: "string" } } }, async (args) => {
    const tab = sim.chrome.getTab(sessionId, requireStr(args, "tabId"));
    if (args.action !== "javascript_exec") throw new Error(`unsupported action: ${args.action}`);
    return { value: sim.evalInPage(tab, args.text) };
  });

  tool("file_upload", "由客户端按自身文件读权限读取 paths 后填充——扩展拿不到宿主文件系统", { type: "object", required: ["paths", "tabId"], properties: { paths: { type: "array", items: { type: "string" } }, tabId: { type: "string" } } }, async (args) => {
    sim.recordAction(`file_upload:${(args.paths ?? []).join(",")}`);
    return { ok: true, note: "populated by the client from paths" };
  });

  tool("upload_image", "把截图/用户图片传给 file input 或拖放", { type: "object", properties: { imageId: { type: "string" }, coordinate: { type: "array" }, tabId: { type: "string" } } }, async () => ({ ok: true }));
  tool("gif_creator", "录制操作过程导出带标注 GIF", { type: "object", required: ["action"], properties: { action: { enum: ["start_recording", "stop_recording", "export", "clear"] } } }, async (args) => ({ state: args.action }));

  tool("browser_batch", "一次往返顺序执行，首错即停；每项独立过权限检查；不能嵌套", { type: "object", required: ["actions"], properties: { actions: { type: "array", items: { type: "object", properties: { name: { type: "string" }, input: { type: "object" } }, required: ["name", "input"] } } } }, async (args) => {
    const results: unknown[] = [];
    let stepsCompleted = 0;
    for (const item of args.actions ?? []) {
      const def = tools.find((t) => t.name === item.name);
      if (!def) throw new Error(`unknown tool in batch: ${item.name}`);
      if (item.name === "browser_batch") throw new Error("browser_batch cannot nest");
      try {
        results.push({ name: item.name, result: await def.handler(item.input) });
        stepsCompleted += 1;
      } catch (e: any) {
        return { stepsCompleted, stoppedAt: stepsCompleted, error: e.message, results };
      }
    }
    return { stepsCompleted, results };
  });

  tool("list_connected_browsers", "列当前账号连接的所有 Chrome 实例", { type: "object" }, async () => ({
    browsers: [{ deviceId: "dev-local", name: "Chrome (this machine)", platform: "macos", isLocal: true }],
  }));
  tool("select_browser", "按 deviceId 直连", { type: "object", required: ["deviceId"], properties: { deviceId: { type: "string" } } }, async () => ({ ok: true }));
  tool("switch_browser", "广播配对请求，等用户手动点 Connect（最长 2 分钟）", { type: "object" }, async () => ({ ok: true, note: "waiting for user to click Connect" }));
  tool("shortcuts_list", "枚举扩展侧快捷指令", { type: "object" }, async () => ({ shortcuts: ["/debug", "/summarize"] }));
  tool("shortcuts_execute", "在 sidepanel 里对当前 tab 运行，立即返回", { type: "object", required: ["shortcut"], properties: { shortcut: { type: "string" } } }, async () => ({ ok: true }));

  // ---------------- JSON-RPC 2.0 分发（stdio MCP 的消息层形状） ----------------

  return {
    sessionId,
    sim,
    toolNames: () => tools.map((t) => t.name),
    /** 处理一条 JSON-RPC 消息；notification 返回 null */
    async handle(message: any): Promise<Record<string, unknown> | null> {
      const { id, method, params } = message ?? {};
      if (id === undefined) return null; // notification（如 notifications/initialized）
      try {
        if (method === "initialize") {
          return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "computer-use+claude-in-chrome (reference)", version: "0.1.0" }, capabilities: { tools: {} } } };
        }
        if (method === "tools/list") {
          return { jsonrpc: "2.0", id, result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } };
        }
        if (method === "tools/call") {
          const def = tools.find((t) => t.name === params?.name);
          if (!def) return { jsonrpc: "2.0", id, result: content(`unknown tool: ${params?.name}`, true) };
          try {
            return { jsonrpc: "2.0", id, result: content(await def.handler(params.arguments ?? {})) };
          } catch (e: any) {
            return { jsonrpc: "2.0", id, result: content(e.message, true) };
          }
        }
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
      } catch (e: any) {
        return { jsonrpc: "2.0", id, error: { code: -32000, message: e.message } };
      }
    },
    /** 便捷入口：直接调用工具并解包文本结果 */
    async callTool(name: string, args: any = {}): Promise<any> {
      const res = await this.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
      const raw = (res as any).result.content[0].text;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; } // 错误结果是纯文本，不保证是 JSON
      if ((res as any).result.isError) throw new Error(typeof parsed === "string" ? parsed : JSON.stringify(parsed));
      return parsed;
    },
  };
}

export type McpServer = ReturnType<typeof createMcpServer>;
export type { Tier };
