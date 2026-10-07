# Fellou（Fellou AI）· 自称"全球第一个 Agentic Browser"的深度动作浏览器

> 一句话结论：**Fellou = Eko 开源工作流框架（浏览器操作员）+ 闭源云端"Javis"助手（宣称的桌面控制）+ Shadow Workspace 并行隔离——本册分析时官方安装包已全网死亡，逆向基线是厂商自家开源框架 + Wayback 产品声明。**

| 项 | 值 |
|---|---|
| 载体 | 安装包**未获得**（最后发行版 Fellou-CE 2.5.18，2025-11-09 构建，官方 S3 已停用） |
| 替代基线 | FellouAI/eko v4.1.3（MIT，commit c3de315）+ 官网 2025-09/11 存档页 |
| 形态 | 浏览器内 agent（开源实证）+ 云端委派"full computer control"（宣称，中置信） |
| CU 工具面 | 开源侧 **0 个 OS 工具**；产品宣称 Computer-use Agent（闭源未验） |
| BU 工具面 | 13 工具（v4.1.3 实测；旧文档口径 15）· SoM 标注观察 |
| 安全模型 | 计划级确认门 · human_interact 四型 · 求助移交（登录/CAPTCHA/支付） |
| 本机可用 | ❌ 未拿到包，无从运行（2026-10 基线） |

## 架构一图（开源可见层；云侧 Javis 不可见）

```
用户对话（Fellou 浏览器 / 任意宿主）
 └─ ChatAgent（eko-core/chat）
     ├─ deepAction 工具 ──→ "Delegate to Javis AI assistant（云端）with full computer control"
     │    └─ 本地 fallback：new Eko() → Planner 生成 XML 工作流 → workflow_confirm 确认门
     ├─ webpageQa / webSearch / variableStorage（轻任务不走工作流）
     └─ Eko 引擎（eko-core/agent）
         ├─ Workflow：XML DSL（agent dependsOn 并行图 + node 变量 + forEach + watch 监听）
         ├─ BrowserAgent 三运行时（同一 BaseBrowserLabelsAgent 基类）：
         │    ├─ eko-extension：chrome.tabs.captureVisibleTab + chrome.scripting（MV3）
         │    ├─ eko-nodejs：playwright-extra + StealthPlugin（可 CDP 附着已开浏览器）
         │    └─ eko-web：html2canvas + history.pushState（仅限当前站点）
         ├─ 观察 = SoM 标注截图 + [33]:<button> 元素索引（build-dom-tree 页内建树）
         ├─ 工具可下沉远端 MCP：响应带 extInfo.javascript → 页内 execute(args)（云端下发脚本）
         └─ human_interact（confirm/input/select/request_help）+ task_snapshot（暂停恢复）
```

## TL;DR（30 秒版）

1. **未拿到包判定书**：官方下载链（S3 bucket `fellou`）已因账户停用整体死亡（us-west-1 301 → us-east-1 403 AllAccessDisabled），Homebrew/GitHub/Wayback/archive.org 均无镜像；证据链见 [evidence §1](evidence/inventory.md)。产品 2025-11 后无新构建，官网 blog 503。
2. **逆向基线换成厂商自家开源框架**：官方博客自认 "The key to Fellou 2.0's success — Eko 2.0, a crucial open-source Browser-use infrastructure"——Fellou 浏览器的 agent 层就是 Eko（Browser + Workflow + Agent 架构）。
3. **CU 归属云端（本册最重要发现）**：eko 聊天层 `deepAction` 工具自述 "delegate to **Javis AI assistant** with **full computer control**" over "**networked computers**"——桌面控制由云端助手承担；全仓库 AXUIElement/CGEvent/SendInput = **0 命中**。
4. **BU = SoM 派浏览器操作员**：标注截图（彩色框 + 右上角标）与 `[33]:<button>Submit</button>` 元素索引对齐；防漂移靠"只用最新索引"纪律，无运行时校验（Codex 同派）。
5. **编排即卖点**：NL → XML 工作流（多 agent 依赖并行 + 变量传递 + DOM watch 监听），Online-Mind2web 自报 80%（2025-05）。
6. **Shadow Browser 两代口径**：2025-09 "shadow window"（不干扰用户）→ 2025-11 "shadow workspace/back-end workspace"（并行任务墙）；编排并行有源码实证，**本地隔离窗口实现无二进制证据**。
7. **Agentic Memory 只在产品层**：开源侧仅 `chatService.memoryRecall` 注入槽位 + 会话级消息压缩；跨会话记忆（浏览器历史/笔记/知识库）在闭源 app。
8. **安全三件套**：计划级 `workflow_confirm`（**默认关**）+ `human_interact` 四型 + `request_help` 把登录/CAPTCHA/支付交还人；官网并宣称"模拟人类行为高准确率解 CAPTCHA"——安全姿态最激进的厂家之一。

## 文档导航

| 文件 | 内容 |
|---|---|
| [computer-use.md](computer-use.md) | CU 判定书：产品宣称 vs 开源零实证 vs Javis 云端委派证据链；形态判定与横向对照 |
| [browser-use.md](browser-use.md) | BU 完整逆向：三运行时、SoM 观察、13 工具、MCP 脚本回传协议、deepAction/Shadow/Memory 产品层 |
| [evidence/inventory.md](evidence/inventory.md) | 判定书全链、eko 源码事实（带路径行号）、Wayback 官方声明（带时间戳）、logo 出处 |

> 合规声明：只读静态分析 + 公开存档取证；未运行安装器、未启动任何样本、未触碰凭据；专有代码零引用（本册全部代码事实来自上游 MIT 开源仓库）。
