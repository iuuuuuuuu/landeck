# Agent Note: activity summary 支持 scope=year + 拒绝静默假响应

Status: implemented

## Problem

activity-pages 揪出的真缺陷：`/activity/summary?scope=year` 是**假 200**——
agent 对不认识的 year 参数没有报错，`GetSummary` 静默回退 `scope="day"`
（`if scope != day/week/month { scope = "day" }`），按「一天」解析返回小时桶。
全部历史页据此渲染了垃圾数据，前端被假 200 骗过两轮验收
（activity-pages 本轮已加前端形状校验 + 回退 12×month 自保）。

静默假响应是这次事故的根源——**同类问题在 GetRank 也存在**，一并修。

## Decision

1. **summary/rank 真正支持 scope=year**：按天聚合全年，桶 key=YYYY-MM-DD
   （与 week/month 桶同形，`bucketKeysFor` 的 default 分支天然覆盖，
   只需 rangeOf 认 year）。
2. **未知 scope / date 格式与 scope 不符 → ErrBadScope → HTTP 400**：
   - `rangeOf` 签名加 error 返回；date 锚点按 scope 校验格式
     （day/week=YYYY-MM-DD、month=YYYY-MM、year=YYYY），不符即报错
     ——原先静默忽略解析失败是同一事故类；
   - `GetSummary`/`GetRank` 入口先校验 scope 白名单（day/week/month/year）；
   - httpapi 层 `errors.Is(err, ErrBadScope)` → `writeErr(400, "bad-params")`；
   - 响应自描述：Summary.Scope 本来就回显 scope（保持不变）。
3. **性能门禁**：TestPerfQueries10x 加 year 冷查断言——3806 段 ≤200ms +
   桶数 365/366 + key 形状 + Scope 回显。

## Alternatives considered

- **只修 400 不实现 year**：前端已就绪单请求形态，alltime 请求数 13→2 的
  收益拿不到；year 的实现成本极低（rangeOf 一个 case + 桶函数零改动）。放弃。
- **date 解析失败静默回退"今天"**（原行为）：与 scope 回退同类——都是
  「参数不对给个看起来正常的响应」。一并改为 400。放弃保留。
- **GetRank 不动**：同样的静默回退代码，同一个事故类；一起修只多 3 行。放弃只修 summary。

## Consequences

收益：

- 全部历史页单请求（alltime 13→2）；year 冷查 65.5ms @3806 段（阈值 200ms，
  机器负载波动余量 3 倍）
- 错误语义契约化：未知 scope/date 格式不符 → 400 + 消息体说明，
  前端形状校验从「自保手段」降级为「纯防御」
- 性能门禁故障注入：bucketKeysFor 把 year 退化成小时桶 → 形状断言精确变红
  （24 桶 ≠ 365/366），恢复绿

代价与边界：

- **破坏性变更**：此前传错 scope/date 的调用方（如果有）从「假 200」变「400」
  ——这正是目的，但发布说明要写；当前前端只发合法参数
- 400 测试需要 activity.Start（date 校验在 mgr 启动后才走到）——顺带修了
  `activity.Stop` 不置 `mgr=nil` 的缺陷：Stop 后再 Start 会拿到已停机
  Manager 全部查询 500（httpapi 400 测试踩出来的，与 memory 同类）
- year 桶 365 个 JSON 对象，响应 ~50-100KB，前端直渲无压力
- rank 的 year 也是按天聚合语义（rank 本身无桶，只受范围影响）——契约上
  与 summary 一致，避免「summary 支持 year、rank 拒绝」的精神分裂

## Testing

- aggregate_test：year 范围（2026-01-01..2026-12-31）、桶数 365（非闰年，
  首版断言把闰平年写反——测试自己抓的）、key 形状、未知 scope/格式不符
  → ErrBadScope 三态
- httpapi/activity_400_test.go：handler 直调（零值 Server）——summary/rank
  未知 scope 400、day+YYYY-MM 400
- perf gate：year 冷查 65.5ms + 形状断言；故障注入精确变红
- 全仓 build/vet/test 7 包绿
