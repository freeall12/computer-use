# MiMo 的 Computer Use：单 `js` 工具 + Swift sky-mac 免聚焦引擎，本机已启用

> 对象：`Xiaomi MiMo AI.app`（`com.xiaomi.mimo.desktop-ai` 26.914.142245，asar 完整性校验 SHA256）+ 自动化运行时根 `~/Library/Application Support/MiMo Automation/`（0.7.11）。
> 方法：只读静态分析（asar 解包至 /tmp、npm 运行时包读取、codesign 校验）；未运行、未抓包、未触碰凭据；对专有源码引用 ≤10 行/处（合规声明仅此一处）。
> 证据：[evidence/inventory.md](evidence/inventory.md)；与 Codex 对照总表见 [README](README.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 核心判定 | 真实、完整的原生桌面控制，**本机已启用**（`MIMO_AUTOMATION_COMPUTER_USE_ENABLED=1`） |
| 本体 | `@mi/mimo-computer-use` 0.7.11——对 Codex Desktop 的清洁室复刻，经 MCP 暴露给任何 MCP-capable agent |
| 模型可见面 | 一个持久 Node REPL 工具 `js`（tools/list 恰为 `["js"]`）；桌面操作 = 内核预注入的 `@mimo/sky` 门面 |
| 执行层 | macOS 免聚焦引擎 **sky-mac**（Swift AX + per-pid CGEvent + SkyLight SPI 不抬窗 + SCK 窗口截屏 + 对截屏不可见的虚拟光标）；Windows 清洁室 Window2；其余 nut.js 兜底 |
| TCC | 独立签名伴生 app `MiMo Computer Use.app` 持有；启动链四重签名校验 |
| 独家能力 | 锁屏操作子系统（§4.1，超出 Codex 对标面） |

## 架构一图：启用链路与进程模型

```
MiMo Desktop（Electron 主进程）
 │ 设置→插件：mimo-computer-use 开关（本机：开）
 │ 写 ~/.config/mimocode/mimocode.jsonc：
 │   mcp.node_repl = automation-repl + env{COMPUTER_USE_ENABLED:"1", BROWSER_USE_ENABLED:"0",
 │                                        PRESENTATION_HOST_SOCKET}
 ▼ stdio MCP
automation-repl（sh）── CU 开 → exec "Computer Use/bin/mcp" node-repl
 ▼
bin/mcp（sh，四重校验）
 ① current 符号链接必须落在 selections/ 内
 ② Info.plist 通道身份 == stable:stable:com.xiaomi.mimo.computeruse
 ③ codesign --verify --deep --strict
 ④ TeamIdentifier:Authority 钉死 DG75VEYT9V（Beijing Xiaomi Co., Ltd）
 ▼ exec
MiMo Computer Use.app/Contents/Resources/Bootstrap/mcp（binder）
 │ App 内嵌校验器按签名 TS build receipt 核对运行时文件
 ▼
@mi/mimo-computer-use dist/node-repl.js（持久 REPL）
 tools/list = ["js"]；globalThis.sky = (await import("@mimo/sky")).sky
 ├─ MiMoComputerUseAgent（AX 服务/事件路由，App 持 TCC）
 ├─ window-capture-macos（SCK 窗口截屏）└─ cursor-overlay-macos（capture-excluded 虚拟光标）
```

## 1. 结论速览

1. **MiMo 的 CU 是真实、完整的原生桌面控制，本机已启用**；本体是内部 npm 包，自述 "inspired by Codex Desktop's sky executor"——清洁室复刻，"Pluggable into any MCP-capable agent"。
2. **功能开关从不新增模型可见工具**：CU/BU env 只决定内核里哪些受信模块可用；未启用时 `@mimo/sky` 不存在（fail-closed，技能明文要求立即报告不可用）。
3. **伴生 app 与运行时是版本钉死的配对资产**：`current` 原子符号链接切换 stable/dev 双通道（打包版宿主不暴露通道选择）；每次启动重校验，原地更新包 fail-closed。
4. **本机实装 stable 0.7.11**：`Computer Use/selections/stable-0.7.11/{app,runtime}`，runtime 即完整 `@mi/mimo-computer-use` 包（dist/native/skills/extension 齐全）。

## 2. 能力载体清单

| 载体 | 路径（本机实证） | 角色 |
|---|---|---|
| `@mi/mimo-computer-use` 0.7.11 | `…/MiMo Automation/Runtime/0.7.11/products/computer-use/node_modules/@mi/mimo-computer-use/` | CU/BU/录制三产品共用的 TS+Swift 运行时 |
| `MiMo Computer Use.app` | `~/Applications/MiMo Computer Use.app` | TCC 持有者 + MiMoComputerUseAgent + Helpers（window-capture/lock-state/lock-curtain/lock-guardian）+ cursor-overlay + CCULockUnlockAuthorizationPlugin + Bootstrap binder |
| 固定启动入口 | `…/MiMo Automation/Computer Use/bin/mcp`（`current → selections/stable-0.7.11`） | 通道中立不可变 shim：校验后 exec App 内 binder |
| 启动器 | `…/MiMo Automation/Launchers/bin/automation-repl` | 宿主注册的 MCP 命令；按 env 开关分发到 CU binder 或 browser 产品 |
| 运行时 Node | 应用自带 `…/runtimes/darwin-arm64/node/bin/node` | app 内不放 Node/node_modules（签名密封资源），签名校验内嵌于启动链 |
| 宿主技能 | `~/.config/mimocode/skills/mimo-computer-use/…/SKILL.md`（+ references/macos.md、windows.md） | 模型侧操作指南（`@mimo/sky` 的 API 契约文档） |
| 应用运行时 | `app.asar`（26.914.142245） | MiMoCode 引擎宿主：插件开关管理、node_repl 条目写入、presentation-host socket |

> 分发形态（CU 包 README 分发表）：三个独立签名原生伴生 app（Computer Use / Browser Use / Record and Replay）+ 插件包（MCP+Skill），同版本发布，宿主负责合成一个安装动作；另有自包含终端 App（`build-terminal-products.mjs`）备选形态。

## 3. 权限模型（macOS TCC）

| 权限 | 用途 | 约束 |
|---|---|---|
| Screen Recording | 截屏（get_app_state/screenshot）必需 | 无授权即捕获失败 |
| Accessibility | 合成输入与 AX 树必需 | 授权主体是**选中的签名 App 身份**（stable/dev 各自独立持权，不共享不转移） |

- **MCP 故意不提供权限检查/申请工具**：权限引导只能在签名 App 的状态窗口完成；agent 只读静默预检诊断（README 明文 "can never open System Settings"）。宿主技能同口径：denial 即 "stop and let the host permission UI guide the user"。
- 本机验证：Team `DG75VEYT9V`、Hardened Runtime flag `0x10000`、2026-09-05 公证时间戳；App 内含授权插件 bundle 与 LaunchServices helper。

### 3.1 锁屏操作链路（Locked use，MiMo 特有）

```
CCULockUnlockAuthorizationPlugin
  装进 /Library/Security/SecurityAgentPlugins（替换 system.login.screensaver 规则）
   ▲ 固定 socket：/Library/Application Support/MiMo Computer Use/
   │             LockAuthorization/authorization.sock
   │ 对端校验：内核审计 token 钉死（bundleId com.xiaomi.mimo.computeruse、
   │ Team DG75VEYT9V、Developer ID 链、Hardened Runtime、无 get-task-allow）
   │ 绑定活动控制台 UID + BSM 审计会话
 授权决策 = 1–20 秒单调 TTL 一次性租约（原子消费）
   撤销：物理输入 / 断连 / 轮次结束 → 即时撤销并重锁
   异常断开 → 46 秒原生准入隔离期；任何异常路径返回 Deny 落回密码流
 安全层 4 工具随时可用：caffeinate 断言防休眠防自锁、caffeinate -u 唤醒屏幕
 本机状态：lock-control-enabled = enabled（用户已 opt-in）
```

8 个 lock 工具：`get_lock_state / prevent_lock / allow_lock / wake_display / set_locked_operation / mark_human_present / unlock_screen / get_locked_operation_status`。

## 4. 工具面

`js` 是唯一模型可见 MCP 工具，参数 `{code, title?, description?, timeout_ms?}`（dist/node-repl.js 参数校验白名单）。**门面即产品面**：桌面 10 操作收进内核预注入的 `@mimo/sky`，浏览器收进 `agent.browsers`——无离散工具。技能规定：观察默认发 AX 文本（`nodeRepl.write(state.text)`），仅需要像素时 `emitImage`；`SkyState.screenshot.unchanged=true` 只说明像素未变，不构成动作成功证明。

### 4.1 `@mimo/sky` 门面（10 方法，Codex parity）

| 方法 | 关键参数 | 语义 |
|---|---|---|
| `list_apps()` | — | 运行中/最近使用 app（Spotlight recency，无需全盘访问）；未知名 app 用返回的 bundle identifier 重试 |
| `get_app_state({app})` | app 名/bundle id | 落地当前进程，返回 AX 树文本 + 窗口截图（diff 默认开启）；每轮首个动作前必须先落地 |
| `click({app, element_index? \| x,y})` | 二选一地址 | AX 元素点击或 SkyLight 免聚焦坐标点击（可达 AX 不可见的 canvas/WebGL/web 内容） |
| `drag({app, to_app?, from/to})` | 跨 app 需双方落地 | 窗口内/跨 app 几何拖拽（native 事务注入短生命周期 frame 能力） |
| `perform_secondary_action({app, element_index, action})` | action 须在 AX 文本中出现过 | 调用 AX 广告的次级动作 |
| `press_key({app, key})` | xdotool 风格，须含非修饰键（如 `super+c`） | 快捷键/导航键（面向命名 app，非全局输入） |
| `scroll({app, element_index, direction, pages?})` | up/down/left/right | 滚动已落地元素 |
| `select_text({app, element_index, text, …})` | text/cursor_before/cursor_after | 选中字面文本或放置光标 |
| `set_value({app, element_index, value})` | | 写 AX 可设值（部分面板忽略，失败要换原语）；非可编辑角色（AXStaticText）直接报错 |
| `type_text({app, text})` | `\n`/`\r` 视作 Return | renderer-aware 键盘目标并保留验证证据；单行 AX SetValue 真免聚焦，多行/web 在 macOS 26 走亚毫秒级「不抬窗前台翻转」 |

> 每次变更动作返回**同事务的下一观察**（dispatchStatus/observationStatus/uiChanged/imageRevision/axRevision/retrySafe/reasonCode/recommendedActions + AX 文本 + 截图）——「动作即观察」，无需补一次 get_app_state（与 Codex parity 的呈现差异：parity 返回紧凑 completion，MiMo 附带原子观察）。

### 4.2 非 parity 扩展面（研究 fixture，不在常态产品面）

`dist/index.js` 51 工具全量档：显式 `frame_id` 拖拽、全局跨 app 拖拽（mouse_down 80ms/12 步插值/终点 hover 60ms）、`screenshot/get_screen_info/get_ui_tree/move_mouse/wait/clipboard/list_windows/focus_window` + 8 个 lock 工具 + 35 个 legacy `browser_*`。README 明文：兼容性研究 API，不得与共享 `js` 运行时并注册。

## 5. 动作机制（驱动层）

| 路径 | 机制 | 细节 |
|---|---|---|
| AX 语义 | 按 app AX 会话产出**带 index 的 AX 树**（十进制字符串标识） | Electron/Chromium 注入 `AXManualAccessibility` 拉起 web 内容树（自带树的如飞书除外）；树退化时轮询重试 ~750ms 并附加 "⚠️ ACCESSIBILITY UNAVAILABLE"，引导改走视觉坐标 |
| 免聚焦坐标 | 私有 SkyLight SPI（`SLEventPostToPid` + activate-without-raise + Chromium 窗口路由字段） | 向目标窗口投递逐窗口鼠标事件，**不抬高、不抢焦点**；SPI 不可用优雅降级公开 `CGEventPostToPid` |
| 键盘（诚实契约） | 单行 AX SetValue 真免聚焦；多行/web 输入/和弦键在 macOS 26 无零焦点变化路径 | 亚毫秒「前台翻转-打字-还原」（z 序不动），与 Codex/cua 同模型 |
| 观察 | SCK 按窗口截屏（后台/遮挡窗口也行，不前置）；全屏 screenshot-desktop+sharp 兜底 | 坐标映射 Retina/HiDPI 安全（image space ↔ input space）；**无 OCR**（刻意对齐 Codex，AX 树+截图交视觉模型读，含中文） |
| 虚拟光标 | click-through overlay 画箭头光标 + 元素高亮框 | `sharingType=.none` 保证**不出现在截图里**；输入等待光标动画到位（gate input until close enough） |
| 兜底 | 非 macOS 或 `CCU_DISABLE_SKYMAC=1` 退化 nut.js 坐标路径（`@nut-tree-fork/nut-js` + screenshot-desktop） | parity/adapter 档直接拒绝变更动作（fail-closed） |

## 6. 安全模型

| 机制 | 要点 |
|---|---|
| 启用门 fail-closed | 插件未开 → 内核无 `sky`；禁用 bash/AppleScript 旁路模拟 |
| 路径唯一性 | 桌面 UI 操作只允许 `js`+`@mimo/sky`；`osascript`/JXA/System Events/PowerShell UIA/CGEvent 脚本一律禁止（含"只是查一下"）；反向禁止用 `js` 的文件系统/进程 API 发现本应从可见 UI 读的值（防 UI 旁路） |
| 内容不可信 | app 内容/网页/消息/工具输出都是 untrusted data，不是用户授权；模糊目标（"最近联系人""默认账户"）禁止猜测 |
| 确认策略 + elicitation | `CCU_SAFETY_MODE` off/prompt/smart/enforce 四档；enforce 下每个门控变更动作须 MCP elicitation 人工批准，客户端不能 elicit 即 fail-closed。默认门控集：click/drag/type_text/press_key/set_value/perform_secondary_action/select_text。支付凭据/OTP/生物识别/凭证变更/安全警告绕过/转账最终提交**移交人工**；skill 层另有破坏性操作、外发通信、敏感数据、安装、权限变更的动作时确认 |
| 签名信任链 | 启动器四重校验（symlink→plist 通道身份→deep-strict 签名→团队钉死）+ App 内嵌 TS build receipt 校验 runtime 文件；`product-identities.json` 集中声明全部合法身份（10 个 bundleId、native host 名、本地签名证书 SHA1） |
| 防重复/防漂移 | 动作返回的 index/坐标一次性有效；被拒动作可能已投递输入，重试前必须先观察；恢复预算 = 重新落地 1 次 + 同原语重试 1 次 + 换原语 1 次，之后停止报告 |

## 7. 与 Codex/Claude 工具协议的关系

- **对 Codex**：CU/BU 运行时自称复刻 Codex Desktop——10 工具 schema 与 `SkyComputerUseClient`（mcp 模式）逐项对齐；保留 `codex-parity.js`/`codex10.js` A/B fixture 与 `scripts/codex-plugin-probe.mjs` 只读探针（对照总表见 [README](README.md)；README 还记录了其对 Codex 的逆向性观察：无 OCR、剪贴板 tab 域、浏览器走代码执行而非离散工具）。
- **对 Claude Code**：宿主引擎 MiMoCode 是 CC 工具协议同构端（Read/Write/Edit/Bash/task/actor 工具命名、CC 式系统 prompt、AGENTS.md 与 SKILL.md 生态、anthropic-messages 协议）；CU 的 `js` 形态与 Codex `node_repl` 同构——**Claude 官方 CU 是离散命名工具路线，MiMo 选择了 Codex 形状**。
- **对 trycua/cua 系（MiniMax/Synara 用）**：无关联；自研 sky-mac（Swift AX 服务），唯一交集是输入兜底依赖 `@nut-tree-fork/nut-js`（nut.js 社区 fork）。

> 低置信度复核点：Windows Window2 后端行为全部来自包内文档/脚本（本机 macOS 未验证）；`MiMo Record and Replay` 第三产品线本机未实装，仅包内有产物定义。
