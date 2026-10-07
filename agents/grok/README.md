# Grok（xAI）· 一台机器两个产品：CLI 零 CU/BU，桌面端是 Cursor 代工换牌

> 一句话结论：**Grok CLI（1.0.46）是纯 coding agent，无任何原生 CU/BU；Grok Bot 桌面端（0.66.0）由 Anysphere（Cursor 母公司）代工换牌——CU 谱系证据为全仓库最硬，BU 彻底云端化。**

| 项 | 值 |
|---|---|
| 载体 | Grok CLI `~/.grok/bin/agent` 1.0.46 ＋ Grok Bot 桌面端 0.66.0（Electron 42.1.0） |
| 形态 | CLI＝终端 agent；桌面端＝Swift CU Helper（CUGrokBotService 1.0.0）+ 云端 agent + noVNC 控制台 |
| CU 工具面 | 16 个 `computer_*` · 编排下沉（catalog 内嵌二进制，`--mcp-stdio` 直挂 MCP） |
| BU 工具面 | 本地 0 工具 · 云端四件套（子代理 + 托管 MCP + box 沙箱 + cookie 导入） |
| 安全模型 | companion/remote 两档 · 租约互斥 · Esc 三路急停 · 错误即指令（16 码四档） |
| 本机可用 | ⚙️ 桌面端 CU 门控全关从未激活；CLI＝能力不存在；BU 云侧默认开（2026-10 基线） |

## 架构一图

```
Grok CLI（~/.grok）                 Grok Bot 桌面端（com.anysphere.sand）
 16 内置工具 · MCP 挂载 · ACP         Electron：Statsig 门控（CU 门默认关）
 无 CU/BU（负证据判定）               + 云 agent 协议（proto 68 工具位）
                                     + cookie 审批 UI + noVNC 控制台
                    │ local-exec-daemon（local-cua 客户端 + box 沙箱）
                    │ Unix socket 行分隔 JSON-RPC（codesign 团队白名单）
                    ▼
 Grok Bot Computer Use.app（Swift，TeamID DCNK4UB866）
  companion：AX 语义 + SCK 单窗截屏（不动真光标、不抬窗）
  remote：CGEvent 整屏接管（租约 + Esc 急停 + 辉光覆盖层）
  CUMcpStdioMode：16 工具 catalog 内嵌 + refusals 分类表
                    ▼
 桌面（companion 后台驱动 / remote 整屏）· 云端远程计算机（proto 11 动作 + 租约）
 浏览器：云端子代理 + box（本机零执行体）
```

## 代工换牌五路取证（本册最大价值）

**五条独立静态证据链互证，无需运行即可复核。**

| # | 取证路径 | 证据 |
|---|---|---|
| ① | 签名 | 主应用 `com.anysphere.sand`、助手 `co.anysphere.grok-bot-computer-use`，TeamID `DCNK4UB866`（Anysphere）与 Cursor 完全一致 |
| ② | 包元数据 | asar package.json：`name:"sand"`、`homepage:"https://cursor.com"`、依赖 `cursor-proclist` |
| ③ | 代码残留 | JS 客户端静态默认值 `cursor-computer-use` / `Cursor Computer Use` / `CUCursorService`（运行时被产品表覆盖） |
| ④ | 分发通道 | sidecar CDN 仍为 `downloads.cursor.com/computer-use-sidecar`（manifest URL 正则可复核） |
| ⑤ | 协议同构 | `sand_*` flag 家族与 `sand-cua` 模型名两家同名同值；`computer_use_*` RPC 面逐名对齐 |

> 判定：不是"借鉴"，是同一条产品线的换牌。代际差异 = 编排下沉进 Swift 二进制（详见 [computer-use.md §2](computer-use.md)）。

## 能力矩阵

| 能力 | 判定 | 载体与要点 |
|---|---|---|
| 桌面观察 | 有（未启用） | SCK 单窗捕获（1280×800 画布、1 MiB JPEG 预算）+ AX 树文本化；snapshot_id / coordinate_token 双句柄 |
| 桌面动作 | 有（未启用） | AX 语义（写后回读校验）+ CGEvent 事件注入；遮挡窗口坐标可命中、不抬升（`skylight-no-raise`） |
| 人接管/急停 | 有（未启用） | `computer_start_control` 显式升级阀；Esc event tap + 用户 Stop + `USER_ABORTED` 三路急停 |
| 失败协议 | 有（未启用） | 16 错误码 → retry / ask_user / use_different_tool / stop 四档建议（9 家分册中最完整） |
| 浏览器（云端） | 有 | browser_subagent（默认开）+ box + 托管 MCP + cookie 逐 origin 审批导入（默认 deny） |
| 浏览器（本地） | **无** | 负证据判定，见 [browser-use.md §6](browser-use.md) |
| 远程计算机控制台 | 有 | noVNC（手机/桌面）：观看 + 键鼠介入 + 剪贴板双向同步 |
| 相邻能力 | 有 | 同一 sidecar 承载 iMessage/Contacts 工具族（AppleEvents 授权 + 独立开关） |

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | 桌面控制：16 工具 catalog、双控制档、观察/动作机制、安全模型、错误码表 |
| [browser-use.md](browser-use.md) | 浏览器控制：云端四件套、负证据判定书、CLI 判定书 |
| [evidence/inventory.md](evidence/inventory.md) | 全部证据：载体清单、strings 行号、flags、proto、谱系 |
| [../../source/grok/README.md](../../source/grok/README.md) | 可复用接口形状（schemas + reference 客户端骨架） |

## 方法与局限

**全部结论来自静态证据**（Info.plist / codesign / asar 内 JS / Mach-O strings / 随包文档与 schema）；未运行、未抓包、未触碰凭据。标"推断"处均在正文注明（sidecar 与 Cua AI 渊源；不可验证的云端子代理内部面）。

> 阅读路线：只问"能不能控我的电脑/浏览器"→ 上表；做同类设计 → computer-use.md §3/§6/§7；做谱系研究 → 上文取证表。
