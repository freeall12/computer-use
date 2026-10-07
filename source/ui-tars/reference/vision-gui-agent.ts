/**
 * vision-gui-agent.ts —— UI-TARS（Agent TARS / UI-TARS Desktop）视觉驱动 GUI Agent 的
 * cleanroom 参考实现（行为规格复现，非上游代码转写）。
 *
 * 复现的机制与出处（机制出处：agents/ui-tars/computer-use.md；上游事实对照 source/ui-tars/vendor/）：
 *   §2 观察机制   —— 截图即观察：无 AX 树、无元素 ID，整屏 JPEG 直进 VLM
 *   §3 响应解析   —— `Thought: ... Action: ...` 纯文本；四种坐标格式归一
 *                   （<|box_start|>(x,y)<|box_end|> / <point>x y</point> / <bbox>x1 y1 x2 y2</bbox> / 裸 (x,y)）
 *   §3.2 动作映射 —— unifyActionType（left_single→click 等别名表）+ unifyActionInputName（start_box→start）
 *   §4 坐标派发   —— normalized(0-1)×屏宽高 或 raw 直用；移动→停 100ms→点击；Windows type 走剪贴板（此处仅记录语义）
 *   §5 主循环     —— while(true){截图→VLM→解析→execute}；maxLoopCount 上限；
 *                   finished→END / call_user→CALL_USER / abort→USER_STOPPED 三终态
 *   §6 安全       —— 无逐动作确认门；pause/resume + AbortSignal + call_user 人在回路是仅有的干预面
 *
 * 运行要求：Node >= 22.6（仅用可擦除 TS 语法：标注 / interface / type / 泛型 / satisfies）。
 * 自测：同目录 test.mjs（纯 Node 断言，零依赖）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 0. 类型：坐标 / 动作 / 解析结果（机制出处：computer-use.md §3）
// ─────────────────────────────────────────────────────────────────────────────

export interface RawPoint {
  x: number;
  y: number;
}

/** 三种坐标表示并存（规格出处：vendor/gui-agent/shared/src/types；computer-use.md §4.1） */
export interface Coordinates {
  raw?: RawPoint; // 物理像素
  normalized?: RawPoint; // 0-1 相对坐标（× 屏幕宽高得物理像素）
  referenceBox?: { x1: number; y1: number; x2: number; y2: number }; // bbox 四元组
}

export interface BaseAction {
  type: string; // 归一后的动作名（click/type/hotkey/drag/scroll/finished/call_user…）
  inputs: Record<string, unknown>; // 归一后的参数名（start/end/point/content/key/direction…）
}

export interface ParsedResponse {
  thought: string | null;
  actions: BaseAction[];
  raw: string;
  error?: string;
}

export interface ScreenContext {
  screenWidth: number;
  screenHeight: number;
  scaleX: number; // Retina 物理像素 = 逻辑像素 × scale
  scaleY: number;
}

export type RunStatus = "running" | "end" | "call_user" | "user_stopped" | "error";

// ─────────────────────────────────────────────────────────────────────────────
// 1. 动作名/参数名归一表（机制出处：computer-use.md §3.2；
//    上游全表见 vendor/gui-agent/shared/src/utils/actions.ts:46-244，此处取子集）
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_ALIASES: Record<string, string> = {
  click: "click",
  left_click: "click",
  left_single: "click",
  leftclick: "click",
  double_click: "double_click",
  left_double: "double_click",
  doubleclick: "double_click",
  right_click: "right_click",
  right_single: "right_click",
  middle_click: "middle_click",
  move: "mouse_move",
  move_to: "mouse_move",
  hover: "mouse_move",
  drag: "drag",
  select: "drag",
  left_click_drag: "drag",
  scroll: "scroll",
  type: "type",
  hotkey: "hotkey",
  press: "press",
  release: "release",
  wait: "wait",
  navigate: "navigate",
  finished: "finished",
  call_user: "call_user",
};

