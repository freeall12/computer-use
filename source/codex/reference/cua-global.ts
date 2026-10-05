/**
 * tinyskyAlt 风格统一 `cua` 全局对象 —— cleanroom 重构。
 *
 * 蓝本行为规格（agents/codex/computer-use.md）：
 * - 顶层对象与 Target/App 接口：§3.1–§3.3（字段名逐字核对自随包官方文档与 types.d.ts）
 * - getApp 隐式拉起（mac 无 launch/activate 原语）：§5.3
 * - 观察以 AX diff 为主、动作后必须重新观察的流程纪律：§4.1
 * - 动作全 Promise<void>、失败信息内嵌新鲜 diff：§0 特征 4
 * - js / js_reset（重置工作内存、不动世界状态）：§2
 *
 * 注：本文件只实现桌面半边（browsers 半边留接口位），并注明与 ZCode 重构版的关键差异
 * （无 stateId/frameId/actionSent —— 这些是 ZCode 自有加固，见 agents/codex/computer-use.md §3.5）。
 */

import * as vm from "node:vm";
import type { SkyClient } from "./sky-transport.ts";
import type { AxNode } from "./sky-sim.ts";

// ---------------------------------------------------------------------------
// 接口形状（§3.1–§3.3）
// ---------------------------------------------------------------------------

export type Direction = "up" | "down" | "left" | "right" | "u" | "d" | "l" | "r";
export type Vec2 = { x: number; y: number };

export interface ObservationOptions { emit?: boolean }
export interface StateOptions extends ObservationOptions { disableDiffing?: boolean }
export interface ClickOptions { mouseButton?: "left" | "right" | "middle" | "l" | "r" | "m"; clickCount?: number }
export interface SelectTextOptions { prefix?: string; suffix?: string; selectionType?: "text" | "cursor_before" | "cursor_after" }

export interface AppInfo { pid: number; name: string; bundle_id: string }
export interface State { apps: AppInfo[]; browsers: unknown[]; errors?: string[] }

/** 提取 skyshot 里的 AX 文本与截图 */
function unwrapAppState(result: any): { text: string; screenshot: Uint8Array | null } {
  const skyshot = result?.skyshot ?? {};
  const bytes = skyshot.screenshot?.bytes;
  const screenshot = bytes == null ? null : (typeof bytes === "string" ? new Uint8Array(Buffer.from(bytes, "base64")) : new Uint8Array(bytes));
  return { text: String(skyshot.text ?? ""), screenshot };
}

// ---------------------------------------------------------------------------
// App：Target 交互面的实现（§3.3）
// ---------------------------------------------------------------------------

export class App {
  private client: SkyClient;
  readonly appRef: { pid: number; name: string; bundleId: string };
  /** start_app（绑定观察）返回的 AX 文本——含首次访问的应用专属指引 */
  boundStateText = "";

  constructor(client: SkyClient, appRef: { pid: number; name: string; bundleId: string }) {
    this.client = client;
    this.appRef = appRef;
  }

  private async appRequest(requestType: string, request: Record<string, unknown>): Promise<any> {
    return this.client.request(requestType, { app: { pid: this.appRef.pid, bundleId: this.appRef.bundleId }, ...request });
  }

  /** AX 树（默认 diff；disableDiffing 取全量）。emit 语义=自动回显给模型，此处以返回代替 */
  async getAXState(options: StateOptions = {}): Promise<string> {
    const result = await this.appRequest("get_app_state", { disableDiff: options.disableDiffing === true });
    const { text } = unwrapAppState(result);
    return text;
  }

  /** 截图：来自 skyshot（§4.2） */
  async getScreenshot(_options: ObservationOptions = {}): Promise<Uint8Array> {
    const result = await this.appRequest("get_app_state", { disableDiff: true });
    const { screenshot } = unwrapAppState(result);
    if (!screenshot) throw new Error("skyshot returned no screenshot");
    return screenshot;
  }

  async getAXStateAndScreenshot(options: StateOptions = {}): Promise<{ state: string; screenshot?: Uint8Array }> {
    const result = await this.appRequest("get_app_state", { disableDiff: options.disableDiffing === true });
    return unwrapAppState(result);
  }

  /**
   * 元素索引点击。注意与 ZCode 重构版的关键差异：动作是 Promise<void>，
   * 失败时抛出的 Error 携带服务端内嵌的新鲜 AX diff（没有 actionSent 语义）。
   */
  async click(target: number | Vec2, options: ClickOptions = {}): Promise<void> {
    if (typeof target !== "number") {
      throw new Error("coordinate clicks are modeled by the mock as index clicks; see cua.computer.click");
    }
    await this.appRequest("click", {
      index: target,
      mouseButton: options.mouseButton ?? "left",
      clickCount: options.clickCount ?? 1,
    });
  }

  async drag(from: Vec2, to: Vec2): Promise<void> {
    await this.appRequest("drag", { from, to });
  }

  async scroll(target: number | Vec2, direction: Direction, pages = 1): Promise<void> {
    await this.appRequest("scroll", { target, direction, pages });
  }

