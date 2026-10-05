/**
 * sidecarClient.ts — CU sidecar 客户端骨架（cleanroom 重写）
 *
 * 实现协议形状：service.json 发现 → 惰性拉起（open -g）→ 就绪轮询（ping）→
 * tools/call / control 会话 → 预投递连接错误 relaunch 重试。
 * 不连接真实服务：socket 层注入 transport 抽象，供 fake sidecar 冒烟（demo.mjs）。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CLIENT_TIMING, SIDECAR_VARIANTS, ServiceState, SidecarVariant,
  RpcRequest, RpcResponse, RpcMethodName, ControlMode,
  encodeFrame, createFrameSplitter,
} from './protocol.ts';

/** socket 传输抽象：生产实现为 node:net createConnection；demo 注入内存双工 */
export interface SocketTransport {
  connect(socketPath: string, onData: (chunk: string) => void): Promise<{ write(frame: string): void; destroy(): void }>;
}

export interface SidecarClientOptions {
  variant?: SidecarVariant;
  /** 覆盖 service.json 目录（对应 env CUA_APP_SUPPORT_DIR） */
  appSupportDirOverride?: string;
  /** 覆盖 sidecar .app 路径（对应 env GROK_BOT_SIDECAR_APP） */
  sidecarAppOverride?: string;
  /** 拉起实现（生产：/usr/bin/open -g <app>；直启分支对应 CUA_DIRECT_LAUNCH=1） */
  launch?: (appPath: string) => Promise<void>;
  transport: SocketTransport;
  now?: () => number;
}

export class SidecarRpcError extends Error {
  constructor(message: string, public readonly errorCode?: string, public readonly tool?: string) {
    super(message);
    this.name = 'SidecarRpcError';
  }
}

export class GrokSidecarClient {
  private readonly variant: SidecarVariant;
  private activeSessionId: string | undefined;
  private mode: ControlMode = 'companion';

  constructor(private readonly options: SidecarClientOptions) {
    this.variant = options.variant ?? 'prod';
  }

  // ---------- 服务发现与拉起 ----------

  serviceStatePath(): string {
    const dir = this.options.appSupportDirOverride
      ?? path.join(os.homedir(), 'Library', 'Application Support', SIDECAR_VARIANTS[this.variant].appSupportDir);
    return path.join(dir, 'service.json');
  }

  serviceAppPath(): string {
    return this.options.sidecarAppOverride
      ?? path.join(os.homedir(), '.grok-bot', 'computer-use', `${SIDECAR_VARIANTS[this.variant].appName}.app`);
  }

