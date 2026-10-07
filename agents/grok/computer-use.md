# Grok Bot 桌面控制：Cursor 代工的 Swift sidecar，编排下沉进二进制，本机未激活

> 对象：Grok Bot 0.66.0（`/Applications/Grok Bot.app`，Electron 42.1.0）内嵌 `Grok Bot Computer Use.app`（CUGrokBotService 1.0.0）。
> 方法：只读静态逆向（asar 解包至 /tmp、Mach-O strings、Swift 符号表、随包 schema）；未运行、未抓包、未触碰凭据（全文合规声明仅此一处）。
> 证据行号：[evidence/inventory.md](evidence/inventory.md)；谱系五路取证表见 [README](README.md)。

## 30 秒速览卡

| 项 | 值 |
|---|---|
| 核心判定 | 完整原生桌面控制 + Cursor 同源代工；本机门控全关、从未激活 |
| 载体 | `Helpers/Grok Bot Computer Use.app` 1.0.0（LSUIElement，min macOS 14.0，6.3MB universal） |
| CU 工具面 | 16 `computer_*`（MCP catalog 内嵌）+ 14 `computer_use_*`（daemon RPC 面） |
| 控制模型 | companion（app 粒度后台驱动）/ remote（整屏接管，显式升级阀） |
| 坐标基准 | 固定 1280×800 截图画布，单张 1 MiB JPEG 预算 |
| 云端 CU | proto `ComputerUseArgs` 11 动作批量 + `desktop_lease_actor_id` 租约 |

## 架构一图

```
模型侧：云端 agent（computer_use_tool_call #23）／本地 harness（工具来源 "cursor-app-control"）
 │ local-cua 客户端：launch = /usr/bin/open -g；ENOENT/ECONNREFUSED → relaunch+retry
 │ （8s ready 超时、200ms ping 轮询；读 service.json 取 rpcSocketPath）
 ▼ Unix domain socket，行分隔 JSON-RPC（团队白名单 + processLock）
CUGrokBotService（Swift CUCore）
 ├─ CULocalRPCService：ping/initialize/tools/* /control/* /permissions/*
 ├─ CUCompanionToolService：app 粒度 AX 语义 + SCK 单窗截屏
 ├─ CURemoteToolService：整屏 CGEvent/AppKit 注入 + 光标覆盖层
 └─ CUMcpStdioMode：--mcp-stdio --conversation-id，16 工具 catalog 内嵌
 ▼
桌面执行 ｜ 云端：ComputerUseArgs → 远程 VM；noVNC 控制台观看/介入
```

## 1. 能力载体清单

| 载体 | 路径 / 形态 | 角色 |
|---|---|---|
| CU 助手 App | `Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app`（1.0.0） | TCC 权限持有者 + 工具执行者 |
| CU 助手二进制 | `.../MacOS/CUGrokBotService`（Mach-O universal，Swift CUCore） | socket RPC + MCP stdio 服务 |
| JS 客户端 | asar `dist/local-exec-daemon/main.cjs`（local-cua 类） | 连接管理、launch/relaunch、control 会话 |
| 变体配置 | prod/lab/dev 三套（appName/bundleId/appSupportDir/executable 四元组） | 多环境隔离 |
| 侧车分发 | `mac_computer_use_sidecar_manifest.sidecarManifestUrl` → downloads.cursor.com | CDN 签名分发（本机未触发，Helpers 已自带） |
| CU 专用模型 | `sand_computer_use_playwright_config` fallback `modelId:"sand-cua"` | 视觉-动作循环模型（playwright 为历史命名残留） |
| 指令下发 | `computer_use_mcp_instructions {darwin:{companion,remote}, win32}` | 按模式注入 MCP instructions |

> TCC 四项声明全在助手 Info.plist：辅助功能 + 屏幕录制（CU 本体）；AppleEvents + Contacts（iMessage 面，非 CU 本体）。

## 2. 工具面到达模型的两条路径

**同一二进制内并存两套词汇，分别服务两种挂法。**

