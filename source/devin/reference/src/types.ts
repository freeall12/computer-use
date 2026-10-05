/**
 * types.ts —— Devin 协议形状（cleanroom 重构，仅接口事实）
 *
 * 出典标注约定：
 *  [INV-x]  agents/devin/evidence/inventory.md 第 x 条
 *  [DOC]    docs.devin.ai 公开文档（抓取日 2026-10-06）
 *  [OMP]    本机第三方开源参考实现 oh-my-pi 中记录的协议形状（独立取证来源）
 */

// ---------------------------------------------------------------------------
// ACP（Agent Client Protocol）—— CLI 作为 ACP server 被 IDE 宿主拉起 [INV-G3]
// ---------------------------------------------------------------------------

/** 本机三份日志实测的宿主（Devin Desktop / Windsurf）能力位 [INV-G3] */
export interface AcpClientCapabilities {
  terminal: boolean;               // 实测 false（宿主不带终端集成）
  terminal_auth: boolean;          // 实测 false
  "fs.read": boolean;              // true
  "fs.write": boolean;             // true
  subagents: boolean;              // true
  elicitation: boolean;            // true
  partial_content: boolean;        // true
  multi_root: boolean;             // true
  grouped_options: boolean;        // true
  windsurf_config: boolean;        // true
  message_grouping: boolean;       // true
  raw_ref_tags: boolean;           // true
  revert: boolean;                 // true
  wiki: boolean;                   // false
  request_diagnostics: boolean;    // true
  editor_context: boolean;         // true
  terminal_context: boolean;       // false
  mcp: boolean;                    // true
  plugins: boolean;                // true
  fast_context: boolean;           // true
  subagent_control: boolean;       // true
  workspace_dir_commands: boolean; // false
  chains: boolean;                 // false
  /** Cognition 私有扩展能力：宿主可提供网页预览回灌 [INV-D3/D4] */
  browser_preview: boolean;        // true（本机三份日志一致）
  /** 在系统浏览器中打开预览 [INV-D3] */
  browser_preview_open: boolean;   // true（同上）
  clipboard_write: boolean;        // false
}

/** 本机日志实测出现过的 cognition.ai/* 扩展方法（7 个，含 .gz 日志）[INV-G3] */
export type CognitionExtMethod =
  | "cognition.ai/document/didOpen"
  | "cognition.ai/document/didFocus"
  | "cognition.ai/workspace/didChangeFiles"
  | "cognition.ai/skills/list"
  | "cognition.ai/mcp/listServers"
  | "cognition.ai/rules/list"
  | "cognition.ai/revert/listSteps";
// browser_preview / browser_preview_open 对应的具体 extMethod 名未公开（[INV-D4] 推断在同一命名空间）。

/** ACP authenticate 元数据（宿主是唯一凭据来源）[INV-F5] */
export interface AcpAuthenticateMeta {
  api_key: string;        // 宿主持有的 API key（不得落盘日志）
  api_server_url: string; // 模型/服务网关地址
}
export const ACP_AUTH_METHOD_ID = "windsurf-api-key" as const; // [INV-A2/F5]

// ---------------------------------------------------------------------------
// Connect-RPC 帧协议（server.codeium.com 模型网关）[INV-E4, OMP]
// ---------------------------------------------------------------------------

export const CONNECT_COMPRESSED_FLAG = 0x01; // 帧载荷 gzip [OMP]
export const CONNECT_END_STREAM_FLAG = 0x02; // end-of-stream JSON trailers [OMP]
/** 参考实现的防御性帧上限（防恶意长度前缀），非服务端约定 [OMP] */
export const MAX_CONNECT_FRAME_PAYLOAD = 16 * 1024 * 1024;

export interface ConnectFrameHeader {
  flag: number;      // bit0=gzip payload, bit1=end-of-stream trailers
  length: number;    // uint32 BE
}

/** 网关请求元数据（字段名来自 OMP 转录的 Metadata 消息形状）[INV-E4] */
export interface GatewayMetadata {
  apiKey: string;          // 形如 "devin-session-token$<…>"（凭据，绝不入库）
  userJwt?: string;        // GetUserJwt 换取的短时 JWT
  ideName: string;         // 实测 "windsurf"
  ideVersion: string;      // 实测 "3.2.23"
  extensionName: string;   // 实测 "windsurf"
  extensionVersion: string;// 实测 "1.48.2"
  locale?: string;         // "en"
}

/** GetChatMessageResponse 的字段形状（流式增量）[OMP] */
export interface GetChatMessageResponseShape {
  messageId?: string;
  deltaThinking?: string;
  deltaSignature?: string;
  deltaText?: string;
  deltaToolCalls?: Array<{ id?: string; name?: string; argumentsJson?: string }>;
  stopReason?: number;     // enum StopReason
  usage?: {
    inputTokens: bigint; outputTokens: bigint;
    cacheReadTokens: bigint; cacheWriteTokens: bigint;
  };
}

// ---------------------------------------------------------------------------
// 云会话 API（api.devin.ai）[INV-D7/E1, DOC]
// ---------------------------------------------------------------------------

export const DEVIN_API_BASE = "https://api.devin.ai" as const;      // [INV-E1]
export const DEVIN_WEBAPP_BASE = "https://app.devin.ai" as const;   // [INV-E2]

/** CLI deployment 缓存 payload 形状（本机缓存解码实测）[INV-B7] */
export interface DevinDeploymentCache {
  version: number;
  identity_digest: string;
  fetched_at_secs: number;
  payload: string; // base64(JSON): { webapp_host: string|null, api_url: string }
}

/** 云端会话的三类人机观测通道 [DOC devin-session-tools] */
export type CloudSessionTab = "Shell" | "Devin IDE" | "Browser" /* CU 启用后改名 "Computer" */ | "Progress" | "Side Chat";

/** 云端会话内浏览器的固定 CDP 端点（会话 VM 内部）[DOC computer-use] */
export const SESSION_CDP_ENDPOINT = "http://localhost:29229" as const;

// ---------------------------------------------------------------------------
// 会话本地存储（sessions.db）形状 [INV-B5/B6]
// ---------------------------------------------------------------------------

/** tool_call_state.tool_call_json 注释自述为 "Serialised acp::ToolCall JSON" [INV-B6] */
export interface SessionRow {
  id: string;
  working_directory: string;
  backend_type: string;
  model: string;
  agent_mode: string;      // 原 permission_mode（迁移 13 更名）
  cogs_json?: string;
  workspace_dirs?: string;
  hidden: number;
  metadata?: string;
}
