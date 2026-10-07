# Comet Browser Use 逆向：AX 伪 HTML 快照 + CDP 合成事件

> 对象：comet-agent 扩展 v0.0.187（`/Volumes/YANG/apps-re/comet/crx/agents/`）。方法：CRX 解包 + service worker 源码（718KB）静态分析。

## 结论：一个自整包的浏览器内 computer-use 引擎

**comet-agent 把 CDP（Chrome DevTools 协议）封装成云端可调用的浏览器 computer-use 工具**：观察走 AX 树（无障碍树，系统暴露给辅助技术的控件结构）序列化成伪 HTML（可交互元素带 `node="<axNodeId>"` 引用），动作走 `Input.dispatchMouseEvent/KeyEvent` 合成事件，主循环是截图→坐标→点击的视觉循环。

## 观察机制

| 通道 | 实现 | 证据 |
|---|---|---|
| AX 伪 HTML | `Accessibility.getFullAXTree` + `DOMSnapshot.captureSnapshot`（computedStyles+DOMRects）→ 角色映射回 HTML 标签（heading→h1-6、textbox→input、checkbox→`type="checkbox"`） | background.js `getHtmlAXTree` |
| 引用句柄 | 可聚焦/可点击节点注入 `node="<CDP AX nodeId>"` 属性；`SCROLL_TO`/`form_input` 按 ref 寻址（DOM.resolveNode→getBoxModel） | `aN="node"` 常量 |
| 过滤 | VIEWPORT 模式只留可见节点；剪掉 LayoutTable/InlineTextBox/`role=none` 噪声；iframe 递归；overlay 内容剔除 | 序列化器 `uN` |
| 截图 | `Page.captureScreenshot`，按视口缩放返回 base64 + screenshot_uuid | ComputerBatch |
| GetContent | 网页 HTML→markdown + og_meta + pdp_data（商品价格/品牌，购物 agent 用）；本地 PDF 走 pdf.js（pdf_worker.js 2MB） | 工具类 `dI` |

**浏览器进程内还有一套 Chrome Glic 血统的 AI 页面内容管线**：`blink.mojom.AIPageContentAgent`、`AnnotatedPageContent`（Z 轴过滤、付费内容标注等 10+ feature flag）——fork 自带，作为 agent 观察的备选/未来通道。

## 动作机制

**ComputerBatch**：一次批量执行动作列表，每步间隔随机延迟（拟人节奏）。

| 动作 | 参数要点 | 底层 |
|---|---|---|
| LEFT/RIGHT/DOUBLE/TRIPLE_CLICK | coordinate + 可选 ref | Input.dispatchMouseEvent（clickCount 1-3，drag 拦截器防误拖） |
| TYPE / KEY | text；KEY 支持 "ctrl+a" 组合 | Input.insertText / dispatchKeyEvent |
| SCROLL / SCROLL_TO | scroll_parameters；SCROLL_TO 按 ref 定位元素 | 鼠标滚轮事件 / DOM.getBoxModel |
| LEFT_CLICK_DRAG | start_coordinate→coordinate | move→down→move→up 序列 |
| SCREENSHOT / WAIT | 截图返回前先校验视口 | captureScreenshot / sleep |
| form_input | 按 ref 填表（原生 select 弹开后提示模型改用 ref） | Runtime/DOM |

**防坐标漂移**：执行前对比当前视口与上次截图视口，不一致则**拒绝执行整批动作**，返回新截图让模型重新定位——截图与坐标的版本一致性由客户端强制。

## 云端通道

- 会话建立：仅 `perplexity.ai` 域（externally_connectable 白名单，含 staging/testing/preview）可发 `START_AGENT`，携 task/uuid/base_url/entry_uuid。
- `AsiCdpBridge`：WebSocket 连云端下发的 wsUrl（token 查询参数鉴权），云端 JSON 消息→本地 CDP dispatch→结果回传；keepalive 心跳，收包超时即断。
- **远端 CDP 白名单只有 15 个方法**：Target 族（发现/附着/建/激活/关 tab）、Browser 族（窗口边界/下载行为/取消下载/版本）、Network 清缓存清 cookie、Fetch.enable（请求拦截）。Input/Accessibility 等动作面只在**本地** ComputerBatch 执行器里，云端拿到的是结果帧。
- 终止：POST `/rest/sse/perplexity_terminate`（entry_uuid+context_uuid，`model_preference: "pplx_asi"`，带凭据）。

## 与 12 家对照（BU 架构位）

| 家 | BU 架构 | 与 Comet 差 |
|---|---|---|
| Cursor | 内嵌 Electron webview + 注入 JS 合成 DOM 事件 | Comet 作用在**真标签页**（用户日常浏览器），非内嵌沙箱 |
| Devin/Grok 云 | 云 VM Chromium + CDP | Comet 浏览器在**用户本机**，登录态不出 device |
| Kimi | MV3 扩展 + Native Messaging | 同为扩展路径，但 Comet 的扩展是浏览器自带 + 配套 23 个私有 API |
| ZCode | 内嵌 WebView IAB | 反向：Comet 让网页（perplexity.ai）成为 agent 宿主 |

> 与 Cursor 的 cursor-browser-extension（装进用户 Chrome 的自动化扩展）机制上最接近（同为 chrome.debugger + content scripts），但 Comet 把它做成了产品底座而非可选组件。

## 复核命令

```bash
cd /Volumes/YANG/apps-re/comet/crx/agents
grep -o 'Accessibility.getFullAXTree' background.js | head -2
grep -c 'Input.dispatchMouseEvent' background.js
python3 -c "import json;m=json.load(open('manifest.json'));print(m['permissions'])"
```
