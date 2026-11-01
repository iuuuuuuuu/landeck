// Package syncengine 实现十期 A1 云同步（WebDAV）：pull-merge-read。
//
// 目录名是契约规定的 internal/sync；包名用 syncengine 以免与标准库
// sync（互斥锁）撞名。
//
// 模型（契约 docs/design/phase10-sync-plugins.md A1）：
//   - 每台设备把自己的段导出 JSON，PUT 到独立路径
//     /landeck-sync/<deviceId>/segments.json（按设备分文件，永不互相覆盖）；
//   - 定时（默认 300s）+ 手动拉取其他所有设备的 segments.json，
//     合并入本地只读视图（activity 库的 sync_segments 表）；
//   - 合并键 = (deviceId, start, app)，同键取 end 更晚者（采集幂等：
//     同一段随采集不断延长，见 merge.go 的键语义说明）；
//   - 删除不传播（v1）；推增量：只推 end > lastPushedAt-7d 的段，首推全量；
//   - rules.json 同样推拉（拉取侧 v1 只存可见快照不覆盖本地规则，
//     防静默覆盖用户规则——合并语义待 Owner 拍板，见交付说明）；
//   - summary/rank 的 scopeAgg=all 把同步视图并入统计（activity 侧）。
//
// WebDAV 客户端：net/http 裸方法（PUT/GET/MKCOL）+ Basic，零新依赖。
// 凭据文件 0600，同 ai.json 口径（writeAtomic 风格）。
package syncengine
