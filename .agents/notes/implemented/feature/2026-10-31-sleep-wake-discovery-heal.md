# Agent Note: 发现服务睡眠唤醒自愈（旧 IP 通告修复）

Status: implemented

## Problem

Owner 直报：电脑休眠/睡眠唤醒后手机连不上电脑。Lead 诊断 + 代码审查定根因：
zeroconf 只在启动时注册一次（带当时 IP 列表），广播循环也持续通告启动时状态。
唤醒后 IP 变化（WiFi 漫游/DHCP 续租/适配器重连）时，发现层通告**旧 IP**——
手机拿旧地址连接必然失败，且不重启 agent 永远不会好。

受控复现受阻：沙箱会话持有电源请求，SetSuspendState 被否决（机器没睡成）。
所以修复以代码审查结论 + 单测为主，真机验证依赖 Owner 下一次自然休眠唤醒
（日志已能自证，见 Consequences）。

## Decision

1. **常驻自愈 goroutine**（discovery/watchLoop，每 15s）：
   - 时间跳跃：`sleptSince(prev, now, 15s, 45s)`——monotonic 差值远超 tick 间隔
     + 45s slack = 睡过（含休眠/快速启动）；
   - IP 集合 diff：`ipSetChanged(prev, cur)`——增/删/换任一即「网络重排」。
   任一触发 → `rebuild()`：停旧（zeroconf Shutdown + UDP conn 关闭）→
   `Start(node, mdns)` 整体重注册 → 字段原地搬回外层指针。日志写明触发原因与
   当前 IP 列表（Owner 唤醒后看 agent.log 即可确认自愈）。
2. **纯函数化**：`sleptSince`（注入时刻，可单测睡 8 小时）、`ipSetChanged`
   （增/删/换/空集四态单测）。
3. **通道生命周期**（本任务最深的坑，panic 三连的来源）：
   - `announceStop` **每次 rebuild 换新**；`watchStop` 只在 Start 创建一次；
   - watch goroutine 常驻、绝不随 rebuild 重启——否则第一次唤醒后自愈就死了
     （初版 rebuild 调 Stop() 把 watchStop 也关了，正是这个错）；
   - rebuild 结束**必须把新实例的字段原地搬回外层指针**——漏了的话
     `a.announceStop` 仍指已关闭旧通道，第二次 rebuild 就是
     close of closed channel（实测 panic，插桩定位）；
   - conn 的判空要配合**局部快照**：stopAnnounce 置 nil 与旧 broadcastLoop
     的写入存在竞态（实测 panic）；
   - Start 会 spawn 新的 watchLoop——rebuild 里 close(na.watchStop) 杀掉多余副本。
   - 测试用 `listenPort` 包变量覆盖成高位端口，避开真机运行中的 agent（8421 冲突）。

## Alternatives considered

- **只重注册 mDNS 不动 UDP**：UDP 广播 payload 里的 node.IP 同样是旧的，
  且半吊子重建让状态机更复杂。整体重建最干净。放弃。
- **监听 network interface 变化事件（Windows NotifyRouteChange）**：更实时，
  但需额外 syscall/回调线程，轮询 15s 的自愈延迟对「连不上手机再扫一次」的
  场景完全够用。放弃（v2 若嫌 15s 慢再上）。
- **唤醒后只更新 mDNS TXT/IP 不重建**：zeroconf 注册条目里的 A 记录改不了
  （grandcat/zeroconf 无更新 API），必须 Shutdown 重注册。放弃。
- **时间检测用挂钟差**：NTP 跳变会误报。用 monotonic（time.Sub 天然走单调钟）。
  放弃挂钟。

## Consequences

收益：

- 唤醒/IP 变化后 ≤15s 自愈重建发现层，日志自证（触发原因 + 当前 IP 列表）。
- 纯函数 + rebuild 集成测试（TestRebuildStillAnswers：重建前后 UDP 探测都得到
  应答、二次重建幂等、Stop 幂等）连跑 3 次全绿。
- 故障注入：sleptSince 恒 false（唤醒检测失效）→ TestSleptSince 精确变红，恢复绿。
- 全仓 build/vet/test 6 包全绿。

代价与边界：

- 自愈延迟最多 15s（轮询模型）；对「唤醒后重开 App 扫码连接」的场景无感。
- watchLoop 每 15s 一次 net.Interfaces() 系统调用，开销可忽略。
- rebuild 瞬间广播有 ≤1 个 tick 的空窗（旧停新起之间毫秒级），无感。
- 真机自然休眠唤醒的最终验证依赖 Owner 下一次真实睡眠——日志键
  `[discovery] 疑似睡眠唤醒`。
- 若唤醒后 IP 没变（相同 IP 续租成功），不触发重建——此时旧通告本来就有效，
  无需自愈。

## Testing

- 纯函数：sleptSince（正常 tick/55s 抖动/睡 8h/2min 停顿/时钟回拨五态）、
  ipSetChanged（不变/新增/删除/更换/空集互换/双空六态）。
- 集成：TestRebuildStillAnswers（独立端口 28421 避让真机 agent）——重建前后
  UDP ProbeToken 探测均得到应答、二次重建幂等、Stop 幂等。
- 故障注入：sleptSince 恒 false → 纯函数测试精确变红。
- 连带发现并修掉两个既有竞态：stopAnnounce 置 nil 后旧 broadcastLoop 的
  nil-deref panic；判空与写入之间的 TOCTOU 窗口。
