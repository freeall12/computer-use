/**
 * visible-use-authorizer.ts — 重构 Synara 的「前台可见使用」授权前置层（cleanroom 实现）
 *
 * 对应机制（证据：agents/synara/computer-use.md §6.3、evidence/inventory.md B9/B10）：
 *
 * Synara 的前台（抢焦点/可见窗口）桌面与浏览器动作不靠模型自我声明，而是由服务端的
 * computerVisibleUse 模块从【用户消息文本】推断授权意图。行为规格：
 *
 *   1. 注入剥离：引用块/代码块/引号内文本先剥离 —— 防止页面注入文本骗授权。
 *   2. 可见使用意图正则族（英文+意大利语）：如 "show me…" / "let me watch you…" /
 *      "bring … to the front" / "take over my screen/desktop/computer"。
 *      注意：分册只记录了正则族的代表性样例，本文件的正则是按行为规格 cleanroom 重写，
 *      非上游原文。
 *   3. 后台倾向短语否决："don't show…" / "keep … background" 等直接否决前台。
 *   4. 问答回路：助手提问 + 用户肯定回答（yes/sì/…）或结构化批准卡答案亦可授予。
 *   5. 授权屏障：授权只沿「例行继续」（continue/keep going 等）存续；任何新指令、拒绝
 *      或非人来源消息都是屏障 —— 后来的 continue 不能从无关历史任务恢复授权。
 *   6. 2 秒安静期：用户在 2 秒内物理操作过桌面 → foreground_user_interaction（否决），
 *      否则未授权拒绝码为 foreground_not_requested。
 *   7. Space 指定：把任务固定到指定 Space 需用户整句显式写出
 *      "use the space id N for this task"（引号示例/Mission Control 布局/provider 输出无效）。
 *
 * 常量与分册对齐：COMPUTER_USER_INTERACTION_QUIET_MS = 2000（index.mjs:2835）。
 */

/** 用户侧消息（供授权判定） */
export interface UserMessage {
  text: string;
  /** 消息来源；非人来源（tool/provider/system）永远不构成授权 */
  origin: 'human' | 'tool' | 'provider' | 'system';
  /** 结构化批准卡答案（用户点击卡片选项） */
  approvalCardAnswer?: { question: string; affirmative: boolean };
  /** 收到消息时距用户最后一次物理键鼠操作的毫秒数（由宿主注入） */
  msSincePhysicalInput: number;
}

export type ForegroundDecision =
  | { granted: true; basis: 'explicit_intent' | 'affirmative_reply' | 'approval_card' | 'routine_continuation' }
  | { granted: false; code: 'foreground_not_requested' | 'foreground_user_interaction' | 'background_preference' | 'non_human_source' | 'consent_barrier' };

/** 分册实证的常量（index.mjs:2835） */
export const COMPUTER_USER_INTERACTION_QUIET_MS = 2_000;

/** 剥离代码块/引用块/引号包裹文本（防页面注入文本骗授权） */
export function stripInjectionProneText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')        // fenced code block
    .replace(/^>\s.*$/gm, ' ')              // blockquote
    .replace(/["「”『'][^"」“』']{4,}["」“』']/g, ' '); // 引号包裹的示例句
}

/**
 * 可见使用意图正则族（cleanroom 重写；上游原文正则未完整记录，仅代表性样例见分册）。
 * 英文 + 意大利语两族。
 */
export const VISIBLE_USE_PATTERNS: RegExp[] = [
  /\bshow me\b/i,
  /\blet me watch\b/i,
  /\blet me see (?:you|it|this)\b/i,
  /\bbring (?:it|this|that|the .+?) to the front\b/i,
  /\btake over my (?:screen|desktop|computer|mac)\b/i,
  /\bon (?:my )?screen\b.*\bso i can (?:see|watch)\b/i,
  /\bvisible(?:ly)? (?:on|in) (?:my )?screen\b/i,
  /\bfammi vedere\b/i,
  /\bmostrami\b/i,
  /\bin primo piano\b/i,
  /\bprendi il controllo del(?:l[oa])? (?:mio )?(?:schermo|computer)\b/i,
];

