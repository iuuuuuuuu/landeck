package activity

import (
	"encoding/json"
	"fmt"
	"runtime"
	"testing"
	"time"
)

// 性能门禁（五期体检）：10 倍量数据（4000 段/90 天）下的查询与导出耗时。
// 阈值 = Owner 定的热点线：热态 >200ms 视为需修（本测试即门禁，回归会红）。
// 数据形态按真实分布造：90 天、每天约 44 段、应用池轮换、时段 08:00-23:30。
func TestPerfQueries10x(t *testing.T) {
	if testing.Short() {
		t.Skip("short 模式跳过性能门禁")
	}
	dir := testDir(t)
	m := Start(dir)
	defer func() {
		Stop()
		startMu.Lock()
		mgr = nil
		startMu.Unlock()
	}()

	// ---- 种 4000 段（事务包裹，插入本身不计入测量）----
	const total = 4000
	const days = 90
	now := time.Now()
	apps := []string{"code", "chrome", "chrome", "steam", "wechat", "explorer", "devenv"}
	perDay := total / days

	if _, err := m.db.db.Exec(`BEGIN`); err != nil {
		t.Fatalf("begin: %v", err)
	}
	n := 0
	for d := days; d >= 1; d-- {
		day := now.AddDate(0, 0, -d)
		hour := 8.0
		for i := 0; i < perDay && hour < 23.5; i++ {
			dur := time.Duration(15+n%8*2) * time.Minute // 15~29 分钟（对齐 44 段/天）
			start := time.Date(day.Year(), day.Month(), day.Day(), int(hour), n%60, 0, 0, time.Local)
			end := start.Add(dur)
			if !end.Before(now) {
				end = now
			}
			if err := m.db.insert(Segment{
				App:   apps[n%len(apps)],
				Title: fmt.Sprintf("perf seg %d — document window", n),
				Start: start.Unix(),
				End:   end.Unix(),
			}); err != nil {
				t.Fatalf("seed: %v", err)
			}
			n++
			hour += dur.Hours() + 0.005 // 0.3 分钟 = 0.005 小时（别把分钟加进小时变量——实测种出 103 段）
		}
	}
	if _, err := m.db.db.Exec(`COMMIT`); err != nil {
		t.Fatalf("commit: %v", err)
	}
	t.Logf("seeded %d segments over %d days", n, days)

	threshold := 200 * time.Millisecond
	measure := func(name string, cold time.Duration) {
		t.Logf("  %-28s cold=%v", name, cold)
		if cold > threshold {
			t.Errorf("%s 冷查询 %v 超过热点阈值 %v", name, cold, threshold)
		}
	}

	// ---- summary/rank/appdetail：冷（真实 DB+聚合）与热（缓存）----
	// 注意：缓存键含 scope+date，用不同 date 避开热身期可能的残留缓存
	day := now.Format("2006-01-02")
	monthStart := now.AddDate(0, 0, -days/2).Format("2006-01")

	t0 := time.Now()
	if _, err := GetSummary("day", day); err != nil {
		t.Fatalf("summary day: %v", err)
	}
	measure("summary day (cold)", time.Since(t0))
	t0 = time.Now()
	if _, err := GetSummary("day", day); err != nil {
		t.Fatal(err)
	}
	t.Logf("  %-28s warm=%v", "summary day (cached)", time.Since(t0))

	t0 = time.Now()
	if _, err := GetSummary("month", monthStart[:7]); err != nil {
		t.Fatalf("summary month: %v", err)
	}
	measure("summary month (cold)", time.Since(t0))

	t0 = time.Now()
	if _, err := GetSummary("week", ""); err != nil {
		t.Fatalf("summary week: %v", err)
	}
	measure("summary week (cold)", time.Since(t0))

	t0 = time.Now()
	if _, err := GetRank("month", 10, monthStart[:7]); err != nil {
		t.Fatalf("rank month: %v", err)
	}
	measure("rank month (cold)", time.Since(t0))

	t0 = time.Now()
	if _, err := GetAppDetail("code", day); err != nil {
		t.Fatalf("app detail: %v", err)
	}
	measure("app detail (cold)", time.Since(t0))

	// ---- export：大表全量导出，量耗时与内存峰值 ----
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	t0 = time.Now()
	data, mime, _, err := Export("json")
	if err != nil {
		t.Fatalf("export json: %v", err)
	}
	jsonDur := time.Since(t0)
	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	peak := int64(after.HeapAlloc) - int64(before.HeapAlloc)
	if peak < 0 {
		peak = 0
	}
	t.Logf("  %-28s %v  out=%.1fMB  heapΔ=%.1fMB", "export json", jsonDur,
		float64(len(data))/1e6, float64(peak)/1e6)
	if jsonDur > threshold {
		t.Errorf("export json %v 超过热点阈值 %v", jsonDur, threshold)
	}

	t0 = time.Now()
	data2, _, _, err := Export("csv")
	if err != nil {
		t.Fatalf("export csv: %v", err)
	}
	t.Logf("  %-28s %v  out=%.1fMB", "export csv", time.Since(t0), float64(len(data2))/1e6)
	if d := time.Since(t0); d > threshold {
		t.Errorf("export csv %v 超过热点阈值 %v", d, threshold)
	}
	_ = mime
	_ = data2

	// 校验导出内容确实覆盖了种子数据（防「快但空」的假绿）
	var parsed struct {
		Count    int `json:"count"`
		Segments []struct {
			App string `json:"app"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("export json 解析失败: %v", err)
	}
	// 种子数受「时段 08:00-23:30 + 时长裁剪」影响实际约 3800（≠整 4000）
	if parsed.Count < 3500 {
		t.Fatalf("导出应 ≥3500 段（含真实采集），得到 %d", parsed.Count)
	}
}
