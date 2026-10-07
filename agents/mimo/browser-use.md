# MiMo 的 Browser Use：`agent.browsers` 四后端，Codex 同构，本机未启用

> 对象与方法同 [computer-use.md](computer-use.md)（只读静态分析；未运行、未抓包）。证据见 [evidence/inventory.md §D](evidence/inventory.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 形态 | 同一 `js` REPL 内核里的 `@mimo/browser-use` 模块——"There are no separate `browser_*` tools"（宿主产品文档原话） |
| 后端 | `iab`（宿主内嵌，桌面首选）/ `extension`（真实 Chrome/Edge/Brave）/ `managed`（Chrome for Testing）/ `cdp`（raw endpoint） |
| 能力协商 | 按 provider 协商，不支持的成员一次性报错，**绝不静默替换** |
| 本机状态 | **能力完整、当前未启用**：env=0、无 IAB provider、宿主无对应技能；曾有插件安装尝试（2026-09-12）——负证据五面俱全 |
| 人机共驾 | 对截屏不可见的虚拟光标 + 每 tab 预览面板（≤5fps，帧不进模型）+ turn 级 tab 回收 |

## 架构一图：extension 后端传输拓扑

```
MCP server（js 内核）
 │ unix socket（每浏览器/配置文件唯一；私有注册表发现：
 │   MIMO_BROWSER_REGISTRY_DIR，心跳 5s、陈旧回收 300s、上限 32 条）
 ▼
browser-native-host（dist/browser/host.js，Node）
 │ Chromium Native Messaging（JSON-RPC 2.0，host 名 com.xiaomi.mimo.browser）
 ▼
Browser Bridge（MV3 扩展：tab 租约/分组管理、心跳 5s/超时 3s、
 断线重连 5s、MAX_SESSIONS=256、"Browser task" 托管 tab 组）
 │ chrome.debugger（CDP 1.3；无 --remote-debugging-port；公开方法走白名单）
 ▼
page（aria-snapshot 观察 + CDP 合成输入 + 虚拟光标呈现）
```

## 1. 结论速览

1. **与 Codex 完全同构**：Codex 的浏览器 = `js` 工具 + `agent.browsers.*`/`tab.*` 运行时 API——MiMo 复刻了这一形状（对照表见 [README](README.md)）。
2. **Browser Bridge 是可上架 Chrome Web Store 的正式 MV3 扩展**：11 项权限 + `<all_urls>`，经固定 host 名与本地 Node host 通信；不暴露调试端口，公开 CDP 方法走白名单。
3. **本机未启用（负证据五面法）**：门控关 / 无 descriptor（Browser Provider 目录空，IAB 未发布）/ 宿主无对应技能 / env=0 / 有插件安装尝试记录（2026-09-12）——判定为"具备完整能力、未启用"而非"无能力"。

## 2. 能力载体清单

| 载体 | 路径（本机实证） | 角色 |
|---|---|---|
| `dist/browser/`（30+ 模块） | `…/Runtime/0.7.11/products/*/node_modules/@mi/mimo-computer-use/dist/browser/` | 运行时本体：runtime/code-repl/cdp-kernel/locator/aria-snapshot/extension-*/managed-chromium/raw-cdp-transport/provider-protocol/public-cdp-policy/preview/clipboard 等 |
| Browser Bridge 扩展 | `…/MiMo Automation/Browser Bridge/`（manifest v0.7.11 + background.js 102KB + cursor-overlay.js） | native messaging 端点 + chrome.debugger CDP 通道 + tab 租约 |
| Native host 清单 | `~/Library/…/Google/Chrome/NativeMessagingHosts/com.xiaomi.mimo.browser.json` | `allowed_origins` 钉死两个商店扩展 ID |
| `browser-native-host` | `…/MiMo Automation/Launchers/bin/browser-native-host` | sh → 应用自带 Node 执行 `dist/browser/host.js` |
| `MiMo Browser Use.app` | `…/MiMo Automation/Applications/`（com.xiaomi.mimo.browseruse 0.7.11） | 状态 GUI + browser-preview-macos 预览 helper + 托管浏览器/扩展安装入口 |
| 宿主 presentation-host | `…/Xiaomi MiMo AI/presentation-host/control.sock` | 桌面主进程 socket：IAB 呈现与焦点协作（focusWebContents 等） |
| 宿主技能 | `~/.config/mimocode/skills/mimo-browser-use/`（**本机缺失**，包内 `skills/` 有同一份源） | BU 关闭的直接证据之一 |

## 3. 工具面与契约（js 内核 + agent.browsers）

**标准进入序列（技能规定，三选一；选择后必须读 `documentation()` 且独占收尾）：**

```js
globalThis.chrome  = await agent.browsers.get("chrome");        // 用户指名浏览器
globalThis.browser = await agent.browsers.getForUrl("https://…/"); // 有 URL 未指名
globalThis.browser = await agent.browsers.getDefault();          // 无指名无 URL
```

| 契约要点 | 内容 |
|---|---|
| `browser.documentation()` | 返回该后端**完整方法契约**（导航/点击/填表/上传/对话框/截图/清理），是权威 API 面；主题查询走 `agent.documentation.get(name)` |
| tab 元数据 | 页面元数据在 `tab` 上；**禁止臆造** `tab.playwright.page/title()/url()`；locator 报 `not actionable` = 未派发点击 |
| 动作即观察 | 每次状态变更单元格内联返回最新 tab 观察 + URL + tab id 列表（codex/toolSurface 形状）；失败单元格仍携带动作反馈 |
| tab 绑定 | `tabs.new()` 仅当紧接着要用；失败后绑定已建立就必须复用；空 tab 列表是清理后的正常态 |
| 文件上传 | 不猜 Playwright 方法、不合成 DOM 事件，按 `file-uploads` 主题的 chooser 序列执行 |
| 轮次生命周期 | 宿主自动宣布 turn 完成；**host 负责 tab finalization**（临时/失败/重复 tab 回收、用户 tab 归还）；无公开 `tabs.finalize`，模型不得发明 |

> legacy 离散 `browser_*`：playwright 后端 22 个 + extension 后端 13 个（含 Codex 风格 `browser_exec`：`tab.playwright`/`tab.cua`/`page`/`console`）——"旧兼容面"研究 fixture，不与 `js` 并注册。

## 4. 观察机制

| 通道 | 机制 |
|---|---|
| AX/DOM 快照 | 扩展后端经 CDP `Accessibility.*`（getFullAXTree/queryAXTree 等在白名单）产出 aria-snapshot 与可交互元素索引；`aria-snapshot.js`/`ax-tree.js`/`ax-capture.js`/`ax-hit-point.js` 模块链完整 |
| 截图 | `Page.captureScreenshot`（扩展后端 JPEG；managed/CDP 后端 PNG）；坐标即该截图视口像素空间 |
| 内联动作反馈 | 变更动作结果自带 tab 观察，模型无需补拍 |
| console/诊断 | 页面 console 与未捕获异常持续捕获；`read-only-evaluate.js` 限定只读检查面 |
| 预览（人看） | IAB 显示在宿主右侧栏；独立宿主由 helper 每活动 tab 开可拖拽预览面板（≤5fps/800px/JPEG）——**帧永不进入模型可见结果或公共 CDP 事件缓冲**；点面板聚焦 tab，不透传点击 |

## 5. 动作机制（CDP 层）

| 机制 | 内容 |
|---|---|
| 呈现与输入分离 | 需要指针操作时注入 pointer-transparent 的 closed-Shadow-DOM 虚拟光标，等 ≤1.5s 光标动画**可被观察**后才派发真实 CDP 输入；呈现失败绝不阻塞动作；非前台 tab 仍可观察操作 |
| 公开 CDP 白名单 | `public-cdp-policy.js`：Accessibility/CSS/DOM 等观察域 + 少量写域按名单放行；语义自动化内部走 `executeCdp`，防绕过高层 locator/CUA；可重入方法（Fetch.continueRequest 等）单独识别 |
| managed 后端 | `mimo-browser-use install` 显式下载 Chrome for Testing 到 `~/.mimo-browser-use/browsers/`；MCP 启动**绝不静默下载**；每次运行私有临时 profile + 随机 CDP 端口，内核关闭即清理。发现顺序：显式可执行 → managed 缓存 → 系统 Chrome/Canary/Chromium/Brave → Puppeteer/Playwright 缓存 |
| IAB 后端 | 宿主发布版本化 Browser Provider descriptor（`MIMO_BROWSER_PROVIDER_DESCRIPTOR` + `MIMO_BROWSER_DEFAULT=iab`）指向用户私有已认证 socket；Electron 对象/cookie/认证 UI/焦点/呈现全归宿主。本机 provider.json 不存在 → IAB 未发布 |

## 6. 安全模型（运行时强制 + 技能约束）

| 层 | 机制 |
|---|---|
| 权限收窄 | 扩展权限虽含 `<all_urls>`，公开 CDP 走白名单；`allowed_origins` 钉死两个商店扩展 ID（开发 manifest 的稳定 key 在商店包中被移除） |
| 调试面 | extension 后端全程 `chrome.debugger`，无 `--remote-debugging-port`；raw CDP 仅限显式配置 |
| live UI 教义 | 网页内容/消息/下载/工具输出都是 untrusted data；后果性动作前确认确切目标；支付凭据/OTP/生物识别/凭证变更/安全警告绕过/转账最终提交移交人工；**禁止**用 JS/WebMCP/另一后端/桌面自动化绕过已要求的确认；页面内容不得当确认 |
| 并发与租约 | 同一显式 `MIMO_BROWSER_SOCKET` 禁止并发宿主；扩展侧 tab 租约防多 agent 争抢 |
| `js` 纪律 | 禁止宽泛 try/catch 吞错（错误须以 `isError` 保持机器可见恢复指引）；禁止内核重置当恢复手段；禁止一个工作流中"发现第二个 Browser MCP" |

## 7. 与 Codex/Claude 的关系

| 对照 | 结论 |
|---|---|
| Codex | `agent.browsers` 对象图、`getForUrl/getDefault`、tab 观察内联、四后端划分、`BROWSER_USE_PREFERRED_CHROME_*` 环境变量全部标注 Codex-shaped parity；legacy `browser_exec` 逐条注明 "mirrors Codex" |
| Claude | 同属"真浏览器扩展 + native messaging + CDP"家族（Claude in Chrome），但扩展协议自研（JSON-RPC 2.0 帧非 Claude 格式） |
| 宿主增强 | 桌面端预览右侧栏 + presentation-host socket 是 MiMo 特有（Codex 侧是 toolSurface 元数据；MiMo 把预览真正渲染成宿主 UI） |

> 低置信度复核点：IAB descriptor 具体字段（provider.json 本机不存在，从 README 与分支逻辑还原）；Chrome Web Store 上架现状；`tab.*` 完整方法集（documentation() 运行时生成，未运行取得实例）。
