# source/synara — Synara 桌面/浏览器控制源码层

> 整理自 `agents/synara/` 逆向分册（Synara.app 0.9.2，Electron 43.4.1，只读静态分析）。
> 本目录 = 接口数据（schemas）+ cleanroom 参考实现（reference）+ 开源上游子集（vendor），不含任何 Synara 专有代码。

## 三层结构

### schemas/（接口数据，全部带 `_provenance` 头）

| 文件 | 内容 | 置信度 |
| --- | --- | --- |
| `gateway-computer-tools.json` | 网关 computer_*：13 读 + 20 变更（批准集合）+ 宿主驱动名 14 读/18 动作 + 传输协议（Unix socket RPC、spawn env、synara_native_revision 握手、孤儿清理）+ activation shield 协议 | 工具清单=高；单工具参数=中 |
| `gateway-browser-tools.json` | browser_* 13 工具（自带面板，免批准）+ BetterWright 2.7.3 实例化参数 + CDP 方法白/黑名单 + 凭据红线 + cookie 导入流程 + 上传 staging 限额 | 高 |
| `computer-browser-tools.json` | computer_browser_* 10 工具（cua-driver CDP 家族）LLM↔驱动名映射 + prepare 三策略（isolated_new/isolated_named/existing_profile）+ 可见窗口授权 + 在途丢失语义 | 映射=高；press→type 语义=中 |

### reference/（cleanroom 参考实现，TypeScript，node 可直接运行）

| 文件 | 对应机制 |
| --- | --- |
| `visible-use-authorizer.ts` | 前台可见使用意图正则授权：注入剥离（代码块/引用块/引号）、可见意图正则族（英/意）、后台倾向否决、问答回路、批准卡、授权屏障（例行继续存续/新指令打断）、2 秒安静期（`COMPUTER_USER_INTERACTION_QUIET_MS=2000`）、Space 整句指定 |
| `escape-stop.ts` | Escape 急停与人接管：仅活跃 generation 时武装、冷却窗 + epoch 推进、仅前台在途被人输入打断、重新观察屏障、在途「已派发-效果未知」上报、用户 Stop 复位 |
| `test.mjs` | 形状自测（15 项断言），`node test.mjs` 直接运行 |

> 注意：分册只记录了上游正则族的**代表性样例**（`show me…`/`let me watch you…` 等），
> `visible-use-authorizer.ts` 的正则是按行为规格 cleanroom 重写，非上游原文 —— 见该文件头注释。

### vendor/cua-driver/（MIT 开源上游子集）

- 上游 `github.com/trycua/cua`，**commit `fc188250b4ca8549b8e61f937fdb1fb560770e86`**（`libs/cua-driver/rust/VERSION` = 0.28.2，即 Synara 随包引擎 provenance.json 记载的版本）
- 搬运内容：`contract/`（manifest.json 28 工具契约）+ `rust/crates/cua-driver-contract/` —— 工具契约层
- Synara 对上游打了补丁（`patched: true`，nativeRevision 39）；补丁差异点与「本目录为补丁前基线」的定位见 `vendor/cua-driver/UPSTREAM.md`

## 运行自测

```bash
cd source/synara/reference && node test.mjs
```
