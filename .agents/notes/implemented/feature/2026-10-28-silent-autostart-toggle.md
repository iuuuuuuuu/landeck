# Agent Note: 开机自启的「静默启动」开关（不弹窗口，只进托盘）

Status: implemented

## Problem

用户提需求：「开机自启，是否静默启动——不要出现窗口，就在后台自动启动在托盘」。

排查后发现这不是从零做，而是**已有半成品 + 两个真缺陷**：

1. `--silent` 的**运行时处理早就有了**（`setup_window` 检测到就 `win.hide()`），
   托盘也早就有了（`setup_tray` 含 `tray_icon_app`）。
2. **Windows 自启项写死了 `--silent`**，没有开关可关。
3. **macOS 的 plist 和 Linux 的 .desktop 根本没传 `--silent`** ——
   这两个平台开机必然弹窗，与 Windows 行为不一致，一直没人发现。
4. 实测用户机器上 2026-10-25 创建的自启快捷方式 `Arguments` 为空：
   那时 `--silent` 还没加进 `autostart.rs`，之后代码虽然改了，
   **那条旧快捷方式从未被重写**，所以每次开机照样弹窗。

## Decision

### 1. 新增持久化偏好 `silent_autostart`（默认 true）

写进 `prefs.rs` 的 `Prefs`，`#[serde(default = "default_true")]`。
默认 true 的理由：开机自启的本意就是「在后台候着」，弹窗是打扰；
且老版本用户没有这个字段，`serde(default)` 让他们升级后直接得到静默行为。

### 2. 三平台自启项都按偏好写参数

- Windows：`$s.Arguments = '--silent'` 或 `''`
- macOS：`ProgramArguments` 数组追加 `<string>--silent</string>`
- Linux：`Exec="exe" --silent`

`enable()` / `enable_as()` 都接受 `silent: bool`。

### 3. 启动时自愈：`sync_autostart_entry()`

自启已开启时，在 `setup` 里按当前偏好重写一次自启项。

**为什么必须自愈**：自启项里写死了参数。老用户的条目没有 `--silent`，
而新版本默认偏好是 true —— 不对齐的话，设置页会显示「已开启静默」，
开机却照样弹窗，**界面与实际行为不一致**，用户只会认为开关是坏的。
失败只打印日志，不打扰用户（下次切换开关会再试）。

### 4. 设置页加「静默启动」开关

只在「开机自启」开启时显示（没开自启时无从谈起）。
文案明确写「开机时不显示窗口，只在托盘里运行；从托盘或双击图标打开仍会显示窗口」——
否则用户手动双击图标发现还是弹窗，会以为开关没生效。

### 5. 把跨平台内容生成抽成纯函数

`macos_plist_body(exe, silent)` / `linux_desktop_body(exe, silent)` 移到模块顶层、
不放在 `#[cfg(target_os)]` 里。理由：这两条逻辑在 Windows 上根本编译不到，
也就永远验证不了 —— 而「plist 漏了 --silent」正是这次发现的真实缺陷。
抽出来之后任何平台都能单测。

## Alternatives considered

- **只加 UI 开关、不做启动自愈**：老用户的旧自启项不会被修，界面会与行为不一致。放弃。
- **自愈改到「每次切换开关时」才重写**：正是现在的做法，但覆盖不到「升级后没进设置页」的用户。所以在 setup 里也做一次。放弃单一时机。
- **每次启动都无条件重写（不管是否开启）**：会凭空创建自启项，等于帮用户开了自启。放弃。
- **把 `--silent` 改成默认总是传、不给开关**：用户明确要「是否」，说明要可选。放弃。
- **用注册表 Run 键代替启动文件夹**：历史已证 KEY_SET_VALUE 在本机被策略拒绝（见 autostart.rs 顶部注释）。放弃。
- **prefs 解析失败时容错跳过 BOM**：实测 `Set-Content -Encoding UTF8` 会写 BOM，`serde_json` 解析失败后静默回落默认值。这是健壮性缺口，但 app 自身写文件从不带 BOM（`serde_json` + `fs::write`），属外部篡改场景，超出本次范围，仅记录不改。

## Consequences

收益（已在真机逐条实测）：
- 开机不再弹窗口：`Tauri Window visible=False`，`tray_icon_app` 存在。
- 自启项与偏好一致，界面不再说谎。
- 三平台行为统一。
- 手动双击图标仍然显示窗口（符合直觉）。

代价与边界：
- 每次启动若自启已开启，会多一次 PowerShell 调用重写快捷方式（约百毫秒级），可接受。
- 自愈会把 `TargetPath` 指向**当前运行的 exe**。若用户从别的目录跑一份副本，
  自启项会被指向那个副本 —— 语义上「最后运行的那份接管」，但值得知情。
- `silent_autostart` 默认 true：老用户升级后即使从没进过设置页，也会变成静默启动。
  这是有意的（正是用户要的行为）。
- prefs.json 若被外部写成带 BOM，所有偏好会静默回落默认值（含主题、窗口几何）。

## Testing

**Rust 单测（6 个，全绿）**：
- `autostart_silent_flag_written_into_shortcut`：真的建 .lnk 并读回 Arguments，
  断言 `true -> [--silent]`、`false -> []`。
- `autostart_roundtrip`：建/删快捷方式全流程。
- `autostart_macos_plist_contains_silent_flag`：plist 含/不含 `--silent`。
- `autostart_linux_desktop_contains_silent_flag`：.desktop 的 Exec 含/不含 `--silent`。
- `local_ip_returns_private_v4`、`scan_lan_finds_local_agent`（真实扫描）。

**故障注入（证明门禁会变红）**：
- 把 `let args = if silent {...} else {...}` 写死成总是 `--silent`
  → 两个快捷方式测试精确变红（`非静默模式不应有 --silent`）。
- 把 plist 生成改回旧 bug（不传 silent）
  → `autostart_macos_plist_contains_silent_flag` 变红。

**UI 端到端（无头浏览器 + 注入 Tauri 运行时，不开 GUI、不抢焦点）**：12 项全绿，
含「点击静默开关实际调用 `silent_autostart_set{enabled:false}`」「toast 出现」
「自启关闭时静默开关隐藏」。故障注入（去掉 `auto &&` 条件）能让其中一项变红。

**真机端到端（用户机器的真实自启项）**：
- 部署新 exe → 以 `--silent` 启动 → 真实 `Startup\LanDeck.lnk` 的
  `Arguments` 从 `[]` 自动变成 `[--silent]`（自愈生效）。
- 反向：`silent_autostart=false` → 启动后 `Arguments` 回到 `[]`。
- 窗口：`Tauri Window visible=False`、`tray_icon_app` 存在。
- 顺带重回签名：cargo 产物是 `NotSigned`，已用 `sign-windows.ps1` 补签为 `Valid`
  （否则开机自启会弹「未知发布者」）。

**顺带修掉一个我之前引入的缺陷**：把 `local_ip` 改成 `async` 后，
测试 `local_ip_returns_private_v4` 仍在调同步版，导致整个测试目标编译不过。
已改为 `local_ip_blocking()`。

## Note on环境限制

`std::env::temp_dir()` 在本会话沙箱下写入被拒（`os error 5 拒绝访问`），
测试改用工作区内目录（从测试二进制路径上溯两级 + `test-tmp/`）。
这同时避免了「受管机器拒写 %TEMP% 时测试落到失败分支却仍报通过」的假绿。