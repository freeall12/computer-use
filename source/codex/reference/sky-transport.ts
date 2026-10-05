/**
 * Sky 传输层重构 —— JSON-RPC 2.0 over 「4 字节长度前缀帧」，内存管道对端。
 *
 * 行为规格出处（agents/codex/evidence/inventory.md §3.3 native-pipe.js 反混淆要点）：
 * - 帧格式：4 字节 UInt32LE 长度前缀 + JSON；单帧上限 8 MiB；
 * - `ping {clientApiVersion}` 严格校验 serverApiVersion，不匹配即硬失败
 *   （SkyComputerUseAPIVersionMismatch）；
 * - `request {clientApiVersion, codexTurnMetadata, deadlineUnixMilliseconds, requestType, request}`
 *   ——每个请求都带会话/轮次元数据与截止时间；
 * - 真实系统跑在 Unix socket（com.openai.sky.CUAService/IPC/computeruse.sock）且要求
 *   受信任的 nodeRepl 宿主；本参考实现用内存管道替代 socket，只保留**协议形状**。
 */

export const MAX_FRAME_BYTES = 8 * 1024 * 1024; // 8 MiB

export function encodeFrame(value: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  if (json.length > MAX_FRAME_BYTES) {
    throw new Error(`frame of ${json.length} bytes exceeds the ${MAX_FRAME_BYTES}-byte limit`);
  }
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length, 0);
  return Buffer.concat([head, json]);
}

export function decodeFrame(buffer: Buffer): unknown {
  if (buffer.length < 4) throw new Error("truncated frame header");
  const len = buffer.readUInt32LE(0);
  if (buffer.length - 4 < len) throw new Error("truncated frame body");
  return JSON.parse(buffer.subarray(4, 4 + len).toString("utf8"));
}

// ---------------------------------------------------------------------------
// 内存管道：一对相接的 Endpoint（替代 Unix socket）
// ---------------------------------------------------------------------------

export interface PipeEndpoint {
  send(msg: unknown): void;
  onMessage: ((msg: any) => void) | null;
  /** 已收到的原始帧字节（供测试验证 4B 前缀帧形状） */
  readonly rawFrames: Buffer[];
}

export function createPipePair(): [PipeEndpoint, PipeEndpoint] {
  const wire = (onMessage: (m: any) => void): PipeEndpoint => ({
    onMessage,
    rawFrames: [],
    send(msg) { /* 在下方互相接线 */ },
  }) as PipeEndpoint;
  const [a, b] = [wire(() => {}), wire(() => {})];
  a.send = (msg) => { b.rawFrames.push(encodeFrame(msg)); queueMicrotask(() => b.onMessage?.(msg)); };
  b.send = (msg) => { a.rawFrames.push(encodeFrame(msg)); queueMicrotask(() => a.onMessage?.(msg)); };
  return [a, b];
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 信封
// ---------------------------------------------------------------------------

const VERSION_MISMATCH_CODE = -32001;
export const SERVER_API_VERSION = 3; // mock 服务端的 API 版本

export interface CodexTurnMetadata {
  sessionId: string;
  turnId: string;
  [k: string]: unknown;
}

export class SkyComputerUseAPIVersionMismatch extends Error {
  constructor(detail: { expected: number; actual: number }) {
    super(`incompatibleClientVersion: client API ${detail.actual} != server API ${detail.expected}`);
    this.name = "SkyComputerUseAPIVersionMismatch";
  }
}

export interface SkyClientOptions {
  clientApiVersion: number;
  turnMetadata: CodexTurnMetadata;
  /** 测试用：默认 0（立即到期），仅作形状演示 */
  deadlineMs?: number;
}

export class SkyClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private endpoint: PipeEndpoint;
  private opts: SkyClientOptions;

  constructor(endpoint: PipeEndpoint, opts: SkyClientOptions) {
    this.endpoint = endpoint;
    this.opts = opts;
    endpoint.onMessage = (msg: any) => {
      const id = msg?.id;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (msg.error) {
        const err = new Error(msg.error.message ?? "sky error");
        (err as any).code = msg.error.code;
        (err as any).data = msg.error.data;
        entry.reject(err);
      } else {
        entry.resolve(msg.result);
      }
    };
  }

  /** ping + API 版本强校验（不匹配即硬失败） */
  async ping(): Promise<number> {
    const result = await this.rpc("ping", { clientApiVersion: this.opts.clientApiVersion });
    if (result.serverApiVersion !== SERVER_API_VERSION) {
      throw new SkyComputerUseAPIVersionMismatch({ expected: SERVER_API_VERSION, actual: result.serverApiVersion });
    }
    return result.serverApiVersion;
  }

  /**
   * 业务请求信封：requestType + request + codexTurnMetadata + deadlineUnixMilliseconds。
   * 「每个请求都带会话/轮次元数据与截止时间」——服务端据此做策略判定与审计。
   */
  async request(requestType: string, request: unknown): Promise<any> {
    return this.rpc("request", {
      clientApiVersion: this.opts.clientApiVersion,
      codexTurnMetadata: this.opts.turnMetadata,
      deadlineUnixMilliseconds: Date.now() + (this.opts.deadlineMs ?? 0),
      requestType,
      request,
    });
  }

  private rpc(method: string, params: unknown): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.endpoint.send({ jsonrpc: "2.0", id, method, params });
    });
  }
}

/** 服务端分派器：ping 响应版本；request 信封校验 + 转发 handler */
export function serveSky(endpoint: PipeEndpoint, handlers: {
  request(requestType: string, request: any): unknown;
}): {
  /** 服务端收到的 request 信封（供测试断言元数据存在） */
  readonly receivedEnvelopes: Array<Record<string, unknown>>;
} {
  const receivedEnvelopes: Array<Record<string, unknown>> = [];
  endpoint.onMessage = (msg: any) => {
    const reply = (result: unknown) => endpoint.send({ jsonrpc: "2.0", id: msg.id, result });
    const fail = (code: number, message: string) => endpoint.send({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
    if (msg.method === "ping") {
      const clientV = msg.params?.clientApiVersion;
      if (clientV !== SERVER_API_VERSION) {
        return fail(VERSION_MISMATCH_CODE, `incompatibleClientVersion: ${clientV}`);
      }
      return reply({ serverApiVersion: SERVER_API_VERSION });
    }
    if (msg.method === "request") {
      const p = msg.params ?? {};
      if (p.clientApiVersion !== SERVER_API_VERSION) {
        return fail(VERSION_MISMATCH_CODE, "incompatibleClientVersion");
      }
      receivedEnvelopes.push(p);
      try {
        return reply(handlers.request(p.requestType, p.request));
      } catch (e: any) {
        return fail(e.code ?? -32000, e.message ?? "service error");
      }
    }
    return fail(-32601, `method not found: ${msg.method}`);
  };
  return { receivedEnvelopes };
}
