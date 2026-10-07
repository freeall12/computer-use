# Synara：Browser Use —— 三条链路：免批准面板 / CDP 家族 / Cookie 导入

> 基线同 computer-use.md。判定：**三层浏览器控制能力，置信度高。**
> 工具全名单：[source/synara/schemas/gateway-browser-tools.json](../../source/synara/schemas/gateway-browser-tools.json)、[computer-browser-tools.json](../../source/synara/schemas/computer-browser-tools.json)；证据：[evidence/inventory.md](evidence/inventory.md) §C。

## 速览

**① 自带浏览器面板（Electron WebContents，BetterWright 库经 CDP 驱动，模型免批准）；② cua-driver 内嵌 CDP 浏览器家族（隔离 headless 或附加真实浏览器，可见窗口需前台授权）；③ Chrome/Safari/Edge cookie 导入（UI 操作）。**

| 组件 | 版本/形态 | 备注 |
|---|---|---|
| BetterWright | 2.7.3，npm 随包（MIT） | 自述 "policy-guarded Playwright for AI agents" |
| BetterChromium | Chromium 153 固定 fork，setup 按需下载（SHA-256 pin） | 本机数据目录为空 → **未安装** |
| CDP 桥 | `contents.debugger.attach("1.3")` 把面板包装成 CDP target | main.js `BetterwrightCdpTarget` |
| cookie 读取 | rookie-cookies 0.6.0（Rust NAPI） | 经 betterwright 接口间接调用（推断） |

## 架构一图（三路径）

```
① 面板：模型 browser_*（13）── server 网关 ── betterwright 库（免批准）
    └─ contents.debugger（CDP 1.3，白/黑名单）── Electron 面板 WebContents
② CDP 家族：模型 computer_browser_*（10）── 宿主 ── cua-driver
    ├─ isolated_new / isolated_named：驱动自拉隔离 headless
    └─ existing_profile：附加本机浏览器（pid+window_id 批准锚点，endpoint 持续重验）
③ Cookie 导入：Chrome/Safari/Edge ── rookie-cookies（UI 操作，无模型工具）
```

## 路径一：自带浏览器面板（browser_* 13 工具）

**免批准——"Integrated browser control requires no user authorization prompt"：产品把自家面板视为沙箱。**

工具：browser_status / tabs / open / navigate / back / forward / reload / resize / screenshot / logs / upload / run / close。

- `browser_run` 在面板 WebContents 执行异步 Playwright 风格 JS（`await page.goto(...)`）；BetterWright 实例化参数：`downloadPolicy:"deny"`、`credentialCapture:false`、`vault:false`、`headless:false`、`NetworkPolicy({allowLoopback:true})`。
- CDP 方法黑名单：模型不能改 cookie、清缓存/下载行为、关浏览器、忽略证书错误（Network.*Cookie*、Page.setDownloadBehavior、Security.setIgnoreCertificateErrors 等全禁）；页面域白名单含 WebMCP。
- 凭据红线：browser_run 明示 "never mutate credentials or read/return passwords, cookies, tokens, or auth headers"；`credentials.list()` 仅返回 origin 域元数据。
- 下载一律拒绝（须经宿主"审批门下载面"）；上传走主进程受控 staging（单次 ≤256MB、目录 ≤64、文件 ≤512）。
- 页面数据不信任 + WebMCP 优先（`webagents.discover()` / `webmcp.tools()` 先于 DOM 盲操作）；面板为独立分区 `Partitions/synara-browser`，cookie/登录随分区持久。

## 路径二：cua-driver CDP 家族（computer_browser_* 10 工具）

| LLM 工具 | 驱动工具 |
|---|---|
| computer_browser_state | get_browser_state |
| computer_browser_prepare | browser_prepare |
| computer_browser_navigate | browser_navigate |
| computer_browser_click | browser_click |
| computer_browser_type | browser_type |
| computer_browser_press | browser_type（映射表如此写，驱动侧分支未追踪——中置信） |
| computer_browser_dialog | browser_dialog |
| computer_browser_upload | browser_set_input_files |
| computer_browser_download | browser_download |
| computer_browser_pointer | browser_pointer |

- 目标是 session 级 `target_id`/`tab_id` 能力，与桌面窗口 id 刻意分离；漏传 tab_id 时从最近 bind 结果解析，不行则结构化拒绝 `browser_tab_required`。
- prepare 策略：`isolated_new` / `isolated_named`（驱动自拉隔离 headless）；`existing_profile`（附加用户已开真实浏览器——需精确 pid + window_id 批准锚点 + capability manifest，持续重验端点归属，CDP 端口被夺/换进程即断链）。
- Chrome 不给默认 profile 开调试端口 → 驱动自带提示：改用 launch_app + `cdp_debugging_port` + 独立 `--user-data-dir`。
- `windowed:true` 走前台授权（与桌面共用 computerVisibleUse 正则 + 批准卡），投递强制 foreground；无授权拒绝语引导改后台工作。
- 除 get_browser_state 外全部记 mutation，在途被打断上报"已派发-效果未知"。

## 路径三：Cookie/会话导入（Chrome / Safari / Edge）

**三路径中唯一直接触碰用户登录态的通道，多层确认框住；模型侧无工具（UI 操作）。**

- 来源白名单 chrome/safari/edge；`site` 域要求目标 origin 与面板当前可见站点一致，`profile` 域必须显式 `confirmed`。
- 导入以"人浏览器操作"互斥执行：先等所有 Agent 暂停，期间面板主框架导航/WebContents 销毁/60s 超时立即中断回滚。

## BetterWright 生态（随包能力，宿主择用）

网络策略（云 metadata 端点永远阻断）、人味输入（human.click/type/scroll）、取证截图（`kind:'proof'`）、本地 CAPTCHA 分阶段求解、录屏、`betterwright view` 实时移交（URL 给人旁观/接管）、凭据 vault + trusted fill（明文永不回传模型）。Synara 以库形态只用子集；完整 CLI/守护面（run/repl/exec/configure/setup…）随包存在但由宿主代码决定实际暴露面。

## 传输与置信度

- 面板驱动全走进程内 `contents.debugger`（无外部端口）；BetterChromium 若安装由 BetterWright 以受管子进程拉起（本地回环调试端口，ATS 为 localhost 显式开明文例外）；未发现 CDP 暴露到非回环地址的代码路径（推断）。
- 高置信：三路径工具名、CDP 桥实现、下载/凭据红线、cookie 导入流程（解包 JS 模块边界完整）。未验证：BetterChromium 本机安装行为（目录为空，仅文档证据）；云浏览器 provider 是否被 UI 暴露（未见宿主引用，倾向未暴露）。
