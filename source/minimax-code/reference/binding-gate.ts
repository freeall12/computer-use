/**
 * binding-gate.ts — 重构 MiniMax Code 的 Host Binding 门控器（cleanroom 实现）
 *
 * 对应机制（证据：agents/minimax-code/computer-use.md §3.1-3.2、schemas/bindings.json）：
 *   MiniMax Code 的 computer_* 与 browser 原生工具不是常驻工具面，而是「官方插件 + Host Binding」
 *   准入制：官方插件声明 *.binding.json（hostCapability: computer.use / browser.use、
 *   requiredSkills、allowedSurfaces），运行时在三层做门控：
 *
 *   1. 插件准入（受信任快照里存在 official 插件且 hostCapabilities 含能力 id）→ setEnabled(true)；
 *      插件吊销 → 立即 setEnabled(false) 并释放 client（本文件用 abortAllInFlight 模拟）。
 *   2. 工具目录装配：先从 nativeTools 中【剔除所有】computer_ 前缀工具；仅当
 *      会话级 computerUseActive 且 client 就绪时重建追加 —— 未启用 = 模型根本看不到工具（fail-closed）。
 *   3. 执行时复查：每次工具执行再查一次 enabled，并把 AbortController 注册进全局表，
 *      使吊销能即时掐断在途调用。
 *
 * 本文件为行为规格的骨架重写：不包含 MiniMax 任何专有代码，只实现协议形状。
 */

/** binding 声明形状（对应官方插件 *.binding.json） */
export interface HostBinding {
  bindingId: string;
  logicalToolName: string;
  hostCapability: { id: string; version: number };
  requiredSkills: string[];
  allowedSurfaces: string[];
}

/** 受信任的插件快照（宿主在插件准入后维护） */
export interface PluginSnapshot {
  name: string;
  source: 'official' | 'marketplace' | 'user';
  hostCapabilities: string[];
  bindings: HostBinding[];
}

/** 工具定义的最小形状 */
export interface ToolDef {
  name: string;
  execute: (input: unknown, signal: AbortSignal) => Promise<unknown>;
}

export type GateRejection =
  | { ok: false; reason: 'plugin_revoked' }
  | { ok: false; reason: 'surface_not_allowed' }
  | { ok: false; reason: 'skill_required'; skill: string }
  | { ok: false; reason: 'not_active_for_session' };

export type GateResult<T> = { ok: true; value: T } | GateRejection;

/**
 * HostBindingGate：三层门控。
 */
export class HostBindingGate {
  private trusted: PluginSnapshot[] = [];
  private enabled = false;
  private loadedSkills = new Set<string>();
  private activeSessions = new Set<string>(); // 会话级 computerUseActive 标记
  private aborts = new Map<string, Set<AbortController>>();

  /** 宿主在插件快照变化时调用（对应 computerUsePluginCapabilitiesChanged） */
  setTrustedPlugins(plugins: PluginSnapshot[]): void {
    this.trusted = plugins;
    const admitted = this.trusted.some(
      (p) => p.source === 'official' && p.hostCapabilities.some((c) => c === 'computer.use' || c === 'browser.use'),
    );
    if (!admitted && this.enabled) {
      // 插件被吊销：立即关闭并掐断全部在途调用（对应 setEnabled(false) + client.release()）
      this.abortAllInFlight();
    }
    this.enabled = admitted;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 会话级激活（对应 toolInput.computerUseActive —— 用户按会话选中 CU/BU） */
  setSessionActive(sessionId: string, active: boolean): void {
    if (active) this.activeSessions.add(sessionId);
    else this.activeSessions.delete(sessionId);
  }

  /** skill 加载回执（对应 requiredSkills 前置门；browser 侧还需独占 step，由调用方约束） */
  markSkillLoaded(skill: string): void {
    this.loadedSkills.add(skill);
  }

  /**
   * 第一/二层：工具目录装配。未启用或会话未激活时，能力工具【不出现在目录里】。
   * 对应 initialize.ts：先剔除所有 computer_ 前缀，激活时才重建追加。
   */
  assembleToolCatalog(sessionId: string, nativeTools: ToolDef[], capabilityTools: ToolDef[]): ToolDef[] {
    const stripped = nativeTools.filter((t) => !t.name.startsWith('computer_'));
    if (!this.enabled || !this.activeSessions.has(sessionId)) return stripped;
    return [...stripped, ...capabilityTools];
  }

  /**
   * 第三层：执行时复查（对应 tools.ts execute 的 isComputerUseEnabled() + AbortController 注册表）。
   */
  async execute(sessionId: string, tool: ToolDef, input: unknown): Promise<GateResult<unknown>> {
    if (!this.enabled) return { ok: false, reason: 'plugin_revoked' };
    if (!this.activeSessions.has(sessionId)) return { ok: false, reason: 'not_active_for_session' };

    const binding = this.findBinding(tool.name);
    if (!binding) return { ok: false, reason: 'plugin_revoked' };
    if (!binding.allowedSurfaces.includes('interactive')) return { ok: false, reason: 'surface_not_allowed' };
    for (const skill of binding.requiredSkills) {
      if (!this.loadedSkills.has(skill)) return { ok: false, reason: 'skill_required', skill };
    }

    const controller = new AbortController();
    let set = this.aborts.get(sessionId);
    if (!set) this.aborts.set(sessionId, (set = new Set()));
    set.add(controller);
    try {
      return { ok: true, value: await tool.execute(input, controller.signal) };
    } finally {
      set.delete(controller);
    }
  }

  /** 吊销/关闭时掐断全部在途调用（对应 /computer-use/abort 与 setEnabled(false) 联动） */
  abortAllInFlight(): void {
    for (const set of this.aborts.values()) for (const c of set) c.abort();
    this.aborts.clear();
  }

  private findBinding(_toolName: string): HostBinding | undefined {
    // 简化：任一 official 插件的任一 binding 匹配即视为绑定存在。
    for (const p of this.trusted) {
      if (p.source !== 'official') continue;
      for (const b of p.bindings) {
        if (b.hostCapability.id === 'computer.use' || b.hostCapability.id === 'browser.use') return b;
      }
    }
    return undefined;
  }
}
