# Kimi Code（Moonshot AI 月之暗面）· 插件化 CU/BU：独立 Helper + 浏览器双轨

> 一句话结论：**agent 内核不带 CU/BU——桌面控制是独立 Swift 常驻服务 KimiCU（后台定向输入：不动真实光标、不抢前台、不用 HID），浏览器控制是"daemon+扩展复用真实登录态"与"内嵌浏览器可控可审计"双轨。**

| 项 | 值 |
|---|---|
| 载体 | CLI `~/.kimi-code/bin/kimi` 0.39.1（Node SEA）+ 桌面 `Kimi Code.app` 1.0.4（Electron） |
| 形态 | managed plugins（CDN zip）+ MCP；CU 另有伴生原生 app |
| CU 工具面 | 18 工具 + js/js_reset · 后台定向输入（SkyLight/SLS 签名事件） |
| BU 工具面 | 双轨：webbridge 14+ 命令 · 内嵌浏览器单 run 工具 ×43 操作 |
| 安全模型 | UDS token 鉴权 · never-front · 扩展白名单 · receipts 审计 |
| 本机可用 | ✅ KimiCU 服务运行中、TCC 双授权已给（2026-10-06 实测） |

## 架构一图

```
pi-tui 终端 ｜ Kimi Code Desktop（Electron：会话面板 + 内嵌浏览器 + 活动浮层/接管/receipts）
 └─ kimi CLI（Node SEA，agent-core-v2；capability 层 detect/install + managed plugins + MCP）
     ├─ CU：kimi-cu 插件（stdio MCP 18 工具 + js/js_reset；或 node-repl @kimi/cu facade）
     │    └─ UDS runtime.sock（token + KimiCU-UDS-1 帧 + observation_context 隔离）
     │        └─ KimiCU.app 0.6.6（launchd ai.kimi.cu.service，TCC 权限持有者）
     │            └─ 观察：AX 树+截图（会话 diff）｜ 动作：SkyLight 窗口路由 · SLS 签名事件后台键盘
     │                · CGEventPostToPid 公共回退 —— 全程不动真实光标/不抢前台/不用 HID
     ├─ BU-A：webbridge skill → HTTP 127.0.0.1:10086 ── WS ── MV3 扩展（用户 Chrome/Edge 真实登录态）
     └─ BU-B：desktop_browser per-session HTTP MCP → 内嵌浏览器（43 操作，隔离世界 1001/1002）
```

## 能力载体

| 载体 | 版本 | 角色 |
|---|---|---|
| `KimiCU.app`（ai.kimi.cu） | 0.6.6，Swift 6.2MB | CU：观察/输入/截图/浮层/权限；launchd 按需常驻 |
| `~/.kimi-code/plugins/managed/kimi-cu` | 0.6.3 | MCP 挂载（`kimi-cu mcp`）+ 官方 skill ×2 |
| `~/.kimi-webbridge/bin/kimi-webbridge` | v2.0.22，Go | BU-A daemon：HTTP /command ↔ WS 扩展 |
| 浏览器扩展（Chrome/Edge 商店） | 与 daemon 配对 | 页面观察/动作执行者 |
| `plugins/managed/kimi-webbridge` | 1.11.3 | webbridge skill 分发 |
| 桌面 `browser-*` 模块 | 1.0.4 | BU-B：单 run 工具 ×43 操作 + 84 个 `kimi:browser-*` IPC 通道 |

## 谱系：与同类 Agent 的架构对照

| 维度 | Kimi Code | ZCode | Codex | Claude Code |
|---|---|---|---|---|
| CU Helper | Swift .app + launchd 按需常驻，服务持 TCC | JS broker + ax_native.node，host 拉起 + 一次性 token | ——（未发现桌面 CU） | ——（官方无） |
| CU IPC | UDS + token + 帧协议（8MiB） | NDJSON/UDS（随机 sock）/ Win 命名管道 | —— | —— |
| CU 工具面 | 18 + js/js_reset | 30（63 broker 方法） | —— | —— |
| 特色 | 后台输入不抢电脑、代码模式批量 | controllerLease、Ghost 光标、证据链截图 | chrome-native-hosts 痕迹 | —— |
| BU 形态 | daemon+扩展 与 内嵌浏览器 双轨 | IAB/CDP 单链路 | 扩展 + native messaging | 社区 MCP |

**同构结论**：KimiCU 与 ZCode cua-helper 属同一设计范式（独立 Helper 持权限 + 本地 IPC 鉴权 + 工具面隔离原生 API），实现零共享、工具名趋同；与 Claude Code 无协议兼容（自研 agent-core-v2 + managed plugins，providers 为 type=kimi/openai）。唯一官方声明的技术借鉴是 Cua AI 的签名键盘事件机制（THIRD_PARTY_NOTICES 明文致谢）。

## 导航与复核

1. [evidence/inventory.md](evidence/inventory.md) — 路径/版本/探针输出的原始底账
2. [computer-use.md](computer-use.md) — 18+2 工具、SkyLight/SignedKeyboard 机制、安全模型
3. [browser-use.md](browser-use.md) — 三链路、webbridge 命令、43 操作、接管与收据

```bash
/Applications/KimiCU.app/Contents/MacOS/kimi-cu service-status   # SMAppService 状态
/Applications/KimiCU.app/Contents/MacOS/kimi-cu xpc-ping         # TCC + runtimeSocket listening
~/.kimi-webbridge/bin/kimi-webbridge status                      # BU-A daemon 状态
```
