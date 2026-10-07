/**
 * source/self-operating-computer/reference —— cleanroom 最小循环骨架
 *
 * 复现对象：OthersideAI/Self-Operating-Computer v1.5.8（上游 MIT，已 vendor 于 ../vendor/）的
 * 「截图 → 内嵌语法 prompt → 多模态模型 → 解析 JSON 动作数组 → pyautogui 合成输入」闭环。
 *
 * 设计对位（本仓库逆向量纲）：
 *   - 观察路线 = 纯视觉（截图即全部状态；无 AX 树、无元素句柄）——与 12 家的 AX 优先路线相反
 *   - 动作语法 = prompt 内嵌 JSON 协议（click/write/press/done 四操作数组）
 *   - 定位     = 模型直接给屏幕百分比坐标 / OCR 文本→中心百分比 / SoM 标签→百分比
 *   - 安全     = 无（无租约/无验证/无白名单；仅 loop_count>10 上限 + 每动作 sleep 1s）
 *
 * 本文件是按分册行为规格的独立重写（cleanroom），不是上游 Python 的转写。
 * 机制出处逐条标注分册章节；上游 文件:行号 证据见 agents/self-operating-computer/evidence/inventory.md。
 */

// ── 1. 动作语法（prompt 内嵌协议）─────────────────────────────────────────────
// 机制出处：agents/self-operating-computer/computer-use.md §3.1
// 上游：operate/models/prompts.py:11-196（三套 system prompt 变体共享同一 4 操作词汇）
export type Operation =
  | { thought: string; operation: "click"; x: string; y: string } // 百分比坐标（standard 档）
  | { thought: string; operation: "click"; text: string } // OCR 档：点文本
  | { thought: string; operation: "click"; label: string } // SoM 档：点标签（"~34"）
  | { thought: string; operation: "write"; content: string }
  | { thought: string; operation: "press"; keys: string[] }
  | { thought: string; operation: "done"; summary: string };

// clean_json：剥掉 ```json / ``` 围栏（上游 apis.py:1117-1139）
export function cleanJson(content: string): string {
  let out = content;
  if (out.startsWith("```json")) out = out.slice("```json".length).trim();
  else if (out.startsWith("```")) out = out.slice("```".length).trim();
  if (out.endsWith("```")) out = out.slice(0, -"```".length).trim();
  return out
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

// 解析模型输出 → 动作数组（上游 apis.py:117/125 等：clean_json 后直接 json.loads）
export function parseModelOutput(content: string): Operation[] {
  return JSON.parse(cleanJson(content)) as Operation[];
}

// ── 2. 观察接口：截图（纯视觉，无 AX）───────────────────────────────────────
// 机制出处：computer-use.md §5.1；上游 utils/screenshot.py:11-27
export interface ScreenCapturer {
  captureScreenWithCursor(): string; // 返回 base64 PNG
}

export class MockScreenCapturer implements ScreenCapturer {
  frames: string[];
  constructor(frames: string[] = []) {
    this.frames = frames;
  }
  push(frame: string) {
    this.frames.push(frame);
  }
  captureScreenWithCursor(): string {
    // 上游把截图写死到 screenshots/screenshot.png 覆盖同名文件；mock 以帧队列代替
    return this.frames.length ? this.frames.shift()! : "frame:blank";
  }
}

// ── 3. 定位解析器：OCR 文本→中心百分比 / SoM 标签→百分比 ─────────────────────
// 机制出处：computer-use.md §5.2、§5.3
// 上游：utils/ocr.py:81-98（边界框中心 ÷ 图宽高，round 3 位小数）；utils/label.py:23-33
export type OcrElement = { text: string; box: [number, number][] }; // box 为像素坐标四角

export function ocrLocate(
  elements: OcrElement[],
  searchText: string,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } {
  let found = -1;
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].text.includes(searchText)) found = i; // 子串匹配；取最后一个命中（上游循环不 break）
  }
  if (found < 0) throw new Error("The text element was not found in the image"); // 上游 ocr.py:65 同文案
  const box = elements[found].box;
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return {
    x: Math.round((centerX / imageWidth) * 1000) / 1000, // round(...,3) 同上游
    y: Math.round((centerY / imageHeight) * 1000) / 1000,
  };
}

