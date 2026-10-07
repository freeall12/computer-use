# source/ui-tars/ —— UI-TARS（ByteDance）CU/BU 能力源码层

> 对应分册：[agents/ui-tars/](../../agents/ui-tars/README.md)（总览）、[computer-use.md](../../agents/ui-tars/computer-use.md)、[browser-use.md](../../agents/ui-tars/browser-use.md)、[evidence/inventory.md](../../agents/ui-tars/evidence/inventory.md)。

## 版本基线

| 项 | 值 |
|---|---|
| 上游 | `github.com/bytedance/UI-TARS-desktop`（monorepo：UI-TARS Desktop + Agent TARS） |
| 版本 | 桌面端 `ui-tars-desktop` **0.2.4**；`@agent-tars/cli` **0.3.0** |
| 修订 | commit `2ff41a9e515828c5bd5b276e493d73aa0bdf4a3a`（2026-09-24 +0800，shallow clone HEAD，2026-10-07 取证） |
| 许可证 | **Apache-2.0**（上游整仓代码；UI-TARS 模型权重为独立许可证，不在本层范围） |
| 语言 | TypeScript（Electron 桌面端 + pnpm workspace CLI） |
| 本机安装 | 无（本目录三层全部基于上游源码与官方文档静态分析） |

## 三层结构

```
source/ui-tars/
├── schemas/                  接口数据（手写整理的规范化 JSON）
│   ├── action-space.json       UI-TARS 动作空间：四种坐标格式、17 动作、别名表、状态机与错误码
│   └── agent-tars-tools.json   Agent TARS CLI 工具面：三种浏览器控制模式逐模式工具集 + filesystem/search/commands
├── reference/                cleanroom 重构参考实现（TypeScript，Node ≥22.6 原生运行）
│   ├── vision-gui-agent.ts     截图→模型文本响应解析→动作映射表→坐标点击派发 的最小骨架
│   └── test.mjs                纯 Node 断言自测（ALL PASSED，11 checks）
└── vendor/                   上游 Apache-2.0 源码子集原样搬运（PROVENANCE + LICENSE 全文）
```

### 1. vendor/（开源搬运）

上游整仓开源（Apache-2.0），GUI Agent 核心三件（截图、动作解析、坐标派发）可直接原样搬运——这是与 zcode/codex/claude-code/cursor 等全专有分册最大的不同。范围与出处见 [vendor/PROVENANCE.md](vendor/PROVENANCE.md)：

```
vendor/
├── PROVENANCE.md / LICENSE-apache-2.0.txt
├── gui-agent/               ← multimodal/gui-agent（Agent TARS 代的 GUI Agent 核心）
│   ├── shared/src/utils/      actions.ts（别名归一表）、coordinateNormalizer.ts
│   ├── action-parser/src/     DefaultActionParser / ActionParserHelper / FomatParsers（Thought+Action 文本解析链）
│   ├── agent-sdk/src/         GUIAgent（browser_vision_control 单工具）+ ToolCallEngine（纯文本→tool call）
│   └── operator-nutjs/src/    NutJSOperator（nut-js 截图 + 16 动作坐标派发）
└── sdk/src/GUIAgent.ts      ← packages/ui-tars/sdk（桌面版 v1 主循环：retry/pause/call_user）
```

逐文件与上游一致（sha256 校验见 PROVENANCE §3）；import 指向 workspace 包，**不可独立构建**，作规格对照与出处锚定用。

### 2. schemas/（接口数据，手写整理）

- `action-space.json` —— 动作空间（17 动作 + 别名 + 四种坐标格式 + 坐标换算语义）、StatusEnum 状态机、ErrorStatusEnum 错误码、循环默认参数；
- `agent-tars-tools.json` —— Agent TARS 的 dom / visual-grounding / hybrid 三种浏览器控制模式各自注册的工具集、`browser_vision_control` 参数面、web_search/filesystem/commands 工具、AIO 沙箱模式。

每个文件头部 `_provenance.status = 文档`（上游开源源码即文档级事实；本机无安装，无"实测"成分）。

### 3. reference/（cleanroom 参考实现）

`vision-gui-agent.ts` 复现"纯视觉路线"的最小闭环：`parsePrediction`（Thought/Action 切分 + 四种坐标格式归一）→ 别名归一表 → `calculateRealCoords`（normalized×屏幕 / raw 直用）→ `runVisionLoop` 主循环（finished/call_user/abort/maxLoopCount/截图熔断五终态）。机制出处逐节引用分册 `agents/ui-tars/computer-use.md`；与 vendor 的上游实现作行为对照而非代码转写。

```bash
node source/ui-tars/reference/test.mjs    # ALL PASSED (11 checks)
```

## 与其他 agent 源码层的对照

| 维度 | 本目录 | 对照：goose | 对照：zcode/codex 等 |
|---|---|---|---|
| 路线 | 纯视觉（截图→VLM→坐标） | AX 标注截图（Peekaboo 透传） | AX 树优先 |
| vendor 可行性 | ✅ 上游整仓 Apache-2.0 | ✅ 上游整仓 Apache-2.0 | ❌ 组件专有 |
| reference 侧重 | 响应解析 + 坐标派发 + 主循环 | 单工具 CLI 透传 + 权限三明治 | AX diff / 租约 / 防重放 |
