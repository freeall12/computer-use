# Xiaomi MiMo — Computer Use（原生桌面控制）完整逆向

> 分析对象：`/Applications/Xiaomi MiMo AI.app`（`com.xiaomi.mimo.desktop-ai`，版本 26.914.142245，Electron，asar 完整性校验 SHA256）+ 其自动化运行时根 `~/Library/Application Support/MiMo Automation/`。
> 分析日期：2026-10-06。方法：只读静态分析（asar 解包至 /tmp、npm 运行时包与配置读取、codesign 校验），未运行被分析对象、未抓包、未触碰凭据。对专有源码仅做不超过 10 行/处的引用并标注路径。

## 1. 结论速览

1. **MiMo 的 Computer Use 是真实、完整的原生桌面控制能力，本机已启用**（`MIMO_AUTOMATION_COMPUTER_USE_ENABLED=1`）。本体是 npm 包 **`@mi/mimo-computer-use` 0.7.11**（小米内部 registry `pkgs.d.xiaomi.net`，restricted），package.json 自述为「Cross-platform computer-use MCP server … **inspired by Codex Desktop's sky executor**」——即对 **OpenAI Codex Desktop computer use 的清洁室复刻**，经 MCP 暴露给「任何具备 MCP 能力的 agent（Claude Desktop、Codex、Cursor、MimoCode…）」。
2. 产品面是 **一个持久 Node REPL MCP 工具 `js`**（`tools/list` 恰为 `["js"]`）：桌面控制的 10 个操作全部收进内核预注入的 **`@mimo/sky` 门面**（`sky.click/drag/type_text/…`），浏览器控制收进 **`@mimo/browser-use` 的 `agent.browsers`**。CU 与 BU 共享同一内核、同一工具；没有独立的 `computer_*` 离散工具（那是研究用 A/B fixture）。
3. 底层执行是 **macOS 免聚焦原生引擎 "sky-mac"**（Swift AX 服务 + per-pid CGEvent + SkyLight 私有 SPI 坐标点击不抬窗 + ScreenCaptureKit 窗口级截屏 + 对截屏不可见的虚拟光标 overlay），Windows 走清洁室 Window2 后端（UIA + SendInput），非 mac 平台退化到 nut.js 坐标路径。
4. TCC 权限由独立签名伴生 app **`MiMo Computer Use.app`**（`com.xiaomi.mimo.computeruse`，Developer ID `Beijing Xiaomi Co., Ltd (DG75VEYT9V)`，Hardened Runtime + 公证）持有；MCP 启动器做代码签名/团队/通道四重校验后才 exec。另有独家的**锁屏操作**子系统（SecurityAgentPlugins 授权插件 + 审计 token 钉死 socket + 1–20 秒一次性授权租约）。
5. 宿主（MiMo Desktop / MiMoCode 引擎）以官方插件开关驱动：主进程把 `node_repl` MCP 条目写入 `~/.config/mimocode/mimocode.jsonc`，环境变量决定 CU/BU 各自是否注入内核；未启用时 `@mimo/sky` 不存在（fail-closed，技能明文要求立即报告不可用）。

## 2. 能力载体清单

