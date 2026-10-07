# UI-TARS：Computer Use（桌面控制）逆向

> 基线：上游 `bytedance/UI-TARS-desktop` commit `2ff41a9e`（2026-09-24，Apache-2.0）；本机无安装，全部结论出自上游源码静态分析。
> 机制对照源码已 vendor：[source/ui-tars/vendor/](../../source/ui-tars/vendor/PROVENANCE.md)。

## 1. 速览

**桌面控制 = 截图进 VLM、模型吐坐标、nut-js 派发，全程无 AX 树。**

| 环节 | 实现 | 上游出处（相对仓库根） |
|---|---|---|
| 截图 | nut-js `screen.grab()`（CLI 版）/ Electron `desktopCapturer`（桌面版） | `multimodal/gui-agent/operator-nutjs/src/NutJSOperator.ts:79`、`apps/ui-tars/src/main/agent/operator.ts:39` |
| 模型 | UI-TARS VLM，OpenAI 兼容端点，返回 `Thought:/Action:` 纯文本 | `packages/ui-tars/sdk/src/GUIAgent.ts:270`（invoke） |
| 解析 | 正则 + 别名归一表 → `BaseAction` | `multimodal/gui-agent/action-parser/src/ActionParserHelper.ts:97` |
| 派发 | 归一坐标 × 屏幕宽高 → nut-js 移动/点击/滚轮/按键 | `NutJSOperator.ts:116-272` |
| 系统 TCC | Accessibility + Screen Recording（启动时引导授权） | `apps/ui-tars/src/main/utils/systemPermissions.ts:63` |

```
截图（JPEG, 物理像素）──► VLM ──► "Thought: …
                                    Action: click(start_box='(279,81)')"
                                        │ ActionParser
                                        ▼
                      BaseAction{type:'click', inputs:{start:{raw:{x:279,y:81}}}}
                                        │ ×(1/scaleFactor) 归一
                                        ▼
                      nut-js mouse.move(straightTo) → sleep(100) → mouse.click
```

## 2. 观察：整屏截图即上下文

**观察是"哑"的——不标注、不解析、不过滤。**

- 截图按物理像素抓取，JPEG（桌面版质量 75）回传；Retina 下除以 `pixelDensity.scaleX` 得逻辑宽高（`NutJSOperator.ts:91-107`）。
- 与 AX 派的根本差异：上下文里**没有控件树、没有元素 ID、没有 ref**，模型只靠看图。
- 桌面版把点击位置画在 UI 展示截图上（`setOfMarks.ts` + `ScreenMarker.ts` 透明置顶窗）——SoM 仅事后可视化，**不参与接地**；标注实现头注释致谢 Midscene（MIT）。

## 3. 解析：模型文本 → 动作对象

**四种坐标格式、几十个别名，全部收敛到一张 `BaseAction`。**

| 格式 | 例 | 处理 |
|---|---|---|
| box 标签 | `click(start_box='<\|box_start\|>(637,964)<\|box_end\|>')` | 预处理剥离标签 |
| point 标签 | `click(point='<point>510 150</point>')` | `point=`→`start_box=` 文本替换 |
| bbox | `drag(start_box='<bbox>x1 y1 x2 y2</bbox>',…)` | 中心即点击点，存 `referenceBox` |
| 裸坐标/四元组 | `click(start_box='(100,200)')` / `[130,226,132,228]` | 正则直取 |

| 归一层 | 例 | 出处 |
|---|---|---|
| 动作名 | `left_single`/`left_click`/`leftclick` → `click`（~50 别名） | `shared/src/utils/actions.ts:46-142` |
| 参数名 | `start_box`/`start_point` → `start`；`navigate` 的 `content` 特判为 `url` | 同文件 `:144-244` |
| 格式链 | UnifiedBC（`Thought:`+`Action:`）/ Omni / XML / BCComplex 五解析器顺序尝试 | `action-parser/src/FomatParsers.ts:171` |

Agent TARS 侧同一解析器换了个入口：`GUIAgentToolCallEngine` 把模型文本包成 `browser_vision_control` tool call（`agent-sdk/src/ToolCallEngine.ts:160-183`）——**prompt engineering 引擎，零原生 tool-call 依赖**，任何会吐文本的模型都能开跑。

