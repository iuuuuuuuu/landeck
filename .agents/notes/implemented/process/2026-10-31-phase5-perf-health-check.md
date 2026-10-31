# Agent Note: 五期性能体检（activity/memory 查询与导出基线 + 门禁）

Status: implemented

## Problem

Lead 集成基线显示全部端点热态 ≤30ms，但那是当前数据量（~400 段）下的数字。
五期要求：用 10 倍量复扫慢路径、大表导出内存峰值、appicon 在线回退的并发单飞、
以及「summary/rank 3 分钟缓存的写后失效」是否要补。

## Decision

新增两个**带阈值的性能门禁测试**（阈值 = Owner 的热点线 200ms，回归即红）：

- `activity/perf_test.go TestPerfQueries10x`：种 3806 段/90 天（事务包裹），
  量 summary day/week/month、rank month、app detail 的冷/热查询，
  以及 export json/csv 的耗时与堆增量；导出内容做 count 校验（防「快但空」）。
- `memory/perf_test.go TestPerfMemorySearchExport`：400 张截图（每张 ~1.5KB OCR
  文本，10% 含关键词），量 search 命中/无命中（全表 LIKE 扫）与导出。
- `iconify_test.go TestAppIconConcurrentSingleflight`：3 应用 × 3 并发同时 404，
  断言外网拉取恰好 3 次（单飞语义）。

## 写后失效的结论：不补（有测量依据）

- 实测 3806 段下冷查询 2-10ms（满载机器峰值 101ms）——连缓存都不太需要，
  更不需要写后失效。
- 段写入每 30s 一次（upsertRange 推进 end）。写后失效 = 每 30s 清一次缓存 =
  缓存命中率归零，纯害无利。3 分钟 TTL 的代价只是统计页数据最多旧 3.5 分钟
  （30s 落库 + 3min TTL），对统计页完全可接受。
- memory 侧 search 无缓存（每请求直达 DB），天然无此问题；memory.Clear 已
  正确作废 activity 缓存（二期实现）。

## Alternatives considered

- **写后失效**：每 30s 段写入清缓存 → 命中率归零，纯害无利。放弃（见 Decision）。
- **缩短 TTL 到 30s**：与写后失效等效（统计页读得勤时缓存照样打空），
  且把"最多旧 3.5 分钟"的裕度砍掉。放弃。
- **FTS/预聚合**：当前量级冷查 ≤101ms，远未到需要预聚合的量级（约 4 万段才触及
  阈值）。留作数据量增长后的升级路径，不预做。
- **性能测试放 CI 单独 job**：当前并入包内测试（-short 可跳），数据量与耗时
  （每包 +2-4s）可接受。放弃。

## Consequences

收益（测量数据，满载机器）：

| 项 | 10 倍量（3806 段/90 天） | 基线（~400 段） |
| --- | --- | --- |
| summary day 冷 | 2-5ms | ~4ms |
| summary month 冷 | 9.9-101ms（机器负载相关） | — |
| summary week 冷 | 2.3-3.4ms | — |
| rank month 冷 | 6.4-9.5ms | — |
| app detail 冷 | 1.5-2ms | — |
| export json | 9.8-11.6ms / 0.4MB / heapΔ 0.9MB | — |
| export csv | 9.8-11.6ms / 0.4MB | — |
| memory search（400 截图，40 命中池） | 2.5ms | — |
| memory search 无命中（全表扫） | 2.9ms | — |
| appicon 并发单飞（3 应用 × 3 并发） | 外网拉取恰好 3 次 | — |

**结论：无热点需修**（全部 ≤110ms << 200ms 阈值），缓存与索引维持现状。
性能门禁沉淀为常驻测试，未来数据量或代码回归一旦超 200ms 会直接红。

代价与边界：

- 性能测试受机器负载影响（month 冷查 10ms 与 101ms 的波动来自并行任务），
  阈值 200ms 留了 2 倍余量；CI 机器更慢时若误红，再调阈值。
- 种子数约 3806（时段+时长裁剪），非整 4000；断言按 ≥3500。
- summary month 的聚合是 O(段数 × 跨桶数)，90 天窗最重；若未来数据量涨 10 倍
  （4 万段），month 冷查预计 ~1s 会超阈值——届时优先 ocrNorm 式索引或按月预聚合。

## Testing

- 故障注入：GetSummary 路径插 300ms sleep → TestPerfQueries10x 精确变红，恢复绿。
- 全量套件连跑 2 轮全绿（单飞测试曾因包级负缓存状态泄漏 flaky——firefox 被
  OnlineNegativeCache 测试标了 10 分钟失败，并发测试复用即挂；改为独立应用
  + 显式清理负缓存后稳定）。
