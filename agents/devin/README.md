# Devin（Cognition）原生 Computer Use 与 Browser Use 逆向分析

> 逆向对象：Cognition Devin 全家桶。本机留存：Devin CLI（内部代号 **chisel**，Rust，`3000.6.19`/`e2b252e2`）的配置、日志、SQLite、缓存（2026-09-11/16/18 三天真实运行痕迹）；Devin Desktop（= **Windsurf 更名**，VS Code fork，已卸载，残留悬挂 symlink 与 `~/.devin` 目录）。方法：只读静态取证（含缓存 base64 解码、SQLite schema 解析）+ 官方文档静态抓取（docs.devin.ai，2026-10-06）+ 本机第三方开源协议参考实现（oh-my-pi）交叉验证。不做抓包、不触碰凭据值。全部证据见 [evidence/inventory.md](evidence/inventory.md)。

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | 桌面控制完整逆向：云端 `computer` 工具（截图-动作循环、1024×768、三平台）、组织级开关、人机同屏接管、CLI 本地零 CU 的三重负证据 |
| [browser-use.md](browser-use.md) | 浏览器控制完整逆向：云会话 Interactive Browser、`save_browser_profile`/blueprint 登录态、CDP :29229、ACP `browser_preview` 能力位实测、Cascade Previews 的 `exa.browser_preview_pb` 通道 |
| [evidence/inventory.md](evidence/inventory.md) | 证据清单：产品判定、本机数据面、CU/BU 证据表、端点、安全模型、谱系、强度分级 |

## TL;DR（30 秒版）

- **本分册核心判定：Devin 的 CU/BU 是"全云端执行、本地只做投影"的形态**——与 Cursor/Synara 的本地 sidecar 路线、codex/claude-code 的"本地 CLI+原生 helper"路线都不同。本地 CLI 工具面只有 `read/edit/grep/glob/exec`（+MCP），没有任何 GUI 控制工具。
- 三产品分工：**Devin Cloud**（`app.devin.ai`/`api.devin.ai`）拥有 `computer` 工具与 Interactive Browser；**Devin CLI** 是本地终端 coding agent（OS 沙箱 + 权限规则 + 云代理 + ACP server）；**Devin Desktop** 是 Windsurf 更名后的 IDE（Cascade 本地 agent + Previews + 云委派 + ACP 宿主）。
- CLI 的 BU 投影：ACP 扩展能力位 `browser_preview`/`browser_preview_open`（本机三份日志实测为 true，Cognition 私有扩展）+ `devin mcp add` 外挂 + `--cloud`/`ssh`/`forward` 代理。
- 凭据与登录态是其安全模型重心：本地 `credentials.toml`（本机未落盘）→ ACP 模式改由宿主 `authenticate` 注入；云端浏览器登录态走 org blueprint（跳过 Chrome 密码库，≤200MB）。
- 模型面：CLI 模型网关复用 **`server.codeium.com`**（exa.* Connect-RPC 协议族，`GetChatMessage`/`GetUserJwt`/`GetCliModelConfigs`），模型目录含 Devin 自家 `swe-2`/`swe-1.6`/`adaptive` 与 `glm-5-3`、`kimi-k3` 等第三方模型。

## 架构分层图

