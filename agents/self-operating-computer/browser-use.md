# Self-Operating Computer：Browser Use 判定书

> 结论：**零浏览器 API。BU 不存在为独立能力面——浏览器只是 CU 动作的一种"用法"**（键盘敲 URL + 视觉点击链接）。
> 基线 v1.5.8（commit `fac568e`，MIT）。负证据五面法如下。

## 1. 五面负证据

| 面 | 事实 | 证据 |
|---|---|---|
| 门控 | 无任何 browser 特性开关/模式；`-m` 只选视觉模型 | `main.py:13-19` |
| 安装面 | requirements 无 playwright/selenium/CDP/websocket 任何浏览器自动化依赖；最"近浏览器"的包是 Pillow（处理截图） | `requirements.txt` 全量 |
| 进程 | 无浏览器 helper/扩展/native messaging 宿主；15 个源码文件无一提及 chrome.debugger、CDP 端口 | `find operate -name '*.py'` 全集 |
| 配置 | config 只管 5 家模型 API key（OPENAI/GOOGLE/ANTHROPIC/QWEN/OLLAMA） | `config.py:50-129` |
| 权限 | 无 origin 白名单、无 cookie 处理、无登录态管理代码 | 全仓 grep 0 命中 |

## 2. "浏览器=键盘路径"的直接证据

浏览器操作被**明文写进 system prompt 的注意事项**，作为 CU 动作的推荐用法：

| prompt 指令 | 证据 |
|---|---|
| "Default to Google Chrome as the browser" | `prompts.py:189` |
| "Go to websites by opening a new tab with `press` and then `write` the URL" | `prompts.py:190` |
| "Go to Google Docs and Google Sheets by typing in the Chrome Address bar"（三套 prompt 均有） | `prompts.py:62,124` |
| 示例动作序列：`press ["command","t"]` → `write "https://docs.new/"` → `press ["enter"]` | `prompts.py:169-175` |
| v1.0 时代甚至硬编码 Chrome 地址栏坐标 `{x:50%, y:9%}` | v1.0.1 `operate/main.py` VISION_PROMPT |

即：打开网页 = `press` 热键 + `write` URL；页面交互 = 截图 + OCR/百分比 `click`。滚动靠 `press ["pagedown"]`（上游 prompt TODO 注释自认此法待补，`prompts.py:131`）。

## 3. 对比定位

| 维度 | Self-Operating Computer | 12 家 BU 极值参照 |
|---|---|---|
| 浏览器 API | 0 | Grok Bot 本机 0 但**云端有** browser_subagent；本项目云端也无 |
| 网页操作精度 | 视觉/OCR 级（可点错文本） | ref 句柄/CDP 级（DOM 语义） |
| 登录态 | 无（靠用户桌面已登录的浏览器） | 扩展复用真实 profile / cookie 导入 |
| 反爬/取证痕迹 | 与人手操作无异（真实键鼠事件） | 合成 DOM 事件 / CDP 可被检测 |
| CU 兜底 BU | **本项目的唯一形态** | 仅 Goose 把 CU 列为 BU 兜底之一 |

**判定**：browser-use 能力 = **无**（非"未启用"、非"断链"——架构上就不存在）。这使它成为 12 家 + 本册共 13 个对象中唯一"BU 完全为空且无云端补偿"的样本；其价值是标定光谱零点：现代框架的 BU 面每多一个工具，都是在给"敲 URL 点链接"这条最原始路径补洞。

## 4. 可复现验证

```bash
cd /tmp/soc-src && grep -rniE "cdp|playwright|selenium|devtools|browser\." operate/ --include='*.py' | wc -l
# 3——全部是 prompt 示例里的 "the browser. I can see…" 思考文本（prompts.py:54,108,172），非任何 API 代码
grep -rn "Address bar\|new tab" operate/models/prompts.py | wc -l   # 3
```
