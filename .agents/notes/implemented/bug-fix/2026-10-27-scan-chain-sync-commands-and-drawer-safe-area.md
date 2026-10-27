# Agent Note: 扫描中段卡顿（local_ip / self_agent_id 仍是同步命令）+ 抽屉头部压住状态栏

Status: implemented

## Problem

用户补充了三个更具体的现象：

1. 「切换到发现页面，等待 0.3 秒左右再切换到设备页，就会非常卡顿」
2. 「在发现页面扫描开始会卡一点，中间有一两秒的卡顿，雷达会直接不动」
3. 「设备详情页 管理文件 上面的操作栏跟状态栏重叠了」

第 2 点说明上一轮只修 `scan_lan` 还不够 —— 扫描**开始那一刻**和**中段**各有一段卡。

## Decision

### 1. `local_ip` / `self_agent_id` 也是同步 Tauri 命令

上一轮只把 `scan_lan` 改成了 `async + spawn_blocking`，但扫描流程在它之前
还会调两个命令，两者都还是同步的（在主线程执行）：

| 命令 | 阻塞来源 | 实测耗时 |
| --- | --- | --- |
| `local_ip` | `preferred_lan_iface()` 枚举网卡 | 114~140ms |
| `self_agent_id` | 网卡枚举 + **600ms** UDP 接收循环 | 700ms+ |

前端 `scanLan()` 的顺序正是：`nativeLocalIP()` → `probeSelfId()` → `scanNative()`。
也就是说点扫描后，主线程先被 `local_ip` 卡 ~140ms，再被 `self_agent_id`
卡 ~700ms，然后才轮到（已经修好的）`scan_lan`。这就是「扫描开始会卡一点、
中间有一两秒卡顿、雷达不动」的来源。

修法：两个命令都改成 `async fn` + `spawn_blocking(具体逻辑)`，
原同步实现拆成 `local_ip_blocking()` / `self_agent_id_blocking()`。

实测（真机，扫描全程 10 秒）：**>50ms 的慢帧 0 个**，最大 36ms；
修复前是单帧 2302ms 冻结。

### 2. 抽屉头部被状态栏压住

`DeviceToolsDrawer` 的 `<aside>` 是 `absolute inset-y-0`（铺满全屏），
但头部 `<header>` 只有 `py-3`，没有避让安全区。手机上状态栏会盖住
「管理工具」标题那一行。

修法：
- `<header>` 加 `pt-safe`（现有工具类，`padding-top: max(env(safe-area-inset-top), 0.25rem)`），
  把 `py-3` 拆成 `pb-3` + `pt-safe`。
- 内容区底部 `py-3` 改 `pt-3 pb-safe`，避免最后一行被导航条压住。

真机验证（1440×3200，`InsetsSource statusBars frame=[0,0][1440,169]`）：
修复后「管理工具」标题 `bounds y=168`，正好贴在状态栏下沿（169）之下，不再重叠。

## Alternatives considered

- **只改 `scan_lan`、不动另外两个命令**：上一轮就是这么做的，用户复测仍有
  「扫描开始卡一点 + 中段一两秒卡」。因为卡的不止 scan_lan。
  说明必须把扫描链路上的**每一个**命令都挪出主线程。放弃。
- **在 Rust 侧把三个命令合并成一个 `scan_all()`**：能少两次 IPC，但会改动
  前端调用约定与错误处理（`local_ip` 失败时前端要能回退到网段猜测），
  且收益只是省两次 IPC（<1ms）。放弃。
- **给抽屉加 `fixed` 而不是 `absolute`**：`fixed` 在部分 Android WebView 里
  与软键盘/安全区配合更差，且当前 `absolute` + `pt-safe` 已验证可行。放弃。
- **统一把所有 tauri 命令改成 async**：收益不明（其余命令都是纯内存读取），
  徒增改动面。只处理有阻塞调用的三个。放弃。

## Consequences

收益：
- 扫描链路（`local_ip` → `self_agent_id` → `scan_lan`）全部不占主线程，
  真机扫描全程无 >50ms 慢帧，雷达动画连续。
- 抽屉头部不再被状态栏遮挡。

代价与边界：
- 三个命令各自多一次 `spawn_blocking` 调度开销（微秒级），可忽略。
- `self_agent_id` 仍需等满 600ms 才返回（逻辑没变，只是不阻塞 UI）。
- 抽屉底部 `pb-safe` 会让内容区在最底部多留一点空隙，视觉上更安全。

## Testing

- 真机 gfxinfo（扫描全程 10 秒）：30 帧、janky 0、50th 13ms / 90th 16ms /
  95th 36ms / 99th 36ms、**>50ms 慢帧 0 个**。
- 抽屉头部位置：`uiautomator dump` 显示「管理工具」`bounds y=168`，
  `dumpsys window` 显示状态栏 `frame=[0,0][1440,169]`。
- `cargo build --release`、`tsc --noEmit`、`go build ./...` 均通过。

## Note on measurement noise

排查中发现这台 PC 的 CPU 长期在 57~95%（`deepseek-harness-desktop` 的 WebView、
`GameViewer.exe`、rustc、flutter_tester、firefox 等多个进程各占几个百分点）。
它会让 agent 的 `/api/v1/status` 返回 75~95% 的 CPU 值，也会放大帧测量噪声。
这不是产品缺陷，但**后续做帧/延迟测量时应先确认基线负载**，否则容易误判。