/**
 * cloud.ts — 云端 ComputerUseAction 批量动作面（cleanroom 重述）
 *
 * 对齐 proto agent.v1 形状：ComputerUseArgs{tool_call_id, actions[], description?,
 * bind_unmapped_characters?, desktop_lease_actor_id?, screenshot_settle_ms?}。
 * 供自研云端 CU 时复用同一动作词汇；本文件只做类型与校验，不做执行。
 */

export type MouseButton = 'LEFT' | 'RIGHT' | 'MIDDLE' | 'BACK' | 'FORWARD';
export type ScrollDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export type KeyStroke = 'TAP' | 'DOWN' | 'UP';

export interface Coordinate { x: number; y: number }

export type ComputerUseAction =
  | { mouse_move: { coordinate: Coordinate } }
  | { click: { button: MouseButton; count: number } }
  | { mouse_down: { button: MouseButton } }
  | { mouse_up: { button: MouseButton } }
  | { drag: { path: Coordinate[]; button: MouseButton; modifier_keys?: string } }
  | { scroll: { coordinate?: Coordinate; direction: ScrollDirection; amount: number; modifier_keys?: string } }
  | { type: { text: string } }
  | { key: { key: string; hold_duration_ms?: number; stroke: KeyStroke } }
  | { wait: { duration_ms: number } }
  | { screenshot: Record<string, never> }
  | { cursor_position: Record<string, never> };

export interface ComputerUseArgs {
  tool_call_id: string;
  actions: Array<{ action: ComputerUseAction }>;
  /** 动作意图描述（用户可见活动列表） */
  description?: string;
  /** unicode 输入绑定（对应本地 flag sand_computer_use_unicode_typing） */
  bind_unmapped_characters?: boolean;
  /** 云端桌面租约执行者（本地 remoteControlLease 的云侧对应物） */
  desktop_lease_actor_id?: string;
  /** 批量动作后截图前的稳定等待 */
  screenshot_settle_ms?: number;
}

const MOUSE_BUTTONS: MouseButton[] = ['LEFT', 'RIGHT', 'MIDDLE', 'BACK', 'FORWARD'];
const DIRECTIONS: ScrollDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
const STROKES: KeyStroke[] = ['TAP', 'DOWN', 'UP'];

export function validateComputerUseArgs(args: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof args !== 'object' || args === null) return { ok: false, reason: 'args must be an object' };
  const a = args as ComputerUseArgs;
  if (typeof a.tool_call_id !== 'string' || a.tool_call_id.length === 0) return { ok: false, reason: 'tool_call_id required' };
  if (!Array.isArray(a.actions) || a.actions.length === 0) return { ok: false, reason: 'actions must be a non-empty array' };
  for (const entry of a.actions) {
    const keys = Object.keys(entry.action ?? {});
    if (keys.length !== 1) return { ok: false, reason: `action must have exactly one variant, got ${keys.join(',')}` };
    const kind = keys[0] as keyof ComputerUseAction;
    const v = (entry.action as Record<string, unknown>)[kind];
    switch (kind) {
      case 'mouse_move': {
        const c = (v as { coordinate?: Coordinate }).coordinate;
        if (!isCoordinate(c)) return { ok: false, reason: 'mouse_move.coordinate invalid' };
        break;
      }
      case 'click': {
        const p = v as { button?: MouseButton; count?: number };
        if (!p.button || !MOUSE_BUTTONS.includes(p.button)) return { ok: false, reason: 'click.button invalid' };
        if (!Number.isInteger(p.count) || (p.count as number) < 1 || (p.count as number) > 3) return { ok: false, reason: 'click.count must be 1..3' };
        break;
      }
      case 'mouse_down':
      case 'mouse_up': {
        const p = v as { button?: MouseButton };
        if (!p.button || !MOUSE_BUTTONS.includes(p.button)) return { ok: false, reason: `${kind}.button invalid` };
        break;
      }
      case 'drag': {
        const p = v as { path?: Coordinate[]; button?: MouseButton };
        if (!Array.isArray(p.path) || p.path.length < 2 || !p.path.every(isCoordinate)) return { ok: false, reason: 'drag.path needs >=2 coordinates' };
        if (!p.button || !MOUSE_BUTTONS.includes(p.button)) return { ok: false, reason: 'drag.button invalid' };
        break;
      }
      case 'scroll': {
        const p = v as { direction?: ScrollDirection; amount?: number };
        if (!p.direction || !DIRECTIONS.includes(p.direction)) return { ok: false, reason: 'scroll.direction invalid' };
        if (!Number.isInteger(p.amount)) return { ok: false, reason: 'scroll.amount must be an integer' };
        break;
      }
      case 'type': {
        const p = v as { text?: string };
        if (typeof p.text !== 'string' || p.text.length === 0) return { ok: false, reason: 'type.text must be non-empty' };
        break;
      }
      case 'key': {
        const p = v as { key?: string; stroke?: KeyStroke };
        if (typeof p.key !== 'string' || p.key.length === 0) return { ok: false, reason: 'key.key required' };
        if (p.stroke !== undefined && !STROKES.includes(p.stroke)) return { ok: false, reason: 'key.stroke invalid' };
        break;
      }
      case 'wait': {
        const p = v as { duration_ms?: number };
        if (!Number.isInteger(p.duration_ms) || (p.duration_ms as number) < 0) return { ok: false, reason: 'wait.duration_ms invalid' };
        break;
      }
      case 'screenshot':
      case 'cursor_position':
        break;
      default:
        return { ok: false, reason: `unknown action kind: ${String(kind)}` };
    }
  }
  return { ok: true };
}

function isCoordinate(c: unknown): c is Coordinate {
  const p = c as Coordinate;
  return typeof p?.x === 'number' && Number.isInteger(p.x) && typeof p?.y === 'number' && Number.isInteger(p.y);
}
