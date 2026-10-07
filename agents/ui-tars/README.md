# UI-TARS / Agent TARS（ByteDance）· 纯视觉路线开源代表

> 一句话结论：**12 家分册里唯一"看截图、给坐标"的原生 GUI Agent——AX 树（系统无障碍控件树）在这条路线里根本不存在。**

| 项 | 值 |
|---|---|
| 载体 | Electron 桌面端 ui-tars-desktop 0.2.4 + CLI `@agent-tars/cli` 0.3.0（同 monorepo 两个产品） |
| 形态 | 桌面 App / CLI / Web UI / SDK（`@ui-tars/sdk` 与 `@tarko/agent` 两代内核并存） |
| CU 工具面 | 1 个模型动作空间（17 动作）· 坐标即参数 |
| BU 工具面 | 3 模式（dom 18 / visual 9 / hybrid 20）· MCP 混合面 |
| 安全模型 | 无逐动作门 · call_user 人在回路 · AIO 沙箱 |
| 本机可用 | ⚙️未安装（上游开源，源码基线 commit `2ff41a9e`，2026-10-07 取证） |

## 架构一图

```
UI-TARS VLM（OpenAI 兼容端点：HuggingFace TGI / VolcEngine Ark / 自部署 vLLM）
 └─ 模型输出纯文本：Thought: … Action: click(start_box='<|box_start|>(x1,y1)<|box_end|>')
     └─ ActionParser  正则解析 → BaseAction{type, inputs{start:{x,y}}}
         └─ Operator  归一坐标 × 屏幕宽高 → nut-js（macOS 走 CGEvent）派发
             └─ 截图回投（SDK：while 循环；Agent TARS：environment_input 事件）
```

桌面端另有四 Operator 选装：LocalComputer（nut-js）/ LocalBrowser（BrowserFinder 找本机 Chrome → CDP）/
RemoteComputer、RemoteBrowser（云端代理，OSS 构建 `UI_TARS_PROXY_HOST=''` 置空不可用）。

## 两个产品，一套内核

| | UI-TARS Desktop | Agent TARS CLI |
|---|---|---|
| 定位 | 桌面 GUI Agent（原生 App） | 通用多模态 Agent（终端 + Web UI） |
| 内核 | `@ui-tars/sdk`（v1 while 循环） | `@tarko/mcp-agent`（事件流 + 工具调用引擎） |
| CU | nut-js 全屏坐标派发 | 经 gui-agent 包挂 `browser_vision_control` 单工具 |
| BU | CDP 浏览器 Operator | 内置 MCP（browser/filesystem/commands 进程内 InMemoryTransport） |
| 扩展 | — | `--mcp` 挂任意外部 MCP server |

## 视觉路线 vs AX 路线（本册最大价值）

12 家已测 Agent 全部 AX 树优先；UI-TARS 是互补的**纯视觉派**：

| 维度 | UI-TARS（视觉派） | 12 家主流（AX 派，如 ZCode/Codex） |
|---|---|---|
| 观察 | 整屏截图直进 VLM | AX 树增量 diff + 截图辅助 |
| 定位 | 模型输出坐标（0-1 或像素） | AX 元素句柄 / ref / snapshot_id |
| 防漂移 | 无（每轮重截图自然刷新） | 五级方案（台账→租约→verify_after） |
| 跨应用泛化 | 强（不依赖 AX 暴露质量） | 受限于目标应用 AX 实现 |
| 小字/密集 UI | 弱（VLM 接地误差） | 强（AX 语义精确） |

SoM（set-of-marks，截图编号标注）在桌面端**只用于 UI 展示**（点击位置画框），不参与接地——
标注实现致谢 Midscene（MIT），见 `ScreenMarker.ts` 头注释。

## 安全与遥测（静态记录）

| 层 | 事实 |
|---|---|
| 确认模式 | **无逐动作确认门**；pause/resume + AbortSignal + `call_user`（模型主动移交人工） |
| 循环熔断 | maxLoopCount 默认 100；截图连续失败 10 次熔断；7 个负数错误码（-100000…-100099） |
| 文件系统 | filesystem MCP `allowedDirectories` 锁 workspace |
| 沙箱 | Agent TARS `aioSandbox` 选项 → 全工具改走 AIO Sandbox 隔离容器 |
| TCC | 桌面端经 `@computer-use/node-mac-permissions` 引导 Screen Recording + Accessibility |
| 遥测 | UTIO（UI-TARS Insights and Observation）：POST JSON 到 `utioBaseUrl`，OSS 默认空=不上报 |
| 模型端点 | VLM_PROVIDER 预设四档（HF UI-TARS-1.0/1.5、Ark doubao-1.5-ui-tars/-thinking-vision-pro）+ 任意 OpenAI 兼容端 |

## 与 Peekaboo / Goose 的关系

**无关**。全仓 grep `peekaboo` 零命中；goose 检索命中均为 `mongoose`（MongoDB ODM）。
两条开源路线对照：Goose 透传 Peekaboo（Swift CLI，AX 标注截图）；UI-TARS 内嵌 nut-js（TS 库，纯坐标）。

## 文档结构

- [computer-use.md](computer-use.md) — 截图循环、动作解析、坐标派发、状态机、安全模型
- [browser-use.md](browser-use.md) — Agent TARS 三控制模式、MCP 生态、桌面端浏览器 Operator
- [evidence/inventory.md](evidence/inventory.md) — 上游 commit、文件:行号证据、负证据、合规说明
- 源码层：[source/ui-tars/](../../source/ui-tars/README.md)（vendor Apache-2.0 子集 + cleanroom reference + 自测）
