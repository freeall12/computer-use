# source/kimi-code — Kimi Code（KimiCU + webbridge + 桌面内嵌浏览器）源码层

> 整理自 `agents/kimi-code/` 逆向分册（kimi CLI 0.39.1 / KimiCU.app 0.6.6 / kimi-webbridge 2.0.22 / Kimi Code.app 1.0.4，只读静态分析 + 只读探针 + 会话实录比对）。
> 本目录 = 接口数据（schemas）+ cleanroom 参考实现（reference）。**无 vendor 层**（见下）。

## vendor 说明（无）

Kimi 链路的关键组件全部专有、无开源上游：
- `kimi-cu`（Swift 原生二进制 6.2MB）—— KimiCU 服务/MCP/维护子命令同体多形态；
- kimi CLI —— Node SEA 单文件可执行（agent-core-v2 自研包树）；
- kimi-webbridge daemon —— Go 闭源（源码包路径 `dev.msh.team/harness/agent-extension`，未公开发布仓库）；
- 浏览器扩展 —— 商店分发（MV3，闭源）。

唯一官方声明的第三方技术输入是 Cua AI 的 `SLSEventAuthenticationMessage + SLEventPostToPid`
后台 Chromium 键盘机制（MIT，THIRD_PARTY_NOTICES 明文致谢，实现独立）—— 未搬运任何
trycua 代码（如需对照该机制可参见 `source/minimax-code/vendor/cua-driver/` 与
`source/synara/vendor/cua-driver/` 的同源上游）。

## schemas/（接口数据，全部带 `_provenance` 头）

| 文件 | 内容 | 置信度 |
| --- | --- | --- |
| `mcp-tools.json` | 18 个 MCP 工具 + js/js_reset（内嵌 schema 偏移 2604544 还原）：参数/枚举/上限/别名双轨/snapshot_id 绑定/UDS 帧协议（KimiCU-UDS-1，4B LE + 8MiB）/安全模型/错误码 | 工具面=高；部分参数精确类型=中 |
| `webbridge-commands.json` | HTTP /command 信封（`{action,args,session}` → `{ok,data}` / `{ok:false,error:{code,message}}`）+ 16 命令（14 表内 + read_page/wait 表外）+ tab group 会话语义 + 运维边界 | 清单=高；read_page/wait=中 |
| `desktop-browser-operations.json` | 桌面内嵌浏览器单一 `run` 工具（协议 kimi.browser/1.0.0）的操作面 + 双模快照（TOON）/隔离世界/接管与 receipts | 已还原 39 操作=高；**总数出入见下** |

> **总数出入（低置信清单项）**：分册标题写「43 操作」，逐名清单实收 **39**（browser.* 10 +
> tab.* 9 + page.* 12 + page.element.* 8）。按 evidence §9 的行式前缀读法清单自洽为 39；
> 差异 4 个操作未在本机还原。

## reference/（cleanroom 参考实现，TypeScript，node 可直接运行）

| 文件 | 对应机制 |
| --- | --- |
| `mcp-server.ts` | MCP stdio server 骨架：initialize/tools/list（注册 18 工具）/tools/call；内存模拟 AX 树应答（FakeAppModel）；snapshot_id 绑定与跨 observation_context 拒绝；参数别名归一 + 未知字段拒绝（KIMI_CU_UNKNOWN_FIELD）；投递验证三态；附 KimiCU-UDS-1 帧编解码器（4B LE 长度 + JSON，8MiB 上限，半帧粘包处理） |
| `webbridge-codec.ts` | webbridge HTTP /command 信封协议编解码器：请求/应答信封形状、16 命令注册表、host 匹配（忽略 path、www 归一）、非回环绑定警告 |
| `test.mjs` | 形状自测（11 项断言），`node test.mjs` 直接运行 |

## 运行自测

```bash
cd source/kimi-code/reference && node test.mjs
```
