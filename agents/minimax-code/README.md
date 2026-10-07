# MiniMax Code（MiniMax）· Anthropic 协议兼容端，CU/BU 全本地

> 一句话结论：**桌面控制用开源 trycua CUA 驱动、浏览器控制用自研 WebContentsView+CDP；两者都由"官方插件 + Host Binding"门控——未启用时工具对模型完全不存在（fail-closed）。**

| 项 | 值 |
|---|---|
| 载体 | `/Applications/MiniMax Code.app`（com.minimax.agent.cn，3.1.0 / build 3.1.0.177，Electron 42.8.0） |
| 形态 | Electron 内嵌 runtime（127.0.0.1:3100）+ utility process `mavis-cua` + 右侧嵌入式浏览器面板 |
| CU 工具面 | 17 个 `computer_*` · AX token + 截图坐标双路由 |
| BU 工具面 | 1 个 `browser` 工具 × 24 action（compact）· CDP 合成事件 |
| 安全模型 | 插件准入 · 单会话 lease · 桌面遮罩+停止按钮 |
| 本机可用 | ✅ 已安装；官方插件缓存与载体在位（2026-10-06 基线） |

## 架构一图

```
模型（Anthropic Messages 协议，pi-ai 0.79.1 anthropic provider）
 └─ agent 内核 @mavis/agent-core（PiTurnRunner）+ pi-agent-core
     └─ 工具目录：官方插件准入后才注入 computer_* / browser
         ├─ CU → utility process mavis-cua ── MessagePort（version:1 JSON + generation）
         │        └─ @trycua/cua-driver 0.22.1（Rust/UniFFI，MIT）→ AX/HID/截图 + TCC 双权限
         └─ BU → modules/browser ── CDP（Chrome DevTools 协议）
                  └─ WebContentsView 嵌入式浏览器 + @mavis/browser-core
```

LLM 网关 `https://agent.minimax.{cn,io}/mavis/api/v1/llm/v1`（Anthropic Messages 格式）；云端 Matrix 只承担云 Agent/多模态工具/技能 Hub，CU/BU 的观察与动作全部本地。

## 能力矩阵

| 能力 | Computer Use | Browser Use（native `browser`） | chrome-devtools-mcp（官方插件） |
|---|---|---|---|
| 载体 | cua-driver 0.22.1 + mavis-cua utility | WebContentsView + @mavis/browser-core（CDP） | npx chrome-devtools-mcp@1.8.0（Puppeteer） |
| 作用域 | 本机整个桌面 | 会话级内嵌 tab；headless 为第二 provider（本机未见启动代码，推断属 TUI/云端） | 用户本机真实 Chrome |
| 观察 | AX 树 + element_token、窗口/桌面截图 | 可交互元素快照（不透明 ref + 分页）、console/network 诊断 | take_snapshot(a11y)、截图、性能 trace |
| 动作 | 17 工具；background（AX）与 foreground（HID）双交付 | 24 action：CDP 合成输入、填表、上传、等待 | Puppeteer 全套 + evaluate_script |
| 任意 JS | 无 | **明确不提供**（skill 与工具描述写死） | 提供 evaluate_script |
| 启用门槛 | 插件 + macOS 辅助功能/屏幕录制 TCC 双授权 | 插件 + 必读 `control-in-app-browser` skill | 插件安装，stdio MCP |
| 安全门 | 单会话 lease、foreground 公告义务、verify_state、遮罩+停止 | SKILL_REQUIRED 门、`safety.requiredNextTool=ask_user` 硬门、上传白名单 | 标准 MCP 权限 |

## 内核：Claude Code 工具协议兼容端（自研运行时，非 fork）

| 层 | 事实 |
|---|---|
| 协议 | `MINIMAX_API_FORMAT='anthropic-messages'`；tool_use/tool_result 闭环，截图以 `type:'image'` 块回传 |
| 工具 | read/write/edit/bash/task/skill… 与 Claude Code 工具族同构（typebox schema 自研定义） |
| 扩展 | MCP 完整支持 + `tool_search` 延迟披露；官方插件在 Claude Code 插件体系上新增 **Host Binding**（绑定宿主原生能力 computer.use / browser.use） |
| 技能 | `.builtin-skills` 目录与社区 Claude 技能同源；未发现 Claude Code 官方 CLI 代码复用（内核为 pi 框架 + 自研 @mavis） |

## 防混淆与导航

小米 MiMo（`~/.config/mimocode/`、MiMo Computer Use）与本册无关；`MiniMax Design.app` 是独立设计工具，不在范围。

- [computer-use.md](./computer-use.md) — 17 工具、双路由交付、lease、TCC、UI 示能
- [browser-use.md](./browser-use.md) — 24 action、快照+不透明 ref、安全合同、chrome-devtools-mcp
- [evidence/inventory.md](./evidence/inventory.md) — 证据底账 ｜ [schemas](../../source/minimax-code/schemas/) — 工具/binding JSON

> 置信度：工具面、进程模型、插件门、CDP 用法为高（直读代码）；headless provider 启动路径、Design.app 用途、手机遥控协议细节为低/推断。
