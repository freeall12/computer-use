/**
 * webbridge-codec.ts — 重构 kimi-webbridge 的 HTTP /command 信封协议编解码器（cleanroom 实现）
 *
 * 对应机制（证据：agents/kimi-code/browser-use.md §2.2/§2.3/§2.6、evidence/inventory.md §8.1）：
 *
 *   agent → daemon：HTTP POST http://127.0.0.1:10086/command，
 *   请求体 {action, args, session}；daemon → 扩展（WS）→ 页面执行。
 *   应答信封：成功 {"ok":true,"data":…}，失败 {"ok":false,"error":{"code","message"}}。
 *   session 语义：一个任务=一个会话=一个 Chrome tab group；
 *   find_tab active:true 借用用户正看的 tab（borrowed:true，不并入组）；
 *   find_tab 按 host 匹配（kimi.com 匹配 www.kimi.com，忽略 path）。
 *   端口治理：绑非回环有明文警告 "any client on the network can drive your browser"。
 *
 * 本文件只做协议形状：编解码 + 命令注册表 + host 匹配 + 回环校验。不含 Kimi 专有代码。
 */

export interface WebBridgeRequest {
  action: string;
  args?: Record<string, unknown>;
  session: string;
}

export type WebBridgeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** SKILL 工具表 14 命令 + 正文提及的 read_page/wait（共 16） */
export const WEBBRIDGE_COMMANDS = [
  'navigate', 'find_tab', 'snapshot', 'click', 'fill', 'evaluate', 'cdp', 'screenshot',
  'network', 'upload', 'save_as_pdf', 'list_tabs', 'close_tab', 'close_session',
  'read_page', 'wait',
] as const;

export type WebBridgeCommand = (typeof WEBBRIDGE_COMMANDS)[number];

/** 信封编解码 */
export class WebBridgeCodec {
  encodeRequest(req: WebBridgeRequest): string {
    if (!req.session || typeof req.session !== 'string') {
      throw new Error('session is required (top-level field)');
    }
    return JSON.stringify({ action: req.action, args: req.args ?? {}, session: req.session });
  }

  decodeRequest(body: string): WebBridgeRequest {
    const parsed = JSON.parse(body) as Partial<WebBridgeRequest>;
    if (typeof parsed.action !== 'string' || typeof parsed.session !== 'string') {
      throw new Error('request requires string fields: action, session');
    }
    if (!this.isKnownCommand(parsed.action)) {
      throw new Error(`unknown command: ${parsed.action}`);
    }
    return { action: parsed.action, args: parsed.args ?? {}, session: parsed.session };
  }

  ok<T>(data: T): WebBridgeResponse<T> {
    return { ok: true, data };
  }

  fail(code: string, message: string): WebBridgeResponse<never> {
    return { ok: false, error: { code, message } };
  }

  isKnownCommand(action: string): action is WebBridgeCommand {
    return (WEBBRIDGE_COMMANDS as readonly string[]).includes(action);
  }
}

/**
 * host 匹配（find_tab 语义）：按 host 匹配、忽略 path；
 * kimi.com 匹配 www.kimi.com（registrable domain 归一，骨架用「去 www.」近似）。
 */
export function hostMatches(patternUrl: string, candidateUrl: string): boolean {
  const norm = (u: string): string | null => {
    try {
      const h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
      return h;
    } catch {
      return null;
    }
  };
  const a = norm(patternUrl);
  const b = norm(candidateUrl);
  return a !== null && a === b;
}

/** 回环治理：绑非回环地址 → 明文警告（骨架返回告警文本） */
export function bindAddressWarning(addr: string): string | null {
  const host = addr.replace(/^http:\/\/|^https:\/\//, '').split(':')[0];
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1') return null;
  return 'any client on the network can drive your browser';
}
