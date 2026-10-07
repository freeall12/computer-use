# source/browser-use/ —— browser-use（开源库）BU 能力三层源码

> 对应分册：[agents/browser-use/](../../agents/browser-use/README.md)（总览）、[computer-use.md](../../agents/browser-use/computer-use.md)（CU 判定书）、[browser-use.md](../../agents/browser-use/browser-use.md)、[evidence/inventory.md](../../agents/browser-use/evidence/inventory.md)。

## 版本基线

| 项 | 值 |
|---|---|
| 上游 | `github.com/browser-use/browser-use` |
| 版本 | **0.13.11** |
| 修订 | commit `c75e8476e26d18b7617643bc2ae082fae8eae431`（2026-10-07 09:39 UTC-7，shallow clone HEAD） |
| 许可证 | **MIT**（Copyright (c) 2024 Gregor Zunic） |
| 语言 | Python ≥3.11（自研 `cdp-use` CDP 客户端 + `bubus` 事件总线，无 Playwright 运行时依赖） |
| 本机安装 | 无（库形态，`pip install browser-use` 即用；本目录三层全部基于上游源码） |

## 三层结构

```
source/browser-use/
├── schemas/tools.json   24 个动作面规范化 JSON（手写整理，条目带上游 文件:行号）
├── reference/           cleanroom 最小骨架（TypeScript）：DOM 快照→[ref] 句柄→动作循环→done
└── vendor/              上游 MIT 源码核心子集原样搬运（附 PROVENANCE + LICENSE 全文）
```

### 1. vendor/（搬运范围 = 机制对应的最小源码子集，21 文件）

| 子目录 | 内容 | 对应分册章节 |
|---|---|---|
| `browser_use/agent/` | Agent 主循环（step 四阶段/multi_act 守卫/judge/planning）+ 输出 schema + 系统提示 | 观察与循环 |
| `browser_use/dom/` | 三 CDP 源合并（DOMSnapshot+DOM+AX）、DOMTreeSerializer、selector_index 分配 | **[index] 句柄机制** |
| `browser_use/tools/` | 24 个动作注册、Pydantic 参数模型、Registry、`<secret>` 替换 | 动作面 + 密钥协议 |
| `browser_use/browser/` | BrowserSession、Profile（域白名单）、6 个关键 watchdog（DOM/截图/安全/下载/启动/动作执行） | 执行与安全 |

每个文件与上游逐字节一致（仅 `agent/message_manager/service.py` 平铺为 `message_manager_service.py`）；sha256 完整性见 PROVENANCE §3。

### 2. schemas/tools.json（接口数据，手写整理）

动作面 24 动作（23 组条目，write_file 族合写）：click / input / navigate / search / go_back / wait / scroll / scroll / send_keys / switch / close / upload_file / extract / search_page / find_elements / dropdown_options / select_dropdown / screenshot / save_as_pdf / evaluate / write_file 族 / done。每条带 `source` 字段标注上游 文件:行号；另附观察格式（`[index]<tag />` 文本树）与安全机制三个条目。`_provenance.status = 文档`。

### 3. reference/（cleanroom 参考实现）

`browser-use-mini.ts`（TypeScript，Node ≥23.6 直接运行；22.6-23.5 加 `--experimental-strip-types`）：按行为规格复现形状，**非**上游 Python 代码转写——

- 极简 HTML 解析 → mock 三源合并（layout/AX/input 三层数据）→ `ClickableElementDetector` 简化规则 → `selector_index` 从 1 递增台账；
- 序列化文本树（`[i]<tag attrs />`、`*` 新元素、属性无引号，与上游格式一致）；
- 动作注册表：navigate/click/input/upload_file/switch/done，`terminates_sequence` 短路 + multi_act URL/焦点双守卫；
- `<secret>占位符</secret>` 执行期替换（含域作用域）+ 历史回显脱敏；
- `allowed_domains` 导航围栏（命中回 about:blank）+ 上传白名单 + file input 禁点指路。

`test.mjs`：9 组断言（交互判定 / 序列化格式 / Agent 循环 / 密钥协议 / 句柄失效 / 上传白名单 / 导航围栏 / 双守卫 / 标签页），末行 `ALL PASSED`。运行 `node test.mjs`。

## 许可证归属

| 目录 | 归属 | 许可证 |
|---|---|---|
| `vendor/` | Gregor Zunic / browser-use 上游 | MIT（全文见 `vendor/LICENSE-mit.txt`；归属与完整性见 `vendor/PROVENANCE.md`） |
| `schemas/tools.json` | 本仓库手写整理（事实来自 MIT 上游） | 随本仓库 LICENSE |
| `reference/` | 本仓库 cleanroom 撰写 | 随本仓库 LICENSE |
