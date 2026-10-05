/**
 * cascade-gateway.ts —— server.codeium.com 模型网关 Connect-RPC 客户端骨架
 *
 * 这是 Devin CLI（以及 Windsurf/Devin Desktop 的 Cascade）把"模型请求"发到云端的通道。
 * 帧协议与端点为本机第三方开源参考实现（oh-my-pi）与本机 model_configs_v5 缓存双重
 * 证实的事实 [INV-E4/B8]；protobuf 消息体（exa.api_server_pb.*）为 Cognition 专有定义，
 * 本骨架不含其编解码 —— 以 `encodeWithYourOwnProtoLibrary` 占位，接入者需自行提供。
 */
import { gzipSync, gunzipSync } from "node:zlib";
import {
  CONNECT_COMPRESSED_FLAG,
  CONNECT_END_STREAM_FLAG,
  MAX_CONNECT_FRAME_PAYLOAD,
  type GatewayMetadata,
} from "./types.ts";

export const GATEWAY_BASE_URL = "https://server.codeium.com" as const; // [INV-E4]
export const PATH_GET_USER_JWT = "/exa.auth_pb.AuthService/GetUserJwt" as const;
export const PATH_GET_CHAT_MESSAGE = "/exa.api_server_pb.ApiServerService/GetChatMessage" as const;
export const PATH_GET_CLI_MODEL_CONFIGS = "/exa.api_server_pb.ApiServerService/GetCliModelConfigs" as const;

export interface ConnectFrame {
  /** bit0=gzip payload；bit1=end-of-stream JSON trailers（帧序列末尾） */
  flag: number;
  payload: Buffer;
}

/** 5 字节帧头：flag(1B) + length(4B BE) [INV-E4] */
export function encodeFrame(frame: ConnectFrame): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt8(frame.flag, 0);
  head.writeUInt32BE(frame.payload.length, 1);
  return Buffer.concat([head, frame.payload]);
}

/** 解析流式字节 → 帧序列；长度前缀超上限立即失败（防御恶意/损坏输入，参考实现同款防御）。 */
export function* decodeFrames(chunk: Buffer): Generator<ConnectFrame> {
  let offset = 0;
  while (chunk.length - offset >= 5) {
    const flag = chunk.readUInt8(offset);
    const length = chunk.readUInt32BE(offset + 1);
    if (length > MAX_CONNECT_FRAME_PAYLOAD) throw new Error(`connect frame too large: ${length}`);
    if (chunk.length - offset < 5 + length) return; // 等更多字节
    yield { flag, payload: chunk.subarray(offset + 5, offset + 5 + length) };
    offset += 5 + length;
  }
}

export function decompressMaybe(payload: Buffer, flag: number): Buffer {
  return flag & CONNECT_COMPRESSED_FLAG ? gunzipSync(payload) : payload;
}

/**
 * 一次 GetChatMessage 流式往返（形状级还原）：
 * 1. GetUserJwt(metadata.apiKey="devin-session-token$…") → { userJwt, customApiServerUrl? }
 * 2. GetChatMessage(gzip Connect 帧) → 流式帧：deltaThinking/deltaText/deltaToolCalls/usage
 *    + end-of-stream trailers（错误以 {error:{code,message,details}} 出现，无 HTTP 错误体）。
 */
export class CascadeGatewayClient {
  private readonly metadata: GatewayMetadata; // apiKey 绝不入日志/仓库
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    metadata: GatewayMetadata,
    fetchImpl: typeof fetch = fetch,
    baseUrl: string = GATEWAY_BASE_URL,
  ) {
    this.metadata = metadata;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
  }

  /** 连接帧头（content-type 为 Connect unary/streaming 的 proto 变体）。 */
  private streamHeaders(): Record<string, string> {
    return {
      "content-type": "application/connect+proto",
      "connect-protocol-version": "1",
      "connect-content-encoding": "gzip",
      "connect-accept-encoding": "gzip",
      "accept-encoding": "identity",
    };
  }

  /**
   * 发送一个 GetChatMessage 请求并逐帧回调。
   * @param encodeRequest 调用方自备的 proto 编码器（GetChatMessageRequest → Uint8Array）
   * @param decodeResponse 调用方自备的 proto 解码器（Uint8Array → 形状对象）
   */
  async streamChatMessage(
    requestFields: Record<string, unknown>,
    encodeRequest: (fields: Record<string, unknown>) => Uint8Array,
    decodeResponse: (bytes: Uint8Array) => { messageId?: string; deltaText?: string; deltaThinking?: string },
    onDelta: (d: { messageId?: string; deltaText?: string; deltaThinking?: string }) => void,
  ): Promise<void> {
    const body = encodeRequest(requestFields);
    const gz = gzipSync(Buffer.from(body));
    const res = await this.fetchImpl(`${this.baseUrl}${PATH_GET_CHAT_MESSAGE}`, {
      method: "POST",
      headers: this.streamHeaders(),
      body: encodeFrame({ flag: CONNECT_COMPRESSED_FLAG, payload: gz }),
    });
    if (!res.ok || !res.body) throw new Error(`gateway error ${res.status}: ${await res.text()}`);

    let pending = Buffer.alloc(0);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (value?.length) pending = Buffer.concat([pending, Buffer.from(value)]);
      for (const frame of decodeFrames(pending)) {
        pending = Buffer.alloc(0); // decodeFrames 已消费整个 pending（骨架简化）
        if (frame.flag & CONNECT_END_STREAM_FLAG) {
          const trailer = decompressMaybe(frame.payload, frame.flag).toString("utf8").trim();
          if (trailer) {
            const parsed = JSON.parse(trailer) as { error?: { code?: string; message?: string } };
            if (parsed.error) throw new Error(`gateway trailer error ${parsed.error.code}: ${parsed.error.message}`);
          }
          return;
        }
        onDelta(decodeResponse(decompressMaybe(frame.payload, frame.flag)));
      }
      if (done) break;
    }
  }
}

/*
 * 模型目录（GetCliModelConfigs）的归一化形状 [INV-B8]（字段名经本机缓存验证）：
 *   ClientModelConfig {
 *     modelUid: string        // 如 "claude-opus-5-medium"
 *     label: string           // 如 "Claude Opus 5 Medium"
 *     disabled: boolean
 *     supportsImages: boolean
 *     maxTokens: number       // 上下文窗口
 *     modelInfo?: { modelFeatures?: { supportsThinking?: boolean } }
 *   }
 * 缓存实证条目（脱敏）：apiBase 均为 https://server.codeium.com； Devin 自家系列
 * swe-2-high / swe-1-6-slow / swe-1-7-lightning / adaptive；effort 变体
 * low|medium|high|xhigh|max 与 *-fast。
 */
