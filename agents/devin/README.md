# Devin（Cognition）· 全云端执行、本地只做投影

> 一句话结论：**`computer` 工具与 Interactive Browser 都跑在云会话 VM 里；本地 CLI（chisel）工具面只有 read/edit/grep/glob/exec，对 CU/BU 的全部参与是"代理、预览、接管"三种投影。**

| 项 | 值 |
|---|---|
| 载体 | Devin CLI "chisel" 3000.6.19（Rust，binary 名 devin）＋ Devin Desktop（= Windsurf 更名，VS Code fork）＋ Devin Cloud——前两者本机已卸载 |
| 形态 | 全云端执行 + 本地投影；CLI 兼 ACP server（stdio） |
| CU 工具面 | 云端 `computer` 1 工具 · 截图-动作循环（1024×768 固定屏） |
| BU 工具面 | 云端 Interactive Browser · CDP :29229；本地 `browser_preview` 能力位（实测 true） |
| 安全模型 | 组织级开关（admin）· 会话同屏接管 · blueprint 登录态 ≤200MB |
| 本机可用 | ❌ 二进制已卸载；留存 2026-09 三天真实运行痕迹（日志/SQLite/缓存） |

## 架构一图

```
Devin Cloud（app.devin.ai 控制面 / api.devin.ai v1-v3 会话 API）
 │ 组织级开关：Computer use toggle（admin only，全计划可用）
 ▼
云会话 VM / Outposts（Linux 默认 | Windows | macOS）
 ├─ computer 工具：截图 1024×768 → 定位 → 动作 → 再截图（macOS VM 需 TCC 双权限）
 └─ Chromium Interactive Browser：CDP :29229（Playwright connect_over_cdp 可附着）
     save_browser_profile → org blueprint（登录态跨会话恢复）
 │ ①会话 UI 同屏接管（Browser/Computer 标签） ②devin ssh/forward 直连 ③--cloud 委派
 ▼
本地（macOS 宿主）
 ├─ Devin CLI：read/edit/grep/glob/exec + MCP（无任何 CU/BU 工具）
 │   沙箱 bwrap/Seatbelt + 权限规则 ×5 模式 + 模型网关 server.codeium.com
 └─ Devin Desktop（=Windsurf fork）：Cascade 本地编码 + Previews 回灌 + ACP 宿主
```

## 三产品分工

| 产品 | 角色 | CU/BU 位置 |
|---|---|---|
| Devin Cloud | 会话编排（webapp/OAuth/sessions API） | `computer` 工具 + Interactive Browser 都在这 |
| Devin CLI | 本地终端 coding agent + ACP server | 零 GUI 工具；投影 = `--cloud` / `ssh` / `forward` / MCP 外挂 |
| Devin Desktop | Windsurf 更名的 IDE | Cascade 跑终端/文件编辑；Previews 是预览回灌，非桌面控制 |

## 本地投影能力位（本机实测）

| 投影 | 形态 | 本机证据 |
|---|---|---|
| ACP `browser_preview` / `browser_preview_open` | 宿主提供"网页预览"与"在浏览器打开"（Cognition 私有扩展，方法名未公开） | 三份日志（09-11/16/18）initialize 能力位均 true |
| `cognition.ai/*` 扩展方法族 | ACP 私有命名空间 | 实测 7 个（document/didOpen、skills/list、revert/listSteps 等） |
| `devin mcp add` | 外挂任意浏览器/桌面 MCP（stdio\|http + OAuth） | 实连 3 个用户自配 streamable HTTP server |
| `--cloud` / `ssh` / `forward` | 任务转云会话、直连云机器 | flags 全套门控（follower-mode 等） |
| Desktop Previews | 元素选择/错误捕获经 `exa.browser_preview_pb` gRPC 回灌 | proto 可证；二进制已卸载 |

> **Windsurf 更名实锤**：Cognition 2025-07 收购 Windsurf 后合并品牌——`~/.devin` 为 VS Code fork 用户目录、`devin-desktop` CLI 装进 Windsurf bin、ACP 自报 `client="windsurf"`、authenticate 方法 `windsurf-api-key`、CLI 复用 `windsurf_api_client` 模块与 `server.codeium.com` 网关（exa.* proto 35 包为 Codeium 遗产）。

## 传输与端点（静态记录）

| 端点 | 用途 |
|---|---|
| `https://api.devin.ai` | CLI 云 API（deployment 缓存实锤）；OAuth token 交换 |
| `https://app.devin.ai` | OAuth 授权（PKCE S256）+ 云会话 URL |
| `https://server.codeium.com` | 模型网关：exa.* Connect-RPC（GetChatMessage 流式等，`Metadata.apiKey = devin-session-token$…`） |
| 云会话内 `http://localhost:29229` | 浏览器 CDP |
| `~/.local/share/devin/` | credentials.toml（文档口径，本机无）、sessions.db、logs、mcp/oauth（空） |

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | 云端 `computer` 工具、三重负证据、本地投影、安全模型 |
| [browser-use.md](browser-use.md) | Interactive Browser、blueprint 登录态、CDP :29229、Previews 通道 |
| [evidence/inventory.md](evidence/inventory.md) | A-H 全证据表（产品判定/数据面/CU/BU/端点/安全/谱系/强度） |

## 快速复核入口

```bash
ls ~/.config/devin/ ~/.local/share/devin/cli/ ~/.cache/devin/cli/   # 三大目录
gunzip -c ~/.local/share/devin/cli/logs/devin_20260911-125208_13731.log.gz | grep -m1 browser_preview
sqlite3 ~/.local/share/devin/cli/sessions.db '.schema'               # ACP 会话森林
ls -la ~/.codeium/windsurf/bin/devin-desktop                        # 悬挂 symlink（已卸载）
open https://docs.devin.ai/llms.txt                                  # 官方文档地图
```
