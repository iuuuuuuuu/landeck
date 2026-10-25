# Agent Note: 托盘归属、扫描「自己」的判据、开机统计按月

Status: implemented

## Problem

用户 8 条反馈里有三条是**架构判据错了**，不是样式或文案问题：

1. **两个托盘图标**：客户端有托盘，被控端 Agent 也有托盘。客户端拉起 Agent 时只传了
   `--no-open`（不弹浏览器），没传 `--no-tray` —— 于是通知区出现两个同款图标。
2. **第一次能扫到 PC，之后再扫就没了**：扫描靠 `selfIPs`（本机 IP 集合）排除「自己」。
   但那台机器上唯一的 Agent 就在本机，按 IP 排除等于**把这台机器的 Agent 整个藏起来**。
   用户第一次看到它、点配对、中途退出，之后再扫就永远看不见。
3. **开机统计只有一周**：`CachedHistory` 默认 14 天，前端 `uptime(14)`，且数据模型只有
   `days`（按天）与 `totals.onSec7d`（固定 7 天），没有月维度。

## Decision

1. **托盘归客户端独占**：`agent_start_impl` 追加 `--no-tray`。
   谁启动进程谁负责托盘：用户装的是客户端，托盘就该只有一个，点它打开客户端。
   命令行手动跑 Agent 时仍自带托盘（那种场景没有客户端）。
2. **「自己」的判据从 IP 改成本机 Agent 的 id**：
   - 新增原生命令 `self_agent_id()`：发一次 UDP 探测、解析回包里��� `id`，
     600ms 内出结果，不受 WebView 网络策略影响。
   - 前端 `probeSelfId()` 优先调它；纯浏览器退回**同源** `/api/v1/hello`
     （同源一定通，不再遍历 127.0.0.1 各端口 —— 那些跨源请求在手机上会被拦，挂到超时反而拖慢整轮扫描）。
   - `emit` 判据改成 `if (selfId && n.id === selfId) return`，外加 loopback 字面量。
3. **开机统计升到月维度**：
   - 后端新增 `UptimeMonth{month,onSec,boots,avgUptimeSec,longestSec}`，最近 12 个月。
     跨月会话**按月切开分别累加**，否则横跨月末的长开机会整段算进某一个月、另一月凭空为 0。
   - 默认窗口 14 → 90 天（`CachedHistory` 上限放到 400）。
   - 前端图表主视图改成按月；y 轴在按月视图下不再固定 24h（那会把累计值全部截平），
     改为自适应、刻度按天换算显示。

## Alternatives considered

- **让 Agent 托盘留着、客户端不要托盘**：客户端关窗后就没入口了，用户明确要一个托盘且要能开客户端。放弃。
- **按 IP 排除「自己」但保留 loopback 例外**：用户就是要在同一台机器上控制这台机器，
  IP 相同不代表是同一个 Agent（同机可以跑多个实例）。放弃。
- **前端遍历 127.0.0.1 各端口探测自己的 id**：安卓 WebView 跨源明文请求会被拦，
  每个端口都要等超时，实测会显著拖慢扫描。放弃，改原生命令。
- **按月只用前端把 days 聚合**：跨月的会话前端拿不到原始 session，按天数据已经切碎，
  聚合出的「单次最长」会失真。放后端算才对。放弃。
- **y 轴仍固定 24h 但把月数据除以天数**：等于显示「日均开机」，与「当月累计」语义混淆。放弃。

## 追加：Android CI 的 configuration cache 必红

v1.0.8 首次触发发布流水线时，Android job 红了：

```
Configuration cache state could not be cached: field `__classpath__` of
`LintTool_Decorated` bean found in `task :app:lintVitalAnalyzeUniversalRelease`:
error writing value of type 'DefaultConfigurableFileCollection'
```

这是 AGP 的 lint 任务与 Gradle configuration cache 的兼容问题，与本次代码无关 ——
但它在 CI 上**必现**，因为 `gen/android/gradle.properties` 里开着
`org.gradle.configuration-cache=true`。本地能过是因为命中了已有缓存条目。

修法：该文件改成 `configuration-cache=false`。代价只是增量构建慢一点，产物不受影响。
本地重跑 `tauri android build --apk` 确认仍能出包。

## Consequences

收益：通知区只有一个图标；扫描「本机」的判据正确（同一台机器上的 Agent 不再被莫名藏起来）；
开机统计能看到 12 个月趋势与每月单次最长/平均。

代价与边界：
- `self_agent_id` 依赖 UDP 探测，若本机 Agent 关了 mDNS/UDP（`--no-mdns`）会拿不到 id，
  此时**不排除任何节点** —— 宁可多显示一条，也不要不显示。
- 按月聚合要求事件日志跨度足够；只有 14 天日志的机器会看到 12 个月里大部分为 0，属正常。
- 前端图表新增 `monthly` 分支，两套 y 轴配置并存（按天/按月），后续若只保留按月需清理。
- 实测：`scan_lan` 连扫两次结果一致；月度接口返回 12 个月（如 2026-07～2026-10 各月 25–33 次开机）；
  Agent 命令行确认含 `--no-open --no-tray`。
