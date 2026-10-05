# MiniMax Code 桌面端 Computer Use / Browser Use 逆向分析

> 分析对象：`/Applications/MiniMax Code.app`（`com.minimax.agent.cn`，版本 3.1.0 / build 3.1.0.177，Electron 42.8.0）
> 分析日期：2026-10-06。方法：只读静态分析（asar 解包到 /tmp、配置与状态文件读取），未运行被分析对象、未抓包、未触碰凭据。
> 文档为原创撰写；对专有源码仅做不超过 10 行/处的引用并标注文件路径。

## TL;DR

1. **MiniMax Code 的 Computer Use 与 Browser Use 都是纯本地实现**，不存在"云端沙箱 + 本地视频流"架构。CU 由内嵌的 **`@trycua/cua-driver` 0.22.1**（trycua CUA 开源驱动的 Rust/UniFFI SDK，MIT）驱动，在 Electron **utility process**（`mavis-cua`）中运行；BU 由自研 **`@mavis/browser-core`** 基于 **Electron `WebContentsView` + CDP（Chrome DevTools 协议）** 实现，浏览器直接显示在应用右侧 FilePanel。
2. 两者的启用都走 **"官方插件 + Host Binding"** 机制：官方插件 `computer-use`（电脑操控）与 `browser-use` 各带一份 `*.binding.json`，声明 `hostCapability: computer.use / browser.use`；插件被用户安装并准入后，运行时才把原生工具（`computer_*` / `browser`）注入模型工具列表。未启用时工具完全不存在（fail-closed）。
3. **CU 工具面共 17 个 `computer_*` 工具**（观察 4 + 交互 4 + 编辑 3 + 窗口/应用管理 5 + 验证 1），核心语义是 **AX/UIA 语义元素 token 定位（background 交付）+ 截图坐标（foreground 交付）双路由**，并有单会话租约（lease）、桌面遮罩、指针动画、停止按钮等安全示能（affordance）。
4. **BU 工具面为一个统一的 `browser` 工具（24 个 action）**，加一组 `browser_inspect` / `browser_click` 等细粒度工具定义（桌面端默认暴露 compact 形态）。观察靠"可交互元素快照 + 不透明 ref + 快照分页"，动作用 CDP 合成事件，附带**结构化效果验证**（effect.verified）与**动作后自动视觉观察**（visualObservation）。
5. 底层 Agent 内核是 **Anthropic 协议生态**：模型访问格式常量 `MINIMAX_API_FORMAT = 'anthropic-messages'`（`@mavis/local-runtime/src/model-provider/minimax-api.ts`），LLM 网关为 `https://agent.minimax.{cn,io}/mavis/api/v1/llm/v1`；Agent 循环基于 `@earendil-works/pi-agent-core` / `pi-ai` 0.79.1（开源 pi 框架，anthropic provider 原生 `tool_use`/`tool_result`），工具契约（`ToolDefinition`/typebox schema）与 Claude Code 工具形态高度同构，MCP 完整支持。**可以认为 MiniMax Code 是 Claude Code 工具协议兼容端**（自研运行时，非 fork 官方 CLI）。

## 1. 信息源与判据

| 信息源 | 路径 | 用途 |
| --- | --- | --- |
| 应用包 | `/Applications/MiniMax Code.app/Contents/Resources/app.asar`（406 MB，解包至 /tmp/mm-asar） | 全部代码证据 |
| 应用数据 | `~/Library/Application Support/MiniMax/` | embedded-browser-tabs.json、browser-cache/element-maps、remote-control/state.json、minimax-agent-cn-config.json |
| 运行时状态目录 | `~/.minimax/` | config.yaml、mcp-runtime-names.json、.builtin-skills、agents/.builtin、v2/plugin-cache（官方插件缓存） |
| 官方插件缓存 | `~/.minimax/v2/plugin-cache/official/sha256-tree-v1-*` | computer-use / browser-use / chrome-devtools-mcp 插件清单与 binding |

