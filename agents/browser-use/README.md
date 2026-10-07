# browser-use（开源，browser-use.com）· BU 事实标准库逆向总览

> 一句话结论：**被集成而非被安装的浏览器 Agent 库——"文本 DOM + `[index]` 句柄"模式的源头与标杆。**

| 项 | 值 |
|---|---|
| 载体 | Python 库 v0.13.11（commit `c75e8476`，2026-10-07 基线） |
| 形态 | 库（被集成）/ 可挂 MCP server / 自带 CLI 与云延伸 |
| CU 工具面 | 0 个 · 无桌面代码（见判定书） |
| BU 工具面 | 24 个动作 · 事件总线 + 15 watchdog |
| 安全模型 | `<secret>` 占位符 · 域白名单 · 上传白名单 |
| 本机可用 | ⚙️ 未安装（上游源码分析基线） |

## 架构一图

```
task + LLM（16 家适配器）
 └─ Agent.step() 四阶段循环（CAPTCHA等待→状态→LLM→执行）
     └─ AgentOutput{memory/next_goal, action[]}  结构化输出=动作计划
         └─ Tools Registry（24 动作，<secret> 替换层）
             └─ BrowserSession 事件总线（bubus）
                 ├─ DOMWatchdog         三 CDP 源 → [index] 句柄台账
                 ├─ ScreenshotWatchdog  干净截图（先抹高亮）
                 ├─ SecurityWatchdog    导航围栏
                 ├─ DefaultActionWatchdog 遮挡检查→CDP 鼠标/键盘
                 └─ DownloadsWatchdog   受控下载
                     └─ cdp-use ←→ Chrome 子进程 --remote-debugging-port
```

## 三层文档

| 文档 | 回答的问题 | 行数预算 |
|---|---|---|
| [computer-use.md](computer-use.md) | 它做桌面控制吗？——**不做，判定书** | 120 |
| [browser-use.md](browser-use.md) | DOM 句柄/CDP 动作/安全护栏怎么实现？ | 150 |
| [evidence/inventory.md](evidence/inventory.md) | 每条结论的 文件:行号 | 数据文件 |

## 与 12 家分册的关键对照

| 维度 | browser-use | 12 家多数 |
|---|---|---|
| 句柄 | 文本 DOM `[index]`（selector_map 台账） | AX 树 ref / 截图 ref / SoM 变体 |
| 截图 | 干净图 + use_vision 三档；SoM 渲染器**遗留未用** | 多为 SoM 或 ref 标注 |
| 执行 | CDP 直连（自研 cdp-use，非 Playwright） | WebView / 扩展 / 云端 |
| 密钥 | `<secret>占位符</secret>` 执行期替换 | 环境变量/凭据柜 |
| 规划 | 单模型字段 `plan_update`（无双 Agent） | 类似或更简 |

## 快速验证（只读上游源码）

```bash
git clone --depth 1 https://github.com/browser-use/browser-use /tmp/browser-use-src
git -C /tmp/browser-use-src log -1 --format='%H'      # c75e8476e26d... 
grep -n 'version' /tmp/browser-use-src/pyproject.toml | head -1   # 0.13.11
grep -rn 'selector_index = self._allocate' /tmp/browser-use-src/browser_use/dom/serializer/serializer.py
```

## 源码层

- [source/browser-use/vendor/](../../source/browser-use/vendor/) — 上游 MIT 源码核心子集原样搬运（21 文件，附 PROVENANCE + sha256 + LICENSE 全文）
- [source/browser-use/schemas/tools.json](../../source/browser-use/schemas/tools.json) — 24 动作规范化 schema（手写整理，条目带 文件:行号）
- [source/browser-use/reference/](../../source/browser-use/reference/) — cleanroom TypeScript 最小骨架（DOM 快照→ref 句柄→动作循环→done），`node test.mjs` 自测