| 路径 | 挂法 | 模型所见 |
|---|---|---|
| A1 编排下沉（新代际） | sidecar `--mcp-stdio --conversation-id` 直接充当 MCP server | 16 个 `computer_*`：schema / 逐字段描述 / instructions / refusals 全部二进制内嵌 |
| A2 宿主编排 | daemon 内 local-cua 类经 socket `tools/call` 直发 | 14 个 `computer_use_*` 低层动词；`control/start(mode:"remote")` 起会话拿 `sessionId`，后续携带 |

## 3. 完整工具面

**坐标基准统一为固定 1280×800 截图画布**（原点左上，x≤1279 / y≤799），多屏窗口缩放进画布。参数 schema 全文见 [source/grok/schemas/tools.json](../../source/grok/schemas/tools.json)。

### 3.1 `computer_*` 家族（companion MCP catalog，16 工具，二进制内嵌原文）

| 工具 | 参数要点 | 语义 |
|---|---|---|
| `computer_screenshot` | `target?`（screen 或 app+pid+target_id） | 截主屏/单 app 窗口；活快照复用 snapshot_id 不重走 AX；带 snapshot_id 时不返回树 |
| `computer_click` | `x,y`、`button`、`count`(1-3)、`coordinate_token`（app target 必填）、`step`(≤120 字用户活动文案) | 坐标点击；返回点击后截图（app target 仅返回文本） |
| `computer_move` | `x,y`、`coordinate_token`、`target?` | 悬停移动（展开 hover UI）；返回截图 |
| `computer_drag` | `from{x,y}`、`to{x,y}`、`button`、`step` | 按下-拖动-释放 |
| `computer_type` | 仅 app scope（**screen-scope 输入直接拒绝**）；element_id+snapshot_id 或点击选中/焦点域 | 打字；不改真光标、不抬窗；错过点击目标即拒绝 |
| `computer_key` | `key`（"Return"/"cmd+l"，`+` 组合修饰键）、`target?` | 按键/组合键；返回截图 |
| `computer_scroll` | `x,y`、`direction`、`amount`、`coordinate_token` | 坐标滚动；返回截图 |
| `computer_wait` | `ms`(0-30000，默认 1000) | 等待页面/动画稳定 |
| `computer_check_permissions` | 无 | 被动上报授权态；"Not needed before acting"，禁并行调用 |
| `computer_start_control` | 无 | **升级阀**：接管整屏 + 移动真光标；"Do not call this to type or fill a form." |
| `computer_release_control` | 无 | 结束整屏接管 |
| `computer_apps` | 无 | 列运行中 app（Spotlight/通知中心/菜单栏 extra 明示不支持） |
| `computer_resolve_app` | pid/bundle_id/app_path/app_name 四选一 | 未运行则不激活启动；返回 pid+target_id |
| `computer_app_state` | `target`、`element_id?`（钻取）、`snapshot_id?` | AX 树文本化（`[id] ROLE name= value= settable actions=`，深度缩进；预算截断；element_id 展开并入同一 snapshot）；末行 snapshot_id |
| `computer_set_value` | `target`、`element_id`、`snapshot_id`、`value` | AX 写值替换（不走键盘）；树未变则 snapshot 继续有效 |
| `computer_app_action` | `target`、`element_id`、`snapshot_id`、`action`（press 或元素 actions 列表项） | 对树内元素执行 AX 动作；"Prefer this over coordinate clicks" |

> instructions 要点：默认 app target、"Do not call computer_start_control first"；拒绝时把拒绝文本转告用户、授权后重试；禁止并行调用 CU 工具。

### 3.2 `computer_use_*` 家族（daemon 直连 RPC 面，14 动词）

`screenshot / click{method:"coordinate"} / scroll / mouse_move / mouse_button{down|up} / drag{path≥2点} / typing / press_key{hold_duration_ms} / set_value / perform_secondary_action / app_state / select_app / apps_list / check_permissions`。

与 `computer_*` 的关系：**低层动作词汇**（≈Cursor 扩展 TS 层 RPC 面）vs **高层语义词汇**（app target 默认、句柄台账、refusals 分类、step 用户文案）。

