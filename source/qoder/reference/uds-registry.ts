/**
 * uds-registry.ts — 重构 Qoder 的 UDS + token 注册表协议（cleanroom 实现）
 *
 * 对应机制（证据：agents/qoder/computer-use.md §1/§3、evidence/inventory.md C7）：
 *
 *   Qoder 的 macOS CU 不走 MCP，而是 node_repl 内 SDK `ComputerUse.create()`：
 *
 *   1. 读注册表 ~/.qoder/ipc/computer-use-tools.json：
 *      {protocol:'qoder-computer-use-tools', version:1, socketPath, instanceId, token(≥32)}
 *      读取时强制 lstat 校验 —— 普通文件、非符号链接、mode & 0o077 === 0、属主为当前 uid。
 *   2. ENOENT/ECONNREFUSED → /usr/bin/open -g <QODER_CU_RUNTIME_APP_PATH> 懒拉起
 *      Qoder Computer Use.app，等 10s 内重读注册表。
 *   3. UDS 连接 socketPath → initialize{token, instanceId} 握手；响应 instanceId 必须一致
 *      并返回 sessionId；此后 15s 一次 ping 心跳，失败即断链。
 *   4. 请求 {id(UUID), method, params, hostContext:{sessionId,turnId}}；默认超时 140s
 *      （1–600000ms 可配）；取消发 {method:'cancel'}；超时后 SDK 主动断链 ——
 *      「结果可能已生效，先观察再决定是否重试」，禁止盲目重放。
 *   5. busy 单飞：同一连接同时只允许一个在途请求。
 *
 * 本文件用注入依赖（fs/lstat、spawn、connect、clock）实现协议形状，测试无需真实 Runtime。
 */

export const REGISTRY_PROTOCOL = 'qoder-computer-use-tools';
export const REGISTRY_VERSION = 1;
export const MIN_TOKEN_LENGTH = 32;
export const LAUNCH_WAIT_MS = 10_000;
export const PING_INTERVAL_MS = 15_000;
export const DEFAULT_TIMEOUT_MS = 140_000;
export const MIN_TIMEOUT_MS = 1;
export const MAX_TIMEOUT_MS = 600_000;

/** 注册表文件形状 */
export interface CuToolsRegistry {
  protocol: typeof REGISTRY_PROTOCOL;
  version: number;
  socketPath: string;
  instanceId: string;
  token: string;
}

/** lstat 结果的最小形状（测试注入用） */
export interface StatLike {
  isFile: boolean;
  isSymbolicLink: boolean;
  mode: number;
  uid: number;
}

export type RegistryReadResult =
  | { ok: true; registry: CuToolsRegistry }
  | { ok: false; code: 'REGISTRY_NOT_FOUND' | 'REGISTRY_INSECURE' | 'REGISTRY_MALFORMED' | 'REGISTRY_PROTOCOL_MISMATCH'; detail?: string };

/**
 * 注册表安全读取（对应 SDK socketTransport.ts 的强校验）。
 */
export function readRegistry(
  lstat: (path: string) => Promise<StatLike>,
  readFile: (path: string) => Promise<string>,
  uid: number,
): (path: string) => Promise<RegistryReadResult> {
  return async (path) => {
    let st: StatLike;
    try {
      st = await lstat(path);
    } catch {
      return { ok: false, code: 'REGISTRY_NOT_FOUND' };
    }
    // 四道硬校验：普通文件 / 非符号链接 / 0600 / 属主
    if (!st.isFile || st.isSymbolicLink || (st.mode & 0o077) !== 0 || st.uid !== uid) {
      return { ok: false, code: 'REGISTRY_INSECURE', detail: `mode=${st.mode.toString(8)} uid=${st.uid}` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path));
    } catch (e) {
      return { ok: false, code: 'REGISTRY_MALFORMED', detail: String(e) };
    }
    const reg = parsed as Partial<CuToolsRegistry>;
    if (reg.protocol !== REGISTRY_PROTOCOL || reg.version !== REGISTRY_VERSION) {
      return { ok: false, code: 'REGISTRY_PROTOCOL_MISMATCH' };
    }
    if (typeof reg.socketPath !== 'string' || typeof reg.instanceId !== 'string' ||
        typeof reg.token !== 'string' || reg.token.length < MIN_TOKEN_LENGTH) {
      return { ok: false, code: 'REGISTRY_MALFORMED', detail: 'token must be >= 32 chars' };
    }
    return { ok: true, registry: reg as CuToolsRegistry };
  };
}

export interface UdsConnection {
  send: (msg: Record<string, unknown>) => void;
  close: () => void;
}

