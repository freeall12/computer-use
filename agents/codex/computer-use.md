# Codex Computer Use（桌面控制）· 一个全局 cua，Swift Sky 执行

> 分析对象：本机 Codex（CLI 0.155.1 + ChatGPT.app 26.930.31730 + Sky CUA 服务）。标注：【实证】/【推断】。证据见 [evidence/inventory.md](evidence/inventory.md)（§编号引用）。

> 一句话结论：**模型经持久 REPL 拿到 `cua` 对象；@oai/sky 客户端走 Unix socket JSON-RPC 把调用交给 Swift 服务 SkyComputerUseService——观察是 AX 树 diff + Skyshot 原子，动作全 Promise<void>，安全靠四层策略而非运行时校验。**

| 项 | 值 |
|---|---|
| 模型可见面 | cua_repl 持久 REPL（工具仅 js/js_reset）；`import("@oai/cua/tinyskyAlt")` → 全局 `cua` |
| 执行链 | @oai/sky → computeruse.sock（JSON-RPC 2.0，4B 长度前缀，≤8MiB）→ SkyComputerUseService（Swift） |
| 主观察 | AX 树自动 diff（带行数预算）；Skyshot = AX 文本 + 截图一次返回 |
| 主动作 | CGEvent 注入 + 事件 taps；浏览器输入先 250ms 建焦点再发 |
| 启动/激活 | mac 无原语——`startApp`/`getApp` 隐式拉起 |
| 安全模型 | 四层：OS 权限 → 服务端审批（AppApprovalStore）→ 模型策略 prompt → 运行时熔断；+锁屏守护 |
| 错误语义 | 动作失败内嵌**新鲜 AX diff** 引导重新索引（无 possibly_sent 标志） |
| 本机可用 | ✅ 服务已装；策略被用户调低（approval_policy=never） |

## 架构一图

```
模型 ─ MCP stdio → cua_repl（持久 REPL；js_reset 清绑定，不清世界状态）
        │ await import("@oai/cua/tinyskyAlt") → cua（CUA_REPL_ENABLED_SURFACES=browser,computer）
        ▼
@oai/sky 客户端（按平台分派；硬依赖 globalThis.nodeRepl 原生管道）
        │ JSON-RPC 2.0 / Unix socket / 4B 长度前缀；request 带 codexTurnMetadata + deadline
        ▼
SkyComputerUseService（Swift，com.openai.sky.CUAService）
  AX 树 diff（行数预算）· Skyshot（AX+截图+分类器）· ScreenCaptureKit · CGEvent+taps
  AppApprovalStore 审批 · URL 禁区 · 锁屏守护（Guardian XPC）· turn 停止熔断
        ▼ AX API / CGEvent / SCStream
macOS 应用窗口
```

## 载体与版本

| 层 | 组件 | 版本 |
|---|---|---|
| 编程面 | `@oai/cua`（tinyskyAlt globals） | 0.2.5（ZCode 逆向基线 0.2.4，文档面一致） |
| REPL 服务 | `@oai/cua-repl`（MCP server） | 0.1.0 |
| 平台客户端 | `@oai/sky` | 0.7.5 |
| 原生服务 | SkyComputerUseService（Swift 24.5MB） | 与 app 构建 26.930.31730 同期 |
| CLI 侧策略 | codex 二进制内嵌 prompt/schema | 0.155.1 |

## 运行时装配：cua_repl

- 进程 `cua_node/bin/node @oai/cua-repl/bin/cua-repl.mjs`（stdio MCP）；模型可见工具仅 `js`（output_token_limit 25000）/ `js_reset` / `turn_ended`（隐藏宿主回调）。
- 启动横幅就是一行 `await import("@oai/cua/tinyskyAlt")`；import 时读 nodeRepl.env（冻结快照）决定装配哪些 provider。
- `js_reset` 重置的是模型工作内存：「does not close browser tabs or native apps, or erase their state」。
- CLI（npm codex）内嵌 `node_repl_policy` 且插件 ID 表含 `cua_repl`——**CLI 也能挂**，本机未启用【推断：未见实际配置】。

## cua 编程面（tinyskyAlt 还原）

| 对象 | 成员 | 语义 |
|---|---|---|
| `cua` 顶层 | initialize/getState/getApp/listApps/listWindows(linux/win)/rewriteDocumentation + browsers*/computer | `State={apps,browsers,errors}`，清单错误按条目隔离 |
| `Target`（App/Tab 共享） | getAXState/getScreenshot/getAXStateAndScreenshot/click/drag/scroll/selectText/setValue/performSecondaryAction | 元素索引或坐标；ClickOptions{mouseButton,clickCount}；selectText{prefix,suffix,selectionType} |
| `App` 扩展 | paste{format:text\|md\|html} / pressKey（xdotool 风格）/ typeText；mac scroll 收页数 | mac paste 走系统剪贴板并**还原用户原剪贴板**；getApp 可后台拉起 |
| `cua.computer`（sky 逃逸口） | mac：click/drag/get_app_state/list_apps/paste/perform_secondary_action/press_key/scroll/select_text/set_value/type_text + 音频录制×2 | 类型即 `typeof sky`；Linux 额外 activate_window/clipboard_*/launch_app/move/key_down 等——**mac 没有这些** |

