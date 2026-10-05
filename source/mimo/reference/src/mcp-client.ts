/**
 * 极简 MCP stdio 客户端（原创实现，JSON-RPC 2.0 over stdio）。
 *
 * 不足以承载生产；仅为复现 MiMo 自动化 MCP 的握手形状：
 *   initialize → notifications/initialized → tools/list → tools/call
 * 协议遵循 Model Context Protocol（@modelcontextprotocol/sdk 语义），
 * MiMo 服务端依赖为 ^1.0.4（CU 包 package.json dependencies）。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: string; [k: string]: unknown }
  >;
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpClientOptions {
  command: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** initialize 请求携带的客户端信息。 */
  clientInfo?: { name: string; version: string };
  protocolVersion?: string;
}

export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private readonly opts: McpClientOptions;

  constructor(opts: McpClientOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.proc = spawn(this.opts.command[0], this.opts.command.slice(1), {
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.proc.stderr.setEncoding("utf8");
    // MiMo 服务端把日志写 stderr（CCU_LOG_LEVEL 控制），保留供诊断。
    this.proc.stderr.on("data", (chunk: string) => this.onStderr(chunk));
    this.proc.on("exit", (code) => this.failAll(new Error(`mcp server exited code=${code}`)));

    await this.request("initialize", {
      protocolVersion: this.opts.protocolVersion ?? "2024-11-05",
      capabilities: {},
      clientInfo: this.opts.clientInfo ?? { name: "mimo-reference-client", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    const res = await this.request("tools/list", {});
    return (res as { tools: McpTool[] }).tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const res = await this.request("tools/call", { name, arguments: args });
    return res as McpCallResult;
  }

  async stop(): Promise<void> {
    this.proc?.kill();
    this.proc = null;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    // MiMo node-repl 使用按行分隔的 JSON-RPC 消息。
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue; // 非 JSON 行忽略
      }
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    }
  }

  private onStderr(chunk: string): void {
    if (process.env.MIMO_REF_DEBUG) process.stderr.write(`[mcp-server] ${chunk}`);
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private notify(method: string, params: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.proc?.stdin.write(JSON.stringify(msg) + "\n");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error("client not started"));
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp request timeout: ${method}`));
      }, 120_000);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          if (r.error) reject(new Error(`${method}: ${r.error.message}`));
          else resolve(r.result);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.proc!.stdin.write(JSON.stringify(msg) + "\n");
    });
  }
}
