# source/devin —— Devin（Cognition）三层源码整理

> 对应分册：[agents/devin/README.md](../../agents/devin/README.md)（及 computer-use.md / browser-use.md / evidence/inventory.md）。
> 红线遵守：不含 Cognition 专有代码（CLI Rust 二进制、`exa.*` 官方 proto、Devin Desktop 打包物均未入库）；
> 不含凭据（`devin-session-token$…`、PAT、credentials.toml 值一概不出现）；本目录全部文件为本仓库手写整理或 cleanroom 重构。

## 版本基线

| 组件 | 基线 | 依据 |
|---|---|---|
| Devin CLI（内部代号 chisel） | `3000.6.19` commit `e2b252e2`，macOS arm64，binary 名 `devin` | 本机 `~/.local/share/devin/cli/logs/` 实测（2026-09-16） |
| Devin Desktop（=Windsurf 更名） | IDE `3.2.23` / exa extension `1.48.2`（协议常量口径） | 本机第三方开源参考实现（oh-my-pi）记录的 Metadata 常量 |
| Devin Cloud API | v1（legacy）/ v2 / v3 三代并存 | docs.devin.ai `_llms/en/api.md`（抓取 2026-10-06） |
| 官方文档快照 | docs.devin.ai 全站（llms.txt 站点地图） | 抓取日 2026-10-06 |

## 三层来源说明

```
source/devin/
├── schemas/tools.json      工具面/对象面/权限/沙箱/端点/模型网关/技能系统 的规范化 JSON
│                           （来源：官方文档 + 本机日志/SQLite/缓存解码 + 第三方参考实现三方交叉）
├── reference/              cleanroom 重构的协议形状骨架（TypeScript，仅 Node 内置依赖）
│   ├── README.md           运行性说明与"真实 vs 占位"边界
│   └── src/
│       ├── types.ts            ACP 能力位（实测 25 项）、Connect 帧常量、会话/存储形状
│       ├── oauth.ts            CLI 登录流（PKCE S256 + 127.0.0.1:59653 → api.devin.ai/auth/cli/token）
│       ├── cloud-sessions.ts   api.devin.ai 云会话客户端骨架（v1 create / v3 message 形状）
│       ├── cascade-gateway.ts  server.codeium.com 模型网关 Connect-RPC 帧协议（编解码占位）
│       ├── acp-server.ts       ACP server 骨架（initialize/authenticate/session/* + cognition.ai/* 扩展）
│       └── sandbox.ts          --sandbox 配置 → bwrap / Seatbelt 形状映射 + excluded 裁决
└── vendor/                 空（见 vendor/README.md：无合规可 vendor 的开源上游）
```

### 与"本地执行 vs 云端执行"核心判定的关系

- 本目录的 **cloud-sessions.ts** 与 schemas 的 `cloud_session_tools` 面对应"云端执行"侧：`computer` 工具与
  Interactive Browser 都在云会话 VM 内，本地只能经 API/ssh/forward 代理与观测。
- **acp-server.ts** 与 `acp_extension` 面对应"本地投影"侧：CLI 的 browser use 投影是 ACP 扩展能力位
  （`browser_preview`/`browser_preview_open`，本机三份日志实测 true），方法名未公开。
- **cascade-gateway.ts** 与 `modelGateway` 面是 CLI 本身唯一的"重协议"通道（模型流式网关）——
  它传输的是对话与工具调用 JSON schema（`ChatToolDefinition.jsonSchemaString`），与 GUI 控制无关，
  这正是"CLI 无 CU/BU"的协议侧佐证。

## 许可证归属

- 本目录代码：随仓库根 [LICENSE](../../LICENSE)（MIT，Copyright (c) 2026 freeall12）。
- 文中出现的接口事实（端点、端口、字段名、工具名、flag 名）来自公开文档与本地取证，不构成专有代码的衍生。
- `exa.*` protobuf 定义、Devin CLI/Desktop 二进制：Cognition 专有，未包含，也无派生转录（`browser_preview_pb`
  仅在 schemas 中以字段名级别描述形状，其转录源为本机第三方开源项目 oh-my-pi 的独立取证）。

## 可运行性

- `reference/`：Node.js ≥ 20（用了 `fetch`/`AbortSignal` 等内置能力），无第三方依赖，`tsc --strict` 可过
  （唯一预期告警：`cascade-gateway.ts` 的 proto 编解码占位需要接入者补齐）。
- 需要真实凭据的路径（OAuth 授权、云会话创建、模型网关）在本仓库**不可**运行——没有也不应有测试凭据。
- 可无凭据运行的部分：`acp-server.ts` 的 initialize/session 握手（与标准 ACP 宿主对跑）、
  `sandbox.ts` 的形状编译、`cascade-gateway.ts` 的帧编解码单测（自备字节流）。
