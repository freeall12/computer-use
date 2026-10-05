# Synara 逆向分析总览

> 分析对象：`/Applications/Synara.app`（macOS arm64）
> 分析方式：静态逆向（plutil / codesign / asar 解包 / strings / 随包源码与文档阅读），未运行、未抓包、未触碰任何凭据。解包产物仅在 `/tmp/synara-analysis`，未写入仓库。
> 分析日期：2026-10-06

## TL;DR

Synara 是一个 **Electron 桌面端的多 Agent 编排产品**（独立开发者 Emanuele Di Pietro，官网 trysynara.com，版本 0.9.2），定位类似"把 Claude Code / Codex / OpenCode / pi 等本地 coding agent 装进一个聊天式工作台，并给它们配上桌面控制、浏览器控制、iOS 模拟器镜像等原生能力"。它**同时具备完整的 Computer Use（桌面控制）与 Browser Use（浏览器控制）能力**，且两条能力链都有明确的授权、审计与"人接管"安全模型：

- **CU 引擎**：第三方开源 [Cua AI 的 cua-driver](https://github.com/trycua) v0.28.2（Rust，MIT，Synara 打了补丁），以 Unix domain socket 上的私有 RPC 被 Electron 主进程托管；注入走 CGEvent，观察走 ScreenCaptureKit + Accessibility。
- **BU 引擎**：三层。① cua-driver 内嵌的 CDP 浏览器家族（`computer_browser_*` 工具，可拉起隔离 headless 浏览器或附加到本机已有可调试浏览器）；② 开源 BetterWright v2.7.3（"policy-guarded Playwright for AI agents"，配 BetterChromium 153 固定分支）作为库，经 Electron `contents.debugger`（CDP）驱动 Synara **自带的浏览器面板**；③ Chrome/Safari/Edge 的 cookie 导入（底层 rookie-cookies NAPI）。
- 另有 **iOS 模拟器 Device Pane**（device-helper，源码随包，CoreSimulator/SimulatorKit 私有 API），能力上等价于一台"虚拟手机的 computer use"。

结论：**"有 CU / 有 BU"判定成立，置信度高**。证据链见 `evidence/inventory.md`。

## 架构分层图

```
┌─────────────────────────────────────────────────────────────────────────┐
│  本地 Web UI（apps/server/dist/client，React 聊天界面）                    │
│      ↑ WebSocket（127.0.0.1，本地回环）                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  编排服务器 apps/server/dist/index.mjs（Node，本地监听）                    │
│  · 多 provider 会话：claudeAgent / codex / opencode / pi / cursor /       │
│    grok / devin / antigravity / omp / factory-droid                      │
│  · agent 网关工具（gateway tools）：computer_* / browser_* 工具定义、       │
│    批准卡、审计日志、computer:control 能力域、前台授权正则引擎               │
│  · 外部 MCP 集成、自动化(定时)运行、终端(node-pty)、语音转写                │
├─────────────────────────────────────────────────────────────────────────┤
│  Electron 主进程 apps/desktop/dist-electron/main.js                       │
│  · CuaDriverHost：spawn cua-driver，Unix socket RPC，前台/后台投递、       │
│    人接管中断、Escape 监听、activation shield、agent 光标                  │
│  · 浏览器自动化：betterwright 库 + BetterwrightCdpTarget                   │
│    （contents.debugger=CDP 桥接到自带浏览器面板 WebContents）              │
│  · cookie 导入（Chrome/Safari/Edge）、Device Pane、AppSnap                 │
├──────────────┬──────────────────┬───────────────────┬───────────────────┤
│ cua-driver   │ synara-appsnap-  │ synara-device-    │ betterwright +    │
│ v0.28.2 Rust │ helper (Swift)   │ helper（源码随包， │ BetterChromium    │
│ （Cua AI，    │ 帧流/Escape 监听/ │ 用户 Xcode 现场   │ 153（按需下载）    │
│ patched）    │ Option 双键抓窗   │ 编译）            │                   │
│ CGEvent 注入 │                  │ CoreSimulator+    │                   │
│ SCK 截屏+AX  │                  │ SimulatorKit 私有 │                   │
└──────────────┴──────────────────┴───────────────────┴───────────────────┘
        ↓ Unix socket              ↓ stdio JSON-RPC + Unix socket 帧
   桌面（macOS 任意 App）        iOS 模拟器（无 Simulator.app 镜像/驱动）
   集成浏览器面板（Electron 分区 Partitions/synara-browser）
   外部浏览器（CDP 附加：Chrome/Edge 等带 --remote-debugging-port）
```

## 能力矩阵

| 能力 | 有/无 | 载体 | 面向模型的工具 | 关键安全机制 |
|---|---|---|---|---|
| 桌面观察（截图/窗口列表/AX 树） | 有 | cua-driver（ScreenCaptureKit/AX） | computer_screenshot、computer_get_state、computer_get_accessibility_tree、computer_zoom 等 | 读工具免批准；帧流仅绑定授权窗口 |
| 桌面动作（键鼠注入） | 有 | cua-driver（CGEvent，前台；AX 后台） | computer_click/type_text/press_key/drag/scroll/hotkey/set_value… 20 项 | 全部需批准；前台需可见使用授权；物理输入即接管 |
| 后台语义操作 | 有 | cua-driver AX 通路 | 同上 + select_text/set_value（后台投递） | deliveryMode 为宿主信封元数据，模型不可指定 |
| 人接管/急停 | 有 | appsnap-helper --escape-monitor + 主进程 | （非工具，系统级） | 物理 Escape/Stop 中断在途输入；2s 用户安静期 |
| 浏览器（自带面板） | 有 | betterwright 库 + Electron CDP | browser_status/tabs/open/navigate/back/forward/reload/resize/screenshot/logs/upload/run/close | 免用户批准；下载拒绝；凭据操作禁用；CDP 方法黑名单 |
| 浏览器（独立实例/附加） | 有 | cua-driver CDP 家族 | computer_browser_prepare/state/navigate/click/type/press/dialog/upload/download/pointer | 可见窗口需前台授权；existing_profile 需 pid/window_id 批准锚点 |
| Cookie/会话导入 | 有 | betterwright.listCookieSourceBrowsers（rookie-cookies） | （UI 操作，非模型工具） | site 域需与可见站点匹配；整 profile 需显式 confirmed |
| iOS 模拟器控制 | 有 | synara-device-helper（源码随包） | 设备面板工具（tap/swipe/key/text/screenshot/describe-ui） | 深链接/启动需批准；HID 失败自动降级为只读 |
| 语音输入 | 有 | 麦克风 + 云转写端点 | （非 agent 能力） | — |
| 云端遥测 | 部分 | cua-driver 自带遥测已被宿主禁用（`CUA_DRIVER_RS_TELEMETRY_ENABLED=0`）；诊断端点 synara-beta-diagnostics…workers.dev 存在于代码 | — | — |

## 关键文件索引

- 总判定证据：`evidence/inventory.md`
- 桌面控制逆向：`computer-use.md`
- 浏览器控制逆向：`browser-use.md`

## 方法与局限

全部结论来自静态证据：Info.plist、代码签名、asar 解包后的 JS（含 `//#region src/...` 原始模块边界，可读性好）、随包源码（device-helper）与随包文档（betterwright/docs、device-helper/HEADER.md）、二进制 strings。未动态运行被分析对象，未做网络抓包；所有"云端端点"仅为静态可见字符串。标"推断"的结论均已在正文注明。
