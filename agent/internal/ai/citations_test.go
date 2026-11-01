package ai

import (
	"strings"
	"testing"
	"time"
)

func range2026_10() (time.Time, time.Time) {
	// 2026-10-26(周一) ~ 2026-11-01(周日)，模拟 week 口径的注入范围
	from, _ := time.ParseInLocation("2006-01-02", "2026-10-26", time.Local)
	to, _ := time.ParseInLocation("2006-01-02", "2026-11-01", time.Local)
	return from, to.AddDate(0, 0, 1).Add(-time.Second)
}

// 多标记 + 同日去重 + 正文剥除。
func TestParseCitationsMultiAndDedupe(t *testing.T) {
	from, to := range2026_10()
	content := "周二你编程 3 小时[cite:2026-10-27]。周三游戏 2 小时[cite:2026-10-28]。" +
		"另外周二的浏览也不少[cite:2026-10-27]。无日期的句子不受影响。"
	clean, cites := ParseCitations(content, from, to)
	if strings.Contains(clean, "[cite:") {
		t.Fatalf("正文残留标记: %s", clean)
	}
	if strings.Contains(clean, "周二你编程") == false || !strings.Contains(clean, "无日期的句子") {
		t.Fatalf("正文被误伤: %s", clean)
	}
	if len(cites) != 2 {
		t.Fatalf("去重后应 2 条: %+v", cites)
	}
	// 升序
	if cites[0].Route != "#/activity/daily?date=2026-10-27" || cites[1].Route != "#/activity/daily?date=2026-10-28" {
		t.Fatalf("route 不对: %+v", cites)
	}
	if cites[0].Label != "10月27日日报" {
		t.Fatalf("label 不对: %q", cites[0].Label)
	}
}

// 一句多日：[cite:a,b] 全部解析。
func TestParseCitationsCommaSeparated(t *testing.T) {
	from, to := range2026_10()
	clean, cites := ParseCitations("两天合计 5 小时[cite:2026-10-27, 2026-10-28]。", from, to)
	if strings.Contains(clean, "[cite:") {
		t.Fatal("标记未剥除")
	}
	if len(cites) != 2 {
		t.Fatalf("应 2 条: %+v", cites)
	}
}

// 无标记：citations 缺席（nil）——响应层据此省略字段。
func TestParseCitationsNone(t *testing.T) {
	from, to := range2026_10()
	clean, cites := ParseCitations("普通回答，没有任何标记。", from, to)
	if clean != "普通回答，没有任何标记。" || cites != nil {
		t.Fatalf("clean=%q cites=%+v", clean, cites)
	}
}

// 范围外日期：标记剥除但不进 citations（幻觉日期链接过去是空页面）。
func TestParseCitationsOutOfRange(t *testing.T) {
	from, to := range2026_10()
	clean, cites := ParseCitations("上周三的事[cite:2026-10-21]。范围内的[cite:2026-10-27]。", from, to)
	if strings.Contains(clean, "[cite:") {
		t.Fatal("范围外标记也应剥除")
	}
	if len(cites) != 1 || cites[0].Route != "#/activity/daily?date=2026-10-27" {
		t.Fatalf("应只剩范围内 1 条: %+v", cites)
	}
}

// 边界含入：from 与 to 当天都有效（to 是 23:59:59 闭区间）。
func TestParseCitationsRangeEdges(t *testing.T) {
	from, to := range2026_10()
	_, cites := ParseCitations("[cite:2026-10-26] [cite:2026-11-01]", from, to)
	if len(cites) != 2 {
		t.Fatalf("范围边界日期应都保留: %+v", cites)
	}
}
