/**
 * lease-fencing.ts — 重构 MiniMax Code 的控制租约与 generation fencing（cleanroom 实现）
 *
 * 对应机制（证据：agents/minimax-code/computer-use.md §3.3-3.4）：
 *
 * 1. generation fencing：每次重建 utility process / MessagePort 通道时 generation +1；
 *    所有控制消息必须携带匹配的 generation，旧进程/旧通道的消息被拒绝
 *    （computer_generation_mismatch），防止串话。
 *
 * 2. 单会话控制租约（lease）：
 *    - 只有「变更类」请求需要持有 lease；观察类（app_list/window_list/display_list/
 *      desktop_state/app_state/verify_state）不占租约。
 *    - 单持有者：另一会话的变更请求被拒绝（"Another conversation owns the computer
 *      control lease."）。
 *    - lease 带 TTL 定时器；显式 cua-release 按 sessionId/turnId 去重（FIFO 缓存
 *      64 条已释放 turn，防重复释放）或会话结束即释放。
 *
 * 本文件只实现协议形状与核心机制，不含 MiniMax 专有代码。
 */

/** 请求信封形状（宿主 ⇄ CUA utility process，version:1 JSON） */
export interface CuaRequest {
  version: 1;
  requestId: string;
  kind: string;
  sessionId: string;
  turnId: string;
  generation: number;
  leaseId?: string;
  payload: Record<string, unknown>;
}

export type CuaResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; completion: 'not_started' | 'unknown' } };

/** 观察类 kind：不占租约（分册 isMutatingRequest 的补集） */
export const OBSERVING_KINDS: ReadonlySet<string> = new Set([
  'app_list',
  'window_list',
  'display_list',
  'desktop_state',
  'app_state',
  'verify_state',
]);

export function isMutatingRequest(kind: string): boolean {
  return !OBSERVING_KINDS.has(kind);
}

export const RELEASED_TURN_CACHE_LIMIT = 64;

interface Lease {
  sessionId: string;
  turnId: string;
  leaseId: string;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * CuaLeaseServer：宿主侧租约/代际仲裁器骨架。
 */
export class CuaLeaseServer {
  private generation = 0;
  private lease: Lease | null = null;
  private releasedTurns: string[] = []; // FIFO，上限 64
  private ttlMs: number;

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  /** 每次重建 utility 进程/通道时递增（对应宿主 index.js 的 generation +1） */
  bumpGeneration(): number {
    this.generation += 1;
    // 旧代际的租约随旧进程一起失效
    this.clearLeaseTimer();
    this.lease = null;
    return this.generation;
  }

  currentGeneration(): number {
    return this.generation;
  }

  /**
   * 请求仲裁入口。返回 CuaResponse；错误码与分册记录一致。
   */
  handleRequest(req: CuaRequest): CuaResponse {
    // generation fencing：旧通道消息直接拒绝
    if (req.generation !== this.generation) {
      return err('computer_generation_mismatch', 'stale generation; a newer utility process owns the channel', 'not_started');
    }
    if (!isMutatingRequest(req.kind)) {
      return ok({ observed: req.kind }); // 观察类不占租约，直接放行
    }
    if (this.lease && this.lease.sessionId !== req.sessionId) {
      return err('computer_lease_held', 'Another conversation owns the computer control lease.', 'not_started');
    }
    if (!this.lease) this.acquireLease(req.sessionId, req.turnId);
    return ok({ dispatched: req.kind, leaseId: this.lease!.leaseId });
  }

  /**
   * 显式释放（对应 cua-release）：按 sessionId/turnId 去重；重复释放是 no-op。
   */
  release(sessionId: string, turnId: string): void {
    const key = `${sessionId}/${turnId}`;
    if (this.releasedTurns.includes(key)) return; // 已释放过，幂等
    this.releasedTurns.push(key);
    if (this.releasedTurns.length > RELEASED_TURN_CACHE_LIMIT) this.releasedTurns.shift();
    if (this.lease && this.lease.sessionId === sessionId) {
      this.clearLeaseTimer();
      this.lease = null;
    }
  }

  leaseHolder(): string | null {
    return this.lease?.sessionId ?? null;
  }

  private acquireLease(sessionId: string, turnId: string): void {
    this.clearLeaseTimer();
    this.lease = {
      sessionId,
      turnId,
      leaseId: `lease-${sessionId}-${turnId}`,
      timer: setTimeout(() => {
        // TTL 到期自动释放（空闲过期；后续变更请求会重新获取）
        this.lease = null;
      }, this.ttlMs),
    };
  }

  private clearLeaseTimer(): void {
    if (this.lease?.timer) clearTimeout(this.lease.timer);
  }
}

function ok(result: unknown): CuaResponse {
  return { ok: true, result };
}

function err(code: string, message: string, completion: 'not_started' | 'unknown'): CuaResponse {
  return { ok: false, error: { code, message, completion } };
}
