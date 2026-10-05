/**
 * MCP provider 工具注册面 —— cursor-ide-browser 风格的 cleanroom 重构。
 *
 * 行为规格出处（agents/cursor/browser-use.md、agents/cursor/evidence/inventory.md）：
 * - 注册形态：内置扩展经 vscode.cursor.registerMcpProvider 注册一方 MCP server，
 *   id "cursor-ide-browser"；descriptor 含工具名/描述/参数 JSON 串/callTool 分发（§3.1、evidence §3.1）
 * - 工具面：15 个注册工具 + callTool 分发里的 browser_lock = 16（§3）
 * - 导航策略：拒绝 file://（仅 http/https）；管理员 origin allowlist 命中失败抛
 *   "blocked by administrator settings"（§7、evidence §3.8）
 * - CDP 拒绝列表：域级 Browser/Input/Storage/SystemInfo/Target/Tethering +
 *   方法级 cookie/cache/文件/导航（evidence §3.5）；Input.* 单独说明焦点敏感性
 * - browser_lock：用户始终可 Take Control 夺回（§3.1）
 * - 错误契约：结构化 {success, error, suggestion}（evidence §1 能力矩阵）
 */

import { MiniElement } from "./dom.ts";
import { takeSnapshot, findElementByRef, assertDescriptionMatches, type SnapshotResult } from "./ref-handles.ts";
import * as synth from "./synthetic-events.ts";

// ---------------------------------------------------------------------------
// 注册面：registerMcpProvider(descriptor) 的形状
// ---------------------------------------------------------------------------

export interface McpToolDescriptor {
  name: string;
  description: string;
  /** 扩展里是 parameters: JSON.stringify(zodSchema)；此处直接存 schema 对象 */
  parametersSchema: Record<string, unknown>;
}

export interface McpProviderDescriptor {
  id: string;
  tools: McpToolDescriptor[];
  callTool(name: string, args: Record<string, unknown>): Promise<{ success: boolean; error?: string; suggestion?: string; [k: string]: unknown }>;
  dispose?(): void;
}

const registered: McpProviderDescriptor[] = [];

/** vscode.cursor.registerMcpProvider 的形状（evidence §3.1：this.id="cursor-ide-browser"） */
export function registerMcpProvider(descriptor: McpProviderDescriptor): { dispose(): void } {
  if (!descriptor.id) throw new Error("provider descriptor requires an id");
  if (typeof descriptor.callTool !== "function") throw new Error("provider descriptor requires callTool");
  registered.push(descriptor);
  return { dispose: () => { const i = registered.indexOf(descriptor); if (i >= 0) registered.splice(i, 1); } };
}

export function registeredProviders(): readonly McpProviderDescriptor[] {
  return registered;
}

// ---------------------------------------------------------------------------
// CDP 拒绝列表（main.js 偏移 ~250543 的两个 Set）
// ---------------------------------------------------------------------------

const CDP_DENIED_DOMAINS = new Set(["Browser", "Input", "Storage", "SystemInfo", "Target", "Tethering"]);
const CDP_DENIED_METHODS = new Set([
  "DOM.setFileInputFiles", "Network.clearBrowserCache",
  "Network.clearBrowserCookies", "Network.deleteCookies", "Network.getAllCookies",
  "Network.getCookies", "Network.setCookie", "Network.setCookies",
  "Page.getNavigationHistory", "Page.navigate", "Page.navigateToHistoryEntry",
]);

// ---------------------------------------------------------------------------
// Browser provider
// ---------------------------------------------------------------------------

export interface BrowserProviderOptions {
  page: MiniElement;
  tabs?: Array<{ index: number; title: string; active?: boolean }>;
  originAllowlist?: string[];
  /** 主进程 sendCDPCommand 的注入点（真实实现 attach("1.3") 后 sendCommand） */
  cdpSend?: (method: string, params: unknown) => unknown;
}