const INPUT_ALIASES: Record<string, string> = {
  start_box: "start",
  start_point: "start",
  start: "start",
  end_box: "end",
  end_point: "end",
  end: "end",
  point: "point",
  position: "point",
  coordinate: "point",
  coordinates: "point",
  content: "content",
  text: "content",
  input_text: "content",
  key: "key",
  hotkey: "key",
  direction: "direction",
  dir: "direction",
  url: "url",
  link: "url",
  time: "time",
  duration: "time",
  delay: "time",
};

export function unifyActionType(name: string): string {
  return ACTION_ALIASES[name.toLowerCase()] ?? name;
}

export function unifyActionInputName(actionType: string, inputName: string): string {
  const type = unifyActionType(actionType);
  const name = inputName.toLowerCase();
  // navigate 的 content 语义是 url（上游 actionTypeSpecificMappings 同款特判）
  if (type === "navigate" && name === "content") return "url";
  return INPUT_ALIASES[name] ?? name;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 坐标字面量解析：四种格式 → Coordinates（机制出处：computer-use.md §3.1；
//    上游预处理见 vendor/gui-agent/action-parser/src/ActionParserHelper.ts:96-116）
// ─────────────────────────────────────────────────────────────────────────────

export function parseCoordLiteral(value: string): Coordinates | null {
  const v = value.trim();
  // ① <point>x y</point>
  const point = v.match(/<point>\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*<\/point>/);
  if (point) return { raw: { x: Number(point[1]), y: Number(point[2]) } };
  // ② <bbox>x1 y1 x2 y2</bbox>
  const bbox = v.match(/<bbox>\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*<\/bbox>/);
  if (bbox) {
    const [x1, y1, x2, y2] = bbox.slice(1).map(Number);
    // 中心即点击点（上游 parseBoxToScreenCoords 语义：box 中心 = (x1+x2)/2）
    return {
      raw: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
      referenceBox: { x1, y1, x2, y2 },
    };
  }
  // ③ <|box_start|>(x,y)<|box_end|> 的标签已在上游预处理剥离；此处兼容裸 (x, y) 与 [x1, y1, x2, y2]
  const pair = v.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (pair) return { raw: { x: Number(pair[1]), y: Number(pair[2]) } };
  const quad = v.match(/^\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]$/);
  if (quad) {
    const [x1, y1, x2, y2] = quad.slice(1).map(Number);
    return { raw: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) } };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 动作字符串解析：`click(start_box='(637,964)')` → BaseAction
//    （机制出处：computer-use.md §3.1；上游 ActionParserHelper.parseRoughFromCallString）
// ─────────────────────────────────────────────────────────────────────────────

