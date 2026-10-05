# source/minimax-code — MiniMax Code 桌面/浏览器控制源码层

> 整理自 `agents/minimax-code/` 逆向分册（MiniMax Code.app 3.1.0，Electron 42.8.0，只读静态分析）。
> 本目录让分册结论落成「可复用的接口数据 + 可运行的参考实现 + 可追溯的开源子集」，不含任何 MiniMax 专有代码。

## 三层结构

### schemas/（接口数据，全部带 `_provenance` 头）

| 文件 | 内容 | 置信度 |
| --- | --- | --- |
| `computer-tools.json` | 17 个 `computer_*` 工具（观察 4 + 交互 4 + 编辑 3 + 窗口/应用管理 5 + 验证 1）：kind/驱动映射/参数/双交付路由/target 规则/结果信封/错误码 | 工具清单与映射=高；个别参数精确约束=中 |
| `browser-actions.json` | 统一 `browser` 工具 24 action（compact 形态）+ 观察管线 + 错误码 | 清单=高 |
| `browser-fine-grained.json` | 13 个 `browser_*` 细粒度工具（full/both 形态），与统一工具 action 的对应关系 | 名单=高；`browser_verify_text` 参数=低 |
| `bindings.json` | Host Binding 门控形状：`hostCapability` 字段、computer/browser 两份 binding、三层门控语义 | 高 |

### reference/（cleanroom 参考实现，TypeScript，node 可直接运行）

| 文件 | 对应机制 |
| --- | --- |
| `binding-gate.ts` | 官方插件 + Host Binding 三层门控：插件准入（official + hostCapabilities）、工具目录装配（未激活=工具不存在）、执行时复查 + AbortController 掐断 |
| `lease-fencing.ts` | 单会话控制租约（观察类不占租约、单持有者、TTL、释放幂等 + FIFO 64 缓存）+ generation fencing（旧通道消息 `computer_generation_mismatch`） |
| `effect-verification.ts` | effect.verified 三态（confirmed/unverified/unverifiable）：click 恒不自动确认、VERIFIED_FILL 4×50ms 采样、scroll 结构化效果、verify_state 1-8 谓词 AND |
| `test.mjs` | 形状自测（14 项断言），`node test.mjs` 直接运行 |

### vendor/cua-driver/（MIT 开源上游子集）

- 上游 `github.com/trycua/cua`，**commit `c60ef6ad2db8774fb342938843e2f17f26c68240`**（该提交处 `libs/cua-driver/rust/VERSION` = 0.22.1，与 MiniMax 内嵌的 `@trycua/cua-driver` npm 0.22.1 同版本锚点）
- 搬运内容：`contract/`（manifest.json 25 工具契约 + fixtures）+ `rust/crates/cua-driver-contract/`（契约 crate 源码 ~3.9k 行）—— 即与 17 个 computer_* 工具面对应的**工具契约层**
- 详见 `vendor/cua-driver/UPSTREAM.md`（含对应关系与合规声明）

## 运行自测

```bash
cd source/minimax-code/reference && node test.mjs
```
