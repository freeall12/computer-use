/**
 * MiMo 自动化高层参考客户端（原创实现）。
 *
 * 复现的协议形状：
 * - 服务端 = automation-repl / dist/node-repl.js，tools/list 恰为 ["js"]；
 * - 模型/客户端经 js 工具在持久内核里执行代码，
 *   内核预注入 sky（@mimo/sky 桌面门面）与 agent（@mimo/browser-use）；
 * - 本参考客户端用 js 单元封装 sky 调用，并解析 SkyState 返回。
 *
 * 安全提醒（与官方技能一致的纪律）：
 * - 未启用开关时 js 单元内没有 sky/agent —— fail-closed，不要伪造；
 * - 每次变更动作返回下一观察，禁止复用旧 element_index/坐标；
 * - 后果性动作前需人工确认（CCU_SAFETY_MODE=enforce 时由 elicitation 强制）。
 */

import { McpStdioClient, type McpCallResult } from "./mcp-client.js";
import type { JsToolArgs, MimoAutomationEnv, SkyState } from "./types.js";

/** 本机默认启动器（宿主写进 mimocode.jsonc 的固定入口）。 */
export const DEFAULT_LAUNCHER =
  "/Users/you/Library/Application Support/MiMo Automation/Launchers/bin/automation-repl";

export interface MimoAutomationClientOptions {
  command?: string[];
  env?: MimoAutomationEnv;
  clientName?: string;
}

export class MimoAutomationClient {
  private mcp: McpStdioClient;

  constructor(opts: MimoAutomationClientOptions = {}) {
    this.mcp = new McpStdioClient({
      command: opts.command ?? [DEFAULT_LAUNCHER],
      env: opts.env as Record<string, string> | undefined,
      clientInfo: { name: opts.clientName ?? "mimo-reference-client", version: "0.1.0" },
    });
  }

  async start(): Promise<void> {
    await this.mcp.start();
  }

  /** 应返回恰为 ["js"]；返回其他形态说明接的不是共享 js 运行时。 */
  async toolSurface(): Promise<string[]> {
    return (await this.mcp.listTools()).map((t) => t.name);
  }

  /** 在持久内核中执行一段 js；返回文本内容与错误标记。 */
  async run(code: string, opts: Omit<JsToolArgs, "code"> = {}): Promise<McpCallResult> {
    return this.mcp.callTool("js", { code, ...opts });
  }

  /** 纯文本结果便捷读取（nodeRepl.write 输出）。 */
  async runText(code: string, opts: Omit<JsToolArgs, "code"> = {}): Promise<string> {
    const res = await this.run(code, opts);
    return res.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  // ---- @mimo/sky 封装：每个动作 = 一次 js 单元 = 一次原生事务 ----

  async skyGetAppState(app: string): Promise<SkyState> {
    const res = await this.run(
      `var state = await sky.get_app_state({ app: ${JSON.stringify(app)} });\n` +
        `nodeRepl.write(JSON.stringify(state));`,
    );
    return parseSkyState(res);
  }

  async skyClickByIndex(app: string, elementIndex: number): Promise<SkyState> {
    const res = await this.run(
      `var state = await sky.click({ app: ${JSON.stringify(app)}, element_index: ${elementIndex} });\n` +
        `nodeRepl.write(JSON.stringify(state));`,
    );
    return parseSkyState(res);
  }

  async skyTypeText(app: string, text: string): Promise<SkyState> {
    const res = await this.run(
      `var state = await sky.type_text({ app: ${JSON.stringify(app)}, text: ${JSON.stringify(text)} });\n` +
        `nodeRepl.write(JSON.stringify(state));`,
    );
    return parseSkyState(res);
  }

  /**
   * 浏览器面：按官方技能的标准进入序列选择后端并读取完整契约。
   * （契约文本由运行时 documentation() 生成，本客户端只透传。）
   */
  async browserDefaultDocumentation(): Promise<string> {
    return this.runText(
      `if (globalThis.browser == null) {\n` +
        `  globalThis.browser = await agent.browsers.getDefault();\n` +
        `}\n` +
        `nodeRepl.write(await browser.documentation());`,
      { timeout_ms: 120_000 },
    );
  }

  async stop(): Promise<void> {
    await this.mcp.stop();
  }
}

function parseSkyState(res: McpCallResult): SkyState {
  const text = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
  try {
    return JSON.parse(text) as SkyState;
  } catch {
    // 服务端可能附加诊断文本；至少保住可读输出。
    return { app: "", text, screenshot: null };
  }
}
