# Agent Note: AI 自动总结持久化与对话依据链接（七期 A6+B3）

Status: implemented

## Problem

对标 Hindsight 的两个能力缺口：
1. 日报/周报只能即时生成看完即走——没有存档、没有自动补缺，用户要每天手动点。
2. AI 对话引用了统计数字，但用户无法核对"这个数字来自哪天"。

## Decision

### A6 报告持久化 + 自动总结

- **文件名即身份**：`dataDir/reports/` 下日报 `YYYY-MM-DD.md`、周报 `week-YYYY-Www.md`（ISO 周号）。
  列表 id 在文件名之上再包一层（`day-2026-10-31` / `week-2026-W44`）——id 用于 API，
  文件名用于人眼，`idToName()` 是两者唯一的翻译点。
- **覆盖语义不对称**：自动补缺**从不覆盖**（已有文件即跳过）；手动生成**总是覆盖**
  （POST /ai/summary 成功即存档，响应带 `saved` 元数据）。这样补缺是幂等的：
  第二次 runBackfill 生成 0 份、0 次 LLM 调用（有测试锁定）。
- **补缺计划是纯函数** `planBackfill(now, exists, hasData)`：最近 7 天日报缺失且
  有数据（totalSec>0）才补；上周周报缺失且周内有数据才补。无数据日跳过——
  对空日子写「0 分钟」的报告没有信息量还烧 token。调度器 30s tick + 「今天跑过没有」
  内存标记，重启靠启动补缺兜底（`Register` 里 `startScheduler()`）。
- **ai.json 扩展** `autoSummary: {enabled, time}`（默认 time="23:00"，非法值 sanitize 回退）。

### B3 citations

- system prompt 约定：引用具体日期数据时句末追加 `[cite:YYYY-MM-DD]`（多日逗号分隔）。
- `ParseCitations(content, from, to)` 纯函数：剥**所有**标记（含越界的——正文不能残留内部记号）、
  同日去重、只保留注入上下文范围 `[from,to]` 内的日期（范围外是幻觉，链接过去是空页面）、
  按日期升序组装 `{label:"10月31日日报", route:"#/activity/daily?date=…"}`。
- 响应 `{content, citations?}`：无标记时省略字段，向后兼容。

## Alternatives considered

- **报告存 SQLite**（与 activity 同库）：报告是低频大文本，文件系统直读即导出（`GET content`
  直接回 markdown，零转换）；入库反而要为导出再拼一层。放弃。
- **滚动 7 天窗口**（chat 上下文）：要 7 次查询拼装；activity 的 week scope 已带缓存且
  「本周」是最高频口径。放弃（注释注明近似）。
- **补缺时覆盖已有报告**：用户手动改过报告文件会被自动任务冲掉；幂等性也没了。放弃。
- **citations 全收（不过滤范围）**：模型幻觉日期的链接点开是空统计页，比没有链接更伤信任。放弃。
- **月报落盘**：契约只定义了日报/周报的文件名。month scope 生成成功只返回 markdown
  不落盘（`saveReport` 对 month 显式拒绝），等前端定版再扩。

## Consequences

收益（真机路径，httptest 假 LLM + 桩统计）：

- POST /ai/summary → 报告落盘 + `saved` 元数据；GET /ai/reports 列表（新在前）、
  GET /ai/reports/content?id= 直出 markdown。
- runBackfill：7 天窗口（1 天无数据）+ 上周周报 = 7 份落盘、7 次 LLM 调用；
  无数据日 0 次调用；重跑 0 生成 0 调用。
- chat：`[cite:2026-10-31]` → `{content(无标记), citations:[{10月31日日报, route}]}`，
  范围外日期被滤掉。

代价与边界：

- `idToName` 是 id 与文件名的隐式映射——日报文件名无前缀（契约原文），
  新增报告类型时必须同步这个函数（有测试锁定两类命名）。
- 补缺最多补 7 天 + 1 周报：更早的缺失不追溯（Hindsight 同口径）。
- 自动总结触发时如果 LLM 挂了，单条失败不拦其余，失败的报告明天补缺时自然重试。

## Testing

37 个用例全绿（原 22 + 新 15）。两处故障注入证明门禁会红：

1. `planBackfill` 忽略「已有报告」判据 → `TestPlanBackfill` 精确变红
   （「已有报告的今天不应在计划: day-2026-10-31」）；
2. `ParseCitations` 去重失效（保留 seen 赋值维持编译）→ `TestParseCitationsMultiAndDedupe`
   变红（10月27日日报出现两条）。

**注入的工程教训**：注入必须编译通过才算数——第一版把 seen 赋值整个删掉导致 build failed，
"红"是编译错不是断言红，证明力为零。改成保留赋值、只破语义。

**调试纪律教训（本批第三次）**：多步补丁脚本「最后统一写盘」在中间断言失败时会丢掉
前面全部替换；PowerShell 内联 python -c 会被引号/编码撕碎。结论：文件修改一律
脚本文件化（.tmp/*.py）或 edit 工具，一步一验证。