export function somLocate(
  label: string,
  labelCoordinates: Record<string, { x: number; y: number }>,
): { x: number; y: number } {
  const hit = labelCoordinates[label]; // 上游 label.py:32 直接 get，miss 得 undefined
  if (!hit) throw new Error("Failed to get click position in percent."); // 触发上游 fallback（apis.py:748-752）
  return hit;
}

// ── 4. 动作接口：输入合成（pyautogui 形状抽象）───────────────────────────────
// 机制出处：computer-use.md §6；上游 utils/operating_system.py:9-63
export interface InputSynthesizer {
  write(content: string): void; // 逐字符 write（上游 :10-16）
  press(keys: string[]): void; // 全部 keyDown → sleep 0.1s → 全部 keyUp（上游 :18-26）
  clickAtPercentage(xPercent: number, yPercent: number): void; // 百分比→像素 + 画圈装饰（上游 :39-63）
}

export class MockPyAutoGui implements InputSynthesizer {
  log: string[] = [];
  keyDownList: string[][] = [];
  screenWidth: number;
  screenHeight: number;
  constructor(screenWidth = 1440, screenHeight = 900) {
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
  }
  write(content: string): void {
    const text = content.replaceAll("\\n", "\n"); // 上游 :12 显式反转义换行
    for (const ch of text) this.log.push(`write:${ch}`);
  }
  press(keys: string[]): void {
    // combo 语义：先全部按下、再全部抬起（区别于逐键 down-up）
    this.keyDownList.push([...keys]);
    for (const k of keys) this.log.push(`keyDown:${k}`);
    this.log.push("sleep:0.1");
    for (const k of [...keys].reverse()) this.log.push(`keyUp:${k}`);
  }
  clickAtPercentage(xPercent: number, yPercent: number): void {
    const x = Math.trunc(this.screenWidth * xPercent); // 上游 :49-50 int(w * pct)
    const y = Math.trunc(this.screenHeight * yPercent);
    this.log.push(`moveTo:${x},${y}`); // duration=0.2 直线移动
    this.log.push("circle:radius=50,duration=0.5"); // 装饰性画圈（上游 :54-59，纯视觉效果）
    this.log.push(`click:${x},${y}`); // 最终落点仍是圆心
  }
}

// ── 5. 动作分派（operate）────────────────────────────────────────────────────
// 机制出处：computer-use.md §4；上游 operate/operate.py:134-187
export type DispatchEvent =
  | { kind: "action"; type: string; detail: string; thought: string }
  | { kind: "done"; summary: string }
  | { kind: "unknown"; raw: unknown };

