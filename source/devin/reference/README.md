# source/devin/reference —— Devin 协议形状参考骨架

> 本目录是对 `agents/devin/` 分册记录的协议事实做的 **cleanroom 重构**（本仓库作者手写，TypeScript），
> 用于表达"本地 harness ↔ Devin 云"的协议形状。**不含任何 Cognition 专有代码**；
> 所有常量/字段名/端点均来自公开文档与本机静态取证，来源以 `出典:` 注释标注。

## 文件

| 文件 | 内容 | 对应分册章节 |
|---|---|---|
| `src/types.ts` | 共享协议形状：ACP 能力位、Connect 帧常量、会话/消息形状 | inventory E/F/G |
| `src/oauth.ts` | CLI 登录流：PKCE + `app.devin.ai/auth/cli/continue` → `api.devin.ai/auth/cli/token` + 本地回调 59653 | inventory E1-E3、F5 |
| `src/cloud-sessions.ts` | `api.devin.ai` 云会话客户端骨架（v1 create / v3 message 形状） | inventory D7、schemas/cloudSessionApi |
| `src/cascade-gateway.ts` | `server.codeium.com` 模型网关 Connect-RPC 客户端骨架（GetChatMessage 帧解析） | inventory E4、schemas/modelGateway |
| `src/acp-server.ts` | ACP stdio server 骨架：initialize/authenticate/session/new + `cognition.ai/*` 扩展位（含 browser_preview 能力） | inventory G3、browser-use §3 |
| `src/sandbox.ts` | `--sandbox` 配置 → Linux bwrap 参数与 macOS Seatbelt profile 的形状映射 | inventory F3/F4 |

## 可运行性

- **不保证开箱即用**：这是协议形状骨架（skeleton），OAuth/会话/网关三处网络调用都需要真实账号凭据；
  本仓库**不提供、也不应硬编码**任何 token（`devin-session-token$…`、PAT 等）。
- 运行时依赖仅 Node.js 内置模块（`node:http`、`node:crypto`、`node:zlib`）。无第三方依赖。
- 合成 protobuf 需要真实 `.proto`（Devin 的 `exa.*` 为专有，未随附）；`cascade-gateway.ts` 因此以
  `encodeWithYourOwnProtoLibrary` 占位——帧协议是真实还原的，消息编解码需自行接入。
- `acp-server.ts` 可与任意标准 ACP 宿主（如 Zed）对跑 initialize/authenticate（无凭据也能握手）。

## 合规

- 专有部分（CLI Rust 二进制、`exa.*` 官方 proto、Desktop 应用）一概未反编译入内；
- 引用的常量（端点、端口、字段名）均为接口事实，非创造性表达；
- 源码许可证随仓库根 LICENSE（MIT）。