> **命名防混淆**：本机另有 `~/.config/mimocode/`、`Xiaomi MiMo AI.app`、`MiMo Computer Use`（Application Support），这些属于**小米 MiMo**产品线，与 MiniMax 无关，分析中已排除。`/Applications/MiniMax Design.app`（`com.minimax.hub`，3.0.21）是 MiniMax 独立的设计类工具（含截图/托盘资源），未见与 coding agent 的 CU/BU 共用组件，判定不在本文范围内（推断）。

## 2. 架构分层图

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MiniMax Code.app (Electron 42.8.0, @mmx-agent/electron 3.1.0)           │
│                                                                         │
│  Renderer (React, public/  Next 静态资源)                                │
│      ▲ IPC: cu:permission:required / cuPermission.ipc / FilePanel       │
│      │                                                                  │
│  Main Process                                                           │
│  ├─ modules/browser/          ← Browser Use 宿主侧                      │
│  │   ├─ controller.js          WebContentsView 嵌入式浏览器(右侧面板)     │
│  │   ├─ electron-cdp-transport.js / cdp-helper.js   CDP 传输/指令        │
│  │   ├─ embedded-browser-manager.js  会话级 tab 注册表(持久化到磁盘)      │
│  │   └─ agent-cursor / overlay / background-render-host                 │
│  ├─ modules/local-runtime/computer-use/   ← Computer Use 宿主侧          │
│  │   ├─ index.js               CUA utility 生命周期/MessagePort 门面      │
│  │   ├─ cua-utility-server.js  kind→CUA 驱动工具映射、lease、审核日志     │
│  │   └─ cua-overlay / cua-pointer / cua-preview / cua-window-handoff    │
│  └─ modules/local-runtime/utility/  (共享 utility process)               │
│      └─ browser-broker.js / computer-use-broker.js                      │
└──────────────┬───────────────────────────────┬──────────────────────────┘
               │ MessagePort (version:1 JSON)   │ 函数调用(CDP)
┌──────────────▼──────────────┐   ┌────────────▼─────────────────────────┐
│ CUA utility (mavis-cua)     │   │ Electron Renderer (WebContentsView)  │
│ @trycua/cua-driver 0.22.1   │   │  Chromium 页面: CDP Target 域          │
│ Rust/UniFFI 原生库           │   │  Input/DOM/Accessibility/Runtime/     │
│ darwin-arm64/x64 .node      │   │  Network/Page                         │
│ AX(UIA)/HID/截图             │   └──────────────────────────────────────┘
│ macOS TCC: 辅助功能+屏幕录制  │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────────────────────────────────────────────────┐
│ local-runtime (127.0.0.1, 默认 3100, /minimax-desktop/api/v1/...)        │
│  @mavis/local-runtime-v2:                                                │
│   service/computer-use/  service/browser-use/   ← 工具目录/能力门/安全钩子 │
│  @mavis/agent-core (PiTurnRunner, RuntimeTool)                           │
│  @earendil-works/pi-agent-core + pi-ai (Anthropic Messages 协议)          │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ HTTPS (anthropic-messages)
               ▼
   https://agent.minimax.cn/mavis/api/v1/llm/v1   (cn 区托管网关)
   https://api.minimaxi.com/v1/messages            (MiniMax 开放平台直连, 备选)
   Matrix 云端: agent.minimax.{cn,io}  (云 Agent/多模态工具/技能 Hub/权限云分类)