| 载体 | 路径（本机实证） | 角色 |
| --- | --- | --- |
| `@mi/mimo-computer-use` 0.7.11 | `~/Library/Application Support/MiMo Automation/Runtime/0.7.11/products/computer-use/node_modules/@mi/mimo-computer-use/` | CU/BU/录制三产品共用的 TS+Swift 运行时（MCP server + 原生 helper 打包体） |
| `MiMo Computer Use.app` | `~/Applications/MiMo Computer Use.app`（`Computer Use/selections/stable-0.7.11/app` 的同体安装） | 原生伴生 app：TCC 持有者 + MiMoComputerUseAgent（AX/CGEvent 服务）+ Helpers（window-capture/lock-state/lock-curtain/lock-guardian）+ cursor-overlay + CCULockUnlockAuthorizationPlugin + Bootstrap binder |
| 固定启动入口 | `~/Library/Application Support/MiMo Automation/Computer Use/bin/mcp`（`current -> selections/stable-0.7.11`） | 通道中立的不可变 shim：校验后 exec `app/Contents/Resources/Bootstrap/mcp` |
| 启动器 | `~/Library/Application Support/MiMo Automation/Launchers/bin/automation-repl` | 宿主注册的 MCP 命令；按 env 开关分发到 CU binder 或 browser 产品 |
| 运行时 Node | `/Applications/Xiaomi MiMo AI.app/Contents/Resources/runtimes/darwin-arm64/node/bin/node` | 应用自带的 Node（Computer Use/node-path 记录其路径） |
| 宿主技能 | `~/.config/mimocode/skills/mimo-computer-use/mimo-computer-use/SKILL.md`（+ references/macos.md、windows.md） | 模型侧操作指南（即 `@mimo/sky` 的 API 契约文档） |
| 应用运行时 | `app.asar`（`com.xiaomi.mimo.desktop-ai` 26.914.142245） | MiMoCode 引擎宿主：插件开关管理、node_repl 条目写入、presentation-host socket |

产品分发形态（CU 包 README 分发表）：三个独立签名原生伴生 app（Computer Use / Browser Use / Record and Replay）+ 插件包（MCP+Skill），同版本发布，宿主负责把「app + plugin」合成一个安装动作；另有自包含终端 App（`build-terminal-products.mjs`）备选形态。app 内不放 Node/node_modules（签名密封资源），签名校验内嵌于启动链。

## 3. 启用链路与进程模型

```
MiMo Desktop（Electron 主进程, com.xiaomi.mimo.desktop-ai）
  │  设置→插件: mimo-computer-use 开关（本机: 开）
  │  写 ~/.config/mimocode/mimocode.jsonc:
  │    mcp.node_repl = { command: ["…/MiMo Automation/Launchers/bin/automation-repl"],
  │                      environment: { MIMO_AUTOMATION_COMPUTER_USE_ENABLED: "1",
  │                                     MIMO_AUTOMATION_BROWSER_USE_ENABLED: "0",
  │                                     MIMO_PRESENTATION_HOST_SOCKET: "…/presentation-host/control.sock" } }
  ▼  stdio MCP
automation-repl（sh）
  │  CU 开 → exec "Computer Use/bin/mcp" node-repl
  ▼
bin/mcp（sh，四重校验）
  │  ① current 符号链接必须落在 selections/ 内
  │  ② 读取选中 app 的 Info.plist：channel:namespace:bundleId == stable:stable:com.xiaomi.mimo.computeruse
  │  ③ codesign --verify --deep --strict 通过
  │  ④ TeamIdentifier:Authority == "DG75VEYT9V:Developer ID Application: Beijing Xiaomi Co., Ltd (DG75VEYT9V)"
  │  export MIMO_CU_INTERNAL_BOOTSTRAP_ROOT/SELECTION_ROOT、CCU_NODE_PATH、MIMO_ELECTRON_NODE_HOST
  ▼  exec
MiMo Computer Use.app/Contents/Resources/Bootstrap/mcp（binder）
  │  App 内嵌校验器按 App 签名的 TS build receipt 核对所选 runtime 文件后放行
  ▼
@mi/mimo-computer-use dist/node-repl.js（持久 Node REPL MCP server）
  │  tools/list = ["js"]
  │  内核预注入: globalThis.sky = (await import("@mimo/sky")).sky
  ▼
js 单元内的 sky-mac 事务（每次动作为一次原生事务）
  ├─ MiMoComputerUseAgent（AX 服务/事件路由，App 进程持有 TCC）
  ├─ window-capture-macos（ScreenCaptureKit 窗口截屏）
  └─ cursor-overlay-macos（capture-excluded 虚拟光标）
```

要点：

