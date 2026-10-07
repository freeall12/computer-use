# source/self-operating-computer/ —— Self-Operating Computer（OthersideAI）CU 能力三层源码

> 对应分册：[agents/self-operating-computer/](../../agents/self-operating-computer/README.md)（总览）、[computer-use.md](../../agents/self-operating-computer/computer-use.md)、[browser-use.md](../../agents/self-operating-computer/browser-use.md)、[evidence/inventory.md](../../agents/self-operating-computer/evidence/inventory.md)。
> 定位：12 家之外的**第 13 册**——CU 范式的"化石级对照组"：最古老（2023-11）、最简（一个 Python 包），
> 一切现代安全机制（租约/防重放/验证/白名单）它都没有。

## 版本基线

| 项 | 值 |
|---|---|
| 上游 | `github.com/OthersideAI/Self-Operating-Computer` |
| 版本 | **1.5.8**（setup.py:13；tag `v1.5.8`，2025-02-28） |
| 修订 | commit `fac568eea7da5e24f8bc91bfc1211b65679177eb`（2025-09-19 UTC-7，shallow clone HEAD，上游最后一个 commit） |
| 许可证 | **MIT**（`Copyright (c) 2023 OthersideAI`，全文见 `vendor/LICENSE-mit.txt`） |
| 语言 | Python（单包 `operate/`，15 个 .py 文件 + 1 个 YOLO 权重二进制） |
| 首个提交 | `88a81ce`（2023-11-03）——早于全部 12 家分册对象的 CU 能力面 |
| 本机安装 | 无（不适用：这是一个 pip 库/框架，不是常驻产品；分析全部基于上游源码） |

## 三层结构

```
source/self-operating-computer/
├── schemas/tools.json        动作语法 + 模型矩阵 + 观察链规范化 JSON（prompt 内嵌协议的工具化表述）
├── reference/                cleanroom 重写的最小循环骨架（TypeScript，Node ≥22.6 原生运行）
│   ├── self-operating-loop.ts
│   └── test.mjs              12 项断言自测
└── vendor/                   上游 MIT 源码子集原样搬运（15 文件逐字节一致）
    ├── PROVENANCE.md         出处/范围/逐字节校验说明
    ├── LICENSE-mit.txt       上游 LICENSE 全文
    └── operate/              全部核心循环源码（main/operate/apis/prompts/config + 5 个 utils）
```

### 1. vendor/（开源搬运）

上游**整仓即开源**（MIT），CU 能力 = 整个 `operate/` 包，因此搬运范围是该包**全部 15 个源码文件**
（排除唯一的二进制 `operate/models/weights/best.pt`，其加载点 apis.py:653-654 已在文档标注）。
`cmp` 逐字节校验通过，未做任何修改。文件角色映射见 [vendor/PROVENANCE.md](vendor/PROVENANCE.md)。

### 2. schemas/tools.json（接口数据，手写整理）

本项目没有 MCP/SDK 工具面——**动作语法内嵌在 system prompt 文本里**（"Your output will be used
in a `json.loads` loads statement"，prompts.py:16）。schemas 把这份 prompt 内嵌协议按工具 schema
形状规范化：4 操作 × 3 变体（standard 百分比 / ocr 文本 / som 标签）、9 模型适配器与兜底链、
平台自适应键位、voice 输入、v1.0 遗留死代码与安全面清单。每条带 `vendor/` 文件:行号出处。

### 3. reference/（cleanroom 参考实现）

`self-operating-loop.ts`（可擦除 TS，零依赖）：截图接口 → prompt 构造（平台键位/三档变体）→
`clean_json` + JSON 数组解析 → OCR/SoM 坐标解析器 → pyautogui 形状的输入合成
（逐字符 write / combo press / 百分比→像素 + 画圈点击）→ 主循环（done/unknown 终止 +
11 轮硬上限）→ 兜底链（重写 system prompt 重试，**封顶 2 次**——上游是无界递归，这是唯一的
刻意行为差异，其余全部按上游语义复刻）。
`test.mjs` 12 项断言全绿：

```bash
node source/self-operating-computer/reference/test.mjs
# ALL PASSED (12 checks)
```

## 许可证归属

| 目录 | 归属 | 许可证 |
|---|---|---|
| `vendor/`（operate 15 文件 + LICENSE） | OthersideAI（上游仓库） | MIT（全文原样保留） |
| `schemas/` `reference/` | 本仓库 cleanroom 撰写 | 随本仓库根 LICENSE（MIT） |