```

## 3. 能力矩阵

| 能力 | Computer Use | Browser Use（native `browser` 工具） | chrome-devtools-mcp（官方插件） |
| --- | --- | --- | --- |
| 载体 | `@trycua/cua-driver` 0.22.1（Rust/UniFFI）+ `mavis-cua` utility process | `WebContentsView` + `@mavis/browser-core`（CDP） | `npx chrome-devtools-mcp@1.8.0`（Puppeteer） |
| 作用域 | 本机整个桌面（macOS/Windows 双平台代码在库，本机为 macOS） | 会话级内嵌浏览器 tab；`native-headless-chrome` 为第二 provider（见 browser-use.md） | 用户本机真实 Chrome |
| 观察 | AX 树 + element_token、窗口/桌面截图、display 列表 | 可交互元素快照（不透明 ref + 分页）、text/dom/editable/semantic 查询、console/network 诊断、截图 | take_snapshot(a11y)、take_screenshot、网络/控制台 |
| 动作 | click/type/key/scroll/drag/set_value/select_text/menu/verify 等 17 工具；background（AX/UIA 注入）与 foreground（HID + 抢焦点）双交付 | 24 个 action：CDP 合成输入、填表、上传、等待、导航 | Puppeteer 全套（click/fill/hover/evaluate_script/性能 trace） |
| 任意 JS | 无 | **明确不提供**（skill 与工具描述均写死） | 提供 evaluate_script |
| 启用门槛 | 官方插件 `computer-use` + macOS 辅助功能/屏幕录制 TCC 双授权 | 官方插件 `browser-use`；首次使用必须加载 `control-in-app-browser` skill | 插件安装；MCP stdio 启动 |
| 安全门 | 单会话 lease、foreground 公告义务、背景优先、verify_state、桌面遮罩+停止按钮 | 必读 skill 门（`SKILL_REQUIRED`）、`safety.requiredNextTool=ask_user` 硬门、上传路径白名单、最终动作确认合同、无凭据接触 | 标准 MCP 权限 |
| 云端依赖 | 无（纯本地） | 无（纯本地；headless provider 用于无 GUI 场景） | 本机 Chrome |

## 4. 与 Claude Code 生态的关系

- **协议层**：MiniMax API 与托管网关均使用 Anthropic Messages 格式（`anthropic-messages`，`tool_use`/`tool_result` 内容块），由 pi-ai 的 anthropic provider 直连。配置文件 `~/.minimax/config.yaml` 的 provider 段同时兼容 opencode 风格的 `npm: '@ai-sdk/anthropic'` 声明（`@mavis/local-runtime/src/legacy-opencode/` 存在完整的 opencode 迁移代码，说明其本地运行时曾兼容/吸收 opencode 生态）。
- **工具层**：内置工具名（read/write/edit/bash/grep/glob/todowrite/task/skill/ask_user/web_fetch…，见 `@mavis/agent-tools/src/desktop/builtin-defs.ts`）与 Claude Code 工具族同构但为自研定义（typebox schema、`executionMode`、`prepareArguments` 等，见 `@mavis/agent-core/src/tools/types.ts`）。CU/BU 均遵循 Anthropic 风格的 tool-use 闭环（截图/状态进 content、image 以 `type:'image'` 块回传，见 CU client 的 `computerUseToolResult`）。
- **扩展层**：完整支持 MCP（stdio 等），且有 `tool_search` 延迟披露机制（`@mavis/agent-tools/src/mcp-disclosure/`）——大量 MCP 工具不进初始工具列表，由模型按需检索。官方插件体系（`~/.minimax/v2/plugin-cache`）在 Claude Code 插件（skills/MCP）之上新增了 **Host Binding** 概念：插件可声明绑定宿主原生能力（`computer.use`/`browser.use`）。
- **技能层**：`.builtin-skills` 的目录结构（docx/pdf/pptx/xlsx/skill-creator/deep-research 等）与社区 Claude 技能高度同源；内嵌 `resume-codex` 技能与 `@minimax/mcode-sandbox-runtime`（本地进程隔离沙箱）表明其同时吸收了 Codex/沙箱生态的实践。
- **结论**：MiniMax Code 是"**Anthropic 工具协议 + MCP + Skills**"生态的兼容实现端；没有发现直接复用 Claude Code 官方 CLI 代码的证据（内核为 pi 框架 + 自研 @mavis 运行时）。

## 5. 文档导航

- [computer-use.md](./computer-use.md) — 桌面控制完整逆向（工具 schema、驱动、进程模型、权限、安全示能）
- [browser-use.md](./browser-use.md) — 浏览器控制完整逆向（provider、CDP 动作面、观察机制、安全合同）
- [evidence/inventory.md](./evidence/inventory.md) — 证据清单（路径→结论映射）

## 6. 置信度声明

高置信（直接读到代码/清单）：工具面、进程模型、插件门、权限检查、CDP 用法、云端端点。
低置信需复核：`native-headless-chrome` provider 的桌面端启动路径（本机桌面包中未找到启动代码，推断属于 TUI/云端版本）；MiniMax Design.app 的用途（未深查）；远程控制桥的移动端协议细节（仅读到设计文档片段）。