- **模型永远只见一个 `js` 工具**。功能开关（CU/BU env）只决定内核里哪些受信模块可用，从不新增模型可见工具（CU 包 README「MCP entry point」节明文）。
- 伴生 app 与运行时是**版本钉死的配对资产**，`current` 原子符号链接切换；每次启动重校验，原地更新包会 fail-closed。稳定/开发双通道（`com.xiaomi.mimo.computeruse(.dev)`）仅开发者可见，打包版宿主不暴露通道选择。
- 本机实装为 stable 0.7.11：`Computer Use/selections/stable-0.7.11/{app,runtime}`，`runtime` 即完整的 `@mi/mimo-computer-use` 包（dist/native/skills/extension 齐全）。

## 4. 权限模型（macOS TCC）

- **Screen Recording**：截屏必需（`get_app_state`/`screenshot`），无授权即捕获失败。
- **Accessibility**：合成输入与 AX 树必需。
- 授权主体是**选中的签名 App 身份**（不是宿主、不是 Node、不是终端）：stable 与 dev 各自独立持权，不共享、不转移。MCP 故意**不提供**权限检查/申请工具——权限引导在 App 的状态窗口里完成，agent 只读静默预检诊断（README「Permissions & configuration」节明文：「normal operation reads only the selected App's silent preflight diagnostics and can never open System Settings」）。宿主技能同口径：「Accessibility or screen-recording denial is a host prerequisite: stop and let the host permission UI guide the user」。
- 本机验证：`~/Applications/MiMo Computer Use.app` 签名 Team `DG75VEYT9V`、Hardened Runtime flag `0x10000`、2026-09-05 公证时间戳；App 内含授权插件 bundle 与 LaunchServices helper。

### 4.1 锁屏操作（Locked use，MiMo 特有加强）

这是 MiMo 运行时超出 Codex 对标面的部分（8 个 lock 工具：`get_lock_state/prevent_lock/allow_lock/wake_display/set_locked_operation/mark_human_present/unlock_screen/get_locked_operation_status`）：

- 安全层（前 4 个）随时可用：caffeinate 断言防休眠防自锁、`caffeinate -u` 唤醒屏幕。
- 自动解锁是**可选、显式 opt-in** 的系统能力：`CCULockUnlockAuthorizationPlugin`（装进 `/Library/Security/SecurityAgentPlugins`，替换 `system.login.screensaver` 规则）连接固定 socket `/Library/Application Support/MiMo Computer Use/LockAuthorization/authorization.sock`；授权决策只存在于签名 App 内，App 校验对端**内核审计 token**（bundleId `com.xiaomi.mimo.computeruse`、Team `DG75VEYT9V`、Developer ID 链、Hardened Runtime、无 `get-task-allow`），并绑定活动控制台 UID 与 BSM 审计会话。
- 决策为 1–20 秒单调 TTL 的**一次性租约**（原子消费），物理输入/断连/轮次结束即撤销并重锁；异常断开触发 46 秒原生准入隔离期。本机 `~/Library/Application Support/MiMo Computer Use/lock-control-enabled` 内容为 `enabled`——用户已开启此能力。

## 5. 工具面

### 5.1 模型可见面：`js`（唯一）

MCP 工具参数恰好 `{code, title?, description?, timeout_ms?}`（dist/node-repl.js 参数校验白名单）。内核全局：`sky`（桌面）、`agent`/`browserAgent`（浏览器）、`nodeRepl`（`write(value)` 文本 / `emitImage(...)` 像素）。技能规定：观察默认发 AX 文本（`nodeRepl.write(state.text)`），仅在需要像素时 emitImage；`SkyState.screenshot.unchanged=true` 只说明像素未变，不构成动作成功证明。

### 5.2 `@mimo/sky` 门面（10 方法，Codex parity）

