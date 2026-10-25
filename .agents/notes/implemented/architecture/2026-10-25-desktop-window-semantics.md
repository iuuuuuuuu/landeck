# Agent Note: 桌面客户端窗口语义（记忆、保留页面、静默启动）

Status: implemented

## Problem

用户装了 v1.0.6 之后反馈三个桌面端行为问题：

1. **窗口大小不记忆** —— 每次启动都回到 1180×780。
2. **关窗再从托盘打开 = 重建** —— 页面重新加载、滚动位置和正在看的设备全丢，
   体感是"又访问了一遍"，而不是"回到刚才那里"。
3. **开机自启会弹窗** —— 用户希望自启时直接缩到托盘，安静待着。

另外还有一个隐性缺陷：客户端启动的被控端会**自动打开浏览器**，
用户看到 `http://127.0.0.1:8420/` 的网页被弹出来，以为装错了东西。

## Decision

1. **几何写进 prefs.json**：`WindowPrefs{width,height,x,y,maximized,saved}` 与主题同一个文件。
   在 `WindowEvent::Resized/Moved` 时保存，`setup` 时恢复。
   - 用逻辑坐标（除以 `scale_factor`），否则换一台缩放比不同的机器会恢复出错误尺寸。
   - 最大化时**只改 `maximized` 标记、不覆盖还原尺寸**，否则取消最大化后窗口变成全屏卡死。
   - `saved` 布尔位：避免把 0×0 当成有效几何。
2. **关窗 = 隐藏**：`CloseRequested` 时 `api.prevent_close()` + `win.hide()`。
   webview 不销毁，托盘再打开就是原样回来（实测同一个 `window` 全局标记、`location.hash` 都保留）。
   真正的退出走托盘菜单的「退出」（`app.exit(0)`）。
3. **`--silent` 静默启动**：开机自启的快捷方式带这个参数，`setup` 里检测到就只 `hide()` 不 `show()`。
4. **被控端加 `--no-open`**：客户端拉起被控端时传这个 flag，首次运行不再弹浏览器。
   命令行手动运行 agent 时行为不变（仍会打开控制台，方便拿到配对码）。

## Alternatives considered

- **用 localStorage / 前端 `setSize` 记几何**：`window|set_size` 被 Tauri ACL 拒绝
  （实测 `Command plugin:window|set_size not allowed by ACL`），而且 WebView 数据目录会变，
  存前端等于把"记不住"的老毛病再犯一遍。放弃。
- **关窗时保存页面路由再重建**：能恢复"哪一页"，但恢复不了滚动位置、表单草稿、WebSocket 状态，
  而且会多一次整页加载。`prevent_close + hide` 直接保住整个运行时。放弃。
- **最大化时也存当前尺寸**：会让"最大化→关→开→取消最大化"得到一个占满屏幕的窗口。放弃。
- **自启时不创建窗口**：Tauri 里窗口由配置声明，跳过创建要改 conf 并手工建窗，
  复杂度高；`hide()` 的差别只在几百毫秒的进程内开销，肉眼不可见。放弃。

## Consequences

收益：窗口位置/尺寸跨重启保持；关窗再开是"回到刚才"而不是"重新加载"；自启安静；
被控端不再抢浏览器焦点。

代价与边界：
- 关窗不退出，所以**进程会常驻**（托盘图标在）。这是有意为之，托盘菜单提供了明确出口。
- 几何以逻辑像素存盘，跨不同缩放的显示器迁移时尺寸会按比例换算，可能不是像素级一致。
- 前端拿不到 `set_size`/`inner_size` 等窗口命令（ACL 只给了 `core:default`）。
  本次所有窗口行为都在 Rust 侧完成，不需要前端权限；若以后要前端控制窗口，需在
  `capabilities/default.json` 里显式加 `core:window:allow-set-size` 等条目。
- 验证方式：直接写 prefs.json 指定 1000×700 → 重启 → `GetWindowRect` 量到外框 1016×739、
  位置 200,120（差值即边框标题栏）；再用 `SetWindowPos(SWP_NOACTIVATE)` 改成 1100×760 →
  prefs 记录内框 1084×721。全程未移动鼠标、未切换前台窗口。