export function createBrowserProvider(options: BrowserProviderOptions) {
  const page = options.page;
  let locked = false;
  let refCounterState: SnapshotResult | null = null;
  const tabs = options.tabs ?? [{ index: 0, title: "Cursor Browser Tab", active: true }];
  let activeTab = 0;
  const allowlist = options.originAllowlist ?? [];

  const tool = (name: string, description: string, parametersSchema: Record<string, unknown>): McpToolDescriptor => ({ name, description, parametersSchema });

  const tools: McpToolDescriptor[] = [
    tool("browser_navigate", "Navigate to a URL. By default reuses an existing tab; set newTab: true to open in a new tab.", { url: { type: "string" }, newTab: { type: "boolean" }, position: { enum: ["active", "side"] } }),
    tool("browser_tabs", "List/new/close/select browser tabs (headless tabs supported).", { action: { enum: ["list", "new", "close", "select"] }, index: { type: "integer" }, position: { enum: ["active", "side"] } }),
    tool("browser_lock", "Lock or unlock the browser to control whether the user can interact while you work. The user can still click 'Take Control' to unlock if needed.", { action: { enum: ["lock", "unlock"] } }),
    tool("browser_snapshot", "Capture accessibility snapshot of the current page, this is better than screenshot.", { interactive: { type: "boolean" }, maxDepth: { type: "integer" }, compact: { type: "boolean" }, selector: { type: "string" }, includeDiff: { type: "boolean" } }),
    tool("browser_take_screenshot", "Take a screenshot for visual verification. Do not use screenshots to locate actions — use snapshot refs.", { type: { enum: ["png", "jpeg"] }, filename: { type: "string" }, fullPage: { type: "boolean" } }),
    tool("browser_highlight", "Highlight an element on the page (visual grounding).", { element: { type: "string" }, ref: { type: "string" } }),
    tool("browser_get_bounding_box", "Get the bounding box of an element.", { element: { type: "string" }, ref: { type: "string" } }),
    tool("browser_click", "Click an element by ref from browser_snapshot. Use this instead of CDP Input.* methods.", { ref: { type: "string" }, element: { type: "string" }, button: { enum: ["left", "right", "middle"] }, doubleClick: { type: "boolean" }, modifiers: { type: "array" }, holdDurationMs: { type: "integer" } }),
    tool("browser_mouse_click_xy", "Click at viewport coordinates. Prefer browser_click with refs.", { x: { type: "number" }, y: { type: "number" } }),
    tool("browser_type", "Type text into an element.", { ref: { type: "string" }, text: { type: "string" } }),
    tool("browser_fill", "Fill a form field.", { ref: { type: "string" }, value: { type: "string" } }),
    tool("browser_select_option", "Select options of a <select>.", { ref: { type: "string" }, values: { type: "array" } }),
    tool("browser_press_key", "Press a key.", { key: { type: "string" } }),
    tool("browser_scroll", "Scroll the page or an element into view.", { direction: { enum: ["up", "down", "left", "right"] }, amount: { type: "integer" }, ref: { type: "string" } }),
    tool("browser_drag", "Perform an HTML5 drag between two elements.", { sourceRef: { type: "string" }, targetRef: { type: "string" } }),
    tool("browser_cdp", "Send a Chrome DevTools Protocol command. Browser-wide, storage, cookie, permission, download, target-management, and system-level commands are denied.", { method: { type: "string" }, params: { type: "object" } }),
  ];

  const fail = (error: string, suggestion?: string) => ({ success: false, error, suggestion });
  const done = (extra: Record<string, unknown> = {}) => ({ success: true, ...extra });

  function resolveRef(args: Record<string, unknown>): MiniElement {
    const ref = String(args.ref ?? "");
    const found = findElementByRef(page, ref);
    if (!found) {
      throw new Error(`ref ${ref} is stale or unknown: it is bound to the most recent browser_snapshot of this tab. Take a new browser_snapshot.`);
    }
    // 防漂移校验（§4.1 流程 5）
    assertDescriptionMatches(found, ref, args.element as string | undefined);
    return found;
  }

  const provider: McpProviderDescriptor = {
    id: "cursor-ide-browser",
    tools,
    async callTool(name, args) {
      try {
        switch (name) {
          case "browser_navigate": {
            const url = String(args.url ?? "");
            // 导航安全策略（evidence §3.8）：file:// 拒绝 + 管理员 allowlist
            if (!/^https?:\/\//.test(url)) {
              return fail(`file:// URLs are not allowed. The browser navigation tool can only access web URLs (http:// or https://). Got: ${url}`);
            }
            const origin = new URL(url).origin;
            if (allowlist.length && !allowlist.some((a) => origin === a || origin.endsWith(`.${a}`))) {
              return fail(`Navigation to ${url} is blocked by administrator settings. Allowed origins: ${allowlist.join(", ")}`);
            }
            return done({ url, note: "navigated (default reuses an existing tab; newTab opens a new one)" });
          }
          case "browser_tabs": {
            const action = String(args.action ?? "list");
            if (action === "list") return done({ tabs });
            if (action === "new") { tabs.push({ index: tabs.length, title: "New Headless Tab" }); return done({ tabs }); }
            if (action === "select") { activeTab = Number(args.index ?? 0); return done({ activeTab }); }
            if (action === "close") { tabs.splice(Number(args.index ?? tabs.length - 1), 1); return done({ tabs }); }
            return fail(`unknown tabs action: ${action}`);
          }
          case "browser_lock": {
            locked = String(args.action) === "lock";
            return done({ locked, note: locked ? "the user can still click 'Take Control' to unlock" : undefined });
          }
          case "browser_snapshot": {
            refCounterState = takeSnapshot(page, { interactive: args.interactive !== false, maxDepth: Number(args.maxDepth ?? 20) });
            return done({ yaml: refCounterState.yaml, entries: refCounterState.entries });
          }
          case "browser_take_screenshot":
            return done({ format: String(args.type ?? "png"), note: "visual verification only — actions must use snapshot refs" });
          case "browser_highlight":
          case "browser_get_bounding_box": {
            const target = resolveRef(args);
            return done({ ref: target.getAttribute("data-cursor-ref"), name: target.textContent.slice(0, 40), ...(name === "browser_get_bounding_box" ? { box: { x: 0, y: 0, width: 0, height: 0 } } : { highlighted: true }) });
          }
          case "browser_click": {
            const target = resolveRef(args);
            synth.synthClick(target, { button: args.button as string, modifiers: args.modifiers as string[], doubleClick: !!args.doubleClick, holdDurationMs: args.holdDurationMs as number });
            return done();
          }
          case "browser_mouse_click_xy":
            return done({ note: "viewport-coordinate click is a fallback; prefer refs" });
          case "browser_type": {
            const target = resolveRef(args);
            synth.synthType(target, String(args.text ?? ""));
            return done();
          }
          case "browser_fill": {
            const target = resolveRef(args);
            synth.synthSetValue(target, String(args.value ?? ""));
            return done();
          }
          case "browser_select_option": {
            const target = resolveRef(args);
            synth.synthSelectOption(target, (args.values as string[]) ?? []);
            return done();
          }
          case "browser_press_key": {
            synth.synthPressKey(page, String(args.key ?? ""));
            return done();
          }
          case "browser_scroll": {
            const target = args.ref != null ? resolveRef(args) : page;
            synth.synthScroll(target, String(args.direction ?? "down"), Number(args.amount ?? 3));
            return done();
          }
          case "browser_drag": {
            const source = resolveRef({ ref: args.sourceRef, element: args.startElement });
            const target = resolveRef({ ref: args.targetRef, element: args.endElement });
            synth.synthDrag(source, target);
            return done();
          }
          case "browser_cdp": {
            const method = String(args.method ?? "");
            const domain = method.split(".")[0];
            if (CDP_DENIED_DOMAINS.has(domain)) {
              if (domain === "Input") {
                return fail("CDP Input.* methods are focus-sensitive in Electron webviews. Use the dedicated browser tools (browser_click / browser_type / ...) instead.", "use browser_click with refs");
              }
              return fail(`CDP command ${method} is denied: the ${domain}.* domain is on the denylist (browser-wide, storage, cookie, target-management, and system-level commands are denied).`);
            }
            if (CDP_DENIED_METHODS.has(method)) {
              return fail(`CDP command ${method} is denied by policy.`);
            }
            if (!options.cdpSend) return fail("no CDP backend is wired into this reference; allowed commands would reach webContents.debugger.sendCommand");
            return done({ result: options.cdpSend(method, args.params ?? {}) });
          }
          default:
            return fail(`unknown tool: ${name}`);
        }
      } catch (e: any) {
        // 错误契约：结构化 {success, error, suggestion}（含防漂移失败的重 snapshot 建议）
        return fail(String(e.message), "take a new browser_snapshot and retry with a fresh ref");
      }
    },
  };

  return {
    descriptor: provider,
    /** 模拟用户点 "Take Control"（browser_lock 的用户夺回语义） */
    userTakeControl() { locked = false; },
    get locked() { return locked; },
    get activeTab() { return activeTab; },
  };
}