export function parseActionCallString(actionStr: string): BaseAction | null {
  let s = actionStr.replace(/\n/g, "\\n").trim();
  // 预处理①：剥离 <|box_start|>/<|box_end|> 标签
  s = s.replace(/<\|box_start\|>|<\|box_end\|>/g, "");
  // 预处理②：point=/start_point=/end_point= 统一为 start_box=/end_box=
  //   （上游正则 (?<!start_|end_)point= 防止误改 start_point；JS 同款 lookbehind）
  s = s.replace(/(?<!start_|end_)point=/g, "start_box=").replace(/start_point=/g, "start_box=").replace(/end_point=/g, "end_box=");

  const m = s.match(/^(\w+)\((.*)\)$/s);
  if (!m) return null;
  const [, rawType, argsStr] = m;
  if (argsStr.trim() === '') return { type: unifyActionType(rawType), inputs: {} }; // wait()/finished()/call_user()

  // 参数切分：key='value' 对（value 内允许转义引号）；无引号裸值兜底
  const inputs: Record<string, unknown> = {};
  const pairRe = /(\w+)\s*=\s*'((?:[^'\\]|\\.)*)'/g;
  let matched = false;
  for (let p: RegExpExecArray | null; (p = pairRe.exec(argsStr)); matched = true) {
    const rawName = p[1];
    const value = p[2].replace(/\\(['"\\])/g, "$1");
    const coord = parseCoordLiteral(value);
    const name = unifyActionInputName(rawType, rawName);
    if (coord) inputs[name] = coord;
    else if (!Number.isNaN(Number(value)) && value.trim() !== "") inputs[name] = Number(value);
    else inputs[name] = value;
  }
  if (!matched) {
    // 兜底：无引号形式 click(start_box=(1,1))
    const bare = argsStr.match(/^(\w+)\s*=\s*(.+)$/);
    if (!bare) return null;
    const coord = parseCoordLiteral(bare[2]);
    if (!coord) return null;
    inputs[unifyActionInputName(rawType, bare[1])] = coord;
  }

  // 拖拽语义：有 start 无 end 时上游把 start 提升为 point 的规则此处不需要——drag 必须双点
  return { type: unifyActionType(rawType), inputs };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 整响应解析：Thought/Action 文本 → ParsedResponse
//    （机制出处：computer-use.md §3.1；上游 UnifiedBCFormatParser 的 Thought/Action 切分）
// ─────────────────────────────────────────────────────────────────────────────

export function parsePrediction(text: string): ParsedResponse {
  const raw = text;
  const input = text.trim();
  const thoughtMatch = input.match(/Thought:\s*([\s\S]+?)(?=\s*Action:|$)/);
  const thought = thoughtMatch ? thoughtMatch[1].trim() : null;

  const actions: BaseAction[] = [];
  const actionParts = input.split(/Action:/).slice(1);
  for (const part of actionParts) {
    const line = part.trim().replace(/^```.*\n?|```$/g, "").trim();
    if (!line) continue;
    // 一段可能含多条动作（换行分隔）——逐行尝试
    for (const candidate of line.split(/\n+/)) {
      const action = parseActionCallString(candidate.trim());
      if (action) actions.push(action);
    }
  }
  if (actions.length === 0) {
    return { thought, actions, raw, error: "There is no GUI action detected" };
  }
  return { thought, actions, raw };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 动作序列化（往返用；机制出处：computer-use.md §3.2——引擎把解析结果
//    serializeAction 后塞进 browser_vision_control 的 tool call 参数）
// ─────────────────────────────────────────────────────────────────────────────

export function serializeAction(action: BaseAction): string {
  const params = Object.entries(action.inputs)
    .map(([key, value]) => {
      const v = value as Coordinates;
      if (v && typeof v === "object" && "raw" in v && v.raw) {
        return `${key}='(${v.raw.x}, ${v.raw.y})'`;
      }
      return `${key}='${String(value)}'`;
    })
    .join(", ");
  return `${action.type}(${params})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Operator 接口 + 坐标派发（机制出处：computer-use.md §4；
//    真实实现 = NutJSOperator（nut-js CGEvent 系）；此处 mock 记录派发序列）
// ─────────────────────────────────────────────────────────────────────────────

export interface ScreenshotOutput {
  base64: string;
  contentType: string;
  status: "success" | "failed";
  errorMessage?: string;
}

export interface DispatchRecord {
  action: string;
  at: RawPoint | null; // 派发坐标（物理像素）
}

export interface Operator {
  getScreenContext(): ScreenContext;
  screenshot(): Promise<ScreenshotOutput>;
  execute(actions: BaseAction[]): Promise<{ status: "success" | "failed"; errorMessage?: string }>;
}

/** 坐标换算：normalized×屏幕 or raw 直用（上游 NutJSOperator.calculateRealCoords 同语义） */
export function calculateRealCoords(coords: Coordinates, screen: ScreenContext): RawPoint {
  if (coords.normalized) {
    return {
      x: coords.normalized.x * screen.screenWidth,
      y: coords.normalized.y * screen.screenHeight,
    };
  }
  if (coords.raw) return { ...coords.raw };
  throw new Error("Invalid coordinates");
}

export class MockOperator implements Operator {
  readonly dispatched: DispatchRecord[] = [];
  readonly screen: ScreenContext;
  private failScreenshotTimes = 0;

  constructor(
    screen: ScreenContext = { screenWidth: 1280, screenHeight: 800, scaleX: 2, scaleY: 2 },
    options?: { failFirstScreenshots?: number },
  ) {
    this.screen = screen;
    this.failScreenshotTimes = options?.failFirstScreenshots ?? 0;
  }

  getScreenContext(): ScreenContext {
    return this.screen;
  }

  async screenshot(): Promise<ScreenshotOutput> {
    if (this.failScreenshotTimes > 0) {
      this.failScreenshotTimes -= 1;
      return { base64: "", contentType: "image/jpeg", status: "failed", errorMessage: "screen grab failed" };
    }
    const base64 = Buffer.from(`mock-screen-${this.dispatched.length}`).toString("base64");
    return { base64, contentType: "image/jpeg", status: "success" };
  }

  async execute(actions: BaseAction[]): Promise<{ status: "success" | "failed"; errorMessage?: string }> {
    for (const action of actions) {
      const point =
        (action.inputs.point as Coordinates) ??
        (action.inputs.start as Coordinates) ??
        (action.inputs.end as Coordinates);
      const at = point ? calculateRealCoords(point, this.screen) : null;
      this.dispatched.push({ action: serializeAction(action), at });
    }
    return { status: "success" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 主循环：截图 → VLM → 解析 → 派发 → 再截图（机制出处：computer-use.md §5）
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelLike {
  /** 输入截图，返回模型纯文本（Thought/Action） */
  invoke(screenshot: ScreenshotOutput, history: string[]): Promise<string>;
}

export interface LoopConfig {
  operator: Operator;
  model: ModelLike;
  maxLoopCount?: number; // 上游默认 100（vendor/sdk/src/GUIAgent.ts 引 MAX_LOOP_COUNT）
  screenshotRetries?: number; // 上游 retry.screenshot.maxRetries（桌面版 5）
}

export interface LoopResult {
  status: RunStatus;
  loopCount: number;
  history: string[];
  errorCode?: number; // ErrorStatusEnum（-100004 = REACH_MAXLOOP 等）
}

export async function runVisionLoop(task: string, cfg: LoopConfig, signal?: AbortSignal): Promise<LoopResult> {
  const maxLoopCount = cfg.maxLoopCount ?? 100;
  const screenshotRetries = cfg.screenshotRetries ?? 0;
  const history: string[] = [];
  let loopCount = 0;
  let snapshotErrCnt = 0;
  const MAX_SNAPSHOT_ERR_CNT = 3; // 连续截图失败熔断（上游常量为 10，见 packages/ui-tars/sdk/src/constants.ts:9；此处取小值便于演示）

  while (true) {
    if (signal?.aborted) return { status: "user_stopped", loopCount, history };
    if (loopCount >= maxLoopCount) {
      return { status: "error", loopCount, history, errorCode: -100004 }; // REACH_MAXLOOP_ERROR
    }
    if (snapshotErrCnt >= MAX_SNAPSHOT_ERR_CNT) {
      return { status: "error", loopCount, history, errorCode: -100000 }; // SCREENSHOT_RETRY_ERROR
    }
    loopCount += 1;

    // ① 观察：截图（带重试；无效截图不计循环、累计熔断）
    let snap = await cfg.operator.screenshot();
    for (let i = 0; snap.status === "failed" && i < screenshotRetries; i++) {
      snap = await cfg.operator.screenshot();
    }
    if (snap.status === "failed") {
      snapshotErrCnt += 1;
      loopCount -= 1;
      continue;
    }

    // ② 模型：纯文本 Thought/Action（无 tool 协议依赖）
    const prediction = await cfg.model.invoke(snap, [task, ...history]);
    history.push(prediction);

    // ③ 解析
    const parsed = parsePrediction(prediction);
    if (parsed.actions.length === 0) {
      return { status: "error", loopCount, history, errorCode: -100099 }; // 解析失败按 UNKNOWN 收敛
    }

    // ④ 派发：终态动作短路；其余交 operator 执行
    for (const action of parsed.actions) {
      if (action.type === "finished") {
        return { status: "end", loopCount, history };
      }
      if (action.type === "call_user") {
        return { status: "call_user", loopCount, history }; // 人在回路
      }
      await cfg.operator.execute([action]);
    }
  }
}
