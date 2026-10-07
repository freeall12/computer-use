# Browserbase Stagehand：Computer Use 判定书

> 分析基线：上游 `browserbase/stagehand` v4（commit `fdd17958`，2026-10-06，MIT）。判定对象：SDK 是否具备桌面（OS 级）控制能力。

## 1. 判定

**判定：CU 能力为零——Stagehand 是浏览器-only 的 SDK，没有任何 OS 级桌面控制原语。**

| 判定项 | 结论 |
|---|---|
| 键鼠注入（AX/CGEvent/xdotool 级） | ❌ 无 |
| 屏幕观察（ScreenCaptureKit/桌面截图） | ❌ 无 |
| 应用/窗口管理 | ❌ 无 |
| 执行边界 | **浏览器标签页内**（CDP 页面域），进程外能力为零 |
| 与 12 家已测 agent 的 CU 对照 | 唯一"无 CU 工具面"的被测对象（其余均有桌面层或以 CU 兜底 BU） |

## 2. 负证据（全仓静态排查）

| 排查项 | 结果 | 证据 |
|---|---|---|
| 输入注入系统调用 | 零命中——动作全部经 CDP `Input.dispatch*`/DOM 事件，落在页面内 | `extension/understudy/page.ts`（keyDown/keyPress/mouse 系列）、`schema-registry.ts` page.* 31 方法无一处出页面 |
| 桌面截图 API | 零命中——`page.screenshot` 是**网页**截图（CDP Page.captureScreenshot 语义），仅截视口/整页 | `extension/dom/screenshotScripts/`、`protocol/schemas.ts`（ScreenshotParams：fullPage/viewport） |
| 窗口/应用枚举 | 零命中——"window"仅指 DOM window/iframe | `understudy/frame.ts` |
| 文件系统交互 | 仅两处：浏览器下载目录设置 + `<input type=file>` 注入（File 对象在页面内构造） | `sdk-ts/src/browser/localBrowser.ts`（Browser.setDownloadBehavior）、`understudy/fileUploadUtils.ts` |
| OS 进程操作 | 仅一件事：launch 本地 Chrome（spawn），flags 全部是浏览器加固开关 | `localBrowser.ts:11-47`（DEFAULT_CHROME_FLAGS 50 项） |
| CU 兜底 BU 形状 | 不存在——Stagehand 无桌面层可兜底；反过来自称"agents 用的浏览器 SDK" | 根 `README.md:19` |

## 3. 三个易误判点

| 表面现象 | 实际 |
|---|---|
| 扩展申请 `debugger` 权限 | 是 **chrome.debugger**（扩展内 CDP 客户端），作用域是标签页调试，不是系统调试 |
| `extract({screenshot:true})` 有"截图" | 网页视口 PNG，作 LLM 图像块辅助抽取；与桌面截屏无关（`extractService.ts:108-110`） |
| `localBrowser.launch()` 能启动进程 | 只启动 Chrome 本体并连 CDP（`localBrowser.ts`）；不能驱动启动后的任何 OS 界面 |

## 4. 为什么这个判定重要

**半自动派的选择：把执行域收敛进浏览器，换取协议面的纯净。**

| 视角 | 全自动 agent（如 goose/MiniMax/Claude Code） | Stagehand v4 |
|---|---|---|
| CU 与 BU 关系 | 两个能力域，CU 可兜底 BU（屏幕级点击浏览器） | 只有 BU；CU 需求被明确让渡给 OS 级工具链 |
| 权限模型 | TCC（屏幕录制/辅助功能）授权链 | 无 TCC——只有浏览器进程自身的沙箱边界 |
| 跨平台代价 | 每平台一套注入层（AX/CGEvent/uinput） | 一套 CDP，三语言 SDK 共享（TS/Python/Go） |
| "急停"语义 | 系统级热停/遮罩条 | `stagehand.close()`/browser handle 释放（进程内） |

> 结论复述：Stagehand 不是"能力不全的全自动 agent"，而是**另一个物种**——它把"agent 能做的"限定在浏览器协议能表达的范围内，用确定性代码+AI 逃生舱换生产可靠性。评估 CU/BU 光谱时应单列。

## 5. 佐证速查

- 官方能力清单通篇无桌面词表（对照根 README "Why Stagehand" 表，`README.md:289-309`）；
- 集成面（CrewAI/Mastra/Vercel AI SDK/Claude Code/Codex，`README.md:444`）全部以"浏览器工具箱"身份接入；
- 若任务真需要桌面（如打开原生 app），官方形态是让上层 coding agent 用自己的 shell 工具做，Stagehand 只接 URL 之后的部分——分册判定不受影响。
