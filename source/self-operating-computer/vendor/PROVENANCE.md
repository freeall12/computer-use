# PROVENANCE —— vendor/ 搬运出处说明

## 1. 上游信息

| 项 | 值 |
|---|---|
| 项目 | Self-Operating Computer Framework（OthersideAI / HyperWrite） |
| 上游 URL | https://github.com/OthersideAI/Self-Operating-Computer |
| 版本 | **1.5.8**（tag `v1.5.8`，setup.py:13 `version="1.5.8"`） |
| 修订 | commit `fac568eea7da5e24f8bc91bfc1211b65679177eb`（2025-09-19 UTC-7，shallow clone HEAD） |
| 许可证 | **MIT**（上游整仓，全文见 [LICENSE-mit.txt](LICENSE-mit.txt)，版权声明 `Copyright (c) 2023 OthersideAI`） |
| 搬运日期 | 2026-10-07 |
| 首个提交 | `88a81ce`（2023-11-03，"Initial commit"）——README.md:8 自述 "Released Nov 2023… one of the first examples of full computer-use" |

## 2. 搬运范围与逐字节一致性

搬运范围 = `operate/` Python 包**全部源码文件**（15 个，`find operate -name '*.py'` 全集），即
"截图 → 多模态模型 → pyautogui 合成输入" 完整链路所需的一切源码。**排除**：

- `operate/models/weights/best.pt`（YOLOv8 二进制权重，6,232,473 字节 ≈ 6.2MB，非文本文件，不搬运；
  其加载点在 `operate/models/apis.py:653-654`）；
- `setup.py` / `requirements.txt` / `requirements-audio.txt` / `evaluate.py` / README / CI 配置
  （非核心循环；requirements 键值已摘录进各分册 evidence）。

**逐字节一致性**：15 个 `.py` 文件均与上游 `fac568e` 逐字节一致（`cmp` 校验通过），
未做任何修改、重命名或格式调整，目录结构保持上游原样（`operate/…`）。

## 3. 文件清单与角色

| 文件 | 角色 | 对应机制出处 |
|---|---|---|
| `operate/main.py` | CLI 入口（argparse：`-m` / `--voice` / `--verbose` / `--prompt`） | agents/self-operating-computer/computer-use.md §2 |
| `operate/operate.py` | 主循环（while True + `loop_count > 10` 上限）+ 动作分派（press/write/click/done） | computer-use.md §3、§4 |
| `operate/models/apis.py` | 视觉接口：9 个模型适配器（gpt-4o / o1 / gpt-4.1 / qwen-vl / claude-3 / gemini / llava）+ OCR 坐标解析 + SoM + `gpt_4_fallback` 兜底 | computer-use.md §5 |
| `operate/models/prompts.py` | 动作语法（内嵌于 system prompt 的 4 操作 JSON 协议，三套变体）+ 平台自适应键位 | computer-use.md §3.1 |
| `operate/utils/operating_system.py` | 输入合成封装：`pyautogui.write`（逐字符）/ `keyDown+keyUp`（0.1s）/ 百分比坐标→像素 + 装饰性画圈点击 | computer-use.md §6 |
| `operate/utils/screenshot.py` | 截图三分支：macOS `screencapture -C` / Windows `pyautogui.screenshot` / Linux Xlib `ImageGrab` | computer-use.md §5.1 |
| `operate/utils/ocr.py` | EasyOCR 结果 → 文本元素 → 边界框中心百分比坐标 | computer-use.md §5.2 |
| `operate/utils/label.py` | SoM 标签（`~x`）→ 坐标 + 点击百分比换算 | computer-use.md §5.3 |
| `operate/utils/misc.py` | **遗留死代码**：v1.0 时代文本协议解析器（`CLICK {}` / `TYPE` / `SEARCH` / `DONE`），现行 JSON 协议已不用 | computer-use.md §3.2（演进史） |
| `operate/config.py` | API key 管理（dotenv + 弹窗收集 + 明文追加写 `.env`） | computer-use.md §7（安全差距） |
| `operate/exceptions.py` | `ModelNotRecognizedException` | — |
| `operate/utils/style.py` | ANSI 颜色常量 | — |
| `operate/__init__.py` 等 3 个 | 空包标记 | — |

## 4. 许可证映射

| 目录/文件 | 归属 | 许可证 |
|---|---|---|
| `vendor/operate/**`（15 文件） | OthersideAI（上游仓库） | MIT（全文见 `LICENSE-mit.txt`） |
| `schemas/` `reference/` | 本仓库 cleanroom 撰写 | 随本仓库根 LICENSE（MIT） |

MIT 无 NOTICE 附加要求；保留上游版权声明即满足条件（`LICENSE-mit.txt` 原样保留）。

## 5. 与本仓库其他 vendor 层的差别

Self-Operating-Computer 是本仓库**首个上游即完整开源项目、且被整体 vendor 的对象**
（goose 只 vendor 了 CU 相关 crate 子集；minimax/synara 只 vendor cua-driver contract）。
原因：上游本身就是"一个 Python 包 = 全部 CU 能力"的极简结构，无专有分发物、无二进制、
无凭据——15 个文本文件即完整实现。