### 3.3 云端 `ComputerUseAction`（proto，11 动作）

`mouse_move / click / mouse_down / mouse_up / drag / scroll / type / key{stroke:TAP|DOWN|UP} / wait / screenshot / cursor_position`；MouseButton 含 BACK/FORWARD。批量载荷附 `description`（意图）、`desktop_lease_actor_id`（租约）、`screenshot_settle_ms`（动作后等待）、`bind_unmapped_characters`（对应本地 flag `sand_computer_use_unicode_typing`）。

## 4. 观察机制：双通道 + 双句柄防漂移

| 通道 | 机制 | 防御细节 |
|---|---|---|
| 像素 | SCK 按窗口捕获（非整屏），JPEG ≤1 MiB（超限降级文本重拍），统一缩放 1280×800 画布补边 | 捕获期持续校验窗口同一性；padding-bar 坐标识别后拒绝/钳制 |
| 结构 | AX 树文本化，一行一元素，深度缩进；预算截断 + element_id 钻取展开 | snapshot_id 跨工具复用（"Reused live snapshot (tree unchanged)"），提示模型不必重读 |
| 双句柄 | 元素句柄 `snapshot_id+element_id`（AX）与坐标句柄 `coordinate_token`（截图）分账 | staleness 归因五种具体原因，错误消息直接给补救动作 |
| 遮挡语义 | 被遮挡/最小化/不在当前 Space 的窗口截图仍有效，**坐标动作可命中** | `skylight-no-raise`（SkyLight 级不抬升）；"Companion does not raise" |
| 云端 | 动作批量后按 `screenshot_settle_ms` 等待再截图回传 | noVNC 帧流观察（黑帧探针 + 帧节流） |

## 5. 动作机制：AX 语义优先，事件注入兜底

| 通路 | 机制 | 关键约束 |
|---|---|---|
| AX 语义（companion 默认） | AXPress / AXShowMenu；AXValue 写值 + **写后回读校验**；AXSelected 回读 false 即报错并指向坐标路径；AXScrollToVisible（不支持即拒绝） | element_id 点击仅单击左键 AXPress；巨型无语义元素拒绝；element_id 与坐标互斥 |
| 事件注入（remote） | CGEvent/AppKit 合成事件 + `EventSequencer` 全序号定序 + `CUPointerMoveHop` 分步；键名文法（"cmd+l"、`+` 组合、unicode 直发）；拖拽 ≥2 点 | 动作前校验 target 身份，stale 即拒发——**未投递即失败，不做半截动作** |
| 投递后 | 超时动作明确警示缓存几何可能失真 | 提示先 `computer_use_screenshot` 再做下一个坐标动作 |

## 6. 安全模型：租约互斥 + 三路急停 + 错误即指令

| # | 机制 | 要点 |
|---|---|---|
| 1 | 进程身份链 | Helpers 同签名团队携带（CDN 可更新分发）；socket 对端校验 = codesign 团队白名单（`localRPCTrustedTeamIdentifiers`+`peerPolicy`），拒跨用户进程与 launchd 直启 |
| 2 | TCC 归助手 | 辅助功能+屏幕录制声明在助手 App；被动探测（`--probe-permissions`、`permissions/status`）与主动引导（`permissions/open-settings`）分离 |
| 3 | 两档控制 + 显式升级阀 | companion 免会话、不动真光标、不抬升；`computer_start_control` 才整屏，指令层明令"输入/填表不得升级" |
| 4 | 租约与会话互斥 | `CURemoteControlLease` 活跃会话唯一（"Remote control is busy with another session"）；`CURemoteControlPermit` 持在途输入（heldInputs）可即时撤销；云端对应 `desktop_lease_actor_id` |
| 5 | 急停三路 | 物理 Esc（`CURemoteEscapeTap` event tap）+ 用户 Stop（`CUCompanionStops`）+ 协议级 `USER_ABORTED`（附"本回合禁再调用输入类工具"）；异常兜底 best-effort release |
| 6 | 结构化拒绝 | `isError=true + structuredContent{code, message, escalation:{recommended, reason}}`，16 码四档（§7）——9 家分册中最完整的模型侧失败协议 |
| 7 | 可视化共驾 | companion 光标悬浮层（"a cursor overlay is still shown"）；remote 辉光覆盖层 + 指针图标 + 透传点击 + 重锚定 |
| 8 | 生命周期卫生 | `CUA_IDLE_EXIT_SECONDS` 空闲自退出；产品上下文 bootstrap 单次锁定；临时目录 + 原子 rename 安装 |
| 9 | 门控 fail-closed | `local_computer_use` / `mac_computer_use` 等默认全关；`computer_use_supported` 由客户端握手上报，未启用 = 工具不存在（P11） |

