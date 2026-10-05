/**
 * 内存模拟器 —— Claude 桌面端 CU/BU 的「机器」假体：屏幕、应用、前台、剪贴板、
 * 授权状态、浏览器 tab 组与页面、权限请求回调。
 *
 * 机制出处（agents/claude-code/computer-use.md、browser-use.md）：
 * - 前台应用门控 / tier 分级（browsers→read，terminals/IDEs→click）：§6.1、evidence §3.1/§3.6
 * - 独占锁（Another Claude session is currently using the computer）：§6.4
 * - 全屏接管独立确认：§6.3
 * - 会话守卫（secureInput / screenLocked）：§6.5
 * - app-scoped 守护理由码（secure_input_active 等）：§5.2、evidence §3.8
 * - teach 模式（tooltip 引导用户）：§3.5
 * - 浏览器侧 tab 组沙箱 / allowedDomains / permission_request：browser-use.md §4
 */

import * as vm from "node:vm";

export type Tier = "read" | "click" | "full";

export interface SimApp {
  name: string;
  bundleId: string;
  pid: number;
  kind: "browser" | "terminal" | "ide" | "app";
  windows: Array<{ window_id: number; title: string; is_main: boolean; is_minimized: boolean; bounds: [number, number, number, number] }>;
  /** app-scoped 假体：最近一次 app_screenshot 捕获的 AX 元素 */
  axElements: Array<{ role: string; title: string; value?: string; menuPath?: string[] }>;
  focusedFieldValue?: string;
}

const BROWSER_APPS = new Set(["Safari", "Chrome", "Arc", "Edge"]);
const TERMINAL_IDE_APPS = new Set(["Terminal", "iTerm2", "VS Code", "Cursor", "ZCode"]);

export function classifyTier(appName: string): Tier {
  if (BROWSER_APPS.has(appName)) return "read";
  if (TERMINAL_IDE_APPS.has(appName)) return "click";
  return "full";
}

// ---------------------------------------------------------------------------
// 浏览器假体：tab 组 + 页面
// ---------------------------------------------------------------------------

export interface SimTab {
  id: string;
  url: string;
  title: string;
  /** a11y 树（ref 稳定）：read_page/find/computer(ref) 的事实来源 */
  elements: Array<{ ref: string; role: string; name: string; formValue?: unknown }>;
  console: string[];
}

export interface SimTabGroup {
  sessionId: string;
  tabs: SimTab[];
}

function makePage(url: string): SimTab["elements"] {
  if (url.includes("example.com")) {
    return [
      { ref: "ref_1", role: "heading", name: "Example Domain" },
      { ref: "ref_2", role: "link", name: "More information..." },
    ];
  }
  if (url.includes("shop.test")) {
    return [
      { ref: "ref_1", role: "heading", name: "Shop" },
      { ref: "ref_2", role: "textbox", name: "Search products", formValue: "" },
      { ref: "ref_3", role: "button", name: "Sign in" },
      { ref: "ref_4", role: "checkbox", name: "Subscribe", formValue: false },
    ];
  }
  return [{ ref: "ref_1", role: "document", name: url }];
}

export interface PermissionRequest {
  tool_type: string;
  url: string;
  action_data: Record<string, unknown>;
  category?: string;
}

export interface DesktopSimOptions {
  /** 交互式授权回调：返回 true=允许。不设时 ask 模式下一律拒绝（fail-closed）。 */
  onPermissionRequest?: (req: PermissionRequest) => Promise<boolean> | boolean;
  /** 全屏接管确认回调：默认自动允许（模拟用户点确认卡）。 */
  onTakeOverConfirm?: (sessionId: string) => Promise<boolean> | boolean;
}

