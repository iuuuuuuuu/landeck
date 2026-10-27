# Agent Note: 切页残余卡顿（Button 的 motion + stats 的 200ms 硬采样）

Status: implemented

## Problem

上一轮修掉 `scan_lan` 阻塞主线程后（最慢帧 2302ms → 48ms），用户反馈
「现在比之前好多了，但还是有一点卡」。

真机复测仍能看到：

- 切页时 90th 11ms / 99th 48ms，长任务 839ms 偶尔出现
- 手机端 `/api/v1/stats` 一次 377~454ms

## Decision

### 1. `Button` / `IconButton` 去掉 framer-motion

`web/src/components/ui/Button.tsx` 原来用 `motion.button` + `whileTap={{ scale: 0.97 }}`，
只为一个按压反馈。但全站有 **94 个 `<Button>`**，每个 `motion.button` 都会实例化
framer-motion 的动画引擎并注册布局测量；切页时整页重挂载，几十个 Button
一起初始化。

真机 CPU profile 证据：`measureScroll` **40.6ms**、`(anon) @ :0`（原生，无源码位置）
**1640ms**、`program` 1229ms。

改成原生 `<button>` + CSS `active:scale-[0.97]`（`motion-reduce:` 时关闭），
只动 transform 走合成层。同样处理 `IconButton`（`active:scale-[0.94]`）。

修复后同一 profile：`measureScroll` 与 `(anon) @ :0` 全部消失，
`program` 1229ms → 16ms，JS 自身合计从 ~2900ms 降到 24ms。

### 2. `/api/v1/stats` 不再触发进程全量采样

`handleStats` 原来调 `metrics.ListApps(Limit:300)` 只为拿「应用数 / 进程数」两个数字。
但 `ListApps` → `cachedProcesses()` → `sampleProcesses()`，里面有：

- 一次 `time.Sleep(200ms)`（算 CPU 百分比需要两次采样间隔）
- 遍历 480 个进程取 Name/CPU/内存/用户/Exe/启动时间

实测 **290~330ms**，而它的缓存 TTL 只有 **2 秒**。手机端切到统计页时
经常正好过期，于是每次切页卡一下。

修法：新增 `metrics.AppProcCount()` —— 只枚举进程取名字、统计去重后的应用数，
带 30 秒独立缓存。**不动** `cachedProcesses` 的 2s TTL，因为进程列表页
（`ListProcesses`）也复用它且需要真实 CPU 采样，两者诉求不同。

实测 `AppProcCount` **294ms → 22.9ms**；HTTP 层 `stats` **454ms → 29~43ms**。

### 3. 顺带确认 `backdrop-filter` 不是主因

`.panel` 上有 `backdrop-filter: blur(22px) saturate(130%)`，一度怀疑是它。
用 CDP 注入 `backdrop-filter: none` 做 A/B：worst 帧 846ms → 840ms、
长任务 832ms → 836ms，**基本无差别**，因此没有改它（保留玻璃质感）。

## Alternatives considered

- **把 `cachedProcesses` 的 TTL 从 2s 拉到 15s**：能缓解 stats，但进程列表页
  复用同一缓存且依赖真实 CPU 采样，拉长会让列表数据变旧。放弃，
  改为给 stats 单独开一条轻量路径。
- **把 `sampleProcesses` 的 `time.Sleep(200ms)` 去掉**：CPU 百分比需要两次采样
  间隔，去掉就测不准。这是 gopsutil 的固有约束。放弃。
- **整个删掉 framer-motion**：抽屉、Toast、下拉菜单仍在用，且那些是低频、
  单实例的，收益远小于改动风险。只处理高频复用的 Button。放弃。
- **去掉 `.panel` 的 backdrop-filter**：A/B 证明无收益，反而损失视觉质感。放弃。
- **给 stats 加更长的缓存**：stats 里有 `realtime`（CPU/内存），
  缓存太久会让实时数字失真。用 30s 只缓存「个数」这部分，其余保持实时。

## Consequences

收益（真机实测）：

- 切页帧数 740 → 966（更流畅），janky 0.95% → 0.62%，99th 48ms → 40ms。
- JS 自身开销（桌面端 profile）~2900ms → 24ms。
- `stats` 接口 454ms → 29~43ms。
- 按压反馈保留（CSS `active:scale`），视觉差异极小。

代价与边界：
- 「应用数 / 进程数」最多滞后 30 秒（原来 2 秒）。对统计页这个口径足够。
- `active:scale` 的按压反馈是瞬时缩放，没有原来的 spring 回弹手感。
- 剩余的 40ms 级长帧来自页面首次挂载的 React 渲染，属正常范围，未继续优化。

## Testing

- 真机 CPU profile（调试版 APK + `adb forward` + CDP Profiler）：
  改前 `measureScroll` 40.6ms / `(anon) @ :0` 1640ms / `program` 1229ms；
  改后三者全部消失，`program` 16ms。
- LoAF（`long-animation-frame`）归因：改前 4 个长帧各 131ms
  （`event-listener` 122ms / `resolve-promise` 128ms）；改后 3 个，
  最长 310ms 且 `blocking=0`（纯渲染）。
- `backdrop-filter` A/B：注入 `none` 前后 worst 帧 846→840ms，判定无关。
- `AppProcCount`：294ms → 22.9ms（`go run` 探针，5 轮模拟 3 秒间隔请求）。
- HTTP `stats`：454ms → 29~43ms（6 次采样，间隔 3 秒）。
- 真机 gfxinfo 切 6 页：966 帧、janky 6 (0.62%)、50th 9ms / 90th 14ms /
  95th 18ms / 99th 40ms。
- `tsc --noEmit` 与 `go build ./...` 通过。