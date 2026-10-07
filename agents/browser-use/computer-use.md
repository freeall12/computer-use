# Browser Use（开源库）· Computer Use 判定书：零桌面控制代码

> 一句话结论：**全树 grep 无任何 AX/CGEvent/ScreenCapture 代码——browser-use 不做 Computer Use，也不需要做；它的桌面能力外包给"浏览器即桌面"这个前提。**

| 项 | 值 |
|---|---|
| 桌面 CU 工具面 | **0 个** |
| 原生 API 依赖 | 仅 `pyobjc`（macOS 平台标记，用于窗口定位/屏幕信息等浏览器启动辅助，非 UI 自动化） |
| 与 CU 的最近距离 | `screeninfo`/`pyobjc` 读屏幕分辨率；`demo_mode` 往浏览器窗口投日志 |
| 本机可用 | ⚙️ 未安装（纯上游源码判定，非本机取证对象） |

## 判定依据

| # | 证据 | 含义 |
|---|---|---|
| 1 | `pyproject.toml` dependencies 全清单：无 ApplicationServices/AX/Quartz 类依赖；`pyobjc==12.1; platform_system == 'darwin'` 与 `screeninfo`（非 macOS）只在列 | 依赖层无桌面自动化入口 |
| 2 | 全仓 grep `AXUIElement\|CGEvent\|ScreenCaptureKit\|accessibility` 于非注释代码零命中（AX 命中全部是 **Chrome 网页 AX 树**，即 `Accessibility.getFullAXTree` CDP 域） | 代码层无桌面自动化实现 |
| 3 | 唯一的进程操作是 `asyncio.create_subprocess_exec(chrome ...)` 启动浏览器（`local_browser_watchdog.py:146`） | 进程面只有浏览器子进程 |
| 4 | 动作注册表 24 个动作全部落在浏览器事件（`tools/service.py`），无一触达 OS 输入/窗口系统 | 工具面封闭在浏览器 |

## 和 12 家 CU 分册的坐标对齐

12 家把 CU/BU 当两个工具面并列；browser-use 是**只做 BU 的极端样本**，与 Grok Bot（本机零浏览器 API，纯 coding）正好构成谱系两端：

| 谱系位置 | 样本 | CU | BU |
|---|---|---|---|
| 纯 CU 极端 | Claude CLI `--computer-use-mcp`（无 BU 时） | ✅ | ❌ |
| 双面齐全 | ZCode / Cursor / Kimi 等 9 家 | ✅ Helper/驱动 | ✅ 内嵌或扩展 |
| 纯 BU 极端 | **browser-use（本册）** | ❌ | ✅ CDP 全链路 |
| 双无极端 | Grok CLI 16 工具纯 coding | ❌ | ❌ |

## 为什么"不做 CU"反而成立

- **任务域封闭**：浏览器任务的观察（DOM）与执行（CDP 输入合成）都在页面进程内完成，不需要 OS 层介入——12 家里内嵌 WebView 派（ZCode/MiniMax 等）本质也是这个思路的产品化收窄。
- **无人值守友好**：CDP 合成事件不抢真实鼠标键盘、不依赖窗口前台，天然规避了 12 家 CU 分册反复处理的锁屏/焦点/TCC 三大难题。
- **要出浏览器怎么办**：文件上传/下载（`upload_file`/DownloadsWatchdog）是它跨越浏览器边界的仅有的两个桥，且两端都被白名单拦住（inventory F1/E6-E7）。

> 结论：CU 维度对本对象不适用，能力面完整分析见 [browser-use.md](browser-use.md)；证据路径级清单见 [evidence/inventory.md](evidence/inventory.md)（§F 安全、§E 动作）。