> 接口全文（字段名逐字核对自随包文档与 types.d.ts）见 `source/codex/schemas/cua-surface.json`；MCP 工具与策略面见 `source/codex/schemas/mcp-tools.json`。

## 观察：AX diff + Skyshot 原子

**观察以 AX 树为主、截图为辅；每动作后必须重新观察是流程纪律，不是运行时校验。**

- **AX 树自动 diff**：服务端 `axTreeDiffing` 系列符号，删除以 ID 区间表达；有**行数预算**（超限报错，回退策略未见代码【推断】）。
- **Skyshot 是原子观察单元**：AX 文本 + 截图（+分类器组件）打包返回；截屏走 ScreenCaptureKit。
- **自动等待**：观察内置稳定等待，明确禁止模型手动 setTimeout；Linux 有 action_settler（默认 100ms），mac 等价物硬编码【推断】。
- 首次访问返回带应用专属指引前缀；`AXManualAccessibility` 符号表明会对未开 AX 的应用（典型 Electron）触发手工启用。
- 流程纪律：**每动作后必须 getAXState 重新决策**，元素索引禁止复用，screenshot-only 后索引视为失效。

## 动作：CGEvent 注入 + 隐式拉起

| 机制 | 事实 |
|---|---|
| 输入注入 | CGEvent / CGEventTap（拖拽续持、点击监听、滚动观察）+ VirtualCursor |
| 浏览器输入包装 | typeText/paste/pressKey 带 elementIndex：先 **250ms 内建立并验证焦点**再发；失败不发、错误附新鲜 AX diff；null = 用当前焦点不校验 |
| 派发路径 | computeruse.sock；ping 严格校验 serverApiVersion（不匹配硬失败）；每请求带会话/轮次元数据与截止时间；服务未起三级自愈（ensureService → openApplication → 重连） |
| startApp | 一次调用完成「拉起会话 + 抓 key window 状态」，每 assistant turn 一次；把易被滥用的 activate 原语收编进受审批的观察【推断：设计动机】 |

## 安全：四层防线 + 锁屏守护

| 层 | 机制 |
|---|---|
| ① OS 权限 | Accessibility + Screen Recording；未批进重试循环等用户授权；Installer + 系统授权插件安装 |
| ② 目标策略（服务端） | `getAppPolicy`（allowed/denied/forbidden × risk）+ AppApprovalStore 持久化；审批粒度 ALWAYS/ONCE/SESSION/TURN；审批 UI 走 MCP elicitation；配置按 bundle_ids/aumids 白名单 |
| ③ 模型策略（prompt） | Rust 内嵌确认策略四档（Hand-off Required / Always Confirm / Pre-Approval Works / Allowed），风险编号 [1]–[17]；node_repl_policy 动作风险分级；auto-review 反绕过话术 |
| ④ 运行时熔断 | URL 禁区（用户自己导航也终止会话）+ 用户本轮显式停止（下一轮可再用） |
| 锁屏守护（独有） | LockScreenGuardian 独立 app + XPC：锁屏暂停自动化、覆盖层提示、物理输入监测（防人机打架）、锁屏登录授权走独立通道【推断：符号+结构】 |

**策略是弹性的，权限与禁区是硬的**：本机 `approval_policy="never"` + browser 三个 approval_mode 全 `never_ask`——此时只剩服务端禁区与 OS 权限兜底。无 controller lease 符号（并发防冲突靠 turn_ended 回收 + per-turn 停止 + 服务端按 codexTurnMetadata 记账）。

## 与 ZCode 14 工具面的对照

| 维度 | Codex | ZCode |
|---|---|---|
| 暴露形态 | `cua.*` JS 对象（MCP 工具仅 js/js_reset） | 14 方法 `cua.computer` 面 + MCP 工具 |
| 启动/激活 | mac 无原语（startApp 隐式） | open_application 删除，「与 codex 一致」 |
| 错误语义 | Promise<void>，失败内嵌新 diff | ComputerUseError 带 actionSent（possibly_sent 防重放）——**ZCode 自有** |
| 安全原语 | 服务端审批 + URL 禁区 + 锁屏守护 | controller lease / kill switch（自有） |

结论：ZCode 的 stateId/frameId/possibly_sent/lease 在 Codex 原始面**无对应物**，属事故驱动自研加固；完整对照见 [zcode 分册 computer-use.md](../zcode/computer-use.md)。

## 周边能力与本机不可见边界

- 周边：音频录制（单独审批）· computer-history MCP（status/pause/resume/update_settings）· record-and-replay（事件流录制 ≤30 分钟，开始需审批）· turn-ended 通知回调（config.toml `notify`）。
- 不可见边界：SkyComputerUseService 为 Swift 编译产物，动作 RPC 完整 method 表未逐个还原；训练侧（TinySky）与云端执行面不在本机；`relaxed` 构建变体与 normal 的差异未验证【推断：审批门槛更低的内测变体】。
