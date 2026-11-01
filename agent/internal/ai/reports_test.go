package ai

import (
	"strings"
	"testing"
	"time"
)

// 文件名与 id：day 直接日期；week 用 ISO 周号。
func TestReportFileName(t *testing.T) {
	day, _ := time.ParseInLocation("2006-01-02", "2026-10-31", time.Local) // 周六
	name, id, err := reportFileName("day", day)
	if err != nil || name != "2026-10-31.md" || id != "day-2026-10-31" {
		t.Fatalf("day: %q %q %v", name, id, err)
	}

	// 2026-10-31 属 ISO 周 2026-W44（Go ISOWeek 验证过的基准，不手算）
	y, w := day.ISOWeek()
	if y != 2026 || w != 44 {
		t.Fatalf("基准 ISO 周假设不成立: %d-W%02d", y, w)
	}
	name, id, err = reportFileName("week", day)
	if err != nil || name != "week-2026-W44.md" || id != "week-2026-W44" {
		t.Fatalf("week: %q %q %v", name, id, err)
	}

	// 同一周的周一与周六必须得到同一文件名（补缺不产生重复文件）
	monday := day.AddDate(0, 0, -5)
	name2, id2, _ := reportFileName("week", monday)
	if name2 != name || id2 != id {
		t.Fatalf("同周锚点文件名不一致: %q vs %q", name2, name)
	}

	if _, _, err := reportFileName("month", day); err == nil {
		t.Fatal("month 不支持落盘，应报错")
	}
}

// 保存/列表/读取往返；不覆盖语义；覆盖语义。
func TestSaveListReadRoundtrip(t *testing.T) {
	SetStoreDir(t.TempDir())
	day, _ := time.ParseInLocation("2006-01-02", "2026-10-31", time.Local)

	meta, err := saveReport("day", day, "# 日报 v1", false)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if meta.ID != "day-2026-10-31" || meta.Type != "day" || meta.Date != "2026-10-31" {
		t.Fatalf("meta 不对: %+v", meta)
	}
	if meta.GeneratedAt == "" {
		t.Fatal("generatedAt 缺失")
	}

	// 不覆盖：再存 v2，读取仍是 v1
	if _, err := saveReport("day", day, "# 日报 v2", false); err != nil {
		t.Fatal(err)
	}
	got, err := readReport("day-2026-10-31")
	if err != nil || got != "# 日报 v1" {
		t.Fatalf("不覆盖语义破坏: %q %v", got, err)
	}

	// 覆盖（手动生成语义）：v3 生效
	if _, err := saveReport("day", day, "# 日报 v3", true); err != nil {
		t.Fatal(err)
	}
	got, _ = readReport("day-2026-10-31")
	if got != "# 日报 v3" {
		t.Fatalf("覆盖语义破坏: %q", got)
	}

	// 列表：新的在前
	week, _ := time.ParseInLocation("2006-01-02", "2026-10-26", time.Local) // 同周周一
	if _, err := saveReport("week", week, "# 周报", false); err != nil {
		t.Fatal(err)
	}
	list := listReports(30)
	if len(list) != 2 {
		t.Fatalf("列表应 2 条: %+v", list)
	}
	if list[0].Type != "day" || list[0].ID != "day-2026-10-31" {
		t.Fatalf("排序不对（新在前）: %+v", list[0])
	}
	if list[1].Type != "week" || list[1].ID != "week-2026-W44" {
		t.Fatalf("week 列表项不对: %+v", list[1])
	}

	// content 读取
	got, err = readReport("week-2026-W44")
	if err != nil || got != "# 周报" {
		t.Fatalf("week 读取: %q %v", got, err)
	}
}

// 路径穿越防护：id 直接拼文件名，必须白名单校验。
func TestReadReportRejectsBadID(t *testing.T) {
	SetStoreDir(t.TempDir())
	for _, bad := range []string{"../../etc/passwd", "day-2026-10-31/../../x", "day-2026-10-31.txt", "", "day-", "week-2026-W440"} {
		if _, err := readReport(bad); err == nil {
			t.Fatalf("非法 id 应被拒绝: %q", bad)
		}
	}
}

// 补缺计划：已有跳过、无数据跳过、上周周报恰好一条。
func TestPlanBackfill(t *testing.T) {
	now, _ := time.ParseInLocation("2006-01-02 15:04", "2026-10-31 23:05", time.Local) // 周六

	// 数据：最近 7 天都有数据，除 4 天前（无数据日）
	existing := map[string]bool{}
	hasData := map[string]bool{}
	for i := 0; i < 7; i++ {
		d := now.AddDate(0, 0, -i)
		a := d.Format("2006-01-02")
		hasData[a] = true
	}
	delete(hasData, now.AddDate(0, 0, -4).Format("2006-01-02")) // 无数据日
	// 今天日报已落盘（此前 23:00 自动总结已跑过的情形）——plan 必须跳过它
	existing["day|"+now.Format("2006-01-02")] = true
	// 上周周报已有
	lw, _ := anchorDate("week", now.AddDate(0, 0, -7).Format("2006-01-02"), now)
	existing["week|"+lw.Format("2006-01-02")] = true

	plan := planBackfill(now,
		func(scope, anchor string) bool { return existing[scope+"|"+anchor] },
		func(scope, anchor string) bool { return hasData[anchor] },
	)

	// 无数据日（4 天前）不得进补缺计划
	for _, p := range plan {
		if p.Scope == "day" && p.Anchor == now.AddDate(0, 0, -4).Format("2006-01-02") {
			t.Fatalf("无数据日进了补缺计划: %+v", p)
		}
	}
	// 周报已有 → 不在计划
	for _, p := range plan {
		if p.Scope == "week" {
			t.Fatalf("已有周报不应在计划: %+v", p)
		}
	}
	// 日报应为 5 条（7 天 - 1 无数据 - 1 今天已有）；今天的不得在计划里
	dayCount := 0
	for _, p := range plan {
		if p.Scope == "day" {
			dayCount++
			if p.Anchor == now.Format("2006-01-02") {
				t.Fatalf("已有报告的今天不应在计划: %+v", p)
			}
		}
	}
	if dayCount != 5 {
		t.Fatalf("日报计划应 5 条，实际 %d: %+v", dayCount, plan)
	}
}

// 周报缺失时补进计划。
func TestPlanBackfillMissingWeekly(t *testing.T) {
	now, _ := time.ParseInLocation("2006-01-02 15:04", "2026-10-31 23:05", time.Local)
	hasData := map[string]bool{}
	for i := 0; i < 7; i++ {
		hasData[now.AddDate(0, 0, -i).Format("2006-01-02")] = true
	}
	// 上周整体无独立数据也要靠 week scope 判断——这里桩成有数据
	plan := planBackfill(now,
		func(scope, anchor string) bool { return false },
		func(scope, anchor string) bool {
			if scope == "week" {
				return true // week scope 查询覆盖整周，有任一数据即 true
			}
			return hasData[anchor]
		},
	)
	weekly := 0
	for _, p := range plan {
		if p.Scope == "week" {
			weekly++
			if !strings.HasPrefix(p.Anchor, "2026-10-") {
				t.Fatalf("上周锚点不对: %+v", p)
			}
		}
	}
	if weekly != 1 {
		t.Fatalf("周报应恰好 1 条: %d", weekly)
	}
}
