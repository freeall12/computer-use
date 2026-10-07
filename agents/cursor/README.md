# Cursor（Anysphere）· 原生 Computer Use 与 Browser Use 逆向总览

> 一句话结论：**两种能力同一形态——VSCode fork 上自建「一方 MCP provider」（registerMcpProvider 挂工具）；BU 本机可用（内嵌 Electron 浏览器 + 合成 DOM 事件 + ref 句柄），CU 被 Statsig 门控默认关，但扩展自带 TS 源码静态还原出 16 工具 + Swift sidecar 全貌。**

| 项 | 值 |
|---|---|
| 载体 | Cursor 3.22.12（VSCode 1.128.0 fork）· cursor-agent CLI 2026.09.23-86fc751 |
| 形态 | 一方 MCP provider：browser→`cursor-ide-browser`；computer→`cursor-computer-use` |
| BU 工具面 | 16 个 browser_* 工具 · 快照 ref + 合成 DOM 事件 |
| CU 工具面 | macOS companion 16 工具（+Windows zoom/batch）· sidecar 执行 |
| 安全模型 | BU：导航 origin allowlist · CDP 拒绝列表 · browser_lock 用户夺回 ｜ CU：TCC 双权限 + 输入租约 + CDN 签名链 |
| 本机可用 | BU ✅（有使用痕迹）· CU ⚙️ 未启用（门默认关、sidecar 未装） |

> 门控一行：Statsig `mac_computer_use` / `local_computer_use` / `windows_computer_use_batch` 默认全 false；`browser_subagent` 默认 on；服务端专用模型 `modelId:"sand-cua"`。方法：只读静态分析（未解包 asar——CU 扩展自带完整 TS 源码）。证据见 [evidence/inventory.md](evidence/inventory.md)。

## 架构一图

```
Cursor 云端（api2/api3/api5.cursor.sh）：agent.v1 protobuf · "sand-cua" 专用模型 · Statsig 下发
 ▼ HTTPS 流式 MCP 工具调用
Cursor.app（Electron，VSCode 1.128 fork）
 ├─ [MCP provider] cursor-ide-browser（内置扩展 cursor-browser-automation）
 │    16 个 browser_* 工具 → executeCommand("cursor.browserView.*") + 页面注入 JS
 │    → 主进程 browserViewMainService（webview/WebContentsView）+ sendCDPCommand 拒绝列表
 └─ [MCP provider] cursor-computer-use（内置扩展，自带 TS 源码）[门默认关]
      16 个 computer_* 工具 → Unix socket JSON-RPC（service.json 会合）
      → computer-use-sidecar.app（Swift，CDN 签名分发，AX + TCC + 真实输入）
```

## 能力矩阵：BU（本机已验证）vs CU（静态还原）

| 维度 | Browser Use | Computer Use |
|---|---|---|
| 提供形态 | MCP provider `cursor-ide-browser` | MCP provider `cursor-computer-use`（附 TS 源码） |
| 目标域 | 内嵌浏览器标签（可见 + headless） | macOS 单 app（companion）或全屏（remote）；Win 桌面；Linux 云 worker |
| 观察 | 注入 JS 遍历 composed DOM → a11y 快照 YAML + `data-cursor-ref` + diff | 截图（WEBP 固定 canvas）+ `computer_app_state` AX 树文本（snapshot_id） |
| 动作 | 注入 JS 合成 DOM 事件（**不用 CDP Input**，主进程硬禁） | 原生注入：mac sidecar（AX 读写+真实输入）、Win sidecar、Linux xdotool |
| 引用稳定性 | element 描述校验防漂移；快照 watchdog 保活（15s/3s/5min） | element_id + snapshot_id 双引用；树变报 stale |
| 权限门 | origin allowlist（禁 file://）· CDP 拒绝列表 · browser_lock 可被用户 Take Control | TCC 双权限 + 自动弹窗路由 · 输入租约 · CDN 签名校验链 |
| 默认状态 | 开（browser_subagent:!0）；可见标签 UI 受 cursor.browserTabEnabled（默认 false） | 关（三门全 false） |
| 本机痕迹 | `~/.cursor/browser-logs/`（CDP 截图 + 快照 YAML） | 无（sidecar 目录不存在） |
| 错误处理 | 结构化 {success,error,suggestion} + 4 次失败即停提示词 | 结构化 refusal {code,message,escalation:retry/ask_user/…} |

## 文档导航与快速复核

| 文件 | 内容 |
|---|---|
| [browser-use.md](browser-use.md) | 16 工具、快照/ref 机制、合成 DOM 事件、CDP 拒绝列表 |
| [computer-use.md](computer-use.md) | sidecar 架构、companion/remote 双模式、16 工具、安全模型 |
| [evidence/inventory.md](evidence/inventory.md) | 路径、版本、代码摘录、字节偏移、特性开关默认值 |

```bash
V=/Applications/Cursor.app/Contents/Resources/app
ls $V/extensions/cursor-computer-use/src/mcp/   # CU 源码（tools.ts / mac-mode.ts）
grep -o '"cursor\.browserView\.[a-zA-Z.]*"' -r $V/out/vs | sort -u
ls ~/.cursor/browser-logs/                      # BU 真实使用痕迹
ls ~/.cursor/computer-use-sidecar/              # CU 未安装（本机为空）
```

> 与 VSCode fork 底座：editor/extension host/webview 体系来自 fork 底座；一方 MCP provider 框架、browserView 命令族、CU sidecar 分发、Glass UI 为 Cursor 自建。CU/BU 工具经 MCP 面进入 `cursor-agent-host → cursor-agent-exec/worker → cursor-local-agent-runtime` 三层编排。
