/**
 * mimo 参考客户端 — 协议类型定义（原创整理）。
 *
 * 依据（只读逆向证据，见 agents/mimo/evidence/inventory.md）：
 * - @mimo/sky 门面 10 方法：宿主技能 SKILL.md「Public API」节
 *   (~/.config/mimocode/skills/mimo-computer-use/mimo-computer-use/SKILL.md)
 * - js 工具参数形状：运行时包 dist/node-repl.js 参数白名单
 *   { code, title, description, timeout_ms }
 * - 浏览器面 agent.browsers：运行时包 skills/mimo-browser-use/SKILL.md
 *
 * 注意：这是按公开可观察行为整理的参考形状，非小米官方类型。
 */

/** js 工具的调用参数（与 node-repl.js 白名单一致：只允许这四个字段）。 */
export interface JsToolArgs {
  code: string;
  title?: string;
  description?: string;
  timeout_ms?: number;
}

/** 单次桌面观察状态（js 单元内 sky 动作的返回值形状）。 */
export interface SkyState {
  app: string;
  /** AX 树文本（index 化元素），模型的主要观察通道。 */
  text: string;
  /**
   * 窗口截图。unchanged=true 仅表示与上一观察像素相同，
   * 是"当前状态上下文"，永远不构成变更成功的证明。
   */
  screenshot: { url: string; unchanged?: boolean } | null;
  /** 焦点/目标窗口身份；sheet/panel 上 title 可能缺失。 */
  targetWindow?: {
    windowId?: number;
    title?: string;
    surface?: "window" | "sheet" | "menu";
    panel?: "open-panel";
  };
  action?: {
    dispatchStatus?: "verified" | "dispatched" | "not-dispatched";
    observationStatus?: "complete" | "partial";
    /** 像素/派发层变化，不等于业务成功。 */
    uiChanged?: boolean | null;
    imageRevision?: number;
    axRevision?: number;
    semanticStatus?: string;
    diagnostic?: string;
    retrySafe?: boolean;
    reasonCode?: string;
    recommendedActions?: string[];
  } | null;
}

export interface SkyAppEntry {
  id: string;
  displayName?: string;
  lastUsedDate?: string;
  useCount?: number;
  isRunning?: boolean;
}

/** @mimo/sky 桌面门面（内核全局 sky）——10 方法完整公开面。 */
export interface Sky {
  target: "mac" | "windows";
  list_apps(): Promise<SkyAppEntry[]>;
  get_app_state(args: { app: string; disableDiff?: boolean }): Promise<SkyState>;
  click(args: {
    app: string;
    element_index?: number;
    x?: number;
    y?: number;
    mouse_button?: "left" | "right" | "middle" | "l" | "r" | "m";
    click_count?: number;
  }): Promise<SkyState>;
  drag(args: {
    app: string;
    /** 跨 app 拖拽目的地；调用前必须先对两端 get_app_state。 */
    to_app?: string;
    from_x: number;
    from_y: number;
    to_x: number;
    to_y: number;
  }): Promise<SkyState>;
  perform_secondary_action(args: {
    app: string;
    element_index: number;
    action: string;
  }): Promise<SkyState>;
  press_key(args: { app: string; key: string }): Promise<SkyState>;
  scroll(args: {
    app: string;
    element_index: number;
    direction: "up" | "down" | "left" | "right" | "u" | "d" | "l" | "r";
    pages?: number;
  }): Promise<SkyState>;
  select_text(args: {
    app: string;
    element_index: number;
    text: string;
    prefix?: string;
    suffix?: string;
    selection_type?: "text" | "cursor_before" | "cursor_after";
  }): Promise<SkyState>;
  set_value(args: { app: string; element_index: number; value: string }): Promise<SkyState>;
  type_text(args: { app: string; text: string }): Promise<SkyState>;
}

/** agent.browsers 的选择入口（方法集由所选后端 documentation() 运行时给出）。 */
export interface BrowserAgent {
  browsers: {
    list(): Promise<Array<{ id: string; family?: string; displayName?: string }>>;
    get(id: "chrome" | "edge" | "brave" | "chromium" | "extension" | "iab" | string): Promise<BrowserHandle>;
    getForUrl(url: string): Promise<BrowserHandle>;
    getDefault(): Promise<BrowserHandle>;
  };
  documentation: {
    get(topic: string): Promise<string>;
  };
}

/** 浏览器句柄：完整方法契约经 documentation() 读取，此处仅固化已知骨架。 */
export interface BrowserHandle {
  documentation(): Promise<string>;
  tabs: {
    new(init?: { url?: string }): Promise<{ tabId: string; tab: Tab }>;
    list(): Promise<Array<{ id: string; url: string; title?: string }>>;
    claim(id: string): Promise<Tab>;
  };
}

export interface Tab {
  url(): string;
  /** 每次状态变更后内联返回的最新观察（codex/toolSurface 形状）。 */
  observe(): Promise<{ url: string; title?: string; snapshot?: string }>;
  screenshot(): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

/** 宿主写入 mimocode.jsonc 的 mcp.node_repl 条目形状。 */
export interface MimoCodeMcpEntry {
  type: "local";
  command: string[];
  enabled: boolean;
  timeout?: number;
  environment?: Record<string, string>;
}

/** 宿主注入 node_repl 的自动化开关环境变量（本机实证值见 mimocode.jsonc）。 */
export interface MimoAutomationEnv extends Record<string, string | undefined> {
  MIMO_AUTOMATION_COMPUTER_USE_ENABLED?: "0" | "1";
  MIMO_AUTOMATION_BROWSER_USE_ENABLED?: "0" | "1";
  MIMO_PRESENTATION_HOST_SOCKET?: string;
  MIMO_BROWSER_PROVIDER_DESCRIPTOR?: string;
  MIMO_BROWSER_DEFAULT?: "iab" | "extension" | "managed" | "cdp";
  CCU_SAFETY_MODE?: "off" | "prompt" | "smart" | "enforce";
  CCU_LOG_LEVEL?: "debug" | "info" | "warn" | "error";
}
