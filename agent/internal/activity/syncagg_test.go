package activity

import (
	"testing"
	"time"
)

// scopeAgg=all（十期 A1）：summary/rank 把同步视图并入统计——
// 「summary(scopeAgg=all) 覆盖两台数据」验收的统计侧（跨设备到达由
// sync 包的 E2E 覆盖）。
func TestScopeAggAll(t *testing.T) {
	m := Start(testDir(t))
	t.Cleanup(func() { Stop() })

	now := time.Now()
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)

	// 本机：1h 编程
	if err := m.db.insert(Segment{App: "code", Title: "main.go", Start: from.Add(time.Hour).Unix(), End: from.Add(2 * time.Hour).Unix()}); err != nil {
		t.Fatal(err)
	}
	// 同步视图（设备 B）：2h 影音（youtube 域名段）
	remote := []Segment{
		{App: "chrome", Title: "视频", Domain: "www.youtube.com", Start: from.Add(3 * time.Hour).Unix(), End: from.Add(5 * time.Hour).Unix()},
	}
	if err := ReplaceSyncDevice("devB", "PC-B", now.Unix(), remote); err != nil {
		t.Fatal(err)
	}

	day := from.Format("2006-01-02")

	// 默认（scopeAgg=""）：只看本机 → 1h
	sum1, err := GetSummary("day", day, "")
	if err != nil {
		t.Fatal(err)
	}
	s1 := sum1.(Summary)
	if s1.TotalSec != 3600 {
		t.Fatalf("默认应只含本机 3600s，得到 %d", s1.TotalSec)
	}

	// scopeAgg=all：本机+同步视图 → 3h（且域名分类生效：youtube→远端段类别）
	sum2, err := GetSummary("day", day, "all")
	if err != nil {
		t.Fatal(err)
	}
	s2 := sum2.(Summary)
	if s2.TotalSec != 3600+7200 {
		t.Fatalf("all 应 10800s，得到 %d", s2.TotalSec)
	}

	// rank 同款
	rk, err := GetRank("day", 10, day, "all")
	if err != nil {
		t.Fatal(err)
	}
	r := rk.(Rank)
	if r.TotalSec != 3600+7200 {
		t.Fatalf("rank all 应 10800s，得到 %d", r.TotalSec)
	}

	// 未知 scopeAgg → 400 语义（拒绝静默假响应）
	if _, _, _, _, err := rangeOf("day", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := GetSummary("day", day, "nonsense"); err == nil {
		t.Fatal("未知 scopeAgg 应报错")
	}
	if _, err := GetRank("day", 10, day, "nonsense"); err == nil {
		t.Fatal("未知 scopeAgg（rank）应报错")
	}

	// 删除不传播（契约 v1）：直查（GetSummary 有 3min 缓存，直删不失效是
	// 设计行为）——本机段清空后同步视图仍是别人的数据
	_, _ = m.db.db.Exec(`DELETE FROM segments`)
	if n, _ := m.db.count(); n != 0 {
		t.Fatalf("本机段应已清空，得到 %d", n)
	}
	if segs := SyncSegsInRange(from.Unix(), from.AddDate(0, 0, 1).Unix()); len(segs) != 1 {
		t.Fatalf("本机清空后同步视图应仍有对方的 1 段（删除不传播），得到 %d", len(segs))
	}
}
