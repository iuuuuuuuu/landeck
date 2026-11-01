# Agent Note: A1 WebDAV 同步引擎（pull-merge-read）

Status: implemented

## Problem

十期 A1（本期最大件）：对齐 Hindsight 的多台电脑活动记录**合并统计**。
数据默认只存本机，同步是可选项——每台设备把段推到 WebDAV 独立路径，
定时拉取其他设备的段并入本地只读视图，summary/rank 的 scopeAgg=all
把视图并入统计。契约 docs/design/phase10-sync-plugins.md A1 节。

## Decision

**包结构**（internal/sync，包名 syncengine 避免与标准库 sync 撞名）：

- `client.go`：WebDAV 客户端——net/http 裸方法（PUT/GET/MKCOL/PROPFIND）+
  Basic，零新依赖。PUT 409/404 自动 MKCOL 重试；GET 404 → ErrNotExist
  （「对方还没数据」正常态）；PROPFIND 粗解析 href 列设备目录（去重）。
- `merge.go`：合并纯函数 MergeInto——map 上三态（新键 added / 同键 end
  更晚 updated / 否则 skipped），坏段防御（End<=Start、空 app），
  删除不传播（只增改从不删）。
- `engine.go`：push = GET 自己的快照 → merge 增量 → PUT 累计快照；
  pull = PROPFIND 列设备 → 逐台 GET → merge 进该设备基线 → ReplaceDevice。
  依赖倒置：Source/Store 最小接口，main 装配 activity 适配器，
  测试装配假件（同进程两台"设备"可测）。
- `settings.go`：sync.json（0600 writeAtomic 口径）——{enabled,url,username,
  password,intervalSec(300,60-3600),deviceId(首启生成),deviceName(主机名),
  lastPushedAt,lastSyncAt,lastError}。凭据落盘 0600，GET 打码。
- `api.go`：包级 StartProduction/GetSettings/UpdateSettings/SyncNow/
  StatusViewOf（main 与 httpapi 用）；NewEngine 直造实例给测试。

**activity 侧**（syncstore.go）：sync_segments + sync_devices 表
（activity.db，共享连接）；ReplaceSyncDevice/SyncDevices/
SyncDeviceSegments/SyncSegsInRange/SegmentsAfter/ExportCategoriesJSON；
GetSummary/GetRank 加 scopeAgg 参数（""/"all"，未知值 400——七期语义延伸），
all 时把 SyncSegsInRange 并入段集再聚合。缓存键加 cacheEpoch
（Start/Stop bump——perf 测试缓存被后续测试命中过，实测踩的）。

**httpapi**：GET/PUT /sync/settings（GET 打码；PUT 部分更新，password
出现且 ≠ 打码值才改——防前端把打码串写回）、POST /sync/now（错误在
响应体 {pushed,pulled,errors}）、GET /sync/status（devices 清单）。
main.go 装配 StartProduction。

## Alternatives considered

- **golang.org/x/net/webdav**：是服务端包；客户端裸 HTTP 即可。放弃。
- **纯增量 PUT（契约字面）**：WebDAV 无 append/If-Match 增量语义，
  把增量 PUT 到自己路径 = 覆盖成空集，老数据丢失、新设备拉不到
  （E2E 实测暴露）。落地为 GET-merge-PUT 累计快照：远端文件单调不减，
  水位线用于新增计数。语义结果与契约一致（不重复推、远端含全部历史）。
- **合并键按契约字面 (deviceId,start,end,app)**：「同键取 end 更晚者」
  只有键不含 end 才有意义；采集幂等模型 = (deviceId,start,app) + 段延长。
  按后者落地（契约调和，交付说明声明）。
- **rules.json 拉取自动覆盖本地**：契约对 rules 合并语义含糊（文档乱码），
  静默覆盖用户自定义规则风险大。v1 只推不拉（远端可备份/查看），
  合并语义待 Owner 拍板。
- **scopeAgg 在 sync 包做视图查询**：分类/缓存/桶逻辑全在 activity，
  sync 只做推拉写表——scopeAgg 在 activity 内部把 SyncSegsInRange 并入
  段集是最小改动。放弃跨包重构。
- **E2E 用 rclone serve webdav**：本机无 rclone。用 Go 内存 WebDAV 服务器
  （真 HTTP 语义 + Basic auth + 409/404/PROPFIND 行为，契约允许「或同类」）；
  rclone 真机验收留给 lead 的集成步骤。

## Consequences

收益（全部有测试）：

- 单测：合并三态（added/updated/skipped + 删除不传播 + 坏段防御）、
  水位线增量（首推 after=0 全量、二次 after=lastPushedAt-7d、成功才记账）、
  MKCOL（严格服务器 409 → 客户端自动建目录重试）、404 正常态（ErrNotExist）、
  打码（GET 打码/回显打码串不覆盖/新密码生效/明文不泄漏）
- E2E：内存 WebDAV + 两台"设备"互相同步——A 推 2 段 B 推 1 段，
  双方拉取后视图恰含对方设备的全部段；合并幂等（重拉视图不变）
- scopeAgg：本机 1h + 同步视图 2h → all=3h、rank 同款、默认仍只看本机、
  未知 scopeAgg 400、删除不传播（本机清空后视图仍是别人的数据）
- 故障注入：WebDAV 指向不可达端口 → /sync/now 返回 errors、lastError
  落盘、有错不推水位线，且 activity 的 GetStatus/GetSummary 照常工作
  （独立 goroutine/独立连接，采集循环零影响）
- 全仓 build/vet/test 8 包绿（新增 sync）

代价与边界：

- 每次 push 是 GET+PUT 整文件（几百 KB 级、300s 一次）——流量换简单正确；
  量级大了再议 If-Match/delta
- rules.json 拉取合并 v1 未做（见 Alternatives），远端只有备份
- 同步视图无 retention：长期运行的设备视图单调增长（v1 接受，
  数据量级远小于本机段）
- 本机 Clear 不清 sync_segments（删除不传播的自然结果）；设置页
  「清除同步数据」按钮可后续接 ClearSyncView（已留函数）
- 性能门禁（perf_test 200ms 阈值）在并行测试负载下偶发瞬时超阈值
  （本批观察过一次，单独重跑即绿）——阈值有 3 倍余量，若 CI 误红再调

## Testing

- 见 Consequences 清单；E2E 走真实组件（httptest 服务器 + 真实 settings
  落盘 + SQLite 迁移 + HTTP 客户端）
- 波折记录：aggregate/api 的 mojibake 注释继续是文本锚点杀手（函数级锚点
  处理）；Classify→GetSummary 签名变更波及 ai 包（actSummary/actRank 是
  函数变量，测试假件签名批量适配）；E2E 首版两个断言错误（视图只含对方
  设备是设计使然；map 迭代序随机）——都被测试自己抓的
- gofmt-crlf 传目录 "." 会扫全树——误格式化 524 行无关文件已回滚，
  以后只传明确的子目录
