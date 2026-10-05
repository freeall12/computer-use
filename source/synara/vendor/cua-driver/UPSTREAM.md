# vendor/cua-driver — 上游来源与修订说明（Synara 侧）

## 上游仓库

- **仓库**：<https://github.com/trycua/cua>（Cua AI, Inc.）
- **许可证**：MIT（全文见本目录 `LICENSE.md`，`Copyright (c) 2025 Cua AI, Inc.` —— 与 Synara 包内
  `Contents/Resources/cua-driver/LICENSE.txt` 的版权声明一致）
- **搬运日期**：2026-10-06

## 搬运的修订版本

| 项 | 值 |
| --- | --- |
| 版本 | **0.28.2**（Synara 0.9.2 随包引擎 `Contents/Resources/cua-driver/cua-driver` 的 provenance.json 版本） |
| 上游提交 | `fc188250b4ca8549b8e61f937fdb1fb560770e86` —— 该提交处上游 `libs/cua-driver/rust/VERSION` 恰为 `0.28.2`（release-please 发布提交） |
| 定位方法 | 同 minimax 侧：遍历 `commits?path=libs/cua-driver/rust/VERSION` 历史逐提交匹配 |
| 与 Synara 二进制的关系 | Synara 的 provenance.json 记载上游 commit `7fe7c33f…`（截断显示，完整 SHA 未知）+ `patched: true` + `nativeRevision: 39` + patchSha256。本目录是 **0.28.2 官方发布提交**的干净源码，可作为"补丁前基线"；`7fe7c33f…` 与发布提交的确切关系未验证（低置信，见下） |

## 搬运的子集（工具契约层，同 minimax 侧但为 0.28.2）

```
v0.28.2/
├── LICENSE.md                          # MIT 全文
├── README.md                           # libs/cua-driver/README.md
├── contract/
│   ├── manifest.json                   # 28 个工具契约（较 0.22.1 新增 list_apps/list_windows/
│   │                                   #   get_window_state —— window/app 域工具整体入清单）
│   ├── README.md
│   └── fixtures/session-success.json
└── rust/crates/cua-driver-contract/    # 契约 crate 源码
    ├── Cargo.toml / uniffi.toml（如存在）
    └── src/{lib,inputs,desktop,windows,outputs,compatibility}.rs
```

## Synara patched 差异点（引用分册，非本目录内容）

Synara 在上游二进制上打了补丁（provenance.json `"patched": true`），分册可确认的差异点：

1. **`synara_native_revision` 握手校验**：宿主 spawn 后经 `metadata` 握手强制校验
   `synara_native_revision`（main.js:1691 附近，80 次重试），版本不符拒绝使用 —— 上游无此字段。
2. **合成光标**：patched 版 spawn 才追加 `--compact-cursor --idle-hide-ms <ms>` 参数
   （main.js:1601-1636），stderr 事件 `synara_cua_overlay_init` / `synara_cua_focus_restore`。
3. **`browser_input_control` 取消清理**（分册推断，中低置信）。

宿主环境变量面（`CUA_DRIVER_EMBEDDED=1`、`CUA_DRIVER_HOST_BUNDLE_ID`、
`CUA_DRIVER_PERMISSION_MODE=standard`、遥测/自更新双关、`CUA_DRIVER_PARENT_LIVENESS_STDIN=1`、
观察节奏 100/350ms）全部是宿主侧注入，非驱动补丁内容。

> 证据：`agents/synara/computer-use.md` §1/§2、`agents/synara/evidence/inventory.md` B1-B3/B17。

## 置信度低处

- Synara 补丁的完整 diff 内容未逐条复原（仅有 patchSha256 与上述三点旁证）。
- provenance.json 的上游 commit `7fe7c33f…` 与本目录发布提交 `fc188250…` 之间的对应关系未验证；
  若需逐字节核对，应取 Synara 包内 `cua-driver` 二进制与上游同 commit 构建产物比对。

## 合规声明

- 仅搬运 MIT 开源源码子集，LICENSE.md 全文随附；未搬运 Synara 专有代码（main.js、
  cuaDriverHostStandalone.js、appsnap-helper 等均不入仓库）。
- 未修改上游文件内容。
