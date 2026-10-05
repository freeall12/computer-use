/**
 * goose-computer-extension.ts —— Goose "Computer Controller" builtin extension 的
 * cleanroom 参考实现（形状复现，非上游代码转写）。
 *
 * 复现的机制与出处（机制出处：agents/goose/computer-use.md）：
 *   §3.1 单工具透传面      —— computer_control(command, capture_screenshot)
 *   §4  观察机制           —— see/image 自动 --path/--json-output、*_annotated.png 优先、
 *                             capture_screenshot 动作后补拍、12000 字符截断、audience 注解
 *   §5  动作机制           —— shell_words 分词 → 外部 CLI 子进程（此处用注入的 mock 后端）
 *   §6  权限模型           —— GooseMode 四档 × PermissionLevel 三级 × smart_approve 只读判定桩
 *   上游事实核对：source/goose/vendor/goose-mcp/computercontroller.mod.rs（Apache-2.0，仅作规格对照）
 *
 * 运行要求：Node >= 22.6（仅用可擦除 TS 语法：标注 / interface / type alias / 泛型 / satisfies）。
 * 自测：同目录 test.mjs（纯 Node 断言，零依赖）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 0. 类型：工具面与权限枚举（对应 schemas/tools.json）
// ─────────────────────────────────────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;

/** GooseMode 四档（机制出处：computer-use.md §6；vendor/goose-permission/goose_mode.rs） */
type GooseMode = "auto" | "approve" | "smart_approve" | "chat";

/** 每工具三级权限（vendor/goose-permission/config-permission.rs PermissionLevel） */
type PermissionLevel = "always_allow" | "ask_before" | "never_allow";

/** 运行时判定五档（vendor/goose-permission/permission.rs Permission） */
type RuntimePermission = "always_allow" | "allow_once" | "cancel" | "deny_once" | "always_deny";

/** 内容块（MCP content blocks 子集：text + image） */
interface ContentBlock {
  type: "text" | "image";
  text?: string;
  data?: string; // base64
  mimeType?: string;
  audience?: string[]; // rmcp Annotations.audience
}

interface ToolResult {
  isError: boolean;
  content: ContentBlock[];
}

/** 计算机控制工具参数（computercontroller.mod.rs:27-39 ComputerControlParams） */
interface ComputerControlParams {
  command: string;
  capture_screenshot?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. shell_words::split 的最小复现（POSIX 风格分词）
//    机制出处：computer-use.md §5（上游用 shell_words crate；computercontroller.mod.rs:455）
//    支持：单/双引号、反斜杠转义、空白切分；不展开变量/glob（与上游一致——透传语义）。
// ─────────────────────────────────────────────────────────────────────────────

export function shellWordsSplit(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      cur += ch;
      hasToken = true;
      escaped = false;
      continue;
    }
    if (!inSingle && ch === "\\") {
      escaped = true;
      hasToken = true;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else cur += ch;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else if (ch === "\\") {
        // 双引号内反斜杠仅转义 \ " ` $（POSIX 规则的近似）
        escaped = true;
      } else cur += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        out.push(cur);
        cur = "";
        hasToken = false;
      }
      continue;
    }
    cur += ch;
    hasToken = true;
  }
  if (escaped || inSingle || inDouble) {
    throw new Error("Failed to parse command: unclosed quote or trailing backslash");
  }
  if (hasToken) out.push(cur);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 执行后端接口：把外部 CLI 抽象为 Backend，测试注入 mock，生产注入真实 peekaboo 进程。