## 7. 错误码全景：16 码四档建议

| 建议档 | 错误码 | 给模型的语义 |
|---|---|---|
| `retry` | capture_failed / invalid_arguments / input_failed / timeout | 未生效，改参重发安全 |
| `ask_user` | secure_desktop / input_desktop_unavailable / target_elevated / permission_required / session_busy / sidecar_unavailable / unsupported_request | 只有机器前的人能解决 |
| `use_different_tool` | screenshot_required / unknown_tool / outcome_unknown / session_required | 先跑指定工具（多为先截图） |
| `stop` | user_aborted | 本回合终止一切输入类调用 |

> 传输层另有：RPC 超时/响应超限/socket 过长/service 不可用、launch 失败（"did not publish service.json after launch" / "did not become ready in time"）。

## 8. 与云端 CU（远程计算机）的关系

- 本地助手服务"这台 Mac"；云端 `computer_use_tool_call` 服务托管 VM——共享动作词汇（proto 11 动作 ≈ 本地事件通路超集）与租约概念。
- 人的介入面：noVNC 控制台（`sand_mobile_agent_computer_console` 默认开）不只观看，还能键鼠介入 + 剪贴板双向同步（带回环抑制）。
- `record_screen`（START/SAVE/DISCARD）是独立工具位，服务会话回放/审计，不是 CU 观察通道。

## 9. 谱系关系：与已测 8 家对照

- **与 Cursor**：同一血统（五路取证表见 [README](README.md)）；代际差异 = 编排下沉进 Swift sidecar（`--mcp-stdio` + 内嵌 catalog + refusals 表）+ companion/remote 双指令服务端动态下发。
- **与 Codex（Sky）/ Claude（SkyLight/CGS）/ Kimi（SLS 签名事件）**：同为"独立 Helper + 后台定向输入"路线；特色是遮挡窗口坐标可命中 + 不抬升（`skylight-no-raise`），与 Claude 的 SkyLight 后台操作同类。
- **与 trycua 系（MiniMax/Synara/Kimi）**：无内嵌关系；共享 Cua AI 风格环境变量命名（`CUA_APP_SUPPORT_DIR` 等）——间接佐证 Swift 基座同源（推断，置信度中）。
- **与 Grok CLI**：无。两套独立产品（不同二进制、不同工具协议、不同会话存储）。

## 10. 本机可用性判定与复现命令

**载体完整在位（App + 二进制 + 宿主客户端 + CDN 通道），门控全关，从未激活**（无 service.json、无安装目录、无进程痕迹）——与 Cursor 本机状态同构。静态还原的工具面即上文，非本机实测会话。

```bash
plutil -p "/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app/Contents/Info.plist"
codesign -dv "/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app"   # TeamID DCNK4UB866
npx asar extract "/Applications/Grok Bot.app/Contents/Resources/app.asar" /tmp/grokbot-analysis/app
strings -n 6 "/Applications/Grok Bot.app/Contents/Helpers/Grok Bot Computer Use.app/Contents/MacOS/CUGrokBotService" | sed -n '640,1520p'   # 内嵌 MCP catalog
ls ~/Library/"Application Support"/grok-bot-computer-use 2>/dev/null                   # 不存在 → 未激活
```