  async readServiceState(): Promise<ServiceState | undefined> {
    try {
      const raw = await fs.readFile(this.serviceStatePath(), 'utf8');
      const parsed = JSON.parse(raw) as ServiceState;
      return typeof parsed.rpcSocketPath === 'string' && parsed.rpcSocketPath.length > 0 ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async launchAndWait(signal?: AbortSignal): Promise<ServiceState> {
    await (this.options.launch ?? (async (app) => { throw new Error(`no launch implementation for ${app}`); }))(this.serviceAppPath());
    const deadline = (this.options.now ?? Date.now)() + CLIENT_TIMING.launchReadyTimeoutMs;
    for (;;) {
      if (signal?.aborted) throw new Error('aborted');
      const state = await this.readServiceState();
      if (state) {
        try {
          await this.sendOnce(state.rpcSocketPath, this.frame('ping'), 2_000, signal);
          return state;
        } catch { /* 未就绪，继续轮询 */ }
      }
      if ((this.options.now ?? Date.now)() >= deadline) throw new SidecarRpcError('local-cua sidecar did not become ready in time');
      await sleep(CLIENT_TIMING.launchPollIntervalMs, signal);
    }
  }

  private async ensureSocketPath(forceRelaunch = false, signal?: AbortSignal): Promise<string> {
    if (!forceRelaunch) {
      const state = await this.readServiceState();
      if (state) return state.rpcSocketPath;
    }
    const state = await this.launchAndWait(signal);
    return state.rpcSocketPath;
  }

  // ---------- 请求 ----------

  private frame(method: RpcMethodName, extra: Partial<RpcRequest> = {}): RpcRequest {
    const now = (this.options.now ?? Date.now)();
    return {
      id: `req-${now}-${Math.random().toString(16).slice(2)}`,
      method,
      requestID: crypto.randomUUID(),
      timeoutSeconds: CLIENT_TIMING.defaultCallTimeoutMs / 1000,
      startedAtEpochSeconds: now / 1000,
      deadlineEpochSeconds: now / 1000 + CLIENT_TIMING.defaultCallTimeoutMs / 1000,
      ...extra,
    };
  }

  private sendOnce(socketPath: string, req: RpcRequest, timeoutMs: number, signal?: AbortSignal): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn(); } };
      const onAbort = () => finish(() => reject(new SidecarRpcError('local-cua RPC aborted')));
      const timer = setTimeout(() => finish(() => reject(new SidecarRpcError(`local-cua RPC timed out after ${timeoutMs}ms`))), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      let buffer = '';
      this.options.transport.connect(socketPath, (chunk) => {
        buffer += chunk;
        const nl = buffer.indexOf('\n');
        if (nl < 0) return;
        finish(() => {
          try { resolve(JSON.parse(buffer.slice(0, nl)) as RpcResponse); }
          catch (e) { reject(new SidecarRpcError('RPC response encoding failed', undefined, req.name)); }
        });
      }).then((socket) => {
        socket.write(encodeFrame(req));
      }).catch((e) => finish(() => reject(e)));
    });
  }

  /** 带预投递错误 relaunch 重试的调用（observed：ENOENT/ECONNREFUSED → 拉起后重试一次） */
  private async call(reqFactory: () => RpcRequest, signal?: AbortSignal): Promise<RpcResponse> {
    const socketPath = await this.ensureSocketPath(false, signal);
    try {
      return await this.sendOnce(socketPath, reqFactory(), CLIENT_TIMING.defaultCallTimeoutMs, signal);
    } catch (e) {
      const code = (e as ErrnoException).code ?? (e as Error).message;
      if (!CLIENT_TIMING.relaunchOnConnectionErrors.some((c) => code.includes(c))) throw e;
      const fresh = await this.ensureSocketPath(true, signal);
      // 远程会话随 sidecar 重启失效：重建（observed：relaunch 后 startControl 重建 sessionId）
      if (this.activeSessionId !== undefined && this.mode === 'remote') {
        this.activeSessionId = undefined;
        await this.startControl(signal);
      }
      return await this.sendOnce(fresh, reqFactory(), CLIENT_TIMING.defaultCallTimeoutMs, signal);
    }
  }

  // ---------- 公开面 ----------

  async listTools(signal?: AbortSignal): Promise<unknown> {
    const res = await this.call(() => this.frame('tools/list'), signal);
    this.throwIfError(res, 'tools/list');
    return res.result;
  }

  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    const res = await this.call(() => this.frame('tools/call', { name, arguments: args, mode: this.mode, ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}) }), signal);
    this.throwIfError(res, name);
    return res.result;
  }

  /** 仅 remote 模式可起会话（observed："control/start requires remote mode"） */
  async startControl(signal?: AbortSignal): Promise<string> {
    if (this.mode !== 'remote') throw new SidecarRpcError('control/start requires remote mode');
    if (this.activeSessionId !== undefined) return this.activeSessionId;
    const res = await this.call(() => this.frame('control/start', { mode: this.mode }), signal);
    this.throwIfError(res, 'control/start');
    if (typeof res.sessionId !== 'string') throw new SidecarRpcError('control/start returned no session');
    this.activeSessionId = res.sessionId;
    return res.sessionId;
  }

  async releaseControl(signal?: AbortSignal): Promise<void> {
    const sessionId = this.activeSessionId;
    if (sessionId === undefined) return;
    this.activeSessionId = undefined;
    try {
      const res = await this.call(() => this.frame('control/release', { mode: this.mode, sessionId }), signal);
      this.throwIfError(res, 'control/release');
    } catch (e) {
      // best-effort 释放（observed 语义）：释放失败不阻塞调用方
    }
  }

  async checkPermissions(signal?: AbortSignal): Promise<PermissionStatus> {
    const res = await this.call(() => this.frame('tools/call', { name: 'computer_use_check_permissions', arguments: {} }), signal);
    this.throwIfError(res, 'computer_use_check_permissions');
    return (res.result ?? { accessibility: false, screenRecording: false }) as PermissionStatus;
  }

  private throwIfError(res: RpcResponse, tool?: string): void {
    if (res.error !== undefined) throw new SidecarRpcError(res.error, res.errorCode, tool);
    if (res.isError) throw new SidecarRpcError(res.message && res.message.length > 0 ? res.message : `tool ${tool} reported an error`, res.errorCode, tool);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
}