  async selectText(elementIndex: number, text: string, options: SelectTextOptions = {}): Promise<void> {
    await this.appRequest("select_text", { index: elementIndex, text, ...options });
  }

  async setValue(elementIndex: number, value: string): Promise<void> {
    await this.appRequest("set_value", { index: elementIndex, value });
  }

  /** 触发元素广告的 AX 副动作；服务端对未广告动作报错（模型层纪律：禁止猜测动作名） */
  async performSecondaryAction(elementIndex: number, action: string): Promise<void> {
    await this.appRequest("perform_secondary_action", { index: elementIndex, action });
  }

  /** paste：走系统剪贴板并恢复用户原剪贴板（服务端行为，§3.3） */
  async paste(text: string, _options: { format?: "text" | "md" | "html" } = {}): Promise<void> {
    await this.appRequest("paste", { text });
  }

  /** xdotool 风格组合键（"super+c"、"Return"） */
  async pressKey(key: string): Promise<void> {
    await this.appRequest("press_key", { key });
  }

  async typeText(text: string): Promise<void> {
    await this.appRequest("type_text", { text });
  }
}

// ---------------------------------------------------------------------------
// 统一 cua 全局（§3.1）
// ---------------------------------------------------------------------------

export function createCuaGlobal(client: SkyClient) {
  const startedSessions = new Set<number>(); // startApp 一次会话一次（§5.3 文案：once per assistant turn）

  const cua = {
    /** node_repl 版有 initialize；cua_repl 版只有 getState */
    async initialize(): Promise<State> {
      return cua.getState({ emit: false });
    },

    async getState(options: ObservationOptions = {}): Promise<State> {
      void options; // emit 语义由宿主 REPL 承担
      const { apps } = await client.request("list_apps", {});
      return { apps, browsers: [], errors: [] }; // 清单错误按条目隔离（§3.1）
    },

    /**
     * getApp：接受名字/完整路径/bundle id；mac 上可后台拉起（startApp 隐式拉起，§5.3）。
     * 「绑定即观察一次」：start_app 直接返回 key window 状态。
     */
    async getApp(target: string | { windowId: number }): Promise<App> {
      const result = await client.request("start_app", { app: target });
      const { app } = result;
      startedSessions.add(app.pid);
      const bound = new App(client, { pid: app.pid, name: app.displayName, bundleId: app.bundleId });
      bound.boundStateText = unwrapAppState(result).text; // 绑定观察文本（模型面会展示）
      return bound;
    },

    async listApps(): Promise<{ apps: AppInfo[] }> {
      return client.request("list_apps", {});
    },

    /** sky 逃逸口：snake_case 原生方法直通（§3.4，mac 面收缩） */
    computer: {
      list_apps: () => client.request("list_apps", {}),
      get_app_state: (req: Record<string, unknown>) => client.request("get_app_state", req),
      start_app: (req: Record<string, unknown>) => client.request("start_app", req),
      get_app_policy: (req: Record<string, unknown>) => client.request("get_app_policy", req),
      click: (req: Record<string, unknown>) => client.request("click", req),
      drag: (req: Record<string, unknown>) => client.request("drag", req),
      paste: (req: Record<string, unknown>) => client.request("paste", req),
      perform_secondary_action: (req: Record<string, unknown>) => client.request("perform_secondary_action", req),
      press_key: (req: Record<string, unknown>) => client.request("press_key", req),
      scroll: (req: Record<string, unknown>) => client.request("scroll", req),
      select_text: (req: Record<string, unknown>) => client.request("select_text", req),
      set_value: (req: Record<string, unknown>) => client.request("set_value", req),
      type_text: (req: Record<string, unknown>) => client.request("type_text", req),
    },

    // ---- 浏览器半边：本参考实现只留接口位（见 agents/codex/browser-use.md） ----
    // getBrowser / createBrowserTab / getTab / listTabs：Tab 同样实现 Target 交互面。
    _startedSessions: startedSessions,
  };

  return cua;
}

// ---------------------------------------------------------------------------
// mini REPL：cua_repl 的 js / js_reset 语义（§2）
// ---------------------------------------------------------------------------

export function createCuaRepl(cua: unknown) {
  let context = vm.createContext({ cua });

  return {
    /**
     * 在持久 REPL 里执行代码：无 await 时返回**完成值**（末表达式值），
     * 顶层 const/let 持久化到上下文（模拟「bindings 跨调用存活」）。
     * 含 await 的代码包一层 async IIFE——此时顶层绑定不持久（形状演示的已知限制）。
     */
    async js(code: string): Promise<unknown> {
      if (/\bawait\b/.test(code)) {
        const script = new vm.Script(`(async () => { ${code} })()`);
        return await script.runInContext(context);
      }
      return new vm.Script(String(code)).runInContext(context);
    },

    /**
     * js_reset：All JavaScript bindings are discarded… does not close browser tabs
     * or native apps, or erase their state —— 只重置工作内存（新 vm 上下文），
     * cua 背后的世界状态（mock 服务）原样不动。
     */
    js_reset() {
      context = vm.createContext({ cua });
    },
  };
}

export type { AxNode };
