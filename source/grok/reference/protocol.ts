/**
 * protocol.ts — Grok Bot CU sidecar 本地 RPC 协议形状（cleanroom 重述）
 *
 * 依据：Grok Bot 0.66.0 静态逆向（agents/grok/computer-use.md §2；source/grok/schemas/tools.json）。
 * 本文件为接口标识与协议形状的重述，不含任何专有代码。
 * 传输：Unix domain socket；请求/响应均为单行 JSON（\n 结尾）。
 */

export type SidecarVariant = 'prod' | 'lab' | 'dev';

/** sidecar 三环境变体（宿主以产品配置在运行时覆盖类默认值） */
export interface SidecarVariantConfig {
  appName: string;
  bundleId: string;
  appSupportDir: string;
  executable: string;
}

export const SIDECAR_VARIANTS: Record<SidecarVariant, SidecarVariantConfig> = {
  prod: { appName: 'Grok Bot Computer Use', bundleId: 'co.anysphere.grok-bot-computer-use', appSupportDir: 'grok-bot-computer-use', executable: 'CUGrokBotService' },
  lab: { appName: 'Grok Bot Lab Computer Use', bundleId: 'co.anysphere.grok-bot-lab-computer-use', appSupportDir: 'grok-bot-lab-computer-use', executable: 'CUGrokBotLabService' },
  dev: { appName: 'Grok Bot Dev Computer Use', bundleId: 'co.anysphere.grok-bot-dev-computer-use', appSupportDir: 'grok-bot-dev-computer-use', executable: 'CUGrokBotDevService' },
};

/** service.json（sidecar 就绪后发布；宿主读取 rpcSocketPath） */
export interface ServiceState {
  rpcSocketPath: string;
}

/** 控制模式：companion 按 app 后台驱动；remote 整屏接管（需 control/start 会话） */
export type ControlMode = 'companion' | 'remote';

/** 请求帧：所有方法共用（行分隔 JSON） */
export interface RpcRequest {
  id: string;
  method: RpcMethodName;
  requestID: string;
  arguments?: unknown;
  /** tools/call 附带 */
  name?: string;
  timeoutSeconds?: number;
  startedAtEpochSeconds?: number;
  deadlineEpochSeconds?: number;
  mode?: ControlMode;
  sessionId?: string;
}

export type RpcMethodName =
  | 'ping'
  | 'initialize'
  | 'tools/list'
  | 'tools/call'
  | 'notifications/initialized'
  | 'notifications/cancelled'
  | 'control/start'
  | 'control/release'
  | 'permissions/status'
  | 'permissions/open-settings';

/** 响应帧：成功带 result，失败带 error/errorCode */
export interface RpcResponse<T = unknown> {
  id: string;
  result?: T;
  isError?: boolean;
  message?: string;
  error?: string;
  errorCode?: string;
  sessionId?: string;
}

/** permissions/status 应答 */
export interface PermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
}

/** 结构化拒绝（catalog refusals 协议）：错误即指令 */
export type Escalation = 'retry' | 'ask_user' | 'use_different_tool' | 'stop';

export interface StructuredRefusal {
  code: RefusalCode;
  message: string;
  escalation: { recommended: Escalation; reason: string };
}

export type RefusalCode =
  | 'capture_failed' | 'invalid_arguments' | 'input_failed' | 'timeout'
  | 'secure_desktop' | 'input_desktop_unavailable' | 'target_elevated'
  | 'unsupported_request' | 'sidecar_unavailable' | 'session_busy' | 'permission_required'
  | 'screenshot_required' | 'unknown_tool' | 'outcome_unknown' | 'session_required'
  | 'user_aborted';

/** 16 错误码 → 四档建议（内嵌 refusals 表的静态映射，observed） */
export const ESCALATION_BY_CODE: Record<RefusalCode, Escalation> = {
  capture_failed: 'retry',
  invalid_arguments: 'retry',
  input_failed: 'retry',
  timeout: 'retry',
  secure_desktop: 'ask_user',
  input_desktop_unavailable: 'ask_user',
  target_elevated: 'ask_user',
  unsupported_request: 'ask_user',
  sidecar_unavailable: 'ask_user',
  session_busy: 'ask_user',
  permission_required: 'ask_user',
  screenshot_required: 'use_different_tool',
  unknown_tool: 'use_different_tool',
  outcome_unknown: 'use_different_tool',
  session_required: 'use_different_tool',
  user_aborted: 'stop',
};

/** 客户端时序参数（observed：local-exec-daemon 静态默认值） */
export const CLIENT_TIMING = {
  defaultCallTimeoutMs: 45_000,
  launchReadyTimeoutMs: 8_000,
  launchPollIntervalMs: 200,
  /** 预投递连接错误（sidecar 未起/重启中）→ relaunch 后重试一次 */
  relaunchOnConnectionErrors: ['ENOENT', 'ECONNREFUSED'],
} as const;

/** 编码：单行 JSON 帧 */
export function encodeFrame(req: RpcRequest): string {
  return `${JSON.stringify(req)}\n`;
}

/** 解码：按 \n 切帧；超限即失败（协议有响应大小上限） */
export function createFrameSplitter(maxBytes: number, onFrame: (line: string) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) {
        if (buffer.length > maxBytes) throw new Error('RPC response exceeded the size limit');
        return;
      }
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.length > maxBytes) throw new Error('RPC response exceeded the size limit');
      onFrame(line);
    }
  };
}