/** 连接工厂注入点（测试用内存连接；生产为 node:net connect(socketPath)） */
export type ConnectFn = (socketPath: string, onMessage: (m: Record<string, unknown>) => void) => Promise<UdsConnection>;

/** 懒拉起注入点（生产为 spawn('/usr/bin/open', ['-g', appPath])） */
export type LaunchFn = (appPath: string) => void;

export interface ComputerUseClientOpts {
  appPath: string;
  connect: ConnectFn;
  launch: LaunchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class ComputerUseError extends Error {
  public result: unknown;
  constructor(message: string, result?: unknown) {
    super(message);
    this.result = result;
  }
}

/**
 * ComputerUseClient：注册表 → 懒拉起 → 握手 → 单飞请求 的骨架。
 */
export class ComputerUseClient {
  private conn: UdsConnection | null = null;
  private sessionId: string | null = null;
  private instanceId: string | null = null;
  private busy = false;
  private pending: ((m: Record<string, unknown>) => void) | null = null;
  private lastSeen = 0;

  private opts: ComputerUseClientOpts;

  constructor(opts: ComputerUseClientOpts) {
    this.opts = opts;
  }

  private get now(): () => number {
    return this.opts.now ?? (() => Date.now());
  }

  /**
   * 建立会话：读注册表；不存在/拒连 → open -g 懒拉起并重试（等 10s）；
   * 成功后 initialize 握手（instanceId 必须一致）。
   */
  async create(
    readReg: (path: string) => Promise<RegistryReadResult>,
    hostContext: { sessionId: string; turnId: string },
  ): Promise<{ sessionId: string }> {
    const regPath = `${process.env['QODER_HOME'] ?? '~/.qoder'}/ipc/computer-use-tools.json`;
    let res = await readReg(regPath);
    if (!res.ok && res.code === 'REGISTRY_NOT_FOUND') {
      this.opts.launch(this.opts.appPath); // /usr/bin/open -g
      const deadline = this.now() + LAUNCH_WAIT_MS;
      while (this.now() < deadline) {
        await (this.opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(250);
        res = await readReg(regPath);
        if (res.ok || res.code !== 'REGISTRY_NOT_FOUND') break;
      }
    }
    if (!res.ok) throw new ComputerUseError(`registry: ${res.code}${'detail' in res ? ` (${res.detail})` : ''}`);

    const reg = res.registry;
    this.conn = await this.opts.connect(reg.socketPath, (m) => {
      this.lastSeen = this.now();
      this.pending?.(m);
    });
    // 心跳看门狗（骨架记录上次响应；真实实现为 15s 定时 ping，失败断链）
    this.instanceId = reg.instanceId;
    const hello: Record<string, unknown> = await this.roundtrip({
      method: 'initialize', params: { token: reg.token, instanceId: reg.instanceId }, hostContext,
    });
    if (hello['instanceId'] !== reg.instanceId || typeof hello['sessionId'] !== 'string') {
      this.conn.close();
      throw new ComputerUseError('initialize: instanceId mismatch or sessionId missing');
    }
    this.sessionId = String(hello['sessionId']);
    this.lastSeen = this.now();
    return { sessionId: this.sessionId };
  }

  /**
   * 单飞请求：同一连接同时只允许一个在途（busy 标志）；
   * 超时主动断链，抛错文案强调「先观察再决定是否重试」。
   */
  async request(method: string, params: Record<string, unknown>, hostContext: { sessionId: string; turnId: string }, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, unknown>> {
    if (this.busy) throw new ComputerUseError('Await the previous Computer Use action before starting another');
    if (!this.conn) throw new ComputerUseError('not connected; call create() first');
    const clamped = Math.min(Math.max(timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
    this.busy = true;
    const started = this.now();
    try {
      return await this.roundtrip({ id: `${started}`, method, params, hostContext }, clamped);
    } finally {
      this.busy = false;
    }
  }

  /** 取消（{method:'cancel'}） */
  cancel(hostContext: { sessionId: string; turnId: string }): void {
    this.conn?.send({ method: 'cancel', hostContext });
  }

  private roundtrip(msg: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const conn = this.conn!;
      const timer = setTimeout(() => {
        this.pending = null;
        conn.close(); // 超时主动断链：结果可能已生效
        this.conn = null;
        reject(new ComputerUseError('request timed out; the connection was closed — the action may have taken effect, observe before retrying'));
      }, timeoutMs);
      this.pending = (m) => {
        clearTimeout(timer);
        this.pending = null;
        if (m['error']) reject(new ComputerUseError(String(m['error']), m['result']));
        else resolve(m);
      };
      conn.send(msg);
    });
  }
}
