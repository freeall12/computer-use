# Qoder（阿里系）· 自研 workbench，CU/BU 收在默认全关的"电脑操控"面板

> 一句话结论：**桌面控制走 node_repl SDK → UDS → 独立 Swift 应用（本机未启用）；浏览器控制 in-app 链路已真实使用，16 工具钉死对齐 chrome-devtools-mcp 基线。**

| 项 | 值 |
|---|---|
| 载体 | `/Applications/Qoder.app` 0.4.3（com.qoder.app，Electron 自研 workbench，**非 VSCode fork**） |
| 形态 | 内置 app-plugin `qoder.computer-control`（三个子能力，默认全关）+ 内置 MCP servers |
| CU 工具面 | SDK 11 方法（macOS）· Windows MCP 16 工具（本机不适用） |
| BU 工具面 | 16 工具（=chrome-devtools-mcp 基线，注册时强校验）· Browser Agent API 对象面 |
| 安全模型 | TCC 双权限 + per-app 审批 + URL 禁区 · 扩展侧确认 · CDP 允许列表 |
| 本机可用 | ⚙️ CU 从未激活；in-app BU 已用（2026-10-05 会话 42 次调用） |

## 架构一图

```
云端（api2/api3/center.qoder.sh；国区 gateway.qoder.com.cn）── agent-sdk wire 1.5.0
 └─ Qoder.app（内置 qodercli worker = 本地 agent；基础工具 + 内置 MCP：node-repl/browser-use/…）
     ├─ node_repl 内核（迁自 qwen-code qwen_node_repl，Apache-2.0）
     │    ├─ @qoder-space/computer-use-sdk ── UDS+token ── Qoder Computer Use.app 1.0.12（Swift）
     │    │    （AX 树 + CGEvent 合成 + ScreenCaptureKit；本机未启用）
     │    └─ createBrowserAgent() ── HTTP loopback + Bearer ── 主进程 Browser Use 宿主（未激活）
     ├─ 内置 browser-use MCP（16 工具，钉死校验）→ WebContentsView in-app 浏览器【已用】
     │                                          ↘ Browser Connector → 扩展内执行【未激活】
     └─ Record & Replay（MCP event-stream，录用户演示生成 Skill）
```

## 能力矩阵

| 维度 | Computer Use | Browser Use |
|---|---|---|
| 提供形态 | 子插件 computerUse v1.0.1：只注入 SKILL.md，交互全走 node_repl SDK（无独立 MCP） | ① 主进程内置 MCP server（16 工具）；② 子插件 browserUse v1.0.0（Browser Agent API） |
| 目标域 | 单个 macOS app 的 key window（无桌面级/窗口枚举）；Windows 走独立 MCP | in-app 会话私有标签；外部 Chrome/Edge 经 Connector |
| 观察 | AX 树文本（elementIndex + diff）+ SCK 截图；动作后自动回传新状态 | AX 快照（diff 默认开）+ 截图 + 网络/控制台摘要 |
| 动作 | AX 语义优先（elementIndex），CGEvent 坐标兜底；set_value 走 AXValue | in-app 合成输入+脚本；外部扩展内 Playwright 语义动作 |
| 引用稳定性 | elementIndex 只对最近一次快照有效；坐标要求截图未过期 + 几何未变 | ref/uid 只对最近快照有效；claim 标签一次性 opaque id |
| 权限门 | TCC 双权限 + 自有授权窗 + per-app 审批 + URL 禁区 + 对端签名信任链 | in-app internet policy；外部逐动作确认、凭据硬禁、CDP 允许列表 |
| 本机痕迹 | 无（`~/.qoder/ipc/` 为空；Runtime 已校验安装在 `~/.qoder/bin/`） | in-app 已用（navigate×18 / snapshot×17 等）；connector 未激活 |

## 谱系

| 判定 | 依据 |
|---|---|
| qwen/通义血缘（确证） | node_repl 内核迁自 qwen-code（UPSTREAM.md 原文）；CU SDK 自述与 "qcum" 快照契约一致；信任链含 com.aliyun.lingma.ide；遥测走阿里云 ARMS RUM |
| 非 Claude Code 协议兼容端 | 自研 wire 1.5.0；但工具命名 / SKILL.md 格式与 Claude Code 习惯同构，`~/.qoder/skills/` 兼容 |
| 非 trycua 系 | CU Runtime/Bridge 为自研 Swift 模块，与 trycua/cua 无符号交集 |
| BU SDK 撞车 | `third_party/browser-use-sdk` 是 Qoder 自研（Apache-2.0），与开源 browser-use 同名不同码 |

已排除：`/Volumes/YANG/qoder/QoderGateway/` 与 `~/.qoder/qoder2api.db` 为分析者自建网关项目，非产品组件。"Qoder IDE"（VSCode fork 形态）与 `qodercli` CLI 本机未安装。

## 导航

- [computer-use.md](computer-use.md) — UDS+token 注册表流程、11 方法 SDK、确认策略四档、Record & Replay
- [browser-use.md](browser-use.md) — 三链路、16 工具钉死基线、Connector 发现协议、安全模型
- [evidence/inventory.md](evidence/inventory.md) — 标记字符串 + 字节偏移 + 复现命令

> 方法：只读静态分析（asar 解包、二进制 strings、用户数据勘查），不抓包、不触碰凭据；压缩 JS 以"标记字符串 + 字节偏移"定位。
