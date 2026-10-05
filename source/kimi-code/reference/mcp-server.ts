/**
 * mcp-server.ts — 重构 KimiCU 的 stdio MCP server 骨架 + 内存模拟 AX 树应答（cleanroom 实现）
 *
 * 对应机制（证据：agents/kimi-code/computer-use.md §2/§3、evidence/inventory.md §3.4/§4）：
 *
 *   KimiCU 的 MCP 入口是同一个 Swift 二进制的 `kimi-cu mcp` 子命令（server 名 plugin-kimi-cu:mac），
 *   注册 18 个 CU 工具 + js/js_reset。工具 schema 关键机制：
 *   - snapshot_id 绑定：get_app_state 产生 AX 快照身份；click(type:index)/set_value/scroll/
 *     select_text/perform_secondary_action 携带的 snapshot_id 「stale or other-context IDs
 *     are rejected」—— 跨观察上下文复用索引直接拒绝。
 *   - observation_context：client 随机 UUID，hello 握手回显校验；快照/坐标缓存跨上下文不可复用。
 *   - 参数双轨别名（snake/camel），未知字段严格拒绝（KIMI_CU_UNKNOWN_FIELD）。
 *   - 投递验证三态：verified / verified:false+verification_required / effect:unverifiable。
 *   - UDS 帧协议 KimiCU-UDS-1：4 字节 LE 长度 + UTF-8 JSON，MAX_FRAME_BYTES=8MiB；
 *     hello {type:'hello', token, protocol, versions, client_name, observation_context}。
 *
 * 本文件：
 *   1. UdsFrameCodec —— KimiCU-UDS-1 帧编解码（纯协议形状）；
 *   2. FakeAppModel —— 内存模拟的 AX 树应用（供测试与理解应答形状）；
 *   3. KimiCuMcpServer —— stdio JSON-RPC 骨架：initialize / tools/list（18 工具）/
 *      tools/call（模拟应答）。
 *
 * 不含 Kimi 任何专有代码。
 */

// ---------------------------------------------------------------- UDS 帧协议

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const UDS_PROTOCOL = 'KimiCU-UDS-1';

export interface HelloMessage {
  type: 'hello';
  token: string;
  protocol: typeof UDS_PROTOCOL;
  versions: number[];
  client_name: string;
  observation_context: string;
}

/** 4 字节小端长度前缀 + UTF-8 JSON（上限 8MiB） */
export class UdsFrameCodec {
  encode(obj: unknown): Buffer {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    if (payload.length > MAX_FRAME_BYTES) throw new Error(`frame exceeds ${MAX_FRAME_BYTES} bytes`);
    const head = Buffer.alloc(4);
    head.writeUInt32LE(payload.length, 0);
    return Buffer.concat([head, payload]);
  }

  /** 从累积缓冲中解出完整帧（返回剩余未消费字节） */
  decode(buf: Buffer): { messages: unknown[]; rest: Buffer } {
    const messages: unknown[] = [];
    let offset = 0;
    while (buf.length - offset >= 4) {
      const len = buf.readUInt32LE(offset);
      if (len > MAX_FRAME_BYTES) throw new Error('frame exceeds MAX_FRAME_BYTES');
      if (buf.length - offset - 4 < len) break; // 半帧，等待更多数据
      messages.push(JSON.parse(buf.subarray(offset + 4, offset + 4 + len).toString('utf8')));
      offset += 4 + len;
    }
    return { messages, rest: buf.subarray(offset) };
  }
}

// ------------------------------------------------------------- 内存 AX 模拟

export interface FakeElement {
  index: number;
  role: string;
  label: string;
  value: string;
  settable: boolean;
}

/** 内存模拟应用：一个窗口 + 线性 AX 元素表（行为规格级，非真实 AXRuntime） */
export class FakeAppModel {
  private seq = 1;
  elements: FakeElement[] = [
    { index: 0, role: 'TextField', label: 'Search', value: '', settable: true },
    { index: 1, role: 'Button', label: 'Submit', value: '', settable: false },
    { index: 2, role: 'StaticText', label: 'Welcome', value: '', settable: false },
  ];
  /** 每次观察产生的新快照身份 */
  observe(observationContext: string): { snapshot_id: string; elements: FakeElement[] } {
    return { snapshot_id: `snap-${observationContext}-${this.seq++}`, elements: this.elements.map((e) => ({ ...e })) };
  }
}

// ------------------------------------------------------------- MCP server 骨架

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** 18 个 CU 工具名（顺序与二进制内嵌 schema 一致） */
export const CU_TOOL_NAMES = [
  'list_apps', 'list_windows', 'get_window', 'launch_app', 'get_app_state', 'get_window_state',
  'activate_window', 'click', 'type_text', 'paste', 'press_key', 'scroll', 'set_value',
  'perform_secondary_action', 'select_text', 'drag', 'drag_paths', 'debug_tap',
] as const;

const ARG_ALIASES: Record<string, string> = {
  windowId: 'window_id', screenshotId: 'screenshot_id', elementIndex: 'index',
  key: 'keys', selectionType: 'selection', autosubmitSearchFields: 'autosubmit',
};

export class KimiCuMcpServer {
  private snapshots = new Map<string, { context: string; model: FakeAppModel }>();
  private activeContext = 'ctx-default';
  private lastObservation: { context: string; snapshotId: string; model: FakeAppModel } | null = null;

  private app: FakeAppModel;

  constructor(app: FakeAppModel = new FakeAppModel()) {
    this.app = app;
  }

