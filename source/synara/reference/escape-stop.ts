/**
 * escape-stop.ts — 重构 Synara 的「物理 Escape 急停 + 人接管」安全层（cleanroom 实现）
 *
 * 对应机制（证据：agents/synara/computer-use.md §6.5/§6.6、evidence/inventory.md B12/B13）：
 *
 * 1. Escape 监听专职化：appsnap-helper --escape-monitor 是独立进程，【仅在存在活跃
 *    driver generation 时武装】（main.js updateInputMonitorArmed）—— 无前台任务时不监听，
 *    避免常驻窥探键盘。
 * 2. 急停效果：触发 emergency interrupt + 输入冷却窗（ESCAPE_INPUT_COOLDOWN_MS，
 *    冷却窗内拒绝派发新的前台输入）。
 * 3. 用户 Stop 语义：撤销本轮前台授权，但不撤销 OS 授权（TCC 授权不受影响）。
 * 4. 人接管边界：仅当 Agent 正有【前台】动作在途时，物理键鼠才打断它；后台控制刻意
 *    不被人输入打断（"Background control shares the Mac with the human"）。
 * 5. 在途丢失语义：打断后 epoch 推进，旧在途动作按「已派发-效果未知」上报；
 *    恢复派发前须重新观察并确认状态新鲜。
 */

export interface EscapeMonitorInput {
  /** 是否存在活跃 driver generation（由宿主维护） */
  hasActiveGeneration: boolean;
  /** 当前是否有前台动作在途 */
  foregroundActionInFlight: boolean;
}

/** Escape 冷却窗时长（分册未给出精确数值，行为规格=存在冷却窗；此处取保守默认） */
export const ESCAPE_INPUT_COOLDOWN_MS = 2_000;

export type DispatchVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'not_armed' | 'cooldown_active' | 'takeover_pending_reobserve'; effect: 'not_dispatched' | 'dispatched_effect_unknown' };

/**
 * EscapeStopController：急停与人接管的状态机骨架。
 */
export class EscapeStopController {
  private armed = false;
  private cooldownUntil = 0;
  private epoch = 0;
  private pendingReobserve = false;

  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** 每次原生输入派发推进 epoch（在途结果按「已派发-效果未知」上报） */
  currentEpoch(): number {
    return this.epoch;
  }

  /** 武装状态跟随活跃 generation（对应 updateInputMonitorArmed） */
  updateArmed(i: EscapeMonitorInput): boolean {
    this.armed = i.hasActiveGeneration;
    return this.armed;
  }

  /**
   * 物理 Escape 到达：仅在武装时生效；进入冷却窗 + epoch 推进 + 要求重新观察。
   */
  onPhysicalEscape(): boolean {
    if (!this.armed) return false;
    this.cooldownUntil = this.now() + ESCAPE_INPUT_COOLDOWN_MS;
    this.epoch += 1;
    this.pendingReobserve = true;
    return true;
  }

  /**
   * 用户物理键鼠输入：仅在前台动作在途时打断（后台控制不打断）。
   */
  onHumanPhysicalInput(i: EscapeMonitorInput): boolean {
    if (!i.foregroundActionInFlight) return false; // 后台刻意不受人输入影响
    this.epoch += 1;
    this.pendingReobserve = true;
    return true;
  }

  /**
   * 派发前置检查。急停/接管后须先重新观察（状态新鲜确认）才恢复派发。
   */
  assertDispatchable(): DispatchVerdict {
    if (!this.armed) return { allowed: false, reason: 'not_armed', effect: 'not_dispatched' };
    if (this.now() < this.cooldownUntil) {
      return { allowed: false, reason: 'cooldown_active', effect: 'not_dispatched' };
    }
    if (this.pendingReobserve) {
      return { allowed: false, reason: 'takeover_pending_reobserve', effect: 'not_dispatched' };
    }
    return { allowed: true };
  }

  /** 重新观察完成（状态新鲜确认后清屏障） */
  markReobserved(): void {
    this.pendingReobserve = false;
  }

  /**
   * 用户 Stop：撤销本轮前台授权（由调用方把 ForegroundAuthorizer 的授权链复位），
   * 但不撤销 OS 授权（TCC 状态不由本层管理）。
   */
  onUserStop(): void {
    this.cooldownUntil = 0;
    this.pendingReobserve = false;
    this.epoch += 1;
  }

  /** 在途动作被打断时的上报形状：已派发-效果未知 */
  static inFlightReport(action: string, dispatchedEpoch: number, currentEpoch: number): Record<string, unknown> {
    return {
      action,
      status: 'dispatched_effect_unknown',
      dispatchedEpoch,
      currentEpoch,
      stale: dispatchedEpoch !== currentEpoch,
    };
  }
}