export function createDesktopSim(options: DesktopSimOptions = {}) {
  const apps: SimApp[] = [
    {
      name: "Safari", bundleId: "com.apple.Safari", pid: 1001, kind: "browser",
      windows: [{ window_id: 11, title: "Safari", is_main: true, is_minimized: false, bounds: [0, 0, 1200, 800] }],
      axElements: [], focusedFieldValue: "",
    },
    {
      name: "Terminal", bundleId: "com.apple.Terminal", pid: 1002, kind: "terminal",
      windows: [{ window_id: 12, title: "zsh", is_main: true, is_minimized: false, bounds: [100, 100, 800, 600] }],
      axElements: [{ role: "textArea", title: "shell" }], focusedFieldValue: "",
    },
    {
      name: "Notes", bundleId: "com.apple.Notes", pid: 1003, kind: "app",
      windows: [{ window_id: 13, title: "备忘录", is_main: true, is_minimized: false, bounds: [200, 200, 700, 500] }],
      axElements: [
        { role: "button", title: "新建" },
        { role: "textArea", title: "正文", value: "" },
        { role: "menuBar", title: "File", menuPath: ["File"] },
        { role: "menuItem", title: "Export as PDF…", menuPath: ["File", "Export as PDF…"] },
      ],
      focusedFieldValue: "",
    },
  ];

  // ---- 屏与会话状态 ----
  let frontmost = "Notes";
  let screenshotCount = 0;
  let lastScreenshotFrame = { frameWidth: 1920, frameHeight: 1080 };
  let clipboard = "";
  let fullControl = new Set<string>(); // 已通过接管确认的会话
  let lockHolder: string | null = null; // 独占锁
  let secureInputActive = false;
  let screenLocked = false;
  const actionsLog: string[] = [];
  let teachActive = false;
  let teachUserWantsExit = false;
  const grantedApps = new Map<string, { tier: Tier; clipboardRead: boolean; clipboardWrite: boolean; systemKeyCombos: boolean }>();

  // ---- 浏览器侧状态 ----
  const tabGroups = new Map<string, SimTabGroup>();
  let tabSeq = 0;
  let chromePermissionMode: "ask" | "follow_a_plan" | "skip_all_permission_checks" = "ask";
  let allowedDomains: string[] = [];

  function simError(code: string, message: string): never {
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    throw err;
  }

  return {
    // ---------- 应用/屏幕 ----------
    apps,
    actionsLog,
    get frontmost() { return frontmost; },
    setFrontmost(name: string) { frontmost = name; },
    get secureInputActive() { return secureInputActive; },
    setSecureInput(v: boolean) { secureInputActive = v; },
    get screenLocked() { return screenLocked; },
    setScreenLocked(v: boolean) { screenLocked = v; },
    get lockHolder() { return lockHolder; },
    /** 独占锁获取（无人持有时占用）；供 server 判断 */
    acquireLock(sessionId: string) { if (lockHolder === null) lockHolder = sessionId; },
    get clipboard() { return clipboard; },
    setClipboard(v: string) { clipboard = v; },
    get granted() { return grantedApps; },
    isFullControl(sessionId: string) { return fullControl.has(sessionId); },
    clearFullControl() { fullControl.clear(); },
    get teach() { return teachActive; },
    setTeachExit(v: boolean) { teachUserWantsExit = v; },

    takeScreenshot() {
      screenshotCount += 1;
      return { base64: Buffer.from(`jpeg-frame-${screenshotCount}`).toString("base64"), ...lastScreenshotFrame, frame: screenshotCount };
    },
    recordAction(a: string) { actionsLog.push(a); },

    // ---------- 浏览器 ----------
    chrome: {
      get mode() { return chromePermissionMode; },
      setMode(m: typeof chromePermissionMode) { chromePermissionMode = m; },
      setAllowedDomains(d: string[]) { allowedDomains = d; },

      ensureGroup(sessionId: string): SimTabGroup {
        let g = tabGroups.get(sessionId);
        if (!g) { g = { sessionId, tabs: [] }; tabGroups.set(sessionId, g); }
        return g;
      },
      createTab(sessionId: string, url = "about:blank"): SimTab {
        const g = this.ensureGroup(sessionId);
        const tab: SimTab = { id: `tab-${++tabSeq}`, url, title: url === "about:blank" ? "New Tab" : url, elements: url === "about:blank" ? [] : makePage(url), console: [] };
        g.tabs.push(tab);
        return tab;
      },
      getTab(sessionId: string, tabId: string): SimTab {
        const g = tabGroups.get(sessionId);
        const tab = g?.tabs.find((t) => t.id === tabId);
        // tab 组沙箱：本会话组外的 tab 一律不可见（browser-use.md §4.4）
        if (!tab) simError("tab_not_in_group", `tab ${tabId} is not in this session's MCP tab group`);
        return tab;
      },
      closeTab(sessionId: string, tabId: string): boolean {
        const g = tabGroups.get(sessionId);
        if (!g) return false;
        const before = g.tabs.length;
        g.tabs = g.tabs.filter((t) => t.id !== tabId);
        return g.tabs.length < before;
      },
      navigate(tab: SimTab, url: string) {
        tab.url = url;
        tab.title = url;
        tab.elements = makePage(url);
      },
      /** 逐动作授权（browser-use.md §4.3 permission_request） */
      async checkPermission(toolType: string, url: string, actionData: Record<string, unknown> = {}): Promise<boolean> {
        if (chromePermissionMode === "skip_all_permission_checks") return true;
        const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
        if (allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return true;
        if (chromePermissionMode === "ask") {
          if (!options.onPermissionRequest) return false; // fail-closed：无人应答即拒绝
          return options.onPermissionRequest({ tool_type: toolType, url, action_data: actionData });
        }
        return true; // follow_a_plan：计划内域外动作放行（形状演示）
      },
    },

    // ---------- 页面 JS 求值（javascript_tool 的形状） ----------
    evalInPage(tab: SimTab, code: string): unknown {
      // 页面内容一律 UNTRUSTED；这里只暴露只读 document 假体，返回完成值（末表达式）
      const ctx = vm.createContext({ document: { title: tab.title, URL: tab.url }, window: { location: { href: tab.url } } });
      return new vm.Script(String(code)).runInContext(ctx);
    },
  };
}

export type DesktopSim = ReturnType<typeof createDesktopSim>;
