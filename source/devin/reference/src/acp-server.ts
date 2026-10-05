/**
 * acp-server.ts —— Devin CLI 的 ACP server 侧骨架（cleanroom 重构）
 *
 * 事实来源：本机三份 CLI 日志（chisel_server::acp / chisel_agent::acp_server）[INV-G3/F5]。
 * CLI 以 `devin acp` 运行时是 ACP **server**（agent 一侧），IDE（Devin Desktop/Windsurf、
 * Zed 等）是 client 宿主。本骨架还原其观察到的方法序列与凭据策略：
 *
 *   initialize → authenticate(meta: api_key+api_server_url, method windsurf-api-key)
 *   → ext_method cognition.ai/{skills,mcp,rules}/list → session/new → session/list
 *
 * 凭据策略（日志原文语义）："ACP host is the sole source of credentials. Local CLI
 * credentials (env vars, on-disk REPL store) will NOT be used. Waiting for the ACP host
 * to call `authenticate`."
 */
import { createInterface } from "node:readline";
import { ACP_AUTH_METHOD_ID, type AcpAuthenticateMeta, type AcpClientCapabilities } from "./types.ts";

type JsonRpcId = number | string;
interface JsonRpcMsg { jsonrpc: "2.0"; id?: JsonRpcId; method?: string; params?: unknown; result?: unknown; error?: unknown }

/** 宿主能力位按本机实测形状校验（宽松：缺省 false）。 */
export function parseClientCapabilities(params: unknown): AcpClientCapabilities {
  const p = (params ?? {}) as Record<string, unknown>;
  const cap = (p.clientCapabilities ?? {}) as Record<string, unknown>;
  const b = (k: string): boolean => cap[k] === true;
  return {
    terminal: b("terminal"), terminal_auth: b("terminal_auth"),
    "fs.read": b("fs.read"), "fs.write": b("fs.write"),
    subagents: b("subagents"), elicitation: b("elicitation"),
    partial_content: b("partial_content"), multi_root: b("multi_root"),
    grouped_options: b("grouped_options"), windsurf_config: b("windsurf_config"),
    message_grouping: b("message_grouping"), raw_ref_tags: b("raw_ref_tags"),
    revert: b("revert"), wiki: b("wiki"), request_diagnostics: b("request_diagnostics"),
    editor_context: b("editor_context"), terminal_context: b("terminal_context"),
    mcp: b("mcp"), plugins: b("plugins"), fast_context: b("fast_context"),
    subagent_control: b("subagent_control"), workspace_dir_commands: b("workspace_dir_commands"),
    chains: b("chains"),
    browser_preview: b("browser_preview"),           // [INV-D3] 实测 true
    browser_preview_open: b("browser_preview_open"), // [INV-D3] 实测 true
    clipboard_write: b("clipboard_write"),
  };
}

export class DevinAcpServer {
  private meta: AcpAuthenticateMeta | null = null;
  private capabilities: AcpClientCapabilities | null = null;

  /** 供嵌入方选择传输；本骨架走 stdio 行分隔 JSON-RPC。 */
  serveStdio(): void {
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: JsonRpcMsg;
      try { msg = JSON.parse(line); } catch { return; }
      void this.dispatch(msg).then((out) => {
        if (out) process.stdout.write(JSON.stringify(out) + "\n");
      });
    });
  }

  private async dispatch(msg: JsonRpcMsg): Promise<JsonRpcMsg | null> {
    if (msg.id === undefined || !msg.method) return null; // 通知不回包（骨架简化）
    switch (msg.method) {
      case "initialize": {
        this.capabilities = parseClientCapabilities(msg.params);
        return {
          jsonrpc: "2.0", id: msg.id,
          result: {
            protocolVersion: (msg.params as { protocolVersion?: string })?.protocolVersion,
            // agent 侧能力（真实 CLI 还会广告 modes/skills 等；此处只还原骨架）
            agentCapabilities: {},
            authMethods: [{ id: ACP_AUTH_METHOD_ID, name: "Windsurf API Key", description: "Authenticate via host-provided API key" }],
          },
        };
      }
      case "authenticate": {
        const params = (msg.params ?? {}) as { methodId?: string; meta?: Record<string, unknown> };
        if (params.methodId !== ACP_AUTH_METHOD_ID) {
          return { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `unsupported auth method: ${params.methodId}` } };
        }
        const meta = params.meta ?? {};
        this.meta = {
          api_key: String(meta.api_key ?? ""),
          api_server_url: String(meta.api_server_url ?? ""),
        };
        // 凭据只驻内存（日志语义：宿主是唯一凭据来源，本地存储弃用）[INV-F5]
        return { jsonrpc: "2.0", id: msg.id, result: {} };
      }
      case "session/new":
        return { jsonrpc: "2.0", id: msg.id, result: { sessionId: `sess-${Date.now()}` } };
      case "session/list":
        return { jsonrpc: "2.0", id: msg.id, result: { sessions: [] } };
      default:
        if (msg.method.startsWith("cognition.ai/")) {
          // 实测存在的扩展方法族 [INV-G3]；browser preview 的具体方法名未公开 [INV-D4]
          return { jsonrpc: "2.0", id: msg.id, result: {} };
        }
        return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
    }
  }
}