export function operate(
  operations: Operation[],
  synth: InputSynthesizer,
  ocr?: OcrElement[],
  somLabels?: Record<string, { x: number; y: number }>,
  imageSize?: { width: number; height: number },
  sleepMs = 1000,
): DispatchEvent[] {
  const events: DispatchEvent[] = [];
  for (const op of operations) {
    // 上游 operate.py:141 每个动作前固定 sleep(1)——唯一的节奏控制
    const op0 = op as Record<string, unknown>;
    const type = String(op0.operation).toLowerCase();
    if (type === "press" || type === "hotkey") {
      const keys = op0.keys as string[];
      synth.press(keys);
      events.push({ kind: "action", type, detail: keys.join(","), thought: op.thought });
    } else if (type === "write") {
      synth.write(op0.content as string);
      events.push({ kind: "action", type, detail: op0.content as string, thought: op.thought });
    } else if (type === "click") {
      let x: number, y: number;
      if (op0.text !== undefined && ocr) {
        // OCR 档：文本→中心百分比（上游在 apis 层解析后回填 x/y，分派层只见百分比）
        const loc = ocrLocate(ocr, op0.text as string, imageSize!.width, imageSize!.height);
        x = loc.x;
        y = loc.y;
      } else if (op0.label !== undefined && somLabels) {
        const loc = somLocate(op0.label as string, somLabels);
        x = loc.x;
        y = loc.y;
      } else {
        x = parseFloat(op0.x as string);
        y = parseFloat(op0.y as string);
      }
      if (Number.isFinite(x) && Number.isFinite(y)) synth.clickAtPercentage(x, y);
      events.push({
        kind: "action",
        type,
        detail: `x=${x},y=${y}`,
        thought: op.thought,
      });
    } else if (type === "done") {
      events.push({ kind: "done", summary: op0.summary as string });
      return events; // 上游 operate.py:163-170 打印 summary 后 return True 停止整个循环
    } else {
      events.push({ kind: "unknown", raw: op }); // 上游 :172-179 未知操作 → 打印错误并 return True（停）
      return events;
    }
    void sleepMs; // 上游为同步 time.sleep(1)；参考实现交由宿主/测试注入节奏，不阻塞断言
  }
  return events;
}

// ── 6. system prompt 构造（平台自适应键位 + 三档变体）────────────────────────
// 机制出处：computer-use.md §3.1；上游 models/prompts.py:210-257
export type PromptVariant = "standard" | "som" | "ocr";
export type Platform = "Darwin" | "Windows" | "Linux";

export function platformKeys(platform: Platform): { cmd: string; osSearch: string; osName: string } {
  if (platform === "Darwin") return { cmd: "command", osSearch: '["command", "space"]', osName: "Mac" };
  return { cmd: "ctrl", osSearch: '["win"]', osName: platform }; // 上游 :219-226 Windows/Linux 同参
}

const GRAMMAR = (os: ReturnType<typeof platformKeys>) => `
You have 4 possible operation actions available to you. The \`pyautogui\` library will be used to execute your decision. Your output will be used in a \`json.loads\` loads statement.
1. click  → [{ "thought": "...", "operation": "click", "x": "x percent", "y": "y percent" }]
2. write  → [{ "thought": "...", "operation": "write", "content": "text" }]
3. press  → [{ "thought": "...", "operation": "press", "keys": ["keys"] }]
4. done   → [{ "thought": "...", "operation": "done", "summary": "..." }]
Return the actions in array format []. (cmd=${os.cmd}, os_search=${os.osSearch}, os=${os.osName})`;

export function buildSystemPrompt(
  model: string,
  objective: string,
  platform: Platform,
): string {
  const os = platformKeys(platform);
  // 变体选择（上游 :228-250）：som→LABELED（click{label:"~x"}）；ocr 族→OCR（click{text}）；其余→STANDARD
  const variant: PromptVariant = model === "gpt-4-with-som" ? "som" : model.includes("ocr") || model === "claude-3" || model === "qwen-vl" ? "ocr" : "standard";
  const head =
    variant === "som"
      ? "click - We labeled the clickable elements with red bounding boxes and IDs like `~x`."
      : variant === "ocr"
        ? 'click - Look for text to click; return "nothing to click" if nothing relevant.'
        : "click - Move mouse and click.";
  return `${GRAMMAR(os)}\n[${variant}] ${head}\nObjective: ${objective}`;
}

// ── 7. 视觉模型接口 + 兜底链 ────────────────────────────────────────────────
// 机制出处：computer-use.md §5、§7；上游 models/apis.py:34-65（9 模型分发表）、1077-1090（fallback）
export interface VisionModel {
  model: string;
  /** 发送 messages + 新截图，返回原始文本输出（调用方负责 clean/parse） */
  respond(messages: ChatMessage[], screenshotBase64: string): Promise<string>;
}
export type ChatMessage = { role: "system" | "user" | "assistant"; content: unknown };

