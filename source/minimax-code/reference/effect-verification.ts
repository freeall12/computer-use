/**
 * effect-verification.ts — 重构 MiniMax Code 的结构化效果验证（effect.verified）三态模型
 * （cleanroom 实现）
 *
 * 对应机制（证据：agents/minimax-code/browser-use.md §4/§5、computer-use.md §5.1）：
 *
 * MiniMax 的 BU 不把「工具调用成功」当作「动作生效」，而是产出结构化效果元数据：
 *   - effect.verified: boolean —— 效果是否已被结构化采样确认；
 *   - verificationRequired: boolean —— 效果未确认时，要求模型先读新状态（反幻觉提示）；
 *   - 不可验证时单独成码（NO_SCROLL_EFFECT / SCROLL_EFFECT_UNVERIFIED）。
 *
 * 具体规则：
 *   1. 普通 click 的 effect.verified 恒为 false 且 verificationRequired: true
 *      （点击回执不证明效果，先读新状态 —— missingClickEffectGuidance）。
 *   2. fill（VERIFIED_FILL）：写入后按 VERIFIED_FILL_SAMPLE_COUNT=4 次、间隔
 *      VERIFIED_FILL_INTERVAL_MS=50ms 采样，值稳定才置 verified=true。
 *   3. scroll 返回 moved/actualDelta/atStart/atEnd；无效果 → NO_SCROLL_EFFECT；
 *      跨域 frame 不可验证 → SCROLL_EFFECT_UNVERIFIED（fail-closed）。
 *   4. CU 侧 computer_verify_state：1-8 个谓词 AND + timeout_ms ≤10s + stable_samples
 *      1-5（连续采样都满足才算稳定）。
 *
 * 本文件为行为规格骨架，不含 MiniMax 专有代码。
 */

export interface ActionEffect {
  action: string;
  /** 三态：confirmed（采样确认）/ unverified（未确认，需读新状态）/ unverifiable（结构上无法验证） */
  status: 'confirmed' | 'unverified' | 'unverifiable';
  verified: boolean;
  verificationRequired: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

/** 分册记录的采样常量 */
export const VERIFIED_FILL_SAMPLE_COUNT = 4;
export const VERIFIED_FILL_INTERVAL_MS = 50;
export const MAX_VERIFY_PREDICATES = 8;
export const MAX_VERIFY_TIMEOUT_MS = 10_000;
export const MAX_STABLE_SAMPLES = 5;

/** 读取页面字段当前值的最小接口（测试里用内存 DOM 模拟） */
export type FieldReader = () => string;

/**
 * 规则 2：VERIFIED_FILL —— 写入后多次采样确认值稳定。
 * 返回结构化 effect；采样期间值不稳定（被页面脚本改写/输入被拦截）→ unverified。
 */
export function verifiedFill(
  readValue: FieldReader,
  expected: string,
  opts?: { samples?: number; intervalMs?: number },
): ActionEffect {
  const samples = opts?.samples ?? VERIFIED_FILL_SAMPLE_COUNT;
  const intervalMs = opts?.intervalMs ?? VERIFIED_FILL_INTERVAL_MS;
  const observed: string[] = [];
  for (let i = 0; i < samples; i++) {
    if (i > 0) {
      // 同步测试环境：以显式推进函数代替真实 sleep；真实实现为 setTimeout。
      advanceClock?.(intervalMs);
    }
    observed.push(readValue());
  }
  const stable = observed.every((v) => v === expected);
  return {
    action: 'fill',
    status: stable ? 'confirmed' : 'unverified',
    verified: stable,
    verificationRequired: !stable,
    reason: stable ? undefined : 'fill value not stable across samples',
    details: { samples: observed },
  };
}

/** 可注入的时钟推进（仅测试用；生产实现用真实定时器） */
export let advanceClock: ((ms: number) => void) | null = null;
export function setAdvanceClock(fn: ((ms: number) => void) | null): void {
  advanceClock = fn;
}

/**
 * 规则 1：click 恒不自动确认效果。
 */
export function clickEffect(extra?: Record<string, unknown>): ActionEffect {
  return {
    action: 'click',
    status: 'unverified',
    verified: false,
    verificationRequired: true,
    reason: 'a click receipt does not prove effect; read the new state first',
    details: extra,
  };
}

/**
 * 规则 3：scroll 结构化效果。scrollable=false 或 delta=0 → NO_SCROLL_EFFECT；
 * 跨域 frame 不可验证 → SCROLL_EFFECT_UNVERIFIED。
 */
export function scrollEffect(input: {
  scrollable: boolean;
  verifiable: boolean;
  actualDelta?: number;
}): ActionEffect {
  if (!input.verifiable) {
    return {
      action: 'scroll',
      status: 'unverifiable',
      verified: false,
      verificationRequired: true,
      reason: 'SCROLL_EFFECT_UNVERIFIED',
    };
  }
  const moved = input.scrollable && (input.actualDelta ?? 0) !== 0;
  return {
    action: 'scroll',
    status: moved ? 'confirmed' : 'unverifiable',
    verified: moved,
    verificationRequired: !moved,
    reason: moved ? undefined : 'NO_SCROLL_EFFECT',
    details: { actualDelta: input.actualDelta ?? 0, atStart: false, atEnd: false },
  };
}

/** verify_state 谓词（CU 侧） */
export interface VerifyPredicate {
  kind: 'window.exists' | 'window.bounds' | 'element.exists' | 'element.value_equals' | 'element.enabled' | 'element.selected';
  role?: string;
  labelContains?: string;
  value?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface VerifyStateInput {
  expect: VerifyPredicate[];
  timeoutMs?: number;
  stableSamples?: number;
}

export interface VerifyStateResult {
  satisfied: boolean;
  checkedAt: number;
  stableSamplesRun: number;
  failedPredicate?: VerifyPredicate;
}

/**
 * 规则 4：computer_verify_state —— expect 1-8 谓词 AND，全部满足且连续
 * stableSamples 次采样都满足才算稳定通过。
 */
export function verifyState(
  input: VerifyStateInput,
  evaluate: (p: VerifyPredicate) => boolean,
): VerifyStateResult {
  if (input.expect.length < 1 || input.expect.length > MAX_VERIFY_PREDICATES) {
    throw new Error(`expect requires 1..${MAX_VERIFY_PREDICATES} predicates`);
  }
  const timeoutMs = Math.min(input.timeoutMs ?? MAX_VERIFY_TIMEOUT_MS, MAX_VERIFY_TIMEOUT_MS);
  const stableSamples = Math.min(Math.max(input.stableSamples ?? 1, 1), MAX_STABLE_SAMPLES);
  const startedAt = Date.now();
  let run = 0;
  let firstFailure: VerifyPredicate | undefined;
  while (run < stableSamples) {
    if (Date.now() - startedAt > timeoutMs) break;
    const failed = input.expect.find((p) => !evaluate(p));
    if (failed) {
      firstFailure = failed;
      break;
    }
    run++;
  }
  return {
    satisfied: run >= stableSamples && !firstFailure,
    checkedAt: Date.now(),
    stableSamplesRun: run,
    failedPredicate: firstFailure,
  };
}
