# Comet Computer Use 判定：桌面控制为零，浏览器即桌面

> 判定：**Comet 没有 OS 级 computer use**。全包扫描零 AX/CGEvent/ScreenCaptureKit 助手、零独立 helper 进程、零 TCC 权限申请面——CU 能力被整体收纳进浏览器标签页内。

## 判定依据

| 排查项 | 结果 |
|---|---|
| 独立 helper .app（对照 Cursor sidecar/ZCode cua-helper） | 无；Helpers/ 仅 Chromium 标配四件 + CometUpdater |
| CGEvent/AXUIElement/SkyLight 符号（主二进制 449MB strings） | 仅 Chromium 自带 a11y 支持代码，无输入注入 |
| TCC 权限（Accessibility/Screen Recording）声明 | 无（只请求麦克风=语音助手、通知） |
| enterprise 批量桌面控制 | 无 |

**"computer" 的边界 = 标签页**：ComputerBatch 动作面（点击/输入/滚动/拖拽/按键）全部经 chrome.debugger CDP 落在标签页内。文件下载、原生 select、JS 对话框、文件选择器（`Page.setInterceptFileChooserDialog`）是它触达"浏览器外世界"的最远处。

## 界定：为什么仍算 CU 玩家

Comet 的产品话术（autopilot 操作网页）与本仓 12 家的 CU 同构——**观察（截图+结构化快照）→ 决策（云模型）→ 动作（合成输入）→ 回读**。差异只在动作落点：

| 维度 | 传统 CU（Cursor/Claude/ZCode） | Comet |
|---|---|---|
| 动作域 | 整机桌面/任意 app | 浏览器标签页 |
| 输入注入 | CGEvent/HID 真实事件 | CDP Input 合成事件（不占真实光标键盘） |
| 权限模型 | TCC 双权限 + 租约 | 域名黑白名单 + Pause/Take control |
| 登录态 | 需逐站授权/cookie 导入 | 天然复用用户 profile |

## 执行链工具面（本地恢复）

**云端→浏览器工具调用**（CALL_TOOL，工具类在 comet-agent service worker）：

| 工具 | 语义 |
|---|---|
| GetContent | 指定页面→markdown+og_meta+商品数据；URL 黑名单门禁 |
| SearchBrowser | 开着标签/最近关闭/历史记录/标签组全文检索（个人搜索，pref 默认开） |
| OpenTab/CloseTabs/GroupTabs/UngroupTabs/SearchTabGroups | 标签页编排 |
| GetVisibleTabScreenshot | 当前标签截图 |
| GetSidecarContext | sidecar 当前页上下文 |
| ComputerBatch | 上述 CU 动作批量执行（10 动作） |

**叠加层（overlay）即运行状态机**：agent 工作时注入全页渐变边框 + 状态标签（31 条 i18n：Clicking/Typing/Reading page/Filling form/Taking screenshot…）+ Pause/Resume + **Take control** 按钮；同时 `events.js` 以 capture 阶段 `stopImmediatePropagation` **封锁人类输入**，防干预也防抢夺。

## 安全模型

| 门 | 机制 |
|---|---|
| 指令来源 | externally_connectable 仅 perplexity.ai 系域可发 START_AGENT/命令 |
| URL 黑名单 | 内部页（chrome:///comet:///扩展页）恒禁；file:// 仅限文档/媒体扩展名；企业 policy `BlockedDomains`（managed storage，子域匹配，未登录可凭 OrganizationUUID 拉取）；用户/系统 blacklist pref |
| 会话急停 | 标签组被关闭→强制 terminate；WS 关闭码 4004→停；云端 perplexity_terminate |
| 下载 | 下载事件回传云端（downloadWillBegin/Progress），云端可 cancelDownload；无本地静默落盘策略 |
| JS 对话框 | 任务中 **自动接受**（accept:true）——效率优先，无人工确认 |

**两处负发现**（静态证据边界内）：未发现逐动作确认对话框（对比 Claude/Cursor 的批量授权弹窗）；未发现页面内容上传前的密码字段脱敏（二进制里的 MASK 逻辑属 Datadog RUM 遥测脱敏，非 agent 观察管线）。

## 与 12 家 CU 对照一句话

> 12 家把 CU 做成「Agent 的手伸向桌面」；Comet 做成「人住在浏览器里，浏览器就是电脑」——动作域换来了天然登录态与零 TCC，代价是永远出不了浏览器边界。
