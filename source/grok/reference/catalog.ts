/**
 * catalog.ts — companion 档 `computer_*` MCP 目录形状（cleanroom 重述）
 *
 * 16 工具的名称/参数/readOnly 标注与 refused 协议见 ../schemas/tools.json；
 * 此处提供 TypeScript 形状与一个最小 tools/list 应答构造器（供 fake sidecar 冒烟）。
 * 画布：固定 1280x800，原点左上；坐标上限 x<=1279, y<=799。
 */

export const CANVAS = { width: 1280, height: 800 } as const;

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: { readOnlyHint?: boolean };
}

const TARGET_SCHEMA = {
  oneOf: [
    { type: 'object', properties: { scope: { type: 'string', const: 'screen' } }, required: ['scope'] },
    {
      type: 'object',
      properties: {
        scope: { type: 'string', const: 'app' },
        pid: { type: 'integer', minimum: 1 },
        target_id: { type: 'string', minLength: 1 },
      },
      required: ['scope', 'pid', 'target_id'],
    },
  ],
} as const;

const STEP_SCHEMA = { type: 'string', maxLength: 120, description: 'A few words for the user about this action, shown in the activity list.' } as const;

/** 16 工具目录（描述为语义重述；原文见 agents/grok/evidence/inventory.md §2.1） */
export function buildCompanionCatalog(appTargetInjection: string): McpToolDef[] {
  const target = { description: `Default: ${appTargetInjection} drives one macOS app in the background without taking screen control or moving the real cursor; needs no computer_start_control. Omit (or {"scope":"screen"}) only to escalate to full-display remote control.`, ...TARGET_SCHEMA };
  const coordinateToken = { type: 'string', minLength: 1, description: 'Required with an app target: the coordinate_token from the latest computer_screenshot of this app; stale after next screenshot or window move/resize.' };
  return [
    { name: 'computer_screenshot', description: 'Screenshot of the primary display or one app window. Coordinates are pixels in the fixed 1280x800 canvas, origin top-left. Reuses a live snapshot_id when fresh.', inputSchema: { type: 'object', properties: { target } }, annotations: { readOnlyHint: true } },
    { name: 'computer_click', description: 'Click at a canvas coordinate; returns a screenshot after the click (text only for app targets).', inputSchema: { type: 'object', properties: { x: { type: 'integer', minimum: 0, maximum: 1279 }, y: { type: 'integer', minimum: 0, maximum: 799 }, button: { type: 'string', enum: ['left', 'right', 'middle'] }, count: { type: 'integer', minimum: 1, maximum: 3 }, coordinate_token: coordinateToken, step: STEP_SCHEMA }, required: ['x', 'y'] } },
    { name: 'computer_move', description: 'Move the pointer to a canvas coordinate without clicking (hover UI).', inputSchema: { type: 'object', properties: { x: { type: 'integer', minimum: 0, maximum: 1279 }, y: { type: 'integer', minimum: 0, maximum: 799 }, coordinate_token: coordinateToken }, required: ['x', 'y'] } },
    { name: 'computer_drag', description: 'Press at one coordinate, drag to another, release.', inputSchema: { type: 'object', properties: { from: point(), to: point(), button: { type: 'string', enum: ['left', 'right', 'middle'] }, coordinate_token: coordinateToken, step: STEP_SCHEMA }, required: ['from', 'to'] } },
    { name: 'computer_type', description: 'Type into a macOS app; prefer element_id. Screen-scope typing is refused. Does not raise or move the real cursor.', inputSchema: { type: 'object', properties: { target: { type: 'object' }, element_id: { type: 'integer', minimum: 1 }, snapshot_id: { type: 'string', minLength: 1 }, text: { type: 'string', minLength: 1 } }, required: ['text'] } },
    { name: 'computer_key', description: 'Press a key or chord such as Return, Escape, Tab, cmd+l; combine modifiers with "+".', inputSchema: { type: 'object', properties: { key: { type: 'string' }, target }, required: ['key'] } },
    { name: 'computer_scroll', description: 'Scroll at a canvas coordinate; returns a screenshot after scrolling.', inputSchema: { type: 'object', properties: { x: { type: 'integer', minimum: 0, maximum: 1279 }, y: { type: 'integer', minimum: 0, maximum: 799 }, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer' }, coordinate_token: coordinateToken }, required: ['direction', 'amount'] } },
    { name: 'computer_wait', description: 'Wait for a page load or animation to settle; text only.', inputSchema: { type: 'object', properties: { ms: { type: 'integer', minimum: 0, maximum: 30000 } } }, annotations: { readOnlyHint: true } },
    { name: 'computer_check_permissions', description: 'Passively report Accessibility and Screen Recording permission state. Not required before acting; never call Computer Use tools in parallel.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'computer_start_control', description: 'Escalation only: take over the display and move the real cursor. App targets need no session.', inputSchema: { type: 'object', properties: {} } },
    { name: 'computer_release_control', description: 'Release remote control after the final screen-scope action.', inputSchema: { type: 'object', properties: {} } },
    { name: 'computer_apps', description: 'List drivable running apps (Spotlight, Notification Center, menu extras unsupported).', inputSchema: { type: 'object', properties: {} } },
    { name: 'computer_resolve_app', description: 'Resolve one macOS app by exactly one selector; launches without activation if not running; returns pid and target_id.', inputSchema: { type: 'object', properties: { pid: { type: 'integer', minimum: 1 }, bundle_id: { type: 'string' }, app_path: { type: 'string' }, app_name: { type: 'string' }, step: STEP_SCHEMA } } },
    { name: 'computer_app_state', description: 'Accessibility tree as text: [id] ROLE name= value= settable actions=, indented; last line is snapshot_id; "(+N descendants omitted)" lines expand via element_id.', inputSchema: { type: 'object', properties: { target: { type: 'object' }, element_id: { type: 'integer', minimum: 1 }, snapshot_id: { type: 'string', minLength: 1 } }, required: ['target'] }, annotations: { readOnlyHint: true } },
    { name: 'computer_set_value', description: 'Replace a settable element value via accessibility, no keystrokes; read-back verified.', inputSchema: { type: 'object', properties: { target: { type: 'object' }, element_id: { type: 'integer', minimum: 1 }, snapshot_id: { type: 'string', minLength: 1 }, value: { type: 'string' }, step: STEP_SCHEMA }, required: ['target', 'element_id', 'snapshot_id', 'value'] } },
    { name: 'computer_app_action', description: 'Perform an accessibility action on an element: "press", or an entry from its actions= list (show-menu, scroll-to-visible). Prefer over coordinate clicks when in tree.', inputSchema: { type: 'object', properties: { target: { type: 'object' }, element_id: { type: 'integer', minimum: 1 }, snapshot_id: { type: 'string', minLength: 1 }, action: { type: 'string' }, step: STEP_SCHEMA }, required: ['target', 'element_id', 'snapshot_id', 'action'] } },
  ];
}

function point() {
  return { type: 'object', properties: { x: { type: 'integer', minimum: 0, maximum: 1279 }, y: { type: 'integer', minimum: 0, maximum: 799 } }, required: ['x', 'y'] };
}