//    机制出处：computer-use.md §5（run_peekaboo_cmd：同步子进程 + merged_path 修 PATH；
//    ensure_peekaboo：which 检测 + brew 自动安装，peekaboo.mod.rs:1-85）
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliBackend {
  /** 后端二进制是否在 PATH（对应 which peekaboo） */
  isInstalled(): boolean;
  /** 自动安装（对应 brew install steipete/tap/peekaboo）；返回错误消息 */
  autoInstall(): { ok: boolean; message?: string };
  /** 执行子命令（对应 std::process::Command::output） */
  run(args: string[]): ExecResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. mock peekaboo：内存 AX 树 + 元素 ID 标注，驱动 see→click→type 循环自测。
//    行为规格出处：computer-use.md §3.1/§4（see --annotate 产 B1/T2 式元素 ID；
//    --json/--json-output 结构化输出；permissions status 报 TCC 两权限）
// ─────────────────────────────────────────────────────────────────────────────

interface MockElement {
  id: string; // B1 / T2 / M1 …
  role: "button" | "text" | "menu" | "window";
  label: string;
}

interface MockAppState {
  name: string;
  elements: MockElement[];
}

const FAKE_PNG = Buffer.from("%PNG-mock-annotated-screenshot").toString("base64");

export function createMockPeekabooBackend(options?: { installed?: boolean }): {
  backend: CliBackend;
  state: { frontmost: MockAppState; lastActions: string[]; screenshots: string[] };
} {
  const state = {
    frontmost: {
      name: "Safari",
      elements: [
        { id: "B1", role: "button", label: "Reload" },
        { id: "T2", role: "text", label: "Address Bar" },
        { id: "B3", role: "button", label: "Sign In" },
        { id: "M1", role: "menu", label: "File" },
      ] satisfies MockElement[],
    },
    lastActions: [] as string[],
    screenshots: [] as string[],
  };
  let installed = options?.installed ?? true;

  const backend: CliBackend = {
    isInstalled: () => installed,
    autoInstall: () => {
      installed = true;
      return { ok: true };
    },
    run(args: string[]): ExecResult {
      state.lastActions.push(args.join(" "));
      const [cmd, ...rest] = args;
      const jsonOut = args.includes("--json") || args.includes("--json-output");

      const snapshotReply = (): Record<string, unknown> => ({
        application: state.frontmost.name,
        elements: state.frontmost.elements,
        screenshot_annotated: true,
      });

      switch (cmd) {
        case "see":
          state.screenshots.push("annotated");
          return {
            exitCode: 0,
            stdout: jsonOut ? JSON.stringify(snapshotReply()) : `captured ${state.frontmost.name}`,
            stderr: "",
          };
        case "image":
          state.screenshots.push("plain");
          return { exitCode: 0, stdout: "image captured", stderr: "" };
        case "click": {
          const on = rest.includes("--on") ? rest[rest.indexOf("--on") + 1] : undefined;
          const el = state.frontmost.elements.find((e) => e.id === on);
          if (on && !el) {
            return { exitCode: 1, stdout: "", stderr: `error: element '${on}' not found in snapshot` };
          }
          return { exitCode: 0, stdout: `clicked ${on ?? "coords"}`, stderr: "" };
        }
        case "type":
        case "press":
        case "hotkey":
        case "paste":
        case "scroll":
        case "drag":
        case "move":
        case "open":
        case "app":
        case "window":
        case "menu":
        case "dialog":
        case "dock":
        case "space":
          return { exitCode: 0, stdout: `${cmd} ok`, stderr: "" };
        case "list": {
          const reply = {
            apps: [{ name: state.frontmost.name, pid: 4242, frontmost: true }],
            windows: [{ title: "Start Page", index: 0 }],
            screens: [{ index: 0, main: true }],
          };
          return { exitCode: 0, stdout: jsonOut ? JSON.stringify(reply) : "list ok", stderr: "" };
        }
        case "permissions":
          return {
            exitCode: 0,
            stdout: jsonOut
              ? JSON.stringify({ screen_recording: true, accessibility: false, macOS: "15+" })
              : "screen_recording: granted\naccessibility: NOT granted",
            stderr: "",
          };
        case "clipboard":
          return { exitCode: 0, stdout: "clipboard ok", stderr: "" };
        default:
          return { exitCode: 0, stdout: `${cmd} ok`, stderr: "" };
      }
    },
  };
  return { backend, state };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 权限模型：GooseMode × PermissionLevel × smart_approve 只读判定桩
//    机制出处：computer-use.md §6（三层正交；permission.yaml 三张名单；
//    smart_approve 用 LLM 判定"严格只读"，此处以观察类命令白名单做最小桩）
// ─────────────────────────────────────────────────────────────────────────────

/** 观察类命令（只读）——对应 smart_approve 判定的"只读"集合的机械近似 */
const READ_ONLY_COMMANDS = new Set([
  "see", "image", "list", "window", "menubar", "permissions", "space", "dock",
]);

export interface PermissionPolicy {
  mode: GooseMode;
  /** 每工具级别（permission.yaml 三张名单的最小形状） */
  toolLevel: (extension: string, tool: string) => PermissionLevel;
  /** smart_approve 只读判定桩：真实 goose 用 LLM（platform__tool_by_tool_permission） */
  isReadOnly: (command: string) => boolean;
  /** 用户交互桩：approve/非只读时询问用户；返回五档运行时判定 */
  askUser: (request: { extension: string; tool: string; summary: string }) => RuntimePermission;
}

export type PermissionVerdict = { allowed: true } | { allowed: false; reason: string };

export function checkPermission(policy: PermissionPolicy, tool: string, command: string): PermissionVerdict {
  if (policy.mode === "chat") return { allowed: false, reason: "chat mode: all tools disabled" };

  const level = policy.toolLevel("computercontroller", tool);
  if (level === "never_allow") return { allowed: false, reason: "tool never_allow (permission.yaml)" };

  switch (policy.mode) {
    case "auto":
      return { allowed: true }; // 全自动批准——CU 动作无额外门（computer-use.md §6）
    case "approve":
      if (level === "always_allow") return { allowed: true };
      return verdictOf(policy.askUser({ extension: "computercontroller", tool, summary: command }));
    case "smart_approve":
      if (level === "always_allow") return { allowed: true };
      if (policy.isReadOnly(command)) return { allowed: true }; // 只读自动放行
      return verdictOf(policy.askUser({ extension: "computercontroller", tool, summary: command }));
  }
}

function verdictOf(p: RuntimePermission): PermissionVerdict {
  switch (p) {
    case "always_allow":
    case "allow_once":
      return { allowed: true };
    default:
      return { allowed: false, reason: `user decision: ${p}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ComputerControllerServer：单工具 + 办公三件套，in-process 形状。
//    真实 goose 用 rmcp 宏暴露 MCP；此处用"工具注册表 + dispatch"复现同一形状。
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TEXT_CHARS = 12_000; // 上游 hardcode（computercontroller.mod.rs:539-540）

const JSON_AUTO_CMDS = new Set(["list", "window", "menubar", "permissions", "clipboard"]);
const SCREENSHOT_CMDS = new Set(["see", "image"]);

export interface ExtensionOptions {
  backend: CliBackend;
  policy: PermissionPolicy;
  /** 截图缓存目录前缀（真实 goose：~/.cache/goose/computer_controller/，mod.rs:238-250） */
  cacheDir?: string;
  now?: () => Date;
}

export class GooseComputerExtension {
  readonly tools = [
    {
      name: "computer_control",
      description: "macOS UI automation via Peekaboo CLI. Pass a subcommand string as `command`.",
      inputSchema: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string", description: "peekaboo subcommand and arguments as a single string" },
          capture_screenshot: { type: "boolean", default: false },
        },
      } satisfies JsonSchema,
    },
  ];

  private backendInstalled = false; // AtomicBool 缓存（mod.rs:390-392）
  #opts: ExtensionOptions;

  constructor(opts: ExtensionOptions) {
    this.#opts = opts;
  }

  /** MCP tools/call 入口 */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (name !== "computer_control") {
      return { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] };
    }
    return this.computerControl(args as unknown as ComputerControlParams);
  }

  /**
   * computer_control 主体。行为对照（括号为上游行号，computercontroller.mod.rs）：
   *   ensure_peekaboo(390-417) → shell_words::split(455) → auto --path/--json-output(466-483)
   *   → run(419-449) → annotated 优先(495-505) → capture_screenshot 补拍(523-537)
   *   → 12000 截断(539-546) → audience 注解(555-563)
   */
  private async computerControl(params: ComputerControlParams): Promise<ToolResult> {
    // —— 权限门（通用三层，CU 无专用门）——
    const verdict = checkPermission(this.#opts.policy, "computer_control", params.command);
    if (!verdict.allowed) {
      return { isError: true, content: [{ type: "text", text: `permission denied: ${verdict.reason}` }] };
    }

    // —— 后端自检 + 自动安装 ——
    const ensured = this.ensureBackend();
    if (ensured) return { isError: true, content: [{ type: "text", text: ensured }] };

    // —— 分词（空命令 → INVALID_PARAMS）——
    let args: string[];
    try {
      args = shellWordsSplit(params.command);
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `invalid params: ${(e as Error).message}` }] };
    }
    if (args.length === 0) {
      return { isError: true, content: [{ type: "text", text: "invalid params: Command cannot be empty" }] };
    }

    // —— 观察类命令自动注入 --path（+ see 的 --json-output）——
    const isSee = args[0] === "see";
    const isImage = args[0] === "image";
    let screenshotPath: string | undefined;
    const fullArgs = [...args];
    if (isSee || isImage) {
      screenshotPath = this.cachePath(args[0], "png");
      if (!fullArgs.includes("--path")) fullArgs.push("--path", screenshotPath);
      if (isSee && !fullArgs.includes("--json-output")) fullArgs.push("--json-output");
    }

    // —— 结构化查询类自动注入 --json ——
    if (JSON_AUTO_CMDS.has(args[0]) && !args.some((a) => a === "--json" || a === "-j" || a === "--json-output")) {
      fullArgs.push("--json");
    }

    // —— 执行子进程 ——
    const exec = this.#opts.backend.run(fullArgs);
    if (exec.exitCode !== 0) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `peekaboo ${args[0]} failed (exit ${exec.exitCode}):\n${exec.stderr.trim()}\n${exec.stdout.trim()}`,
        }],
      };
    }

    const content: ContentBlock[] = [];

    // —— 截图块：see 优先返回 *_annotated 变体 ——
    if (screenshotPath) {
      const annotatedPath = screenshotPath.replace(/\.png$/, "_annotated.png");
      const chosen = isSee ? (annotatedPath in mockFs ? annotatedPath : screenshotPath) : screenshotPath;
      const png = mockFs[chosen];
      if (png) {
        content.push({ type: "image", data: png, mimeType: "image/png" });
        state_lastScreenshots.push(chosen);
      }
    }

    // —— capture_screenshot：动作后补拍前台截图 ——
    if (params.capture_screenshot && !screenshotPath) {
      const capPath = this.cachePath("peekaboo_capture", "png");
      const cap = this.#opts.backend.run(["image", "--mode", "frontmost", "--path", capPath]);
      if (cap.exitCode === 0 && mockFs[capPath]) {
        content.push({ type: "image", data: mockFs[capPath], mimeType: "image/png" });
        state_lastScreenshots.push(capPath);
      }
    }

    // —— 文本块：截断 + audience 注解 ——
    const text =
      exec.stdout.length > MAX_TEXT_CHARS
        ? `${exec.stdout.slice(0, MAX_TEXT_CHARS)}\n\n[Output truncated. ${exec.stdout.length} total chars.]`
        : exec.stdout;
    content.unshift({ type: "text", text, audience: ["assistant"] });

    return { isError: false, content };
  }

  /** ensure_peekaboo：已装→缓存 true；未装→autoInstall；失败→带 brew 提示的错误（mod.rs:390-417） */
  private ensureBackend(): string | undefined {
    if (this.backendInstalled || this.#opts.backend.isInstalled()) {
      this.backendInstalled = true;
      return undefined;
    }
    const res = this.#opts.backend.autoInstall();
    if (res.ok && this.#opts.backend.isInstalled()) {
      this.backendInstalled = true;
      return undefined;
    }
    return (
      `Peekaboo is not installed and auto-install failed: ${res.message ?? "unknown"}\n` +
      "Install manually with: brew install steipete/tap/peekaboo\n" +
      "Peekaboo requires macOS 15+ (Sequoia) with Screen Recording and Accessibility permissions."
    );
  }

  /** get_cache_path：<prefix>_<yyyymmdd_HHMMSS>.<ext>（mod.rs:383-388，格式 %Y%m%d_%H%M%S） */
  private cachePath(prefix: string, ext: string): string {
    const d = (this.#opts.now ?? (() => new Date()))();
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    return `${this.#opts.cacheDir ?? "/tmp/goose-mock-cache"}/${prefix}_${ts}.${ext}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. mock 文件系统：截图落盘形状（真实 goose 用 fs；测试用内存 map）
// ─────────────────────────────────────────────────────────────────────────────

const mockFs: Record<string, string> = {};
const state_lastScreenshots: string[] = [];

/** 测试辅助：放置任意 mock 文件（真实 goose 用 fs 读截图文件） */
export function __setMockFile(path: string, data: string = FAKE_PNG): void {
  mockFs[path] = data;
}

/** 测试辅助：在 mock fs 里放置一次 see/image 的产物（plain 与 annotated 各一） */
export function seedScreenshotCache(cacheDir: string, timestamp: string): { plain: string; annotated: string } {
  const plain = `${cacheDir}/see_${timestamp}.png`;
  const annotated = `${cacheDir}/see_${timestamp}_annotated.png`;
  mockFs[plain] = FAKE_PNG;
  mockFs[annotated] = FAKE_PNG;
  return { plain, annotated };
}

/** 测试辅助：只读观察返回过的截图路径（annotated 优先逻辑的断言面） */
export function __lastScreenshotPaths(): string[] {
  return [...state_lastScreenshots];
}

export { FAKE_PNG, READ_ONLY_COMMANDS };
