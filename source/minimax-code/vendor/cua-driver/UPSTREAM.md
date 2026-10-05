# vendor/cua-driver — 上游来源与修订说明

## 上游仓库

- **仓库**：<https://github.com/trycua/cua>（Cua AI, Inc.）
- **许可证**：MIT（全文见本目录 `LICENSE.md`，版权声明 `Copyright (c) 2025 Cua AI, Inc.`）
- **搬运日期**：2026-10-06

## 搬运的修订版本

| 项 | 值 |
| --- | --- |
| 版本 | **0.22.1**（与 MiniMax Code.app 3.1.0 内嵌的 `@trycua/cua-driver` npm 包版本一致，证据：`agents/minimax-code/computer-use.md` §2、`evidence/inventory.md` B 节） |
| 上游提交 | `c60ef6ad2db8774fb342938843e2f17f26c68240` —— 该提交处上游文件 `libs/cua-driver/rust/VERSION` 内容恰为 `0.22.1`（release-please 发布提交，2026 年内） |
| 定位方法 | 遍历 GitHub API `commits?path=libs/cua-driver/rust/VERSION` 历史，逐提交读取 VERSION 文件匹配 `0.22.1` |
| 对应 npm 产物 | `@trycua/cua-driver@0.22.1`（registry.npmjs.org，MIT，`repository: git+https://github.com/trycua/cua.git`）。npm 包是 UniFFI/JS 绑定层（dist/index.js、electron.js），本仓库搬运的是同 release 的 Rust 源码**工具契约层**，两者共享同一套工具语义 |

## 搬运的子集（仅为工具定义/契约层，非完整仓库）

```
v0.22.1/
├── LICENSE.md                          # 上游根 LICENSE.md（MIT 全文）
├── README.md                           # libs/cua-driver/README.md
├── contract/
│   ├── manifest.json                   # 工具契约清单（25 个工具：click/drag/get_desktop_state/
│   │                                   #   hotkey/invoke_menu/press_key/scroll/set_window_frame/
│   │   │                               #   start_session/type_text/verify_state/get_screen_size/
│   │   │                               #   move_cursor/clipboard_*/session 系/cursor 系）
│   ├── README.md
│   └── fixtures/                       # 会话成功/图片结果/工具拒绝 三份契约样例
└── rust/crates/cua-driver-contract/    # 契约 crate 源码（~3.9k 行）
    ├── Cargo.toml / uniffi.toml
    └── src/
        ├── lib.rs                      # ToolContract/ContractManifest + 工具名校验
        ├── inputs.rs                   # 各工具输入类型（ClickInput/TypeText/SetWindowFrame/
        │                               #   InvokeMenu/StartSession… + action_target_schema）
        ├── desktop.rs                  # list_windows/get_desktop_state 输出 schema
        ├── session.rs                  # start_session/end_session 生命周期
        ├── verification.rs             # verify_state 谓词验证契约
        ├── outputs.rs                  # 结构化输出契约
        ├── compatibility.rs            # 兼容性/降级
        ├── cursor.rs / cursor_tools.rs # agent 光标语义（含 element_token/delivery_mode
        │                               #   foreground/background 路由判定、list_apps/
        │                               #   launch_app/bring_to_front 等 App 类动作）
        └── bin/cua-contract-gen.rs     # manifest 生成器
```

## 与分册 17 个 computer_* 工具的对应关系

MiniMax 侧 `cua-utility-server.js` 的 `mapRequestToCuaTool` 把宿主 17 工具映射到本驱动工具名：
`list_apps / list_windows / get_desktop_state / get_window_state / launch_app / bring_to_front /
click / double_click / type_text / set_value / hotkey / press_key / scroll / invoke_menu /
verify_state / set_window_frame / start_session`。

这些名字全部出现在本子集中：
- `contract/manifest.json` 直接定义其中 14 个（click/drag/hotkey/invoke_menu/press_key/scroll/set_window_frame/start_session/type_text/verify_state/get_desktop_state/get_screen_size/move_cursor/clipboard_*）；
- `cursor.rs` 的动作分类表（`CursorAction::App => "launch_app" | "activate_app" | "bring_to_front" | "set_window_frame" | "invoke_menu" | "list_apps" | "list_windows" | "kill_app"` 等）与 `desktop.rs`、`lib.rs` 的输出 schema 覆盖其余 window/app 域工具（list_apps/list_windows/get_window_state/set_value/double_click/element_token/delivery_mode）。

> 说明：0.22.1 的 manifest 以桌面/会话域工具为主，window/app 域工具（list_apps、get_window_state、set_value 等）在 `cursor.rs`/`desktop.rs`/`lib.rs` 的分类与校验层中定义；到上游 0.28.2（见 `source/synara/vendor/cua-driver/v0.28.2/`）这些工具才整体进入 manifest.json。这与 MiniMax 分册"宿主 17 工具 → 驱动工具"映射表的观察一致。

## 合规声明

- 本目录仅搬运 MIT 许可的上游开源源码子集，保留原版权与许可声明（LICENSE.md 全文随附）。
- 未搬运任何 MiniMax 专有代码（`@mavis/*`、`dist/main/**` 均不入仓库）。
- 未修改上游文件内容；本目录结构（版本目录划分、UPSTREAM.md）为整理者添加。
