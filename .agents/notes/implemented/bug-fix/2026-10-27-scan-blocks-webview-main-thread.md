# Agent Note: 扫描时雷达停转 + 切页卡死（Tauri 同步命令阻塞 WebView 主线程）

Status: implemented

## Problem

用户连报三个现象，看起来是三个问题，实测后收敛到**一个根因**：

1. 「扫描的时候上面的雷达图都卡的不会动」
2. 「我切换页面也还是卡的不行」
3. 「扫描到 pc，点击进去显示已被删除，但是设备列表又有本台电脑」

真机 CDP profile（WebView 147，384×853@3.75）抓到：

- 长任务 2 个共 **3136ms**，其中一个 **2302ms**
- 帧间隔 worst **2310ms**
- profile 里 **3083ms 记在 `(anon) @ :0`** —— `:0` 表示没有源码位置，即**原生代码**

雷达的扫描扇形是纯 CSS `animate-sweep`（合成层动画，与 JS 无关）。
它停住只能说明一件事：**主线程被原生调用占死了**。

## Decision

### 1. `scan_lan` 是同步 Tauri 命令，阻塞 WebView 主线程

`app/src-tauri/src/lib.rs` 里 `scan_lan` 原本是普通同步 `#[tauri::command]`，
内部有 `LISTEN_MS`（安卓 2000ms / 桌面 900ms）的阻塞 UDP 接收循环。
Tauri 的同步命令在 **WebView 主线程**上执行 —— 于是点扫描就把主线程占满 2.3 秒：
CSS 动画停住、切页无响应、整个界面冻住。

修法：改成 `async fn` + `tauri::async_runtime::spawn_blocking(scan_lan_blocking)`。
只改 `async` 不够（阻塞代码仍占 executor 线程），必须 spawn_blocking 挪到阻塞线程池。

### 2. 雷达设备点与切页动画改用纯 CSS

即便主线程不被占死，两处 framer-motion 仍在白白消耗主线程：

- `Radar.tsx`：每个设备点一个 `motion.g`，扫描时节点陆续出现，
  framer-motion 每次都做布局测量。
- `AppShell.tsx`：每个页面一个 `motion.div` + `initial={{ y: 8 }}` 位移动画。
  CDP profile 里 `measureScroll` 单项 **122.5ms**，是切页开销最大的一笔
  （比 React 渲染 bu 45.7ms + Fu 23.6ms 加起来还多）。

两处都换成 CSS keyframes（`page-enter` / `radar-blip`），只动 opacity/transform，
走合成层、不读布局。视觉保持一致，`prefers-reduced-motion` 时自动关闭。

### 3. 扫描结果点「进入」显示「设备不存在或已被移除」

`Scan.tsx` 的 `onEnter` 用扫描到的 `node.id` 跳转，
但 store 里存的是配对那一刻的旧 id（agent 的 `deviceId` 会变：`config.json` 丢了就 `GenerateID()`）。
`DeviceDetail` 用 `devices.find(d => d.id === 路由id)` 找不到 → 报「设备不存在」。

修法：新增 `pairedDeviceFor(node)`，按与 `isPaired` 相同的规则
（先 id、再 `host:port`）反查 store 记录，用**记录的真实 id** 跳转。

## Alternatives considered

- **只把 `scan_lan` 改成 `async fn`**：Tauri 会把 async 命令放进 executor，
  但函数体里是阻塞的 UDP recv 循环，仍会占住 executor 线程；
  多个并发调用时会互相饿死。必须 spawn_blocking。放弃。
- **缩短 LISTEN_MS**：能减轻症状但治不了根 —— 阻塞仍然发生在主线程上，
  只是时间短一点。放弃。
- **让扫描在 agent 侧做、前端只取结果**：架构改动过大，且手机端本来就要能扫。
  放弃。
- **保留 framer-motion 只删位移动画**：`measureScroll` 是 framer-motion 内部
  对滚动容器的测量，只要用它做 layout 相关动画就会触发；换成 CSS 才彻底。
  放弃。
- **按 IP 整段判断「是不是本机」**：历史上试过，会把同一台机器上的所有 Agent
  都排掉。注释里已记录这个坑，不再走。放弃。

## Consequences

收益（真机实测）：

- 扫描期间最慢帧 **2302ms → 48ms**，99th **2302ms → 24ms**，
  90th 11ms / 95th 13ms，janky **0.29%**，长任务消失。
- 扫描中切页：90th **13ms**、95th **19ms**。
- 雷达恢复转动（连拍两帧画面内容不同）。
- 扫描结果点「进入」不再报「设备不存在」。

代价与边界：
- `scan_lan` 现在跑在阻塞线程池，返回时机与原来一致（都是等满 LISTEN_MS），
  只是不再占主线程。并发多次扫描会各占一个阻塞线程，属可接受。
- 切页动画从 framer-motion 换成 CSS，**曲线细节**（缓动函数）略有差异，
  但时长与位移量保持一致。
- 雷达点的入场动画从 350ms opacity 渐变改为 CSS 同参数，视觉等价。

## Testing

- 真机 CDP profile（`webview_devtools_remote_*` + `adb forward`）：
  修复前 `(anon) @ :0` 3083ms、长任务 3136ms、worst 帧 2310ms；
  修复后长任务消失、worst 帧 48ms。
- 桌面端 CDP profile（385px 视口，连切 6 页）：
  修复前 `measureScroll` 122.5ms + React 渲染 ~70ms；
  修复后 JS 自身耗时合计 **16.3ms**，`over33` 从 6 帧降到 3 帧。
- 真机 gfxinfo：扫描期间 698 帧、janky 2 (0.29%)、50th 9ms / 90th 11ms /
  95th 13ms / 99th 24ms；扫描中切页 580 帧、90th 13ms / 95th 19ms。
- 雷达动画：扫描期间连拍两帧，截图字节数不同 → 画面在变化。
- `cargo build --release` 与 `cargo test --release --no-run` 通过；
  `tsc --noEmit` 通过。