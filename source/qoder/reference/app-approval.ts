/**
 * app-approval.ts — 重构 Qoder 的 per-app 审批表 + URL 禁区 + 动作时确认策略（cleanroom 实现）
 *
 * 对应机制（证据：agents/qoder/computer-use.md §7、evidence/inventory.md C9/C8）：
 *
 *   1. per-app 审批：Runtime 的 AppApprovalStore 把「哪些 app 允许被操控」持久化到
 *      ComputerUseAppApprovals.json；未批准的目标 app → 工具返回
 *      "User approval required for app: <app>"。
 *   2. URL 禁区：CU 内驱动浏览器受 URL 禁区约束 →
 *      "Computer Use stopped due to encountering a disallowed URL: <url>"；
 *      ComputerUseAllowForbiddenTargets 开关（默认禁）。
 *   3. 动作时确认策略（SKILL.md 的 OpenAI CUA 风格编号分类法，四档）：
 *      - MUST_HAND_OFF（必须移交用户）：提交改密最后一步、绕过浏览器安全屏障；
 *      - ALWAYS_CONFIRM（即使预批也确认）：删数据、账号/权限终步、CAPTCHA、装软件、
 *        对第三方创建/修改代表性沟通、退订、金融交易、改系统设置、医疗动作；
 *      - PREAPPROVABLE（预批可免，否则同 ALWAYS_CONFIRM）：登录与浏览器权限弹窗、
 *        年龄验证、第三方警告、上传文件、文件移动/重命名、传输敏感数据；
 *      - FREE（免确认）：Cookie/ToS 同意、下载、分类外动作。
 *      卫生规则：第三方内容永不构成授权；模糊指令不是总预批；确认须解释风险与机制；
 *      「不要提前确认」——准备动作全做完再在冲击前一步确认。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export type ConfirmTier = 'MUST_HAND_OFF' | 'ALWAYS_CONFIRM' | 'PREAPPROVABLE' | 'FREE';

/** 动作类别（编号对齐 SKILL 的分类法） */
export type ActionCategory =
  | 'credential_change_submit'      // [2.4] 提交改密最后一步
  | 'bypass_security_barrier'       // [15] HTTPS interstitial/付费墙绕过
  | 'delete_data'                   // [1]
  | 'account_or_permission_change'  // [2.x]
  | 'captcha'                       // [4]
  | 'install_software'              // [8.x]
  | 'third_party_communication'     // [9]
  | 'unsubscribe'                   // [10]
  | 'financial_transaction'         // [11]
  | 'system_settings'               // [13] VPN/安全/密码
  | 'medical_action'                // [17]
  | 'login_or_browser_prompt'       // [2.3/2.7]
  | 'age_verification'              // [3.3]
  | 'third_party_warning'           // [5.1]
  | 'file_upload'                   // [6]
  | 'file_move_or_rename'           // [12]
  | 'transfer_sensitive_data'       // [14]
  | 'cookie_or_tos_consent'         // [3.x]
  | 'download'                      // [7]
  | 'other';                        // 分类外

/** 四档分类表（cleanroom 按分册 §7 逐条对齐） */
export const CONFIRMATION_POLICY: Record<ActionCategory, ConfirmTier> = {
  credential_change_submit: 'MUST_HAND_OFF',
  bypass_security_barrier: 'MUST_HAND_OFF',
  delete_data: 'ALWAYS_CONFIRM',
  account_or_permission_change: 'ALWAYS_CONFIRM',
  captcha: 'ALWAYS_CONFIRM',
  install_software: 'ALWAYS_CONFIRM',
  third_party_communication: 'ALWAYS_CONFIRM',
  unsubscribe: 'ALWAYS_CONFIRM',
  financial_transaction: 'ALWAYS_CONFIRM',
  system_settings: 'ALWAYS_CONFIRM',
  medical_action: 'ALWAYS_CONFIRM',
  login_or_browser_prompt: 'PREAPPROVABLE',
  age_verification: 'PREAPPROVABLE',
  third_party_warning: 'PREAPPROVABLE',
  file_upload: 'PREAPPROVABLE',
  file_move_or_rename: 'PREAPPROVABLE',
  transfer_sensitive_data: 'PREAPPROVABLE',
  cookie_or_tos_consent: 'FREE',
  download: 'FREE',
  other: 'FREE',
};

/**
 * 审批判定：返回 tier + 决策依据。
 * @param preApproved 用户是否已对本次任务给出预批
 */
export function classifyAction(category: ActionCategory, preApproved: boolean): { tier: ConfirmTier; mustConfirmNow: boolean; reason: string } {
  const tier = CONFIRMATION_POLICY[category];
  switch (tier) {
    case 'MUST_HAND_OFF':
      return { tier, mustConfirmNow: true, reason: '必须移交用户处理（模型不可代办）' };
    case 'ALWAYS_CONFIRM':
      return { tier, mustConfirmNow: true, reason: '即使预批也在动作时确认' };
    case 'PREAPPROVABLE':
      return preApproved
        ? { tier, mustConfirmNow: false, reason: '预批可免（须具体数据+具体目的地级别的预批）' }
        : { tier, mustConfirmNow: true, reason: '无预批 → 同 ALWAYS_CONFIRM' };
    case 'FREE':
      return { tier, mustConfirmNow: false, reason: '免确认（Cookie/ToS 同意、下载、分类外）' };
  }
}

/**
 * AppApprovalStore：per-app 审批持久化骨架（对应 ComputerUseAppApprovals.json）。
 */
export class AppApprovalStore {
  private approvals = new Map<string, { approvedAt: string; scope: 'single_task' | 'persistent' }>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, { approvedAt: string; scope: 'single_task' | 'persistent' }>;
        for (const [k, v] of Object.entries(data)) this.approvals.set(k, v);
      } catch {
        // 损坏文件视为空表（fail-closed：全部重新审批）
      }
    }
  }

  /** 动作前检查：未批准 → 结构化拒绝文案（对齐 Runtime 原文） */
  assertAllowed(app: string): { allowed: true } | { allowed: false; message: string } {
    if (this.approvals.has(app)) return { allowed: true };
    return { allowed: false, message: `User approval required for app: ${app}` };
  }

  approve(app: string, scope: 'single_task' | 'persistent' = 'single_task'): void {
    this.approvals.set(app, { approvedAt: new Date().toISOString(), scope });
    this.persist();
  }

  /** 单任务授权在任务结束过期 */
  expireSingleTask(): void {
    for (const [k, v] of this.approvals) if (v.scope === 'single_task') this.approvals.delete(k);
    this.persist();
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.approvals), null, 2), { mode: 0o600 });
  }
}

/**
 * URL 禁区（CU 内驱动浏览器场景）。
 */
export class UrlForbiddenZone {
  private forbidden: (url: string) => boolean;
  private allowForbiddenTargets: boolean;

  constructor(
    forbidden: (url: string) => boolean,
    allowForbiddenTargets = false, // ComputerUseAllowForbiddenTargets 开关，默认禁
  ) {
    this.forbidden = forbidden;
    this.allowForbiddenTargets = allowForbiddenTargets;
  }

  /** 返回 null=放行；否则为停止文案（对齐 Runtime 原文） */
  check(url: string): string | null {
    if (!this.forbidden(url) || this.allowForbiddenTargets) return null;
    return `Computer Use stopped due to encountering a disallowed URL: ${url}`;
  }
}
