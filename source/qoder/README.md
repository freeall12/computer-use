# source/qoder — Qoder 桌面/浏览器控制源码层

> 整理自 `agents/qoder/` 逆向分册（Qoder.app 0.4.3，自研 Electron workbench，只读静态分析；本机 CU 未启用、BU in-app 链路已真实使用）。
> 本目录 = 接口数据（schemas）+ cleanroom 参考实现（reference）+ 开源上游子集（vendor），不含任何 Qoder 专有代码。

## 三层结构

### schemas/（接口数据，全部带 `_provenance` 头）

| 文件 | 内容 | 置信度 |
| --- | --- | --- |
| `cu-sdk-methods.json` | CU 11 SDK 方法（listApps/getAppState + 9 动作）与 Swift IPC 类型名一一映射（ComputerUseIPCListAppsRequest 等）+ 传输协议（注册表/握手/15s ping/140s 超时断链/busy 单飞）+ 信任链（TrustedBundleIdentifiers 14 项含 com.aliyun.lingma.ide） | 高（SDK 随包 TS 源码直读） |
| `windows-tools.json` | Windows MCP 16 工具（list_apps…run_steps，含 macOS 面没有的窗口枚举与 run_steps 批量动作） | 清单=高；参数=中 |
| `bu-tools.json` | 内置 `browser-use` MCP server 16 工具（注册时钉死校验 chrome-devtools-mcp 兼容基线）+ 两后端（in-app WebContentsView / external Connector）+ 本机 42 次调用实录 | 高 |
| `browser-agent-api.json` | Browser Agent API 对象面（agent/browsers/browser/tab 方法 + capabilities：cdp 允许列表/botDetection/pageAssets/webmcp）+ Native Messaging 发现协议（4B LE 帧、clients/*.json 心跳、5 扩展 ID 白名单）+ 错误码族 + 动态文档 id | 高（SKILL/bundle 直读；本机未激活，静态还原） |
| `record-replay.json` | Record & Replay 3 工具（event_stream_start/status/stop）+ 产物语义（events.jsonl/session.json/suppressedEventsPath）+ Skill 生成闭环 | 工具=高；产物格式=中 |

### reference/（cleanroom 参考实现，TypeScript，node 可直接运行）

| 文件 | 对应机制 |
| --- | --- |
| `uds-registry.ts` | UDS + token 注册表协议：`computer-use-tools.json` 四道硬校验（lstat 普通文件/非符号链接/0600/属主 uid，token ≥32）→ ENOENT 时 `/usr/bin/open -g` 懒拉起等 10s → initialize{token,instanceId} 握手（instanceId 必须一致，返回 sessionId）→ busy 单飞（同连接一个在途）→ 超时主动断链（「结果可能已生效，先观察再决定是否重试」） |
| `app-approval.ts` | per-app 审批表（AppApprovalStore ↔ ComputerUseAppApprovals.json，单任务授权过期）+ URL 禁区（"Computer Use stopped due to encountering a disallowed URL: …"）+ 四档动作时确认策略（MUST_HAND_OFF / ALWAYS_CONFIRM / PREAPPROVABLE / FREE，编号对齐 SKILL 分类法） |
| `test.mjs` | 形状自测（8 项断言，含异步用例顺序执行），`node test.mjs` 直接运行 |

### vendor/qwen-node-repl/（Apache-2.0 开源上游子集）

- 上游 `github.com/QwenLM/qwen-code`，**commit `b1ac3e297023a27dea8b4836fb86f0a4b4bd8b49`**（与 Qoder.app 内 `node-repl/UPSTREAM.md` 记载一致）
- 搬运内容：上游 `packages/node-repl/` 在该 commit 的**全部 40 个 blob**（runtime/kernel.mjs、kernel-manager.ts、mcp-server.ts、protocol.ts、cell-transform.ts、security-policy.ts + 测试与冒烟脚本；源码级，无 dist）
- Qoder 的产品化改造（内核池/turnContext/trusted-service 桥）不在本仓库；详见 `vendor/qwen-node-repl/UPSTREAM.md`

## 运行自测

```bash
cd source/qoder/reference && node test.mjs
```
