package activity

import (
	"testing"
	"time"
)

func mkSeg(app, title string, start, end int64) Segment {
	return Segment{App: app, Title: title, Start: start, End: end}
}

func dayAt(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04:05", s, time.Local)
	if err != nil {
		panic(err)
	}
	return t
}

func TestRangeOfWeek(t *testing.T) {
	// 2026-10-31 是周六。所在 ISO 周：周一 10-26 → 周日 11-01
	from, to, fs, ts := rangeOf("week", "2026-10-31", dayAt("2026-10-31 12:00:00"))
	_ = from
	_ = to
	if fs != "2026-10-26" || ts != "2026-11-01" {
		t.Fatalf("周范围应为 2026-10-26..2026-11-01，得到 %s..%s", fs, ts)
	}
	// 无锚点 → 今天所在周
	from2, to2, _, _ := rangeOf("week", "", dayAt("2026-10-28 08:00:00")) // 周三
	if d := to2.Sub(from2).Hours(); d != 168 {
		t.Fatalf("周跨度应 168h，得到 %v", d)
	}
}

func TestBuildSummaryDay(t *testing.T) {
	rules := DefaultCategories()
	from := dayAt("2026-10-31 00:00:00")
	to := from.AddDate(0, 0, 1)

	segs := []Segment{
		// 09:00-11:00 编程（2h）
		mkSeg("Code", "main.go", dayAt("2026-10-31 09:00:00").Unix(), dayAt("2026-10-31 11:00:00").Unix()),
		// 10:30-11:30 浏览（与编程重叠的测试数据：用不重叠的更真实，改为 11:00-11:30）
		mkSeg("chrome", "新闻", dayAt("2026-10-31 11:00:00").Unix(), dayAt("2026-10-31 11:30:00").Unix()),
		// 跨小时段：13:15-14:45 游戏（1.5h，分属 13/14 两个桶）
		mkSeg("steam", "CS2", dayAt("2026-10-31 13:15:00").Unix(), dayAt("2026-10-31 14:45:00").Unix()),
		// 完全在范围外的段：不计
		mkSeg("Code", "yesterday", dayAt("2026-10-30 09:00:00").Unix(), dayAt("2026-10-30 10:00:00").Unix()),
	}

	sum := BuildSummary(segs, rules, "day", from, to)

	if sum.Scope != "day" || sum.From != "2026-10-31" || sum.To != "2026-10-31" {
		t.Fatalf("summary 元信息不对: %+v", sum)
	}
	if len(sum.Buckets) != 24 {
		t.Fatalf("day 应有 24 个桶，得到 %d", len(sum.Buckets))
	}
	// 总时长：2h + 0.5h + 1.5h = 4h
	if want := int64(4 * 3600); sum.TotalSec != want {
		t.Fatalf("总时长应 %d，得到 %d", want, sum.TotalSec)
	}
	// 09 桶：编程 1h；10 桶：编程 1h；11 桶：浏览 30m；13 桶：游戏 45m；14 桶：游戏 45m
	b9 := sum.Buckets[9].Secs
	if b9["编程"] != 3600 {
		t.Fatalf("09 桶编程应 3600s，得到 %v", b9)
	}
	if sum.Buckets[11].Secs["浏览"] != 1800 {
		t.Fatalf("11 桶浏览应 1800s，得到 %v", sum.Buckets[11].Secs)
	}
	if sum.Buckets[13].Secs["游戏"] != 2700 || sum.Buckets[14].Secs["游戏"] != 2700 {
		t.Fatalf("13/14 桶游戏各应 2700s，得到 %v / %v", sum.Buckets[13].Secs, sum.Buckets[14].Secs)
	}
	// 分类总量：编程 2h、浏览 30m、游戏 1.5h，且按秒数倒序
	if len(sum.Categories) != 3 {
		t.Fatalf("应 3 个分类，得到 %d", len(sum.Categories))
	}
	if sum.Categories[0].Category != "编程" || sum.Categories[0].Secs != 7200 {
		t.Fatalf("第一名应为 编程 7200s，得到 %+v", sum.Categories[0])
	}
	if sum.Categories[0].Parent != "工作" {
		t.Fatalf("编程的大类应为 工作，得到 %s", sum.Categories[0].Parent)
	}
}

