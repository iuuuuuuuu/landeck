# LanDeck · Hindsight 风格改版设计规格（一期）

> 状态：设计批产出，待 Owner 过目后进入实施。
> 参考来源：[Hindsight](https://github.com/Tomotsugu-dev/Hindsight)（GPL-3.0）。本仓库已同为 GPL-3.0（93b606a），允许参考其实现；截图仅作设计对照，不进仓库。
> 参考截图清单见文末 URL（raw.githubusercontent 已被墙，用 `cdn.jsdelivr.net/gh/Tomotsugu-dev/Hindsight@main/docs/intro/...`）。

## 1. 从 Hindsight 提炼的设计语言

逐张分析了 monthly / day-bars / app_detail 等截图，核心不是配色，是**信息架构节奏**：

1. **固定左侧栏**（约 300px）：品牌区在顶；导航按组分区，组名是小号灰色大写（Stats / AI-beta / Data / System）；激活项是**白色圆角胶囊卡**（带阴影），非激活项是灰字行；栏底放状态位（「休息中」）和语言切换。
2. **页面头**：超大加粗标题（~40px）+ 灰色副标题，副标题直接带本页汇总数字（"October 2026 · 6h 48m daily avg"）——标题区就是摘要。
3. **大卡片 + 卡内工具条**：主图独占一张大圆角卡（rounded-3xl、细边框、大内边距），卡头左侧是视图切换（下划线式 Segmented：时段/占比），右侧是**设备选择器大下拉 + 日期前后翻页箭头 + "本月"胶囊按钮**。设备切换和翻页是全局复用件。
4. **图表**：堆叠柱状、柱顶圆角、浅色虚线网格；类别色板统一贯穿（柱/图例/排行条/饼图同色）；"工作时段"用淡紫背景 + 虚线边框整段标出。
5. **排行列表**：序号 + 应用图标 + 名称（下行小字类别）+ 类别色内联进度条 + 右对齐时长；两张一列（最常用应用 / 最常用分类）。
6. **下钻用浮层**：点应用弹大圆角面板（非跳页）：图标+名称+类别点+总时长+关闭；内含小时分布迷你柱图、"BY SITE"可展开分节 + 内联条。
7. **整体气质**：浅色、留白大、圆角大、粉彩但饱和的类别色、冷静的仪表盘感。

## 2. LanDeck 新信息架构

Hindsight 是单机应用，侧栏可全平铺；LanDeck 的第一维度是**设备**，不能丢。方案：侧栏分两组，设备维度内聚在"设备"组，统计/AI/数据为新组。

```
侧栏
├─ 品牌：LanDeck（图标 + 名）
├─ 【设备】
│  ├─ 设备         /devices        （现有列表+扫描入口，卡片化重排）
│  ├─ 本机         /local          （现有）
│  └─ 设备详情      /devices/:id    （点进设备后进入，侧栏高亮"设备"）
├─ 【活动】（新增，Hindsight 核心）
│  ├─ 日统计        /activity/daily
│  ├─ 周统计        /activity/weekly
│  ├─ 月统计        /activity/monthly
│  ├─ 全部历史      /activity/all
│  └─ 分类管理      /activity/categories
├─ 【AI】（二期，侧栏先占位分组）
│  ├─ AI 对话       /ai/chat
│  ├─ AI 总结       /ai/summary
│  └─ AI 设置       /ai/settings
├─ 【数据】
│  ├─ 文件          /files          （现有）
│  ├─ 定时任务      /schedules      （现有）
│  └─ 屏幕记忆      /activity/memory （二期，默认隐藏直到开启）
└─ 【系统】
   └─ 设置          /settings       （现有）
栏底：被控端采集状态位（采集中/休息中/已停止，对应 Hindsight 的 Resting）
```

- **Android 端**（同套 web 代码）：侧栏在窄屏折成底部导航，组只保留"设备 / 活动 / 文件 / 设置"四个一级，AI 与统计子页从活动页二级进入。导航组件做两套壳、一套路由。
- 旧 `/stats`、`/activity` 的重定向已指向 /devices（1.0.16 删除统计页时加的），一期用真统计页接管 `/activity/*`。

## 3. 设计 token（落到 web/src/index.css 的 CSS 变量 + tailwind 主题）

| token | 值 | 说明 |
| --- | --- | --- |
| `--ldk-radius-card` | 20px（rounded-3xl） | 大卡统一圆角，比现在更大 |
| `--ldk-sidebar-w` | 280px | 窄屏折叠为底部导航 |
| 类别色板（浅色） | `#A78BFA` 编程 / `#38BDF8` 办公 / `#2DD4BF` 沟通 / `#60A5FA` 浏览 / `#34D399` 社交 / `#8B5CF6` 影音 / `#FB7185` 游戏 / `#94A3B8` 其他 | 类别→颜色全局唯一映射，柱图/图例/排行/饼图共用 |
| 激活导航 | 白底胶囊 + ring 阴影 | 深色主题下用 elevated 底色 |
| 页面标题 | 28~34px 加粗 + 灰色副标题带汇总值 | 移动端降到 22px |
| 卡内工具条 | 左 Segmented(下划线式) / 右 DevicePicker+DateNav | 全局复用组件 |
| 进度条 | 高 6px 圆角，类别色 | 排行/详情共用 |

现有品牌紫与 Hindsight 主紫（#A78BFA 系）接近，直接沿用现有 accent 作为"编程/默认"主色，不引入第二套品牌色。

## 4. 新增/改造组件清单（一期前端批）

新增：`AppSidebar`（含分组与激活胶囊）、`PageHeader`（大标题+副标题摘要）、`CardToolbar`（Segmented + DevicePicker + DateNav）、`StackedBarChart`（echarts 堆叠柱+圆角+工作时段带）、`RankList`（序号/图标/内联条/时长）、`CategoryDot`、`AppDetailPanel`（浮层下钻）、`CategoryBadge`。
改造：`AppShell`（桌面侧栏 / 移动底栏双壳）、`DeviceSelect`（升格为工具条大下拉）、现有页（设备/文件/任务/设置）迁移到新骨架并统一 PageHeader。
复用：`UptimeBarChart` 的 echarts 懒加载模式；缓存层 `queryCache` 直接服务统计 API。

## 5. 一期 agent 批（活动采集）对应此 UI 需要的 API

- `POST /api/v1/activity/events`（agent 内部采集写入，SQLite）
- `GET /activity/summary?scope=day|week|month&date=…&device=…`（堆叠柱数据：按小时/天 × 类别）
- `GET /activity/rank?scope=…`（应用/分类排行）
- `GET /activity/app/:name?date=…`（应用详情：窗口标题/域名分组）
- `GET/PUT /activity/categories`（分类规则）
- `GET/PUT /activity/settings`（开关、间隔、闲置阈值、工作时段、隐私过滤）
采集默认参数对齐 Hindsight：30s 间隔、闲置 3 分钟停表、截图默认关。

## 6. 实施顺序（一期，3 批）

1. **agent 批**：SQLite + 采集（前台应用/窗口标题/闲置检测）+ 上述 API + 单测（含故障注入：关停采集/闲置阈值）。
2. **前端骨架批**：token + AppSidebar + PageHeader + CardToolbar + 现有页迁移（实机逐页截图回归）。
3. **统计页批**：日/周/月/全部历史 + 应用详情浮层 + 分类管理（真数据实机验证，含 Android）。

每批结束跑一次完整构建+部署+实机验证，按实测纪律攒批。

## 附：参考截图 URL（实现时对照用）

- https://cdn.jsdelivr.net/gh/Tomotsugu-dev/Hindsight@main/docs/intro/en/imgs/{daily,app_detail,weekly,monthly,monthly_cal,ai_summary,ai_chatbot}.png
- https://hindsight.kyosweb.com/docs/zh/imgs/activity-record/{day-bars,week-bars,month-bars,month-pie,month-pie-selected,alltime-year,alltime-month}.png