| 方法 | 关键参数 | 语义 |
| --- | --- | --- |
| `list_apps()` | — | 运行中/最近使用 app（Spotlight recency，无需全盘访问）；未知名 app 用返回的 bundle identifier 重试 |
| `get_app_state({app, disableDiff?})` | app 名/bundle id | 落地当前进程，返回 AX 树文本 + 窗口截图（diff 默认开启）；每轮首个动作前必须先落地 |
| `click({app, element_index? | x,y, mouse_button?, click_count?})` | 二选一地址 | AX 元素点击或 SkyLight 免聚焦坐标点击（可达 AX 不可见的 canvas/WebGL/Chromium web 内容） |
| `drag({app, to_app?, from_x, from_y, to_x, to_y})` | 跨 app 需先双方落地 | 窗口内/跨 app 几何拖拽（native 事务注入短生命周期 frame 能力） |
| `perform_secondary_action({app, element_index, action})` | action 必须在 AX 文本中出现过 | 调用 AX 广告的次级动作 |
| `press_key({app, key})` | xdotool 风格，必须含非修饰键（如 `super+c`） | 快捷键/导航键（面向命名 app，非全局输入） |
| `scroll({app, element_index, direction, pages?})` | direction: up/down/left/right | 滚动已落地元素 |
| `select_text({app, element_index, text, prefix?, suffix?, selection_type?})` | text/cursor_before/cursor_after | 选中字面文本或放置光标 |
| `set_value({app, element_index, value})` | | 写 AX 可设值（部分面板忽略；失败要换原语）；非可编辑角色（AXStaticText）直接报错 |
| `type_text({app, text})` | `\n`/`\r` 视作 Return 键 | 经「renderer-aware 键盘目标」输入并保留验证证据；单行 AX SetValue 真免聚焦，多行/web 输入在 macOS 26 走亚毫秒级「不抬窗前台翻转」 |

每次变更动作返回**同事务的下一观察**（action.dispatchStatus/observationStatus/uiChanged/imageRevision/axRevision/retrySafe/reasonCode/recommendedActions + AX 文本 + 截图）——「动作即观察」，模型无需再补一次 get_app_state（这是 MiMo adapter 与 Codex parity 的呈现差异：parity 返回紧凑 completion，MiMo 附带原子观察）。

### 5.3 非 parity 扩展面（51 工具全量档，`dist/index.js`，研究 fixture，不在常态产品面）

`click/drag` 带 `frame_id` 显式帧能力、全局跨 app 拖拽（mouse_down 80ms/12 步 144ms 插值/终点 hover 60ms）、`screenshot/get_screen_info/get_ui_tree/move_mouse/wait/get_clipboard/set_clipboard/list_windows/get_active_window/focus_window` + 8 个 lock 工具 + 22/13 个 legacy `browser_*`。README 明文：这些是兼容性研究 API，不得与共享 `js` 运行时并注册。

## 6. 动作机制（驱动层）

1. **AX 语义路径**：sky-mac 建立按 app 的 AX 会话，产出**带 index 的 AX 树**（元素标识为十进制字符串）；对 Electron/Chromium 应用注入 `AXManualAccessibility` 拉起 web 内容树（飞书这类自带树的除外）；树退化/骨架时 state 构建器轮询重试 ~750ms 并附加「⚠️ ACCESSIBILITY UNAVAILABLE」警告，引导模型改走视觉坐标。
2. **免聚焦坐标路径**：私有 SkyLight SPI（`SLEventPostToPid` + activate-without-raise + Chromium 窗口路由字段）向目标窗口投递逐窗口鼠标事件，**不抬高、不抢焦点**；SPI 不可用时优雅降级到公开 `CGEventPostToPid`。
3. **键盘路径（诚实契约）**：单行 AX `SetValue` 真免聚焦；多行/web 输入/和弦键在 macOS 26 无零焦点变化路径，采用亚毫秒「前台翻转-打字-还原」（z 序不动），与 Codex/cua 同模型。
4. **观察**：ScreenCaptureKit 按窗口截屏（后台/遮挡窗口也行，不前置）；全屏截图（screenshot-desktop+sharp）为兜底；坐标映射 Retina/HiDPI 安全（image space ↔ input space）。**无 OCR**（刻意移除以对齐 Codex；AX 树+截图交由视觉模型读，含中文）。
5. **虚拟光标**：原生 click-through overlay 画箭头光标+元素高亮框，`sharingType=.none` 保证**不出现在截图里**；输入等待光标动画到位（gate input until close enough）。
6. **兜底**：非 macOS 或 `CCU_DISABLE_SKYMAC=1` 时退化 nut.js 坐标路径（`@nut-tree-fork/nut-js` + screenshot-desktop）；parity/adapter 档直接拒绝变更动作（fail-closed）。