```
                    ┌───────────────────────────────────────────┐
                    │ Devin Cloud                                │
                    │  app.devin.ai（webapp/OAuth/会话 UI）        │
                    │  api.devin.ai（v1/v2/v3 sessions API）      │
                    │  组织级开关：Computer use toggle             │
                    └──────────────┬────────────────────────────┘
                                   │ REST + 会话 UI
┌──────────────────────────────────▼───────────────────────────────────┐
│ 云会话 VM / Outposts（Linux 默认 | Windows | macOS）                    │
│  ┌────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │ computer 工具（desktop 模式）│  │ Chromium（Interactive Browser）  │ │
│  │  截图1024×768→动作→再截图    │  │  CDP :29229（Playwright 可附着） │ │
│  │  macOS VM 需 TCC 双权限      │  │  save_browser_profile→blueprint │ │
│  └────────────────────────────┘  └─────────────────────────────────┘ │
│  Shell / Devin IDE（VSCode env）/ Progress / Side Chats               │
└──────────────┬───────────────────────────────────────┬──────────────┘
               │ ② ssh/forward 直连                     │ ① 会话 UI 观看/接管
┌──────────────▼───────────────────────────────────────▼──────────────┐
│ 本地（macOS 宿主）                                                     │
│                                                                      │
│  Devin CLI "chisel"（Rust，binary 名 devin）                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ 本地工具面: read/edit/grep/glob/exec + MCP（无 CU/BU 工具）        │ │
│  │ 权限: Read/Write/Exec/Fetch 规则 ×5 mode（normal→autonomous）     │ │
│  │ 沙箱: --sandbox（bwrap/Seatbelt）+ loopback 网络代理              │ │
│  │ 技能: 8 家 provider 目录布局（devin/agents_standard/cursor/       │ │
│  │       windsurf/claude/opencode/zed/copilot）+ plugins/hooks      │ │
│  │ 存储: sessions.db（ACP 会话森林+tool_call_state）                 │ │
│  │ 模型: server.codeium.com GetChatMessage（exa.* Connect-RPC）      │ │
│  │ 云: api.devin.ai（--cloud、drs、blueprint、secret）               │ │
│  └────────────────────────────────────────────────────────────────┘ │
│        ▲ ACP stdio（authenticate 注入 windsurf-api-key 凭据）          │
│  Devin Desktop（=Windsurf fork，本机已卸载）                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Cascade（本地文件/终端 agent）+ Previews（元素选择/错误捕获        │ │
│  │   → exa.browser_preview_pb: DOM/截图/console 回灌）+ Agent        │ │
│  │ Command Center（本地+云 agent 看板）+ 第三方 ACP agent 宿主        │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

## 能力矩阵

| 维度 | 云端 Computer Use | 云端 Browser Use | 本地 CLI 投影 | Devin Desktop 投影 |
|---|---|---|---|---|
| 载体 | 会话 VM 内 `computer` 工具 | 会话 VM 内 Chromium（Interactive Browser） | 无 GUI 工具（read/edit/grep/glob/exec） | Cascade + Previews |
| 观察机制 | 截图 1024×768 循环 | 会话 UI 实时画面 + Progress 日志 | 无 | 预览页 DOM 元素/截图/console 回灌（gRPC） |
| 动作机制 | click/type/scroll/快捷键/drag | Devin 自主驱动 + Playwright over CDP :29229 | 无（终端 exec 有沙箱） | 无驱动能力，仅"在浏览器打开"（`browser_preview_open`） |
| 人接管 | Browser/Computer 标签同屏接管（SSO/MFA/CAPTCHA） | 同左，标签即入口 | `ssh`/`forward` 直连云机器 | IDE 内查看 |
| 凭据/状态 | 组织开关统一启用 | `save_browser_profile` → org blueprint（密码库排除、≤200MB） | credentials.toml / ACP authenticate 注入 | 宿主持有 API key |
| 审批 | 组织级开关（admin），无逐动作审批 | blueprint 变更需批准步骤 | 5 级权限规则 ×5 模式，deny 恒胜 | Terminal allow/deny 列表 |
| 本机状态 | 无本地痕迹（全云） | 无本地痕迹（`mcp/oauth/` 空目录） | 日志×3 天、sessions.db 空库、缓存×5 | 悬挂 symlink、`~/.devin` |

## 传输与端点（静态记录）

| 端点 | 用途 |
|---|---|
| `https://api.devin.ai` | CLI 云 API（deployment 缓存实锤）；OAuth token 交换 `POST /auth/cli/token` |
| `https://app.devin.ai` | OAuth 授权 `GET /auth/cli/continue`（PKCE S256）；云会话 URL |
| `127.0.0.1:59653/callback` | CLI 登录本地回调（PKCE） |
| `https://server.codeium.com` | 模型网关：`/exa.auth_pb.AuthService/GetUserJwt`、`/exa.api_server_pb.ApiServerService/GetChatMessage`（流式）、`…/GetCliModelConfigs`；Connect 帧（0x01 gzip/0x02 trailers）；`Metadata.apiKey = devin-session-token$…` |
| `https://cli.devin.ai/install.sh`、`brew install --cask devin-cli`、`https://static.devin.ai/cli/` | CLI 分发 |
| 云会话内 `http://localhost:29229` | 浏览器 CDP |
| `~/.local/share/devin/` | credentials.toml（文档口径，本机无）、sessions.db、logs、plugins、mcp/oauth |

## 谱系关系

- **Codeium → Windsurf → Cognition**：exa.* proto 家族（35 包）与 `server.codeium.com` 网关是 Codeium 时代遗产；2025-07 Cognition 收购 Windsurf，2026 年 Windsurf 更名 Devin Desktop（本机 `~/.devin`、`devin-desktop` symlink、ACP `client="windsurf"`、`windsurf_api_client` 模块名均为更名过渡实锤）。Devin CLI 复用 Windsurf 的 API client 与 ACP authenticate 方法（`windsurf-api-key`）。
- **与云 Devin 的关系**：CLI 是"本地 harness + 云集成"（handoff/cloud/follower-mode flags 一整套）；模型目录中 Devin 自家模型（`swe-2-high`、`swe-1-6-slow`、`adaptive`）与 Cascade 同源。
- 交叉印证：Synara 分册 A6 的 provider 文档列表含 `devin`；本机 oh-my-pi 项目独立实现了同一协议形状（OAuth 流、模型发现、GetChatMessage 流式解析），与本分册证据互洽。

## 快速复核入口

```bash
ls ~/.config/devin/ ~/.local/share/devin/cli/ ~/.cache/devin/cli/   # 三大目录
gunzip -c ~/.local/share/devin/cli/logs/devin_20260911-125208_13731.log.gz | grep -m1 'version='
gunzip -c ~/.local/share/devin/cli/logs/devin_20260911-125208_13731.log.gz | grep -m1 browser_preview
sqlite3 ~/.local/share/devin/cli/sessions.db '.schema'               # ACP 会话森林
ls -la ~/.codeium/windsurf/bin/devin-desktop                        # 悬挂 symlink（已卸载）
grep -n 'Added by Devin' ~/.zshrc                                   # PATH 注入痕迹
open https://docs.devin.ai/llms.txt                                  # 官方文档地图
```
