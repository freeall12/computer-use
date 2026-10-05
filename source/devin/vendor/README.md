# source/devin/vendor —— 判定：无 vendor 层

**结论：Devin 无合规可搬运的开源上游，本目录保持为空。**

| 候选上游 | 判定 | 理由 |
|---|---|---|
| Devin CLI（`cli.devin.ai/install.sh` 分发的 Rust 二进制，内部代号 chisel） | 不可 vendor | 专有二进制，无公开源码仓库；本机副本已随 Devin.app 卸载，且红线禁止二进制入库 |
| `exa.*` protobuf 定义（api_server_pb / auth_pb / browser_preview_pb 等 35 包） | 不可 vendor | Cognition/Codeium 专有 proto；本机所得为第三方开源项目（oh-my-pi）内转录的子集，非上游原件，且完整集合属专有产品分发物 |
| Agent Client Protocol（agentclientprotocol.com） | 不需要 | 是第三方标准（独立规范仓库），非 Devin 上游组件；本目录 reference 只按其公开规范实现形状 |
| oh-my-pi（本机开源参考实现） | 不搬运 | 属本机另一项目的源码树，不是 Devin 的上游；其存在仅在分册中作为独立取证来源引用 |

vendor 引入条件（同仓库 source/README.md 约定）：能给出可验证的"本机版本 ↔ 上游修订"对应说明 + 原样目录 + LICENSE 全文。当前对 Devin 不成立。
