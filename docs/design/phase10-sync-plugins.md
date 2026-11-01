# LanDeck · 云同步（WebDAV 先行）+ 插件系统 设计规范（十期）

> 状态：契约定稿。A1 云同步是本期最大件；A4 插件 MVP 为纯前端实现。

## A1. 云同步（WebDAV）

对齐 Hindsight：多台电脑的活动记录**合并统计**。数据默认只存本机，同步是可选项。

### 同步模型（pull-merge-read，不做删除传播）

- 每台设备把**自己的段记录**导出为 JSON，推到 WebDAV 的**独立路径**：`/landeck-sync/<deviceId>/segments.json`（按设备分文件，永不互相覆盖）。
- 分类规则同样推拉：`/landeck-sync/<deviceId>/rules.json`（合并语义见下）。
- **拉取合并**：每台设备定时（默认 300s + 手动「立即同步」）拉取**其他所有设备**的 segments.json，合入本地一个只读视图（`sync_segments` 表或内存+落盘缓存）。
- **合并语义（段记录是 (start,end,app,title,domain)）**：
  - 键 = (deviceId, start, end, app)；同键且内容一致 → 跳过；同键不同内容 → 取 end 更晚者（采集幂等，实际不会发生，防御性）。
  - **删除不传播**（v1）：本机删数据不影响其他设备副本；下次全量重推前用 `updatedAt`水位线避免重推已推过的段。
  - 水位线：每设备记 `lastPushedAt`，只推 `end > lastPushedAt - 7天` 的段（增量）；首推全量。
- **查询聚合**：summary/rank 增加可选参数 `scopeAgg=all`（本机+同步视图合并统计）；默认仍只看本机。设备选择器里出现「全部设备（汇总）」与各同步设备。
- **隐私**：同步内容含窗口标题（敏感）——设置页明确告知；截图永不同步；同步开关默认关。

### WebDAV 客户端（Go，agent 内）

- 用 `golang.org/x/net/webdav`？不——webdav 是服务端包；客户端直接用 HTTP 方法（PUT/GET/PROPFIND/MKCOL）+ Basic auth，零新依赖（net/http 足够）。
- 路径不存在自动 MKCOL；GET 404 视为「对方还没有数据」正常态。
- 凭据：`/sync/settings` 存 {enabled, url, username, password(0600 同 ai.json 口径), intervalSec}；GET 打码。

### API

| 路由 | 语义 |
| --- | --- |
| GET /sync/settings | {enabled, url, username, password: 打码, intervalSec, lastSyncAt, lastError} |
| PUT /sync/settings | 部分更新；password 字段出现即改 |
| POST /sync/now | 立即同步一次（push+pull），返回 {pushed, pulled, errors} |
| GET /sync/status | {enabled, lastSyncAt, lastError, devices: [{deviceId, name, segments, lastSeenAt}]} |

- 同步设备的 `name` 从对方 segments.json 的 meta 里带（每文件头放 {deviceId, name, savedAt}）。

### 前端（设置页 + 统计页）

- 设置页「云同步」卡：开关、WebDAV 地址/账号/密码、间隔、「立即同步」按钮（结果 toast）、设备清单（status.devices）。
- 统计页：设备选择器加「全部设备（汇总）」项（仅当 sync.devices 非空时出现）；选中后 summary/rank 带 scopeAgg=all。
- 语言卡等已有多语言基建，新文案照 A5 的 key 体系走。

### 验收口径

- 单测：合并语义（同键跳过/取晚/水位线增量）、路径 MKCOL、404 正常态。
- 真机 E2E：本地起一个 WebDAV 服务（Go 内存实现或 Docker 不行——用 rclone serve webdav 临时进程），两台"设备"（同机两个数据目录）互相同步后，summary(scopeAgg=all) 覆盖两台数据。
- 故障注入：WebDAV 不可达 → lastError 有内容且不影响本机采集。

## A4. 插件系统（MVP，纯前端）

- **manifest**：`{id, name, version, entry, permissions: ['activity.read'], author}`——entry 是 JS 模块（esm），从 agent dataDir 的 `/plugins/<id>/` 由 agent 静态服务（/plugins/<id>/entry.js）。
- **宿主**：前端 PluginHost——侧栏出现「插件」组，点击挂载插件的 React 面板（懒 import entry.js）。插件 API 面只暴露 `activity.query`（走现有 activityApi，权限位校验）。
- **Focus 番茄钟**：首个内置插件（bundled），纯前端计时器 + 可选接到活动统计显示本时段用时。
- **市场**：读取固定 URL 的 catalog JSON（先指向仓库里的 plugins.json），展示列表 + 一键安装（下载 entry+manifest 存 agent dataDir，经 agent 新端点 `/plugins/install`——**agent 侧本期不做**，MVP 安装=浏览器导入 manifest URL，记入限制）。
- **安全**：插件 JS 在主页面运行（同源）——v1 明确「只装可信来源」，市场目录默认空 + 手动添加。

## A3. 主题包（MVP）

- 主题包 = JSON：`{id, name, tokens: {...CSS 变量}}`——导入后注册为 data-theme。
- 导入 UI 在设置页外观卡（「导入主题包」按钮，文件选择）；市场列表同样读 catalog JSON（v1 手动 URL）。

## 分工

| 批 | 执行者 | 范围 |
| --- | --- | --- |
| A1 后端 | agent-activity | agent/internal/sync/**、httpapi/sync.go+路由、summary/rank 的 scopeAgg |
| A1 前端 | activity-pages | 统计页汇总项 + 设备选择器、（设置页云同步卡归 web-shell） |
| A4 插件 | web-rd | web/src/plugins/**（宿主+Focus+市场读取）、nav 注册、browser-extension 不动 |
| A5 + 设置页云同步卡/主题导入 | web-shell | ja/pt/es、Settings 云同步卡（对接 A1 后端契约）、主题导入 UI |
| 集成 | lead | 契约裁决、拼装、WebDAV 真机 E2E、发版 |
