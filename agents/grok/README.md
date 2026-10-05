# Grok（xAI）逆向分析总览

> 分析对象：① Grok CLI `~/.grok/bin/agent`（1.0.46，Mach-O arm64）；② Grok Bot 桌面端 `/Applications/Grok Bot.app`（0.66.0，Electron 42.1.0）。
> 分析方式：静态逆向（plutil / codesign / asar 解包 / Mach-O strings / 随包文档与配置 schema），未运行、未抓包、未触碰凭据；解包产物仅在 `/tmp`。
> 分析日期：2026-10-06

## TL;DR

**"Grok"在本机是两个独立产品，CU/BU 判定相反**：

- **Grok CLI**（xAI 官方终端 agent）：纯 coding agent，内置 16 件工具（read_file/bash/web_search/web_fetch/task/MCP 桥等），**无任何原生 Computer Use / Browser Use 能力**——判定书见 [browser-use.md §9](browser-use.md)。它与 `.zcode`-系、`.codex`-系同类，目录结构（sessions/plugins/skills/hooks/marketplace）与 Claude Code 高度同构，但能力面止步于终端。
- **Grok Bot 桌面端**：一个完整的"桌面 agent 工作台"（聊天式 bots + 云端 agent + 远程计算机），**具备完整 CU 与云端 BU**。其 CU 栈是本仓库 9 家中**谱系证据最硬**的：由 **Anysphere（Cursor 母公司）代工并签名**（TeamID `DCNK4UB866` 与 Cursor 完全一致；asar 包名 `sand`、homepage `cursor.com`、sidecar CDN `downloads.cursor.com`），即 Cursor 的 computer-use-sidecar 产品线换牌版，且**编排层下沉**——`computer_*` 16 工具 MCP catalog（含 schema、instructions、拒绝/升级分类表）整体嵌入 Swift sidecar 二进制（`--mcp-stdio` 模式）。BU 则彻底云端化：本机零浏览器工具面，靠云端浏览器子代理 + 托管 MCP + box 沙箱 + Chrome cookie 逐 origin 审批导入。
- **本机可用性**：桌面端 CU 门控全关（`local_computer_use`/`mac_computer_use` 默认 false，无 service.json、无安装目录）——载体完整在位但从未激活，与 Cursor 本机状态同构；BU 云侧默认开但本机无法静态验证云端行为。

结论：**CLI = 无 CU/BU；桌面端 = 有 CU（未启用）/ 有 BU（云端）**，置信度高。

## 架构分层图

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Grok CLI（~/.grok）                    Grok Bot 桌面端（com.anysphere.sand）│
│  16 内置工具 · MCP 挂载 · ACP           Electron 主进程 main-app/main-core  │
│  无 CU/BU（负证据判定）                  · Statsig 门控（CU 门默认关）        │
│                                        · 云端 agent 协议（proto 68 工具位）│
│                                        · Chrome cookie 导入 + 审批 UI      │
│                                        · noVNC computer 控制台（手机/桌面） │
├────────────────────────────────────────┬───────────────────────────────────┤
│                                        │ local-exec-daemon（本地 harness）  │
│                                        │  · local-cua 客户端（socket RPC）  │
│                                        │  · box：docker cursor-box-computer │
│                                        │  · 工具来源注册表 cursor-*          │
│                                        ├───────────────────────────────────┤
│                                        │ Grok Bot Computer Use.app（Swift） │
│                                        │  CUGrokBotService 1.0.0（CUCore）  │
│                                        │  · CULocalRPCService（peerPolicy）  │
│                                        │  · CUCompanionToolService（AX+SCK） │
│                                        │  · CURemoteToolService（CGEvent）   │
│                                        │  · CUMcpStdioMode（16 工具 catalog）│
│                                        │  · 租约/Esc 急停/光标覆盖层          │
└────────────────────────────────────────┴───────────────────────────────────┘
   桌面（macOS 任意 App）：companion 按 app 后台驱动 / remote 整屏接管
   云端：远程计算机（ComputerUseArgs 11 动作批量 + desktop_lease_actor_id）
   浏览器：云端子代理 + box + 托管 MCP（本机无执行体）
