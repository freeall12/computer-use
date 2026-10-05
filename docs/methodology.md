# 逆向方法论：如何在不运行、不抓包的前提下还原一个 Agent 的 CU/BU 能力

> 本文总结本轮 12 个 Agent 逆向实际使用的手段，可复现于任何 macOS 本机安装（或曾安装、或仅存上游开源）的桌面 Agent。
> 各 agent 的具体命令与输出存档见其 [evidence/inventory.md](../agents/)（ZCode/Codex/Claude/Cursor/MiniMax/Synara/Kimi 各一份）。

**目录**

1. [总原则](#1-总原则)
2. [安装面侦察](#2-安装面侦察)
3. [身份与完整性判定](#3-身份与完整性判定)
4. [asar 解包与打包 JS 分析](#4-asar-解包与打包-js-分析)
5. [原生二进制分析](#5-原生二进制分析)
6. [随包官方文档与类型定义优先](#6-随包官方文档与类型定义优先)
7. [MCP/IPC 协议还原](#7-mcpipc-协议还原)
8. [运行痕迹与会话数据](#8-运行痕迹与会话数据)
9. [负证据判定：如何证明「未启用」](#9-负证据判定如何证明未启用)
10. [上游源码基线法：对象已卸载时的开源替代路径](#10-上游源码基线法对象已卸载时的开源替代路径)
11. [对照样本反推](#11-对照样本反推)
12. [置信度标注与交叉验证](#12-置信度标注与交叉验证)
13. [合规边界](#13-合规边界)
14. [局限与失效模式](#14-局限与失效模式)

---

## 1. 总原则

- **静态优先**：全部 7 份分析都未运行被分析对象、未抓包、未触发 TCC 弹窗（Kimi 的 `service-status`/`xpc-ping` 是只读探针，不算运行）。
- **证据分层**：每条结论标注【实证】（文件/二进制/文档直接可见）或【推断】（旁证推导，需复核）——Codex 分册的约定，被全仓库沿用。
- **引用限额**：专有源码引用 ≤10 行/处，且以分析说明为目的；解包产物只进 `/tmp`，不进仓库。
- **路径:行号 或 命令输出**：每条结论可定位、可复跑。函数名来自压缩 JS 时给出文件与字节偏移（如 "asar 偏移 ~4395000"、"偏移 ~2886000-2920000"）。

## 2. 安装面侦察

CU/BU 能力的载体分散在五类位置，按序扫描：

```bash
# 1) 应用包
ls /Applications/ | grep -iE 'zcode|codex|claude|cursor|minimax|synara|kimi'
plutil -p "/Applications/X.app/Contents/Info.plist"        # bundle id / 版本 / LSUIElement / URL scheme

# 2) 用户目录配置与缓存（各家习惯不同，全都要看）
~/.zcode/cli/plugins/cache/   ~/.codex/   ~/.claude/   ~/.cursor/
~/.minimax/   ~/Library/Application\ Support/<app>/   ~/.kimi-code/   ~/.kimi-webbridge/
~/.local/share/cursor-agent/  ~/.local/share/claude/versions/

# 3) 全局 npm 包与 CLI
npm ls -g --depth=0                                          # @openai/codex
ls ~/.local/bin/                                             # cursor-agent

# 4) 系统级安装痕迹
ls ~/Library/LaunchAgents/ ~/Library/LaunchDaemons/          # KimiCU 的 ai.kimi.cu.service.plist
ls "/Library/Chrome/NativeMessagingHosts/" 2>/dev/null       # native host manifest
ls ~/Library/"Group Containers"/                             # Codex Sky 服务的 socket 目录

# 5) 运行进程与日志
pgrep -fl 'cua|helper|sidecar|sky|kimi-cu'
ls ~/.zcode/computer-use/logs/  ~/.cursor/browser-logs/  ~/.kimi-code/logs/
```

侦察的判定物：**Helper 类 app**（`LSUIElement=true` 的独立 app）、**原生模块**（`*.node`）、**launchd plist**、**socket/token 文件**、**插件缓存**（`plugins/cache` / `plugin-cache`）。见 [ZCode evidence §1](../agents/zcode/evidence/inventory.md)、[Kimi evidence §1](../agents/kimi-code/evidence/inventory.md)。

## 3. 身份与完整性判定

先钉死「分析的是什么版本、有没有被改过」，再谈内容：

```bash
plutil -p <Info.plist>                     # CFBundleIdentifier / ShortVersionString / ElectronAsarIntegrity(SHA256)
codesign -dv --verbose=4 /Applications/X.app  # TeamIdentifier / flags 0x10000(runtime)=Hardened / 签名时间
file <binary>                              # Mach-O arm64 / 字节数
otool -L <binary>                          # 链接库：ScreenCaptureKit? CoreGraphics? SkyLight?
```

特有判据：
- **provenance 自述**：Synara 的 cua-driver 带 `provenance.json`（`patched: true`、`patchSha256`、`nativeRevision: 39`、上游 commit）——开源组件被谁改过、改了多少，直接读得到（[Synara CU §1](../agents/synara/computer-use.md)）；同类还有 Qoder 的 `node-repl/UPSTREAM.md`（内核迁自 qwen-code 的源仓库/commit/许可证记录，[Qoder README](../agents/qoder/README.md)）。
- **third-party notices**：KimiCU 的 `THIRD_PARTY_NOTICES.md` 明文致谢 Cua AI 的签名键盘机制——「借鉴关系」最硬的证据形态（[Kimi CU §5.2](../agents/kimi-code/computer-use.md)）。
- **签名类型影响 TCC 语义**：Synara 区分 ad-hoc 签名（TCC 授权随 cdhash 失效）与 Developer ID（[Synara CU §4](../agents/synara/computer-use.md)）——解读「权限丢失」类现象时必须考虑。

## 4. asar 解包与打包 JS 分析

Electron 应用的一切业务逻辑都在 `app.asar` 里：

```bash
npx @electron/asar extract /Applications/X.app/Contents/Resources/app.asar /tmp/x-asar
# 555MB 级别产物照解（MiniMax 406MB asar → /tmp/mm-asar），/tmp 用完即弃
```

对解包产物的四板斧：

1. **清单先行**：`package.json` 的 dependencies 直接暴露技术栈（`@trycua/cua-driver`、`betterwright`、`@earendil-works/pi-ai`、`@ant/computer-use-mcp` 一眼可见）。
2. **grep 定位**：在压缩 JS 里按专有名词定位（工具名、错误码、socket 路径、Symbol 名）：
   ```bash
   grep -rn "capture_app\|press_key_to_app\|CONTROLLER_BUSY" /tmp/zcode-asar/out/ | head
   grep -o '"cursor\.browserView\.[a-zA-Z.]*"' -r $V/out/vs | sort -u
   grep -o '"browser_[a-z_]*"' extensions/cursor-browser-automation/dist/extension.js | sort -u
   ```
3. **局部美化**：只对命中的 chunk 做 beautify（Claude 分册："asar index.chunk-Btw0RfUS.js，beautify 后 L3159-3990"），不要整文件美化。
4. **region 注释红利**：部分打包器保留模块边界注释（`//#region src/...`，Synara/Kimi 产物可读性极好）；Cursor 的 `cursor-computer-use` 扩展甚至**自带 TS 源码**（`src/`）——遇到就先读源码，可信度高于一切反编译。

版本演进也是证据：保留旧版插件缓存（`zcode-cua/0.5.12` vs `computer-use/0.6.3`、`browser-use/0.4.2` vs `0.5.1`）做 diff，能还原「设计如何演化、为什么删工具」（[ZCode evidence §2.23](../agents/zcode/evidence/inventory.md)）。

## 5. 原生二进制分析

Helper/驱动/CLI 原生二进制四件套：

```bash
# 1) Node SEA 识别（Helper 常是打包了 Node 的单文件）
strings <binary> | grep -a NODE_SEA          # "NODE_SEA_FUSE_...:1" → Node 单文件可执行
strings <binary> | grep -a "helper.cjs"      # 内嵌脚本构建路径泄露原始工程名

# 2) 符号表（NAPI 模块/Swift 二进制的信息量最大）
nm -gU ax_native.node                        # 105 个导出：ZCodePostKeyboardEventToWindow / PipStart* / Ghost* / RegisterBackgroundInput
nm <kimi-cu> | wc -l                         # 21,192 符号 → 按模块前缀聚类成职责表（ServiceIPC 7343 / AXTree 854 / SignedKeyboard 19...）

# 3) 字符串（错误文案 = 行为规格）
strings <binary> | grep -i "permission\|approval\|stale\|refused"
grep -ao "capture_app[a-z_]*\|press_key[a-z_]*" <binary> | sort | uniq -c   # RPC 方法名频次统计

# 4) 链接库反推动作机制
otool -L kimi-cu   # ScreenCaptureKit + Carbon + ServiceManagement → 截图/权限 UI/服务注册的实现选型
```

经验法则：
- **错误文案即文档**：Cursor framebuffer 的 `"[framebuffer:pixelGuard] refusing click (compare failed)"`、Synara 的 `"the ref's frame identity cannot be re-proven"`、Codex 的 kill-switch 文案——strings 里的大段英文文案就是未公开的行为规格。
- **符号聚类出架构**：Kimi 把 21,192 个 Swift 符号按模块前缀统计（ServiceIPC/BackgroundInput/SignedKeyboard/Overlay…），直接得出子系统划分图（[Kimi evidence §3.2](../agents/kimi-code/evidence/inventory.md)）。
- **ObjC 类名/选择器**：`ZCodeCuaPasteDataProvider`、`AXPress/AXValue/AXSelectedTextRange` 等选择器字符串直接指认 API 用法。
- **弱链接 = 可选依赖**：ScreenCaptureKit 以 weak 链接出现（ZCode ax_native）说明目标系统可能低于其引入版本，属兼容性处理。

## 6. 随包官方文档与类型定义优先

**比反编译更可靠的证据，按可信度排序**：

1. **随包 `.d.ts` 类型定义**：Codex 的 `@oai/cua/docs/tinysky-alt-core-*.md` + `tinysky_alt/types.d.ts` + `@oai/sky` 全套 `.d.ts` 是「随包分发的官方规范」——API 面逐字核对的首选基线（[Codex README 复用注意](../agents/codex/README.md)）。
2. **`api.json` / manifest**：ZCode `docs/api.json`（manifest v11，28 个对象类型 + 成员支持矩阵）、Codex browser 插件 `docs/api.json`（root="Agent"）——用脚本抽取即得完整对象面。
3. **SKILL.md / 工具描述**：Kimi webbridge 官方 skill（CDN tarball 可直接下载解包）、MiniMax 官方插件 skill（明言 "Adapted from official CUA Driver 0.22.1 skill"）、各家工具 `description` 字段的长指令文本（schema 字面量直接还原参数语义）。
4. **binding/manifest 清单**：MiniMax `bindings/computer.binding.json`、ZCode `.zcode-plugin/plugin.json`、Codex `plugin.json`（repository 字段泄露内部仓路径）。
5. **配置 schema**：从 Rust 二进制 strings 抽反序列化键串（`BrowserUseConfigToml{allow_history_access, default_origin_policy, origins}`）还原配置面（[Codex evidence §7.2](../agents/codex/evidence/inventory.md)）。

## 7. MCP/IPC 协议还原

进程间协议的三种还原路径：

**socket/端口型**（本地 IPC）：
```bash
ls -la ~/Library/"Application Support"/KimiCU/     # runtime.sock + runtime.token → 有鉴权 UDS
lsof -U | grep -iE 'cua|sky|synara'                # 谁在听哪个 socket
```
帧格式与握手从客户端 JS/符号还原：Codex `native-pipe.js`（4 字节 UInt32LE 长度前缀 + JSON，≤8MiB；`ping {clientApiVersion}` 强校验；`request {codexTurnMetadata, deadlineUnixMilliseconds, ...}`）；Kimi `KimiCU-UDS-1` 帧协议 + hello（token + protocol + observation_context + runtime_version）；Synara `metadata` 握手校验 `synara_native_revision`。

**stdio 型**（MCP server）：
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | kimi-cu mcp    # 手动起 stdio MCP 探工具面
```
MCP schema 常内嵌于二进制（Kimi 内嵌 schema JSON 是工具面的主证据）；会话实录（`mcp.tools_discovered` 事件）可交叉验证工具名单。

**消息端口型**（Electron 内部）：MiniMax `MessageChannelMain` + `{version:1, requestId, kind, sessionId, turnId, generation, leaseId, payload}` 信封从 `cua-utility-server.js` 直读。

一个高价值技巧：**每个请求携带的元数据字段暴露宿主的审计/策略意图**——Codex 每请求带 `codexTurnMetadata + deadline`（服务端可做策略判定与审计），Kimi hello 带 `observation_context`（多客户端隔离），MiniMax 带 `generation + leaseId`（fencing）。

## 8. 运行痕迹与会话数据

「代码存在」与「真的在用」之间隔着运行痕迹：

```bash
# 真实动作日志（最有价值的单一证据源）
cat ~/.zcode/computer-use/logs/zcode-cua-helper-2026-10-05.jsonl
#   → cua.element_action {action:"AXPress", target_pid:65178, ax_ok:true, guardEngaged:true}
#   → "macOS window pointer dispatched" native_args:"[65178,\"com.minimax.hub\",8613,[116,33,1280,800],...]"
#     （坐标点击被归一为窗口相对派发的直接实证）

# BU 使用痕迹
ls ~/.cursor/browser-logs/                        # CDP 截图 JSON ×5 + 快照 YAML ×4（2026-08/09）
head -40 ~/.cursor/browser-logs/snapshot-*.log    # data-cursor-ref 快照格式实样

# 会话级 wire 记录
~/.kimi-code/sessions/*/agents/*/wire.jsonl       # mcp.tools_discovered + 实际工具调用统计
~/.kimi-webbridge/logs/daemon.log                 # "[ws] extension connected"、版本握手实录
```

注意边界：会话内容可能含用户数据，**只做统计性引用（工具名、事件名），不引用业务内容**；MiniMax 明确未读 `~/.minimax/sessions`。

## 9. 负证据判定：如何证明「未启用」

证明「没有」比证明「有」难，需要多路负证据汇聚（本轮两个典型案例）：

**Cursor CU 未启用**（[Cursor README](../agents/cursor/README.md)、[evidence §7–8](../agents/cursor/evidence/inventory.md)）：
1. 门控默认值快照：`mac_computer_use:!1` / `local_computer_use:!1`（CLI 与 workbench 两处偏移各验一次）；
2. 安装目录不存在：`~/.cursor/computer-use-sidecar/` 为空、`service.json` 不存在；
3. 无进程、无日志；
4. 排除项防误判：`workbench.anysphere-ui-automations.js` 文件名诱人但实为 cron Automations（`cron`×75、`schedule`×49 验证）；main.js 唯一 `Accessibility.getFullAXTree` 调用属 VSCode 上游链接检测——**逐个排除同名异义物**。

**Claude 链路断**（[Claude browser-use §8](../agents/claude-code/browser-use.md)）：
扩展 ID 在 `Chrome/Default/Extensions/` 无目录、`NativeMessagingHosts/` 无 manifest（目录里只有第三方 host，顺带证明扫描方法有效）、`~/.claude/chrome/` wrapper 不存在、`~/.claude.json` 无 `chromePermissionMode` 键、TCC 未授权——五路独立负证据，且每路都给出了「如果有会是什么样」的对照。

通用准则：负证据要覆盖**门控、安装、进程、配置、权限**五个面；找到「名字像但无关」的东西必须显式排除而不是忽略（防误判是负证据的核心工作）。

## 10. 上游源码基线法：对象已卸载时的开源替代路径

当分析对象**本机已卸载**但上游开源时，分析基线从「本机文件」切换为「上游仓库的某个 commit」——Goose 分册是本轮唯一的完整案例（本机仅存 99 个断链 skills symlink，改用 `block/goose` v1.53.0、commit `5bd5e548`（2026-10-05，Apache-2.0）做全套分析）。

流程：

```bash
git clone --depth 1 https://github.com/block/goose /tmp/goose-src
cd /tmp/goose-src && git log -1 --format='%H %ci'      # 锁定 commit，写进分册头部
grep version Cargo.toml                                 # workspace 版本 + LICENSE
ls crates/goose-mcp/src/                                # 能力载体（computercontroller/peekaboo/...）
grep -n '"id": "computercontroller"' -A 5 ui/desktop/src/built-in-extensions.json   # 默认开关
```

要点：

1. **证据等级反而更高，但断言范围变小**：源码可引 `文件:行号`、可编译验证，高于一切反编译；但「源码如此」≠「本机曾装版本如此」——必须写「按上游 v1.53.0 分析」而不是「本机 Goose 行为为」。Goose 分册还给出跨版本陷阱实例：1.0.x 时代的 Computer Controller 是外部 MCP server（`uvx mcp-server-computer-controller`、多细粒度工具），现行版本才内置化并改为 Peekaboo 单工具透传——「做历史对齐时勿混用两代工具面」。
2. **与负证据判定组成三段式结论**：本机残留（断链 symlink、无 config.yaml、无二进制）证明「曾安装、已卸载」；上游源码证明「该产品的能力面是什么」；两者合并为「曾安装过 Goose（且做过 skills 定制），分析时点前已卸载，其 CU/BU 能力面如上游源码所述」。
3. **注册表/feature gate 是源码分析的第一站**：`BUILTIN_EXTENSIONS` 注册表 + feature gate（`--features computer-controller`）+ 桌面端 `built-in-extensions.json` 的 `enabled:false`——三层共同决定「代码在库里」与「用户可用」的差距，与 [reusable/patterns.md P11](../reusable/patterns.md#p11)（fail-closed 门控）互为印证。
4. **开源边界要核**：上游开源 ≠ 全部开源。对照 [source/README.md](../source/README.md) 的判定表——Codex 的 npm 仓库（Apache-2.0）是 CLI 开源仓，但桌面控制关键组件（`@oai/cua`/`@oai/sky`/SkyComputerUseService）不在其中，故不 vendor；Goose 的 goose-mcp 子集（7 文件，sha256 校验）、MiniMax/Synara 的 cua-driver 契约子集（MIT，两版本 28 文件 blob-SHA 一致）、Qoder 的 qwen-node-repl（Apache-2.0，40 文件）、MiMo 插件 SDK（MIT）则满足「上游本身开源 + 附 PROVENANCE/LICENSE」的 vendor 红线。
5. **半开源自带源码的同族形态**：Cursor `cursor-computer-use` 扩展随包携带完整 TS 源码（但属专有分发物、无许可证，不构成可 vendor 上游）；Qoder `node-repl/UPSTREAM.md` 反向指认上游——「源码层证据」在本轮以四种形态出现（开源仓 clone、随包源码、UPSTREAM 指认、vendor 子集），可信度依次为：开源仓 ≥ 随包源码 > UPSTREAM 指认 > 二进制符号。

---

## 11. 对照样本反推

当分析对象缺乏源码级证据时，用一个「已知面」作对照：

- **ZCode ↔ Codex**：ZCode SDK 头注释自述对齐 `@oai/cua@0.2.4`，于是反向把 ZCode 文档中「逐字同构的 12 成员」当作 Codex 面的旁证，再把「ZCode 自有加固」（stateId/possibly_sent/lease/kill switch）标注为 Codex 面的**缺失项**——两侧源码/文档直接对比后确证（[Codex CU §3.5](../agents/codex/computer-use.md)）。这一来一回同时校准了两份文档。
- **Kimi ↔ ZCode**：工具名几乎一一对应（get_app_state/click/type_text/…）→ 判定为「同一设计范式的平行实现」而非 fork；差异点（Swift vs JS broker、launchd vs 懒启动）即各自的独立演化。
- **Claude 桌面浏览器版 computer ↔ 官方 computer-use-demo**：action 描述文本几乎逐字一致 → 判定 schema 派生自公开 demo，再列出叠加扩展（tabId/ref/zoom/scroll_to）。

对照的纪律：**结论写成关系而非抄袭**——「API 面逐字对齐（自述）」「机制公开致谢」「同一范式平行实现」是三种不同的谱系结论，证据等级不同。

## 12. 置信度标注与交叉验证

每个分册末尾都有置信度表（高/中/低/待复核），判定规则：

| 等级 | 要求 | 示例 |
|---|---|---|
| 高 | ≥2 路独立证据（源码/二进制/日志/schema/实录） | ZCode 三层链路（源码+日志+二进制三重印证） |
| 中高 | 符号名 + 逻辑推断，无行为验证 | ax_native 各 API 组用途 |
| 中 | 单路证据 + 强推断 | controller lease 宿主侧实现（可选依赖注入点未解包到） |
| 低 | 仅类型枚举/字符串存在 | ZCode `extension` 后端（无运行证据） |

交叉验证的常见组合：内嵌 schema JSON ↔ 会话实录工具名单（Kimi）；api.json manifest ↔ Proxy 运行时白名单（ZCode）；provenance.json ↔ strings 引擎能力（Synara）；门控默认值 ↔ 安装目录状态（Cursor）。

## 13. 合规边界

本轮全部工作遵守的自约束（各分册「方法与合规说明」的公约数）：

- **只读分析**：不修改 `/Applications` 下任何文件；解包产物仅入 `/tmp`；不运行被分析对象、不抓包、不触发权限弹窗。
- **引用限额**：专有源码引用 ≤10 行/处，且以分析说明为目的；本仓库不含任何专有源码文件。
- **不复制二进制**：不把任何被分析的二进制/固件入库；证据以摘录、哈希、偏移表示。
- **不触碰凭据**：`auth/` 目录、token 字段、API key 一律不读明文；引用的配置文件脱敏（Kimi config.toml 内含 API key，文档一律脱敏标注）；会话内容只做统计性引用。
- **无 DRM 规避**：分析对象均为本机合法安装、对用户可见的文件；未做任何解密/破解/提取受保护内容。
- **商标与归属**：各产品名称与商标归各自所有者；本文档为独立研究，与各厂商无关。

## 14. 局限与失效模式

诚实记录这套方法的盲区，供复用者预期：

1. **Swift/Rust 编译产物无源码级细节**：动作 RPC 的完整 method 名表（服务端 switch）只能由客户端方法名反推（Codex 分册标注推断）。
2. **压缩 JS 的宿主侧实现可能漏读**：ZCode controller lease 的桌面宿主实现因产物高度压缩未逐行核证——「SDK 语义确凿 + 宿主实现未定位」要如实分开设。
3. **闭源分发的组件拿不到**：Kimi webbridge 的扩展本体在商店（闭源），只能从 daemon strings + SKILL 描述推断扩展行为。
4. **静态可见 ≠ 运行时可达**：云端面（Codex cdp、MiniMax Matrix、Cursor 云 worker）只有客户端指令文档；Synara 的「静态可见云端点」全部注明未抓包。
5. **版本快照失效**：所有结论绑定分析时点版本（各家头部均注明）；旧版缓存做演进分析时注意新旧面混用（ZCode 14 vs 30 工具的口径差就是这样来的）。
