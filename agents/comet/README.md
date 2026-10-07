# Perplexity Comet（Perplexity）· 浏览器即 Agent 载体

> 一句话结论：**Agent 不在 app 里、也不全在云上——大脑在 perplexity.ai 网页里，Chromium fork 给这个网页发了三张"特权扩展"通行证。**

| 项 | 值 |
|---|---|
| 载体 | Comet.app 145.2.7632.4587（Chromium fork，universal，654MB；官方最新 153.0.8010.222） |
| 形态 | 浏览器即载体：sidecar 网页（云）+ 3 个内置 CRX（本地执行） |
| CU 工具面 | ComputerBatch 10 动作 · CDP Input 合成事件 |
| BU 工具面 | 同一执行器 · AX 伪 HTML 快照 + 截图视觉循环 |
| 安全模型 | 域名黑白名单 + 输入封锁 + Pause/Take control |
| 本机可用 | ✅ 静态还原（2026-10 基线；未运行，零运行痕迹） |

## 架构一图

```
perplexity.ai 云 (agent 大脑, 模型偏好 pplx_asi)
 │ ① START_AGENT（仅 perplexity.ai 域可发） ② WebSocket CDP 桥（AsiCdpBridge，远端白名单 15 方法）
 │ ③ SSE/REST（perplexity_terminate、shopping browser-config）
─┼───────────────「本机可见」边界──────────────────────────────
 │
 Comet.app（Chromium fork，ai.perplexity.comet）
  └─ sidecar 侧栏 = www.perplexity.ai 网页（agent 会话 UI）
      └─ 23 个 perplexity.* 私有扩展 API（fork 注入）
          ├─ comet-agent 扩展（npclhjbdd…，v0.0.187）★执行核心
          │    ├─ 本地工具：GetContent/SearchBrowser/OpenTab/GroupTabs/截图
          │    ├─ ComputerBatch：Input.dispatchMouseEvent/KeyEvent + Page.captureScreenshot
          │    └─ 观察：Accessibility.getFullAXTree → 伪 HTML（node="ref"）
          ├─ perplexity 扩展（v1.0.76）：DNR 广告拦截、代理、pdf.js
          └─ comet_web_resources 扩展：sidecar 静态资源
```

## 三个内置扩展

| CRX | ID 前缀 | 版本 | 角色 |
|---|---|---|---|
| agents.crx（comet-agent） | npclhjbdd… | 0.0.187 | agent 手脚：debugger(CDP)+scripting+`<all_urls>` 内容脚本 |
| perplexity.crx（Comet） | mcjlamoh… | 1.0.76 | 浏览器胶水：广告拦截/代理/身份/pdf.js/debugger |
| comet_web_resources.crx | mjdcklhe… | 2026.3.26.537 | sidecar/inline-assistant/voice-assistant 静态资源 |

## 判定摘要

- **浏览器侧 = 手和眼**（本地执行：CDP Input 合成点击、AX 树快照、截图）；**大脑 = 云端**（任务编排、决策、工具调用全在 perplexity.ai，浏览器只上报执行结果）。
- 卖点「用你的登录态」= 直接跑在用户 profile 里，cookie/会话不复制、不出本机；但页面内容（markdown/截图/商品数据）会上传云端。
- 与已测 12 家最大差异：不是「Agent 内嵌浏览器」（Cursor/ZCode IAB），也不是「云 VM 浏览器」（Devin），而是**浏览器 fork 本身成为 agent 运行时**。

## 快速复核入口

```bash
V=/Volumes/YANG/apps-re/comet/Comet.app
plutil -p $V/Contents/Info.plist | grep ShortVersion     # 145.2.7632.4587
D="$V/Contents/Frameworks/Comet Framework.framework/Versions/145.2.7632.4587/Default Apps"
ls $D                                                    # agents/perplexity/comet_web_resources.crx
unzip -oq "$D/agents.crx" -d /tmp/agents && cat /tmp/agents/manifest.json
grep -o 'Input.dispatchMouseEvent' /tmp/agents/background.js | head
```

> 逆向方式：只读静态分析。未安装、未启动 app，不抓包、不碰凭据。证据见 [evidence/inventory.md](evidence/inventory.md)。
