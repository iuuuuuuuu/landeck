# Agent Note: 轻量模式（关窗销毁 WebView，释放页面内存）

Status: implemented

## Problem

用户要求：

> 再支持一个功能，就是轻量模式，当关闭窗口缩小在任务栏的时候，释放页面占用内存，只保留服务

现状：关窗只是 `hide()`。WebView2 的渲染进程并没有退出，实测**空闲状态下 6 个进程、
WorkingSet ≈ 700 MB**。对一台整天挂着的机器来说，这部分内存纯属浪费 —— 用户既然把窗口
收起来了，就不会立刻看界面。

## Decision

新增偏好 `prefs.lightweight_mode`（默认 **false**，老用户升级后行为不变），配套设置项
「轻量模式」。

打开后，`CloseRequested` 里：

1. 先 `save_window_geometry()`（销毁后重建要回到原位置）；
2. `api.prevent_close()` 之后调 `webview_window.destroy()` —— **真正销毁 WebView**，
   渲染进程随之退出，内存还给系统；
3. 托盘图标保留，被控端 agent 是独立进程，不受影响。

再次打开时 `show_main()` 发现 `get_webview_window("main")` 为空，调用
`create_main_window()` 按 prefs 里的尺寸/位置/最大化重建，并把 `index.html#/local`
这类 hash 直接写进 URL（托盘菜单「本机状态」在重建场景下不会因为 eval 抢跑而丢页面）。

配套三处必要改动（不做就会出问题）：

- **`RunEvent::ExitRequested` 里 `api.prevent_exit()`**：销毁最后一个窗口时 Tauri 会请求退出，
  不拦住的话「关窗口」就变成「退出程序」，托盘和服务全没了。
  托盘「退出」会先置 `QUITTING` 原子标记，所以主动退出不受影响。
- **回环唤出通道 `127.0.0.1:47821`**：窗口被销毁后，用户再点桌面图标会起第二个进程
  （两套托盘 + 两个后台服务）。现在第二个进程发一条 `show` 就退出，第一个进程收到后重建窗口。
  这同时给自动化验证留了一个**不依赖鼠标**的唤出入口。
- **落盘缓存（上一个改动）**：重建窗口等于重新加载前端，靠 `localStorage` 缓存
  才能做到"打开就是有数据的"，否则每次唤出都要重新拉一遍全部接口。

## Alternatives considered

- **把 WebView 导航到 `about:blank`**：能释放 DOM，但 WebView2 的浏览器进程和渲染进程
  仍然常驻，实测释放量很小。放弃。
- **监听最小化（而不是关窗）就销毁**：用户从任务栏还原的路径就断了 —— 任务栏按钮无法
  重映射到我们的重建逻辑。而且"最小化"通常是临时行为，销毁代价太大。放弃。
- **默认开启**：老用户升级后"关窗再打开"会从秒开变成重建，属于行为突变；
  默认关闭、用户在设置里自己开更稳妥。放弃。
- **不做唤出通道**：那关窗后只剩托盘一个入口，用户点桌面图标会意外起第二个实例。
  顺带解决双实例问题，成本只有一个回环监听。放弃。
- **把 `lightweight_mode` 存进 localStorage**：prefs 是 Rust 侧读的（关窗那一刻要用），
  必须先于前端可用，只能落在 prefs.json。放弃。

## Consequences

收益（本机实测，WebView2 进程 WorkingSet 合计）：

| 阶段 | WebView 进程 | 内存 | 主窗口 | 托盘 | agent |
| --- | --- | --- | --- | --- | --- |
| 窗口打开 | 6 | 702.2 MB | 有 | 有 | 在 |
| 关窗（轻量模式） | **0** | **0 MB**（释放 702 MB） | 无 | **有** | **在** |
| 唤出后 | 6 | 707.3 MB | 有 | 有 | 在 |

- 关窗后 `landeck` 与 `landeck-agent` 两个进程都活着，托盘图标仍在。
- 重建后窗口可见，内存回到关闭前水平（707 MB，略高属正常波动）。

代价与边界：

- 唤出是**重建**：页面内临时状态（滚动位置、抽屉开合、未提交的表单）不保留；
  数据靠落盘缓存仍在，但最多旧到 TTL（系统信息 5 分钟等）。
- 重建需要 1~2 秒（新建 WebView2 + 加载 bundle），不是秒开。
- 只在**关窗**触发，最小化不触发（见上）。
- 手机端不涉及：Android 上前台/后台由系统管理，没有"关窗"概念，设置项按
  `runtime === 'desktop'` 隐藏。

## Testing

**Rust 单测（9 条全绿，新增 3 条）**：

- `prefs_old_file_without_lightweight_field_still_parses`：老 prefs.json 少字段时整份仍能解析
  （`load` 解析失败会 `unwrap_or_default()`，少一个 `serde(default)` 就会静默丢掉主题/窗口/自启）；
- `prefs_lightweight_roundtrip`；
- `prefs_parse_tolerates_utf8_bom`：顺手把 `load` 抽成可测的 `parse()` 并容忍 UTF-8 BOM
  （PowerShell `Set-Content -Encoding UTF8` 会写 BOM，实测踩过一次，表现是所有偏好被重置）。

**实机验证（不移动鼠标、不抢焦点）**：用 `PostMessage(WM_CLOSE)` 模拟点关闭按钮，
用回环 TCP 发 `show` 唤出，全程统计 `msedgewebview2.exe` 与窗口句柄。

**对照组（证明测量确实能区分两种行为）**：把 `lightweight_mode` 改成 false 重跑同一脚本 ——
关窗后 WebView 仍是 6 个进程、内存 565.9 → 584.1 MB、主窗口句柄仍在、仅 `visible` 变 false，
即回到"隐藏"行为。同一脚本在两种模式下给出相反结论，说明它测的是真行为而不是恒真断言。