```

## 能力矩阵

| 能力 | 有/无 | 载体 | 面向模型的工具 | 关键安全机制 |
|---|---|---|---|---|
| 桌面观察（截图/AX 树） | 有（未启用） | CUGrokBotService（ScreenCaptureKit 单窗捕获 + AX 树文本化） | computer_screenshot / computer_app_state（+computer_use_* 面） | 1280×800 固定画布、1MiB JPEG 预算、snapshot_id/coordinate_token 双句柄台账 |
| 桌面动作（AX 语义） | 有（未启用） | 同上（AXPress/AXValue 回读/AXSelected/AXScrollToVisible） | computer_click/type/set_value/app_action… | element_id 单击左键限制、巨型元素拒绝、写后回读校验 |
| 桌面动作（事件注入） | 有（未启用） | CURemoteToolService（CGEvent/AppKit + EventSequencer） | computer_start_control 升级后同面 | 租约互斥、真光标可视化、Esc event tap 急停 |
| 后台定向输入 | 有（未启用） | companion 档（遮挡窗口坐标可命中、不抬升：`skylight-no-raise`） | 默认 app target 即后台 | "Companion does not raise"、目标身份前置校验（stale 即拒发） |
| 人接管/急停 | 有（未启用） | CURemoteEscapeTap + CUCompanionStops | （非工具，系统级） | USER_ABORTED 错误码带行为指令（本回合禁再输入） |
| 失败协议 | 有（未启用） | 二进制内嵌 refusals 表 | 16 错误码 → retry/ask_user/use_different_tool/stop 四档建议 | isError+structuredContent{code,message,escalation} |
| 浏览器（云端） | 有 | 云端 browser_subagent（默认开）+ box docker MCP + 托管 MCP | （服务端定义，本机仅存来源标签 cursor-browser-extension/ide-browser） | cookie 逐 origin 审批（默认 deny）、web bot auth 签名、指纹伪装默认关 |
| 浏览器（本地） | **无** | —（负证据判定，见 browser-use.md §6） | — | — |
| 网络观察 | 有 | fetch/web_search/web_fetch/x_search（proto 工具位）；CLI 内置 web_search/web_fetch | 同左 | CLI 侧 web_fetch 域名白名单+审批 |
| 远程计算机控制台 | 有 | noVNC（preload-vnc 注入 + vncProxy 令牌） | （人的介入面，非模型工具） | networkToken、黑帧探针、剪贴板回环抑制 |
| iMessage/Contacts | 有（相邻能力） | 同一 sidecar 承载 messages 工具族 | snapshot-messages-db/send-message/find-contacts… | AppleEvents 授权 + 独立开关 |

## 关键文件索引

- 判定与全部证据：[evidence/inventory.md](evidence/inventory.md)
- 桌面控制逆向：[computer-use.md](computer-use.md)
- 浏览器控制逆向（含 CLI 判定书）：[browser-use.md](browser-use.md)
- 可复用接口形状：[../../source/grok/README.md](../../source/grok/README.md)（schemas + reference 客户端骨架）

## 阅读路线

只想回答"能不能控我的电脑/浏览器"→ TL;DR 与能力矩阵；要做同类设计 → computer-use.md §3（双工具面）、§6（安全模型）、§7（失败协议）；做谱系研究 → computer-use.md §9（与 Cursor 的逐项证据对照）。

## 方法与局限

全部结论来自静态证据（Info.plist、codesign、asar 内 JS 的模块边界与字符串、Mach-O strings 与 Swift 符号、随包 README/CHANGELOG/config schema）。未运行被分析对象，未抓包；"云端端点/行为"仅为静态可见字符串与 proto 反射表推断。标"推断"处均在正文注明（置信度中：sidecar 与 Cua AI 的渊源；本机不可验证的云端子代理内部面）。
