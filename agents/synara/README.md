# Synara（Emanuele Di Pietro，独立开发者）· 多 Agent 工作台 + 原生桌面/浏览器控制

> 一句话结论：**CU/BU 引擎是第三方开源 cua-driver 0.28.2（Rust，Cua AI，Synara 打补丁），其上盖了一层全市场最细的"前台可见使用"授权正则与物理 Escape 急停。**

| 项 | 值 |
|---|---|
| 载体 | `/Applications/Synara.app` 0.9.2（com.emanueledipietro.synara，Electron 43.4.1，Developer ID 签名） |
| 形态 | 本地编排 server（claude/codex/opencode/pi/cursor/grok/devin 等 10 家 agent）+ Electron 主进程托管引擎 |
| CU 工具面 | 33 网关工具（读 13 免批准 + 变更 20 逐个批准）· CGEvent/AX |
| BU 工具面 | 三层：面板 browser_* 13 · CDP 家族 computer_browser_* 10 · cookie 导入 |
| 安全模型 | 前台正则授权 · 人接管 · Escape 急停 · activation shield |
| 本机可用 | ✅ 已安装，cua-driver 引擎与 helper 在位（2026-10-06 基线） |

## 架构一图

```
本地 Web UI（React 聊天界面）── WebSocket 127.0.0.1 ── 编排 server（Node）
 ├─ 多 provider 会话 + 网关工具（computer_*/browser_* 定义、批准卡、审计、前台授权正则引擎）
 └─ Electron 主进程
     ├─ CuaDriverHost ── spawn cua-driver serve --embedded ── Unix socket RPC
     │    └─ cua-driver 0.28.2（patched）：CGEvent 注入 · ScreenCaptureKit 截屏 · AX 语义
     ├─ betterwright 库 ── contents.debugger（CDP）── 自带浏览器面板
     ├─ appsnap-helper（Swift）：帧流 / Escape 监听 / Option 双键抓窗
     └─ device-helper（源码随包）：CoreSimulator+SimulatorKit 私有 API → iOS 模拟器
```

## 能力矩阵

| 能力 | 载体 | 面向模型的工具 | 关键安全机制 |
|---|---|---|---|
| 桌面观察 | cua-driver（SCK/AX） | computer_screenshot、computer_get_state、computer_get_accessibility_tree、computer_zoom 等 13 读 | 读免批准；帧流仅绑定授权窗口 |
| 桌面动作 | cua-driver（CGEvent 前台；AX 后台） | computer_click/type_text/…/kill_app 20 变更 | 全部需批准；前台需可见使用授权 |
| 后台语义操作 | cua-driver AX 通路 | 同上（deliveryMode 为宿主信封元数据） | 模型不可自选投递模式 |
| 人接管/急停 | appsnap-helper + 主进程 | （非工具，系统级） | 物理 Escape/Stop 中断在途输入；2s 用户安静期 |
| 浏览器（面板） | betterwright + Electron CDP | browser_status…browser_close 13 | 免批准；下载拒绝；凭据禁用；CDP 黑名单 |
| 浏览器（独立/附加） | cua-driver CDP 家族 | computer_browser_prepare…pointer 10 | 可见窗口需前台授权；existing_profile 需批准锚点 |
| Cookie 导入 | rookie-cookies（UI 操作） | （无模型工具） | site 域匹配可见站点；整 profile 需显式确认 |
| iOS 模拟器 | synara-device-helper | 设备面板工具（tap/swipe/key/text/screenshot/describe-ui） | 深链接/启动需批准；HID 失败降级只读 |

云端面：cua-driver 自带遥测被宿主环境变量关闭；诊断端点（workers.dev）仅为静态可见字符串，未抓包验证。

## 导航

- [computer-use.md](./computer-use.md) — 引擎托管、读/变更两表、投递模式、十层安全模型
- [browser-use.md](./browser-use.md) — 三条浏览器链路、CDP 白/黑名单、cookie 导入
- [evidence/inventory.md](./evidence/inventory.md) — 证据底账（A 产品 / B CU / C BU / D 其他）

> 方法：纯静态逆向（plutil/codesign/asar/strings/随包源码与文档），未运行、未抓包、未触碰凭据；推断均已标注。