## 4. 派发：坐标 → CGEvent

**归一坐标乘屏幕、raw 直用；先直线移动、停 100ms、再点击。**

| 动作 | nut-js 实现 | 细节 |
|---|---|---|
| click/double/right/middle | `mouse.click/doubleClick(Button.*)` | `handleClick`：移动→`sleep(100)`→点击 |
| drag/select | `mouse.drag(straightTo(end))` | 起终点各做坐标换算 |
| type | `keyboard.type` | **Windows 走剪贴板 Ctrl+V 粘贴再还原**（IME 规避）；结尾 `\n` 补回车 |
| hotkey/press/release | `keyboard.pressKey(...)` | `ctrl` 在 macOS 映射 `LeftCmd`（`getHotkeys` 键表） |
| scroll | `mouse.scrollUp/Down(500)` | 可先移动到 point 再滚 |
| wait/finished/call_user | 循环层处理 | 不落输入 |

坐标换算一条公式（`calculateRealCoords`，`NutJSOperator.ts:274-291`）：

```
realX = normalized ? normalized.x * screenContext.screenWidth : raw.x
```

## 5. 主循环与状态机

**v1 SDK 是裸 while 循环；Agent TARS 是"单工具 + 事件流"。**

| 机制 | v1 SDK（桌面端用） | Agent TARS（gui-agent 包） |
|---|---|---|
| 循环 | `while(true){截图→invoke→解析→execute}` | 模型循环 + `onAfterToolCall` 动作后补截图发 `environment_input` 事件 |
| 停机 | `finished`→END / `call_user`→CALL_USER / abort→USER_STOPPED / maxLoop→ERROR | `finished` 短路（ToolCallEngine 不生成 tool call） |
| 重试 | model 5× / screenshot 5× / execute 1×（桌面版默认） | loopIntervalInMs 500ms 节流 |
| 熔断 | maxLoopCount 默认 100；截图连续失败（MAX_SNAPSHOT_ERR_CNT） | maxIterations |
| 错误码 | -100000 截图 / -100001 调用 / -100002 执行 / -100004 超限 / -100005 环境 | `StatusEnum` 8 态 |

`call_user` 是路线特色：模型判断任务不可解时**主动移交人工**（状态机出处 `packages/ui-tars/shared/src/types/agent.ts:41-53`）。

## 6. 安全模型

**没有逐动作确认门——干预面只有 pause/abort/call_user 三个。**

| 层 | 事实 | 出处 |
|---|---|---|
| 确认 | 无 CU 专用授权、无 tier、无应用白名单（对比 Claude 三 tier / Qoder 四档确认） | 全仓 grep 无 confirm 门代码 |
| 暂停 | `pause()` 挂起 resumePromise；UI 停止按钮 → AbortSignal | `sdk/src/GUIAgent.ts:133-149` |
| 循环上限 | 100 轮默认，防死循环烧钱 | `shared/src/constants/vlm.ts:6` |
| 可视化 | 屏幕水流特效 + 预测点击位画框——执行可见但**不可拦截单步** | `window/ScreenMarker.ts` |
| TCC | 授权给宿主 App；nut-js 无自有权限模型 | `utils/systemPermissions.ts` |

> 与 12 家对照：这是安全面**最薄**的一档（只有 goose 的 auto 模式可与之比），代价换来的是三行代码的极简执行层。

## 7. 与 12 家的路线矩阵

| | 观察源 | 定位子 | 执行器 | AX 依赖 |
|---|---|---|---|---|
| **UI-TARS** | 截图 | 模型坐标 | nut-js（CGEvent） | **零** |
| ZCode/Codex | AX diff | AX 句柄 | ax_native.node / Sky 服务 | 全量 |
| Goose+Peekaboo | AX 标注截图 | 元素 ID B1/T2 | Peekaboo CLI | 半（标注来自 AX） |
| Claude/MiMo | AX+截图 | AX + SkyLight 私有 API | 自研 Helper | 全量 |

**复刻最小骨架**：`node source/ui-tars/reference/test.mjs` → ALL PASSED (11 checks)。
