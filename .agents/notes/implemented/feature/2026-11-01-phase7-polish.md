# Agent Note: 七期集成——对标 Hindsight 精致度补齐 + scope=year 假 200 事故

Status: implemented

## Problem

Owner 要求全面对标 Hindsight（官方文档 11 个功能页逐项对照，差距清单见对比审计）。七期落地其中的精致度项：B1 月饼联动、B2 年表交互、B3 对话依据、B5 侧栏停采、A3 四主题、A6 自动总结、A7 检查更新、A2 调研。

## Decision

1. **B1/B2**（activity-pages）：月统计点选内环大类→外环只显示该类应用构成+四卡联动（本月 vs 上月变化、日均、日均环比、最大构成应用，数值与 rank API 对账）；全部历史热力图拖选放大区间+点选某天排行联动（scope=day）。区间排行按月粒度并明确标注（无区间排行端点，不加 agent 参数）。
2. **B5**（web-shell）：侧栏状态位可点击停采/恢复（PUT settings 部分更新+乐观更新+失败回滚），移动端 ActivityStatusFab 同链路；语义对齐 Hindsight：采集中/休息中点击=停止、已停止点击=恢复。
3. **A3**（web-shell）：四主题 token 集（data-theme 切换）：明亮/暗色/简约（中性低饱和）/留白扁平（纯白、发丝分隔、无极光）；循环切换+设置页外观卡；图表 props 跟随 ThemeName。顺手修三期遗留的 light 段 --ldk-nav-active-* 锚点错位（写成了深色值）。
4. **A6+B3**（agent-ai + ai-pages）：报告持久化 dataDir/reports/（自动补缺**从不覆盖**、手动**总是覆盖**的不对称语义）；planBackfill 纯函数（最近 7 天+上周周报，无数据日跳过不烧 token）；GET /ai/reports 两端点；chat 响应扩展 citations（[cite:YYYY-MM-DD] 标记解析，范围过滤+去重）；前端报告历史卡+自动总结设置卡+依据链接。
5. **A7**（titlebar-win）：tauri updater 全链路——签名密钥（仓库外 D:\WishProject\landeck-updater-keys\，私钥入 gh secret）、CI 产 latest.json（签名缺失发 0.0.0 空清单优雅降级）、设置→关于卡（手动检查+自动检查开关+启动静默检查）。**updater 端点强制 HTTPS 在插件初始化校验——http 端点=启动 panic**（险些上线，已修）。
6. **scope=year 真实现**（agent-activity，追加）：**发现五期的 year 是假 200**——agent 对未知 scope 按一天解析返回小时桶，全部历史页渲染垃圾数据两轮验收未察觉。修：真 year 聚合（65.5ms@3806 段）+ **未知 scope/date 一律 400**（拒绝假响应是事故根源的根治）+ 响应自描述（Scope 回显）+ activity.Stop 置 nil（Stop 后 Start 拿已停机 Manager 全查询 500，同类）。

## Alternatives considered

- **前端不校验响应形状，等 agent 修 year**：假 200 已存在数月未察觉——形状校验（scope 回显+桶 key 格式）是防此类事故的门禁，必须前端自保。放弃裸等。
- **A2 域名记录走 UIA/History/代理**：agent-activity 五路径调研（proposed 笔记）——代理/hosts MITM 是隐私反模式直接否决；History「最近访问≠当前前台」否决；推荐 MV3 扩展 companion + localhost 推送 + Origin 白名单（下轮立项）。
- **自动补缺带覆盖**：会重复烧 LLM token——补缺从不覆盖、手动总覆盖的不对称语义。

## Consequences

- 真机验收：四主题四态截图亲眼、侧栏停采双向往返 CDP 实测、报告历史区+自动总结卡+关于卡+检查更新 404 降级路径全过、月饼四卡真数据上线（本月总时长 2h55m −4h48m、日均、活跃天数、最大类别）。
- 签名密钥入库外：**此后所有 tauri build 必须带 TAURI_SIGNING_PRIVATE_KEY/PASSWORD 两个 env**（CI 已配；缺密钥构建直接失败）。
- 完整 check→install→relaunch 待 CI 发首个签名版本后回归（updater 端点强制 HTTPS，本地 http 端点不可用）。
- month 报告暂不落盘（契约未定义月报文件名，Hindsight 月报也在开发中）。

## Testing

- 全仓 7 包测试绿；ai 包新增 15 用例（覆盖语义/路径穿越防护/citations 端到端）；discovery/activity/memory/perf 门禁常驻。
- 真机 CDP 验收 8/9 过（唯一 FAIL 是探针文案假设——返回全览控件在选中态才出现，模拟 dispatch 未完全进入选中态；选中态由 activity-pages 真数据对账截图自证）。
- 故障注入多处证明会红：planBackfill 忽略已有报告、citations 去重失效、bucketKeysFor year 退化小时桶、签名篡改拒绝。

## 关联

- 六期移动适配（同日交付）：[移动适配](2026-10-31-phase4-integration.md) 之后的轮次
- A2 调研：proposed/feature/2026-11-01-domain-capture-feasibility.md
- 待立项：A1 云同步（WebDAV 先行）、A4 插件系统、A5 多语言