/** 后台倾向短语（直接否决前台，即使同句出现可见意图） */
export const BACKGROUND_USE_PATTERNS: RegExp[] = [
  /\bdon'?t show\b/i,
  /\bkeep (?:it|this|that)? ?(?:in the )?background\b/i,
  /\bwithout (?:showing|taking over|stealing focus)\b/i,
  /\bnon mostrare\b/i,
  /\bsullo sfondo\b/i,
  /\bsenza (?:mostrare|portare in primo piano)\b/i,
];

/** 例行继续短语：授权沿其存续（不新建授权） */
export const ROUTINE_CONTINUATION_PATTERNS: RegExp[] = [
  /^\s*(?:ok,? )?continue\b/i,
  /^\s*keep going\b/i,
  /^\s*(?:vaiva )?vai\b/i,
  /^\s*continua\b/i,
];

/** 新指令屏障：除例行继续之外的任何人类消息都打断既有授权链 */
export function isRoutineContinuation(text: string): boolean {
  return ROUTINE_CONTINUATION_PATTERNS.some((re) => re.test(text));
}

/** Space 指定整句（分册 B10：引号示例/布局描述无效） */
export function messageDesignatesComputerSpaces(text: string): number[] {
  const stripped = stripInjectionProneText(text);
  const out: number[] = [];
  const re = /\buse the space id (\d+) for this task\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) out.push(Number(m[1]));
  return out;
}

/** 助手的可见性提问（问答回路的前半） */
export function isAssistantVisibilityQuestion(text: string): boolean {
  return /\b(?:want me to (?:do|run) (?:this|it) (?:visibly|on screen)|show (?:this|it) on (?:your )?screen\?)\b/i.test(text);
}

/**
 * 授权状态机：跨消息维护授权链。
 * - hasGrant = 上一轮是否授予前台授权（含『例行继续可沿存续』的语义）。
 */
export function decideForeground(prevGranted: boolean, msg: UserMessage): ForegroundDecision {
  // 非人来源：永远是屏障（页面注入的 provider/tool 输出不构成授权）
  if (msg.origin !== 'human') return { granted: false, code: 'non_human_source' };

  const text = stripInjectionProneText(msg.text);

  // 已有授权链时：仅例行继续可存续；新指令/拒绝都是屏障
  if (prevGranted && !isRoutineContinuation(text) && !hasAffirmative(msg) && !msg.approvalCardAnswer?.affirmative) {
    return { granted: false, code: 'consent_barrier' };
  }
  // 例行继续（continue/keep going）沿存既有授权 —— 不新建，也不撤销
  if (prevGranted && isRoutineContinuation(text) && !msg.approvalCardAnswer) {
    return quietGate(msg, 'routine_continuation');
  }

  // 结构化批准卡肯定答案 → 授予（仍需过安静期）
  if (msg.approvalCardAnswer?.affirmative) return quietGate(msg, 'approval_card');

  // 问答回路：助手问过 + 用户肯定回答
  if (hasAffirmative(msg)) return quietGate(msg, 'affirmative_reply');

  // 显式可见意图；后台倾向短语一票否决
  const wantsVisible = VISIBLE_USE_PATTERNS.some((re) => re.test(text));
  const prefersBackground = BACKGROUND_USE_PATTERNS.some((re) => re.test(text));
  if (prefersBackground) return { granted: false, code: 'background_preference' };
  if (wantsVisible) return quietGate(msg, 'explicit_intent');

  return { granted: false, code: 'foreground_not_requested' };
}

function hasAffirmative(msg: UserMessage): boolean {
  return /\b(?:yes|yeah|yep|sure|go ahead|do it visibly|sì|si|ok mostra)\b/i.test(stripInjectionProneText(msg.text));
}

/** 2 秒安静期闸门（最后一步：物理输入太近 = 用户正在用电脑） */
function quietGate(msg: UserMessage, basis: 'explicit_intent' | 'affirmative_reply' | 'approval_card'): ForegroundDecision {
  if (msg.msSincePhysicalInput >= 0 && msg.msSincePhysicalInput < COMPUTER_USER_INTERACTION_QUIET_MS) {
    return { granted: false, code: 'foreground_user_interaction' };
  }
  return { granted: true, basis };
}