export class ModelError extends Error {}

// 兜底语义（上游 apis.py:1077-1090）：失败 → 用 gpt-4o 的 system prompt 整体替换 messages[0] → 重试。
// 上游实现是【无界递归重试】（apis.py:142 异常分支 return call_gpt_4o(messages)）；
// 参考实现把重试深度封顶为 maxFallbacks，这是与上游的唯一行为差异（安全加固，见分册 §7）。
export async function getNextAction(
  vision: VisionModel,
  messages: ChatMessage[],
  screenshot: string,
  maxFallbacks = 2,
): Promise<Operation[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxFallbacks; attempt++) {
    try {
      const content = await vision.respond(messages, screenshot);
      const ops = parseModelOutput(content);
      messages.push({ role: "assistant", content }); // 上游先 append assistant 再返回（保持对话史）
      return ops;
    } catch (e) {
      lastError = e;
      messages[0] = {
        role: "system",
        content: buildSystemPrompt("gpt-4", pickObjective(messages), "Darwin"),
      };
    }
  }
  throw lastError;
}

function pickObjective(messages: ChatMessage[]): string {
  const sys = String(messages[0]?.content ?? "");
  const m = sys.match(/Objective: (.*)$/);
  return m ? m[1] : "";
}

// ── 8. 主循环 ────────────────────────────────────────────────────────────────
// 机制出处：computer-use.md §2；上游 operate/operate.py:33-131
export type LoopEvent = { loop: number; events: DispatchEvent[] };

export async function runSelfOperatingLoop(opts: {
  objective: string;
  vision: VisionModel;
  screen: ScreenCapturer;
  synth: InputSynthesizer;
  ocr?: OcrElement[];
  somLabels?: Record<string, { x: number; y: number }>;
  imageSize?: { width: number; height: number };
  platform?: Platform;
  /** 每循环后是否继续（注入点；上游无条件跑到 done/未知操作/10 次上限） */
  sleepMs?: number;
}): Promise<LoopEvent[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(opts.vision.model, opts.objective, opts.platform ?? "Darwin") },
  ];
  const timeline: LoopEvent[] = [];
  let loopCount = 0;
  while (true) {
    // 上游 while True（operate.py:107）+ loop_count > 10 break（:119-121）→ 最多 11 轮
    const screenshot = opts.screen.captureScreenWithCursor(); // 纯视觉：截图 = 全部观察
    const operations = await getNextAction(opts.vision, messages, screenshot);
    const events = operate(
      operations,
      opts.synth,
      opts.ocr,
      opts.somLabels,
      opts.imageSize,
      opts.sleepMs ?? 1000,
    );
    timeline.push({ loop: loopCount, events });
    if (events.some((e) => e.kind === "done" || e.kind === "unknown")) break;
    loopCount += 1;
    if (loopCount > 10) break;
  }
  return timeline;
}

// ── 9. 配置/鉴权（形狀复刻，安全语义见分册 §7）───────────────────────────────
// 上游 config.py:131-187：缺 key 时弹窗收集 → 明文追加写 .env（无加密、无 keychain）
export class MockConfig {
  env: Record<string, string> = {};
  requireApiKey(keyName: string, isRequired: boolean, dialog: () => string | null): boolean {
    if (!isRequired || this.env[keyName]) return true;
    const value = dialog(); // 上游 prompt_toolkit input_dialog（config.py:163-169）
    if (value === null) return false; // 用户取消 → sys.exit
    this.env[keyName] = value;
    this.saveApiKeyToEnv(keyName, value); // 上游 :184-187 明文 append .env
    return true;
  }
  saveApiKeyToEnv(keyName: string, value: string): void {
    // 复刻上游行为以供测试断言其风险（明文落盘）；真实部署不应这样做
    (this.env as Record<string, string | undefined>)[`__env_file_${keyName}`] = `\n${keyName}='${value}'`;
  }
}