  toolSpecs(): ToolSpec[] {
    // 18 个 CU 工具；js/js_reset 由原生 ToolRouter 另行接受（不在此骨架中注册）。
    return CU_TOOL_NAMES.map((name) => ({
      name,
      description: `KimiCU ${name}（cleanroom 骨架；语义见 schemas/mcp-tools.json）`,
      inputSchema: { type: 'object', additionalProperties: false },
    }));
  }

  /** JSON-RPC 分发（stdio 骨架核心） */
  handleRequest(req: JsonRpcRequest): Record<string, unknown> {
    try {
      if (req.method === 'initialize') {
        return this.result(req, { protocolVersion: '2024-11-05', serverInfo: { name: 'plugin-kimi-cu', version: '0.0.0-cleanroom' } });
      }
      if (req.method === 'tools/list') {
        return this.result(req, { tools: this.toolSpecs() });
      }
      if (req.method === 'tools/call') {
        const name = String(req.params?.name);
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
        return this.result(req, this.callTool(name, args));
      }
      return this.error(req, -32601, `method not found: ${req.method}`);
    } catch (e) {
      return this.error(req, -32603, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * 工具调用（模拟应答）。重点还原三条行为：
   * 未知字段拒绝 / snapshot_id 跨上下文拒绝 / 投递验证三态。
   */
  callTool(name: string, rawArgs: Record<string, unknown>): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    if (!CU_TOOL_NAMES.includes(name as (typeof CU_TOOL_NAMES)[number])) {
      throw new Error(`unknown tool: ${name}`);
    }
    // 1) 别名归一 + 未知字段严格拒绝
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      const canon = ARG_ALIASES[k] ?? k;
      if (!(canon in args) || rawArgs[k] !== undefined) args[canon] = v;
      if (rawArgs[k] !== undefined && !(canon in this.knownFields(name))) {
        throw new Error('KIMI_CU_UNKNOWN_FIELD');
      }
    }
    // 2) 观察类：产生快照（observation_context 换绑 —— 跨上下文缓存不可复用）
    if (name === 'get_app_state') {
      const context = String(args['observation_context'] ?? this.activeContext);
      this.activeContext = context;
      const snap = this.app.observe(context);
      this.lastObservation = { context, snapshotId: snap.snapshot_id, model: this.app };
      this.snapshots.set(snap.snapshot_id, { context, model: this.app });
      return this.text(JSON.stringify({ mode: args['mode'] ?? 'full', snapshot_id: snap.snapshot_id, elements: snap.elements, tree_diff: null }));
    }
    // 3) index 类动作：snapshot_id 绑定校验（含跨 observation_context 拒绝）
    if (['click', 'set_value', 'scroll', 'select_text', 'perform_secondary_action'].includes(name)) {
      const sid = args['snapshot_id'];
      const rec = typeof sid === 'string' ? this.snapshots.get(sid) : undefined;
      if (!rec) {
        throw new Error('snapshot_id is stale or belongs to another observation context');
      }
      if (rec.context !== this.activeContext) {
        throw new Error('snapshot_id is stale or belongs to another observation context');
      }
      const idx = Number(args['index']);
      const el = this.app.elements.find((e) => e.index === idx);
      if (!el) return this.text(JSON.stringify({ ok: false, error: 'element_not_found' }));
      if (name === 'set_value') {
        if (!el.settable) return this.text(JSON.stringify({ ok: false, error: 'element_not_settable' }));
        el.value = String(args['value'] ?? '');
        return this.text(JSON.stringify({ ok: true, verified: true }));
      }
      // 点击对 TextField 是「聚焦」：效果可验证；对无 AX 回读面目标 → Electron 语义的未确认
      const verified = el.role !== 'StaticText';
      return this.text(JSON.stringify({
        ok: true,
        verified,
        verification_required: verified ? undefined : 'screenshot',
      }));
    }
    // 4) 其余工具：形状应答
    return this.text(JSON.stringify({ ok: true, tool: name, simulated: true }));
  }

  private knownFields(_tool: string): Record<string, true> {
    // 骨架：全部工具接受其 schema 内字段（此处按分册常见字段白名单模拟）。
    return {
      index: true, value: true, snapshot_id: true, observation_context: true, mode: true,
      text: true, keys: true, window_id: true, app: true, pid: true, running_only: true,
      x: true, y: true, button: true, count: true, hold_ms: true, hover_ms: true,
      channel: true, allow_foreground_fallback: true, verify_after: true, clear: true,
      submit: true, activate: true, page: true, dx: true, dy: true, autosubmit: true,
      action: true, selection: true, start: true, length: true, prefix: true, suffix: true,
      from_x: true, from_y: true, to_x: true, to_y: true, step_ms: true, steps: true,
      paths: true, abort_if_cursor_in_window: true, seconds: true, code: true, timeout_ms: true,
      screenshot_id: true, rect: true, screenshot_detail: true, disable_diff: true,
      additional_window_ids: true, ax_filter: true, include_screenshot: true, include_text: true,
      format: true,
    };
  }

  private result(req: JsonRpcRequest, result: unknown): Record<string, unknown> {
    return { jsonrpc: '2.0', id: req.id, result };
  }

  private error(req: JsonRpcRequest, code: number, message: string): Record<string, unknown> {
    return { jsonrpc: '2.0', id: req.id, error: { code, message } };
  }

  private text(t: string): { content: Array<{ type: string; text: string }> } {
    return { content: [{ type: 'text', text: t }] };
  }
}
