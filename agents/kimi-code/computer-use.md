# Kimi Code：Computer Use —— KimiCU 独立常驻服务，后台定向输入不抢电脑

> 基线：KimiCU v0.6.6，本机 2026-10-06 实测；方法为只读静态分析（otool/nm/strings/asar 解包）+ 只读探针 + 会话实录比对。
> 18 工具完整 schema：[source/kimi-code/schemas/mcp-tools.json](../../source/kimi-code/schemas/mcp-tools.json)；证据编号 (E#) 对应 [evidence/inventory.md](evidence/inventory.md)。

## 速览

**KimiCU 是独立签名的原生 Swift 常驻服务（`/Applications/KimiCU.app`，ai.kimi.cu），launchd 按需拉起，独占持有 TCC「辅助功能 + 屏幕录制」；CLI 经插件把它挂成 stdio MCP（18 工具 + `js`/`js_reset`），核心设计是后台定向输入。**

## 架构：服务持权限，两条调用链共享观察缓存

```
kimi CLI（Node SEA，agent-core-v2）
 └─ 插件 kimi-cu：stdio MCP（18 工具 + js/js_reset）｜ node-repl @kimi/cu facade
     └─ UDS runtime.sock（token 认证 + KimiCU-UDS-1 帧 8MiB + observation_context 隔离）
         └─ launchd 服务 ai.kimi.cu.service（TCC 权限 owner，"CLI may lack accessibility
             permission; the launchd Service holds it for MCP"）
             ├─ 观察：ScreenCaptureKit 截图（meanAbsDiff 会话 diff）+ 收敛 AX 树（snapshot_id 绑定）
             └─ 动作 = 后台定向输入（不动真实光标 / 不抢前台 / 不用 HID tap）：
                  ├─ SkyLight 窗口路由（WindowServer 阶段补全窗口号+局部坐标）
                  ├─ SignedKeyboard：SLSEventAuthenticationMessage + SLEventPostToPid
                  │    （后台 Chromium 键盘；机制公开致谢 Cua AI，实现独立）
                  └─ CGEventPostToPid 公共回退
```

**与 ZCode cua-helper 同构、实现独立**（同一设计范式：独立 Helper 持权限 + 本地 IPC 鉴权 + 工具面隔离原生 API）：

| | KimiCU | ZCode cua-helper |
|---|---|---|
| Helper 形态 | 独立 .app + launchd Mach service 按需启动 | 独立 .app，host `open -n -g` 拉起 + 一次性 token |
| 权限 owner | launchd Service | helper bundle id（peer 验签） |
| 传输 | UDS + token + 帧协议 KimiCU-UDS-1 | NDJSON/UDS（随机 sock）；Windows 命名管道 |
| 工具面 | 18 MCP 工具 + js/js_reset | 30 MCP 工具（63 broker 方法） |
| 动作机制 | SkyLight 路由 / postToPid 签名事件，不用 HID 不动光标 | ax_native.node 后台输入队列 + SkyLight 双加载器 |

KimiCU 独特点：(a) 服务常驻 + launchd 按需；(b) node-repl 代码模式（CU 调用可编程批量）；(c) `observation_context` 让 MCP 与 JS 两条链路共享观察缓存/快照绑定。

## 工具面（18 + 2）

参数语义全部取自二进制内嵌 schema JSON（E3.4）；schema 层同时接受 snake_case 与 camelCase 别名，未知字段严格拒绝（`KIMI_CU_UNKNOWN_FIELD`）。

### 观察（7）

| 工具 | 必填 | 语义要点 |
|---|---|---|
| `list_apps` | — | 可定位 app（name/bundle_id/pid/is_running/**has_cef/has_chromium_input_surface** 路由判别）；false 时扫已安装未运行 app |
| `list_windows` | — | 屏上可定位窗口（app/pid 过滤） |
| `get_window` | window_id | Window2 句柄 → app/pid/id/title；窗口已关则报错 |
| `get_app_state` | app 或 pid | **主观察**：截图 + 收敛 AX 树；mode full/image/ax、diff 增量、rect 裁剪、附加窗口 ≤3 |
| `get_window_state` | window_id | 按窗口号定点观察（include_screenshot/include_text） |
| `launch_app` | app | 启动已安装 app 但**不激活** |
| `activate_window` | 目标四选一 | 显式抬窗；"仅任务需要可见交互时使用" |

观察关键机制：`snapshot_id` 绑定观察上下文——"stale or other-context IDs are rejected"，跨上下文复用索引直接拒绝；x/y 是"所用截图的像素坐标"非屏幕坐标；AX 树与截图都做会话级增量 diff（`disable_diff` 回全树）；无 SoM 式编号叠加，定位靠 AX index + 截图像素双轨。

### 动作（10）

| 工具 | 定位 | 语义要点 |
|---|---|---|
| `click` | index 或 x,y（截图像素） | 后台定向；button/count 1-3/hold_ms/hover_ms；`channel auto\|skylight\|public`；`allow_foreground_fallback`（默认 never-front）；`verify_after` 后验证；**"It never uses a HID tap or moves the real pointer"** |
| `type_text` | 可选聚焦目标 | 后台 Unicode 输入；clear=替换、submit=回车（先回读验证）；Electron 无 AX 回读 → `verified:false, verification_required:"screenshot"` |
| `paste` | 当前焦点 | 临时剪贴板投递事后恢复；format text/md/html |
| `press_key` | — | xdotool 风格 DSL，空格分隔可批量；默认后台，窗口全遮挡也能落键（native apps on macOS 26 已验证） |
| `scroll` | index 或 x,y | page 优先（正=向上）、dx/dy legacy；无移动返回 `ok:false` |
| `set_value` | index + value | 原生控件走 AXValue；Electron/Web 走 no-raise 后台替换路径（清空而非追加）；autosubmit 可后台回车提交 |
| `perform_secondary_action` | index | 元素二级 AX 动作（默认 AXShowMenu=右键菜单），action 可显式指定 |
| `select_text` | index | start+length 或可见文本（prefix/suffix 消歧）；selection text/cursor_before/cursor_after |
| `drag` | from→to（截图像素） | hold_ms/step_ms/steps 插值；Chromium 上不可靠；**标题栏起点 = 经验证的 AXPosition 写入移窗**（合成事件参与不了 WindowServer 移动会话） |
| `drag_paths` | paths ≤500 × ≤1024 点 | 同窗口批量笔画（绘画/手势）；须显式 window_id；`abort_if_cursor_in_window` 用户光标守卫；非事务，可从首个 false 续作 |

### 调试与代码模式

`debug_tap`（对某 pid 起带注解 event tap N 秒，投递事件记 `/tmp/kimicu-pidtap-<pid>.log`，只读）；`js`/`js_reset`（见下节，插件 manifest 白名单显式包含）。

## `js` 工具：node-repl 沙箱

| 组成 | 事实 |
|---|---|
| 运行时 | 随包 `bin/node`（112MB）+ kernel.mjs（每 cell 内核）+ trusted-worker.mjs（监督者）+ meriyah 静态检查 |
| facade | `@kimi/cu` 18 方法同名导出；`nodeRepl.write()` 才有输出；观察图片经 emitImage 注入 |
| 参数差异 | facade 与 MCP 有独立别名表（如 JS `press_key` 用 `key`，MCP 用 `keys`） |
| 安全链 | cell 不直接持有 UDS——经 native_pipe 取 exec 作用域连接，每 exec 懒建会话结束即弃；hello 后跑版本门（低于 0.6.6 报 `KIMI_CU_RUNTIME_TOO_OLD`）；`approval_token` 可选强制 |
| js_reset | 清 REPL 变量重建内核；不清理 app 内草稿；升级后须 reset + 重连 MCP |

## 动作机制：点击通道与签名键盘

**无跨通道自动重试：被吞事件可能分钟级后才落地，盲发同坐标可能双击。**

| channel | 机制 |
|---|---|
| `auto`（默认） | SkyLight 窗口路由：WindowServer 阶段给事件补全窗口号与局部坐标 |
| `public` | 整段序列（hover→primer→down/up）以 NSEvent 工厂事件携窗口号经 postToPid 投递；长时间遮挡/被节流的 Chromium 上 SkyLight 可能分钟级停滞，public 保持完整 hover/焦点/导航语义 |
| `skylight` | 强制仅路由通道（A/B 用） |

后台 Chromium 键盘（SignedKeyboard），THIRD_PARTY_NOTICES 原文致谢：

> "Background-Chromium keyboard delivery … uses an authentication-envelope mechanism (`SLSEventAuthenticationMessage` + `SLEventPostToPid`) that was publicly documented and implemented by Cua AI, Inc. in the MIT-licensed cua-driver. KimiCU's implementation in `Sources/SignedKeyboard/` is independently written"

即：对后台 Chromium 窗口发键不走全局 HID，而是构造带认证封包的 SkyLight 事件定向投给目标 pid——窗口完全被遮挡也能落键；strings 另见回退 `bg-input falls back to public CGEventPostToPid`。

兜底与边界：set_value/type_text 兜底 AX 写值/编辑命令/AX 聚焦，全部后台；`activate:true` 才短暂抬窗（报 `used_backend=foreground_targeted`）；前台回退受调用方参数 × 服务策略（默认 never-front）双门；**永不**：HID tap、移动真实光标、拦截用户真实输入、未经授权激活 app。

投递验证：`delivery_unverified`（已发但 AX 回读未见文本）、`focus_unverified`（目标无 AX 回读面）、`effect:"unverifiable"`（遮挡窗口/CEF 原生 chrome 目标）。**投递成功 ≠ 生效**；未观察到效果的点击绝不自动重发。

## 安全模型

| 层 | 机制 |
|---|---|
| TCC | 辅助功能 + 屏幕录制授权给 launchd Service（CLI 终端上下文 TCC 不同）；本机实测双 true |
| UDS 认证 | `runtime.token` + hello 握手；peer 身份/uid/pid 校验，失败即断链不留毒连接 |
| 审批门 | `approval_token` 机制（服务端可强制要求）；本机未观察到实际强制场景 |
| 上下文隔离 | `observation_context`（client 随机 UUID）回显校验，快照/坐标缓存跨上下文不可复用——防多客户端串话 |
| 用户守卫 | `abort_if_cursor_in_window`；点击不动真实光标，天然不与用户抢输入 |
| 急停 | `kimi-cu uninstall` + `launchctl bootout` + `pkill`；未发现运行时全局急停开关 |

发送/付款类动作由 SKILL 约束为"用户已明确授权的目标和范围内，缺信息先问"（模型纪律，非服务强制）。

## 运维与谱系

> 安装：`curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash`（CLI capability 层亦可自动装）。升级**不会**自动替换长寿的 MCP 桥与 node-repl 内核——升级后须重连 MCP + `js_reset`。诊断：doctor / service-status / xpc-ping / probe / tap-pid / keywin-probe。

谱系：与 Claude Code 无协议兼容（自研包树 + `kimi.plugin.json` + managed plugins CDN）；CU 与 ZCode 同构实现独立（见上表）；node-repl 形态与 ZCode node_repl MCP 同构（自研实现、自有协议名）。

置信度：高——工具面、动作机制、沙箱结构、安全主链（文件/符号/schema/实录四重印证）。中（推断）——浮层触发时机、`agent-*.png` 用途、Windows 链路。未在本机发现：审批 token 实际强制场景、全局 kill switch、CU 跨设备扩展。
