# vendor/ — 开源上游归档说明

原则：**只 vendor 开源上游；专有代码绝不入仓。**

## 已 vendor

### mimo-ai-plugin/ — `@mimo-ai/plugin` 0.1.14（MIT）

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/XiaomiMiMo/MiMo-Code （monorepo `packages/plugin`） |
| 许可证 | MIT（`mimo-ai-plugin/LICENSE`，版权行同时致谢 `Copyright (c) 2025 opencode` —— 证实 MiMoCode 与 opencode 的谱系承继） |
| 本机对应组件 | `~/.config/mimocode/node_modules/@mimo-ai/plugin/`（MiMo Desktop 引擎的插件 SDK 运行依赖，engine-config/package.json 声明 `@mimo-ai/plugin: "*"`） |
| 归档内容 | 原样 npm 包（package.json + dist/*.js|.d.ts + README + LICENSE），共 15 文件 ~92KB |
| 修订/校验 | npm 发布版 0.1.14（package.json 内无 gitHead；package.json 前 32 位 SHA256 = `1a38258fdc2e71c2c0af10bc153b3295`） |
| 谱系价值 | 官方 README 证实 MiMoCode 是**开源终端编码代理**（`@mimo-ai/cli` 可 npm 全局安装），支持 Codex OAuth / Claude Code 认证导入 / 任意 OpenAI 兼容 Provider —— 与 agents/mimo/README.md 的「Claude Code 工具协议同构端 + opencode 谱系」判定互证 |

## 未 vendor（仅记录 URL 与许可证）

以下开源依赖是 `@mi/mimo-computer-use` 0.7.11（**专有**，小米内部 registry `pkgs.d.xiaomi.net`，restricted，无公开仓库）的依赖，本机以运行时形式存在，本仓库不复制：

| 包 | 许可证 | 在 CU/BU 中的角色 |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` ^1.0.4 | MIT | MCP 服务端框架（js 工具承载） |
| `@nut-tree-fork/nut-js` ^4.2.0 | Apache-2.0 系 | 非 mac / AX 禁用时的鼠标键盘坐标兜底 |
| `screenshot-desktop` ^1.15.0 | MIT | 全屏截图兜底 |
| `sharp` ^0.33.5 | Apache-2.0 | 截图缩放/JPEG 编码 |
| `zod` ^3.23.8 | MIT | 工具 schema |
| `playwright` 1.61.1 (optional) | Apache-2.0 | legacy 平面 browser_* 工具后端；浏览器运行时另 vendor 了一份生成版 Playwright 注入载荷（Apache-2.0，见 CU 包 `THIRD_PARTY_NOTICES.browser.md`） |

## 专有组件边界（红线清单）

以下本机组件为小米专有，本仓库**只做了文档级记录与 ≤10 行/处引用**，未复制任何文件：

- `@mi/mimo-computer-use` 0.7.11 全部内容（dist/、native/ Swift helper、extension/、skills/、README）
- `Xiaomi MiMo AI.app` 的 app.asar（MiMoCode 桌面引擎主进程/out/main、prompts、内置技能）
- `MiMo Computer Use.app` / `MiMo Browser Use.app`（原生二进制与签名资源）
- Browser Bridge 扩展（manifest/background.js/cursor-overlay.js）

完整证据路径见 `agents/mimo/evidence/inventory.md`。