func TestBuildSummaryMonthCrossMidnight(t *testing.T) {
	rules := []CategoryRule{{ID: "1", Category: "编程", Parent: "工作", AppPatterns: []string{"code"}}}
	from := dayAt("2026-10-01 00:00:00")
	to := from.AddDate(0, 1, 0)
	// 10-31 22:00 → 11-01 02:00（4h，2h 在 10 月、2h 在 11 月——只应计入 10 月的 2h）
	segs := []Segment{
		mkSeg("code", "x", dayAt("2026-10-31 22:00:00").Unix(), dayAt("2026-11-01 02:00:00").Unix()),
	}
	sum := BuildSummary(segs, rules, "month", from, to)
	if sum.TotalSec != 2*3600 {
		t.Fatalf("跨月段只应计入 10 月的 2h，得到 %d", sum.TotalSec)
	}
	// 31 号的桶有 7200s，11-01 的桶不存在
	last := sum.Buckets[len(sum.Buckets)-1]
	if last.Key != "2026-10-31" || last.Secs["编程"] != 7200 {
		t.Fatalf("末日桶应 7200s，得到 %+v", last)
	}
}

func TestBuildRank(t *testing.T) {
	rules := DefaultCategories()
	from := dayAt("2026-10-31 00:00:00")
	to := from.AddDate(0, 0, 1)
	segs := []Segment{
		mkSeg("Code", "a", dayAt("2026-10-31 09:00:00").Unix(), dayAt("2026-10-31 10:00:00").Unix()),   // 1h
		mkSeg("chrome", "b", dayAt("2026-10-31 10:00:00").Unix(), dayAt("2026-10-31 12:00:00").Unix()), // 2h
		mkSeg("steam", "c", dayAt("2026-10-31 12:00:00").Unix(), dayAt("2026-10-31 15:00:00").Unix()),  // 3h
		mkSeg("", "无名字进程", dayAt("2026-10-31 15:00:00").Unix(), dayAt("2026-10-31 15:30:00").Unix()),   // 30m → 未知
	}
	r := BuildRank(segs, rules, "day", from, to, 2)
	if r.To != "2026-10-31" {
		t.Fatalf("rank To 应为含当天 2026-10-31，得到 %s", r.To)
	}
	if len(r.Apps) != 2 {
		t.Fatalf("limit=2 应只返回 2 行，得到 %d", len(r.Apps))
	}
	if r.Apps[0].App != "steam" || r.Apps[0].Secs != 3*3600 || r.Apps[0].Category != "游戏" {
		t.Fatalf("第一名应为 steam 3h 游戏，得到 %+v", r.Apps[0])
	}
	if r.Apps[1].App != "chrome" {
		t.Fatalf("第二名应为 chrome，得到 %+v", r.Apps[1])
	}
	if r.Categories[0].Category != "游戏" || r.Categories[0].Parent != "娱乐" || r.Categories[0].Secs != 3*3600 {
		t.Fatalf("分类第一名应为 游戏(娱乐) 3h，得到 %+v", r.Categories[0])
	}
	// limit=0 → 默认 10，空应用归「未知」
	r2 := BuildRank(segs, rules, "day", from, to, 0)
	if len(r2.Apps) != 4 || r2.Apps[3].App != "未知" {
		t.Fatalf("默认 limit 应 10 且空应用归未知，得到 %+v", r2.Apps)
	}
}

func TestBuildAppDetail(t *testing.T) {
	rules := DefaultCategories()
	from := dayAt("2026-10-31 00:00:00")
	to := from.AddDate(0, 0, 1)
	segs := []Segment{
		mkSeg("chrome", "GitHub — Pull Request #42", dayAt("2026-10-31 09:00:00").Unix(), dayAt("2026-10-31 09:40:00").Unix()),
		mkSeg("chrome", "GitHub — Issues", dayAt("2026-10-31 09:40:00").Unix(), dayAt("2026-10-31 10:00:00").Unix()),
		mkSeg("chrome", "GitHub — Pull Request #42", dayAt("2026-10-31 22:00:00").Unix(), dayAt("2026-10-31 22:30:00").Unix()),
		mkSeg("Code", "不属于该应用", dayAt("2026-10-31 09:00:00").Unix(), dayAt("2026-10-31 11:00:00").Unix()),
	}
	d := BuildAppDetail(segs, rules, "chrome", from, to)
	if d.TotalSec != 90*60 {
		t.Fatalf("chrome 总时长应 90min，得到 %d", d.TotalSec)
	}
	if d.Category != "浏览" {
		t.Fatalf("chrome 分类应 浏览，得到 %s", d.Category)
	}
	// 小时分布：09 桶 60m（40m+紧接的 20m 同属 09 点小时）、22 桶 30m
	if len(d.Hours) != 2 {
		t.Fatalf("应 3 个非空小时，得到 %d", len(d.Hours))
	}
	if d.Hours[0].Hour != "09" || d.Hours[0].Secs != 3600 {
		t.Fatalf("09 桶应 3600s，得到 %+v", d.Hours[0])
	}
	// 标题分组排序：PR #42 共 70min 排第一
	if len(d.ByTitle) != 2 || d.ByTitle[0].Title != "GitHub — Pull Request #42" || d.ByTitle[0].Secs != 70*60 {
		t.Fatalf("标题分组应 PR#42 70min 居首，得到 %+v", d.ByTitle)
	}
}
