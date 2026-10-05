/**
 * cloud-sessions.ts —— Devin Cloud 会话客户端骨架（cleanroom 重构）
 *
 * 端点事实：https://api.devin.ai（本机 devin_deployment 缓存解码实测 + 文档）[INV-E1/D7]。
 * 端点族形态来自官方 API 索引（v1 legacy / v3 org sessions）；精确路径与字段以官方
 * OpenAPI（docs.devin.ai 的 /v1-openapi.yaml、/v3-openapi.yaml）为准 —— 本骨架只固化
 * "本地 harness ↔ 云会话"的形状，供驱动云端的 computer/browser 会话时参考。
 *
 * 云会话内与 CU/BU 相关的事实（来自文档，静态记录）[DOC computer-use/devin-session-tools]：
 *  - computer 工具：截图-动作循环，1024×768，Linux/Windows/macOS/Outposts；
 *  - Interactive Browser（CU 启用后 UI 标签改名 Computer）：人机同屏接管；
 *  - 会话内 CDP：http://localhost:29229（Playwright connect_over_cdp 可附着）。
 */

import { DEVIN_API_BASE } from "./types.ts";

/** PAT（Personal Access Token）。凭据由调用方提供，本骨架不存储。 */
export interface DevinSessionClientOptions {
  token: string;
  baseUrl?: string;          // 默认 https://api.devin.ai
  fetchImpl?: typeof fetch;
}

/** v1 legacy：创建云会话（端点族形态，字段名以官方 OpenAPI 为准）。 */
export interface CreateSessionRequestV1 {
  prompt: string;
  snapshotId?: string;       // blueprint/快照
  idempotencyKey?: string;
  /** 本分册关注点：会话内是否可用桌面控制由组织级开关决定，客户端仅可提示。 */
  hidden?: boolean;
}

export interface SessionHandle {
  sessionId: string;         // 形如 https://app.devin.ai/sessions/<id> 中的 <id>
  url?: string;
  status?: string;
}

export class DevinSessionClient {
  private readonly opts: DevinSessionClientOptions;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: DevinSessionClientOptions) {
    this.opts = opts;
    this.base = (opts.baseUrl ?? DEVIN_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.token}`,
      "Content-Type": "application/json",
    };
  }

  /** v1 legacy：创建会话。 */
  async createSessionV1(req: CreateSessionRequestV1): Promise<SessionHandle> {
    const res = await this.fetchImpl(`${this.base}/v1/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`create session failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as SessionHandle;
  }

  /** v3：向活动会话发消息（文档：挂起会话会被自动恢复）。 */
  async sendMessageV3(sessionId: string, message: string): Promise<void> {
    const res = await this.fetchImpl(
      `${this.base}/v3/organizations/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", headers: this.headers(), body: JSON.stringify({ message }) },
    );
    if (!res.ok) throw new Error(`send message failed: ${res.status} ${await res.text()}`);
  }

  /** v3：取会话详情（观测 computer/browser 活动的数据面入口之一）。 */
  async getSessionV3(sessionId: string): Promise<unknown> {
    const res = await this.fetchImpl(
      `${this.base}/v3/organizations/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET", headers: this.headers() },
    );
    if (!res.ok) throw new Error(`get session failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /**
   * 人接管辅助：`devin ssh <session>` / `devin forward <session> 8080:3000` 的本地形态
   * （可 --gateway host[:port]）[DOC cli/reference/commands]。本骨架不实现 SSH，只给出
   * 会话→网关参数的形状提示。
   */
  static sshCommandShape(session: string, gateway?: string): string {
    return `devin ssh ${session}${gateway ? ` --gateway ${gateway}` : ""}`;
  }
}
