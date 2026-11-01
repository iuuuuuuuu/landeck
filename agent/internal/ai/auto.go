package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// auto.go：自动总结调度与补缺。
//
// 行为对齐 Hindsight「自动总结」：每天到点生成当天日报；每次启动/到点时
// 补最近 7 天缺失的日报与上一周的周报（有活动数据才生成，无数据日跳过；
// 自动生成从不覆盖已有文件）。
//
// 调度实现刻意朴素：30s tick + 「今天跑过没有」标记，而不是精确 timer——
// 重启后由启动补缺兜底，错过时点最多晚一个 tick，不值得引入复杂生命周期。

const backfillDays = 7

// backfillTarget 计划里的一条「要生成的报告」。
type backfillTarget struct {
	Scope    string // day | week
	Anchor   string // YYYY-MM-DD（scope 锚点，传给 GetSummary/GetRank）
	Desc     string // 人话描述（日志/测试断言用）
	SaveDay  time.Time
	Overview bool // 概览型（scope 与 SaveDay 的 scope 不同，如上周周报）
}

// planBackfill 纯函数：给定现在、存在性判据、数据判据，算出该补哪些报告。
//
// 单测重点：已有文件跳过、无数据跳过、7 天窗口边界、上周周报恰好一条。
// exists(scope, anchorDate)/hasData(scope, anchorDate) 都以 YYYY-MM-DD 锚点为参。
func planBackfill(now time.Time, exists func(scope, anchor string) bool, hasData func(scope, anchor string) bool) []backfillTarget {
	var plan []backfillTarget

	// 最近 7 天日报（含今天：到点时今天也该有一篇）
	for i := 0; i < backfillDays; i++ {
		day := now.AddDate(0, 0, -i)
		anchor := day.Format("2006-01-02")
		if exists("day", anchor) {
			continue
		}
		if !hasData("day", anchor) {
			continue
		}
		plan = append(plan, backfillTarget{Scope: "day", Anchor: anchor, Desc: "日报 " + anchor, SaveDay: day})
	}

	// 上周周报：锚点取 7 天前（任意位置落在上一个 ISO 周内，含今天周日的边界）
	lastWeek := now.AddDate(0, 0, -backfillDays)
	lwMonday, _ := anchorDate("week", lastWeek.Format("2006-01-02"), now)
	lwAnchor := lwMonday.Format("2006-01-02")
	if !exists("week", lwAnchor) && hasData("week", lwAnchor) {
		plan = append(plan, backfillTarget{Scope: "week", Anchor: lwAnchor, Desc: "周报 " + lwAnchor, SaveDay: lwMonday, Overview: true})
	}
	return plan
}

// runBackfill 执行补缺计划：逐条生成并落盘（不覆盖）。返回生成的条数与错误聚合。
// 单条失败不拦其余（断电式失败的每一天明天还会再补）。
func runBackfill(ctx context.Context, now time.Time) (int, error) {
	// planBackfill 用字符串锚点（纯函数好测）；这里桥接 time.Time 判据。
	toAnchor := func(scope string, day time.Time) string {
		d, err := anchorDate(scope, day.Format("2006-01-02"), now)
		if err != nil {
			return day.Format("2006-01-02")
		}
		return d.Format("2006-01-02")
	}
	plan := planBackfill(now,
		func(scope, anchor string) bool {
			d, err := time.ParseInLocation("2006-01-02", anchor, now.Location())
			return err == nil && reportExists(scope, d)
		},
		func(scope, anchor string) bool { return dataPresent(scope, anchor) },
	)
	_ = toAnchor
	generated := 0
	var errs []string
	for _, t := range plan {
		md, err := generateReport(ctx, t.Scope, t.Anchor, false)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", t.Desc, err))
			continue
		}
		generated++
		_ = md
	}
	if len(errs) > 0 {
		return generated, fmt.Errorf("部分报告生成失败: %s", strings.Join(errs, "; "))
	}
	return generated, nil
}

// dataPresent 该锚点下有没有活动数据（无数据日跳过——对空日子写「0 分钟」的
// 报告没有信息量，还烧 token）。判据 = summary 的 totalSec > 0。
func dataPresent(scope, anchor string) bool {
	v, err := actSummary(scope, anchor, "")
	if err != nil {
		return false
	}
	// GetSummary 返回 any（Summary 结构体非导出），走 json round-trip 松散判。
	raw, err := json.Marshal(v)
	if err != nil {
		return false
	}
	var s struct {
		TotalSec int64 `json:"totalSec"`
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return false
	}
	return s.TotalSec > 0
}

// generateReport 生成并落盘一份报告。overwrite 语义见 saveReport。
// scope=month 契约未定义报告文件名，返回 (空, nil) 语义为「不落盘」——
// 月报的沉淀方式等前端定版后再扩（见交付说明）。
func generateReport(ctx context.Context, scope, date string, overwrite bool) (ReportMeta, error) {
	cfg := Get()
	if !configured(cfg) {
		return ReportMeta{}, errNotConfigured
	}
	summary, err := actSummary(scope, date, "")
	if err != nil {
		return ReportMeta{}, err
	}
	rank, err := actRank(scope, 10, "", date)
	if err != nil {
		return ReportMeta{}, err
	}
	msgs, err := BuildReportPrompt(scope, summary, rank)
	if err != nil {
		return ReportMeta{}, err
	}
	md, err := chat(ctx, cfg, msgs)
	if err != nil {
		return ReportMeta{}, err
	}
	day, err := anchorDate(scope, date, time.Now())
	if err != nil {
		return ReportMeta{}, err
	}
	return saveReport(scope, day, md, overwrite)
}

// ---------- 调度 ----------

var (
	schedStarted bool
	lastAutoDay  string // 最近一次自动触发所在的本地日期（防同日重复）
)

// startScheduler 启动 30s tick（幂等）。检查逻辑：
//   - autoSummary.enabled 为 false → 什么都不做（设置改了立刻生效，不用重启）
//   - 未到配置时点 → 跳过
//   - 今天已跑过 → 跳过
//   - 其余 → 置标记后执行补缺（补缺本身包含「生成今天日报」）
func startScheduler() {
	if schedStarted {
		return
	}
	schedStarted = true
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			tickAuto()
		}
	}()
}

func tickAuto() {
	cfg := Get()
	if !cfg.AutoSummary.Enabled || !configured(cfg) {
		return
	}
	deadline, ok := parseAutoTime(cfg.AutoSummary.Time, time.Now())
	if !ok || time.Now().Before(deadline) {
		return
	}
	today := time.Now().Format("2006-01-02")
	if lastAutoDay == today {
		return
	}
	lastAutoDay = today
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if _, err := runBackfill(ctx, time.Now()); err != nil {
		fmt.Printf("[ai] 自动总结补缺失败: %v\n", err)
	}
}

// parseAutoTime 「HH:MM」→ 今天该时点。解析失败返回 false（非法配置当没配）。
func parseAutoTime(s string, now time.Time) (time.Time, bool) {
	t, err := time.ParseInLocation("15:04", strings.TrimSpace(s), now.Location())
	if err != nil {
		return time.Time{}, false
	}
	return time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, now.Location()), true
}