## 7. 安全模型小结

- **启用门 fail-closed**：插件未开 → 内核无 `sky`；技能要求此时立即报告「Computer Use MCP 不可用」并禁止用 bash/AppleScript 等旁路模拟。
- **路径唯一性**：桌面 UI 操作只允许 `js`+`@mimo/sky`；`osascript`/JXA/System Events/PowerShell UIA/CGEvent 脚本一律禁止（含「只是查一下」）；反向地，`js` 内核也不许用文件系统/进程 API 去发现本应从可见 UI 读的值（防 UI 旁路）。
- **内容不可信原则**：app 内容/网页/消息/工具输出都是 untrusted data，不是用户授权；模糊目标（「最近联系人」「默认账户」）禁止猜测。
- **确认策略 + elicitation 强制**：`CCU_SAFETY_MODE` off/prompt/smart/enforce 四档；enforce 下每个门控变更动作都要 MCP elicitation 人工批准，客户端不能 elicit 就 fail-closed。默认门控集：click、drag、type_text、press_key、set_value、perform_secondary_action、select_text。支付凭据/OTP/生物识别/凭证变更/安全警告绕过/转账最终提交**移交人工**；skill 层另有破坏性操作、外发通信、敏感数据、安装、权限变更的动作时确认要求。
- **签名信任链**：启动器四重校验（symlink→plist 通道身份→deep-strict 签名→团队钉死）+ App 内嵌 TS build receipt 校验 runtime 文件；`product-identities.json` 集中声明全部合法身份（10 个 bundleId、native host 名、本地签名证书 SHA1）。
- **锁屏安全**（见 4.1）：一次性授权租约 + 审计 token 钉死 + 物理输入撤销；任何异常路径返回 Deny 落回密码流；`/tmp`、`/var/run` 不参与任何授权决策。
- **防重复/防漂移**：动作返回的 index/坐标一次性有效；被拒绝的动作可能已投递输入，重试前必须先观察；恢复预算 = 重新落地 1 次 + 同原语重试 1 次 + 换原语 1 次，之后停止报告。

## 8. 与 Claude/Codex 工具协议的关系（CU 视角）

- **对 Codex**：CU/BU 运行时自称是 Codex Desktop computer use 的复刻——10 工具名与 schema 与 Codex `SkyComputerUseClient`（其 `mcp` 模式）逐项对齐；保留 `codex-parity.js`/`codex10.js` 两个 A/B fixture 与 `scripts/codex-plugin-probe.mjs` 只读探针，把本机 Codex 安装当只读基线对照（README 还给出了对 Codex 的逆向性观察：无 OCR、剪贴板 tab 域、浏览器走代码执行而非离散工具）。
- **对 Claude Code**：宿主引擎（MiMoCode）是 Claude Code 工具协议同构端——Read/Write/Edit/Bash/task/actor 工具命名、`claude.txt` CC 式系统 prompt、AGENTS.md 与 SKILL.md 生态、anthropic-messages 协议输出。CU 的 `js` 工具形态（持久 REPL + 全局门面）与 Codex 的 `node_repl` 同构，而 Claude 官方 CU 是离散命名工具路线——MiMo 选择了 Codex 形状。
- **对 trycua/cua 系（MiniMax/Synara 用）**：无关联。MiMo 没用 cua-driver，自研 sky-mac（Swift AX 服务），唯一交集是输入兜底依赖 `@nut-tree-fork/nut-js`（nut.js 社区 fork）。

> **一句话定位**：小米 MiMo = Claude Code 形状的宿主引擎 + Codex 形状的 CU/BU 运行时，两者以「插件开关 + 单一 `js` MCP 工具 + 签名伴生 app」的方式缝合，是八家分册中把「对标复刻」做得最明示的一家（产品文档自带 vs Codex 逐项比较与差距清单）。

*低置信度复核点：Windows Window2 后端行为全部来自包内文档/脚本（本机 macOS 未验证）；`MiMo Record and Replay` 第三产品线本机未实装，仅包内有产物定义。*
