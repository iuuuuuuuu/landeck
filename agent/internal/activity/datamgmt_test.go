package activity

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 图标缓存：磁盘扫描 → 内存命中 → 名字归一查找。
// （正路提取 icons.Extract 需要真实带图标的 exe，磁盘扫描路径覆盖同一套内存结构。）
func TestIconCacheDiskScan(t *testing.T) {
	dir := testDir(t)
	icoDir := filepath.Join(dir, "appicons")
	if err := os.MkdirAll(icoDir, 0o755); err != nil {
		t.Fatalf("建图标目录失败: %v", err)
	}
	fake := []byte("FAKE-ICO-BYTES")
	// 文件名按 normalizeApp 名存；这里故意存一个大小写不同的名字验证查找归一
	if err := os.WriteFile(filepath.Join(icoDir, "Code.ico"), fake, 0o644); err != nil {
		t.Fatalf("写图标失败: %v", err)
	}

	initIconStore(dir)

	data, mime, etag, ok := GetAppIcon("code.EXE") // 查找侧带 .exe 与大小写
	if !ok {
		t.Fatal("磁盘上的 Code.ico 应被扫进缓存并命中 code.EXE 查询")
	}
	if string(data) != string(fake) {
		t.Fatal("图标字节应原样返回")
	}
	if mime == "" || etag == "" {
		t.Fatalf("mime/etag 不应为空: %q %q", mime, etag)
	}
	// 同内容 etag 稳定（304 依赖这一点）
	_, _, etag2, _ := GetAppIcon("code")
	if etag != etag2 {
		t.Fatalf("同内容 etag 应稳定: %q vs %q", etag, etag2)
	}
	// 未缓存的名字 → miss（404 路径）
	if _, _, _, ok := GetAppIcon("never-seen"); ok {
		t.Fatal("未缓存应用不应命中")
	}
	// 安全性质：端点只查内存缓存，name 只是缓存键，请求路径上没有任何
	// 文件系统访问——路径形式的名字最坏是归一后别名命中同一枚公开图标
	//（normalizeApp 本来就剥路径），不构成目录穿越。
	// 真正要保证的是：从没见过的应用名必须 miss（404）。
	if _, _, _, ok := GetAppIcon(`..\..\secrets\never-installed-app`); ok {
		t.Fatal("从未见过的应用名必须 miss（404 路径）")
	}
	if _, _, _, ok := GetAppIcon(""); ok {
		t.Fatal("空名字必须 miss")
	}
}

// 负缓存：提取失败的应用不再反复尝试。
// Windows 上用必然失败的假路径走真实 Extract 错误分支。
func TestIconNegativeCache(t *testing.T) {
	dir := testDir(t)
	initIconStore(dir)

	bad := filepath.Join(dir, "definitely-not-an-exe.exe")
	if _, err := os.Stat(bad); err == nil {
		t.Fatal("测试前置：假路径不应存在")
	}

	app := "ghostapp"
	if !markIconSeen(app) {
		t.Fatal("首次标记应返回 true")
	}
	extractAppIcon(app, bad) // 提取失败 → 负缓存

	if _, _, _, ok := GetAppIcon(app); ok {
		t.Fatal("提取失败的应用不应有缓存")
	}
	// 已失败：markIconSeen 应回 false，采集循环不会再起 goroutine
	if markIconSeen(app) {
		t.Fatal("负缓存后 markIconSeen 应返回 false")
	}
}

// 清理：只删 beforeDays 之前的段，且作废查询缓存。
func TestClearBeforeDays(t *testing.T) {
	dir := testDir(t)
	m := Start(dir)
	// 注意顺序：Stop 先把 goroutine 停掉并落库，才能清 mgr、删测试目录。
	// 写反了 Stop 会变成 no-op，SQLite 句柄不释放，RemoveAll 失败，
	// 上一轮真实采集的数据就泄进下一轮（实测踩过）。
	defer func() {
		Stop()
		startMu.Lock()
		mgr = nil
		startMu.Unlock()
	}()

	// 等第一次 tick（1s）跑完，让真实状态就绪
	time.Sleep(1500 * time.Millisecond)

	now := time.Now()
	oldEnd := now.AddDate(0, 0, -30).Unix()
	if _, err := m.db.db.Exec(`INSERT INTO segments(day,start,"end",app,title) VALUES(?,?,?,?,?)`,
		dayOf(oldEnd), oldEnd-3600, oldEnd, "oldapp", "old"); err != nil {
		t.Fatalf("种旧段失败: %v", err)
	}
	newEnd := now.Add(-time.Minute).Unix()
	if _, err := m.db.db.Exec(`INSERT INTO segments(day,start,"end",app,title) VALUES(?,?,?,?,?)`,
		dayOf(newEnd), newEnd-60, newEnd, "newapp", "new"); err != nil {
		t.Fatalf("种新段失败: %v", err)
	}

	// 预填查询缓存：Clear 必须把它清掉，否则清完数据统计页还显示旧数字
	cacheMu.Lock()
	cache["summary|day|"] = cacheEntry{at: time.Now(), value: Summary{}}
	cacheMu.Unlock()

	deleted, err := Clear(7)
	if err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if deleted < 1 {
		t.Fatalf("应至少删除 1 条旧段，得到 %d", deleted)
	}
	// 旧段没了、新段还在。按 app 名断言（不用窗口计数）：
	// 这个测试里的采集器是活的，会把本机真实前台写进同一个库，
	// 窗口计数断言对那些数据没有免疫力（实测踩过）。
	var n int
	if err := m.db.db.QueryRow(`SELECT COUNT(*) FROM segments WHERE app='oldapp'`).Scan(&n); err != nil {
		t.Fatalf("查旧段失败: %v", err)
	}
	if n != 0 {
		t.Fatalf("旧段应被删除，还剩 %d", n)
	}
	if err := m.db.db.QueryRow(`SELECT COUNT(*) FROM segments WHERE app='newapp'`).Scan(&n); err != nil {
		t.Fatalf("查新段失败: %v", err)
	}
	if n != 1 {
		t.Fatalf("新段不应被删除，还剩 %d", n)
	}
	// 缓存已作废
	cacheMu.Lock()
	cached := len(cache)
	cacheMu.Unlock()
	if cached != 0 {
		t.Fatalf("Clear 后查询缓存应清空，还剩 %d 条", cached)
	}
}

func TestParseClearDays(t *testing.T) {
	// 缺省拒绝（防误触全清）
	if _, ok := ParseClearDays(map[string]any{}); ok {
		t.Fatal("缺省 beforeDays 必须拒绝")
	}
	// 非法值拒绝
	for _, bad := range []any{0, -1, 1.5, "30", 4000.0, nil} {
		if _, ok := ParseClearDays(map[string]any{"beforeDays": bad}); ok {
			t.Fatalf("beforeDays=%v 必须拒绝", bad)
		}
	}
	// 合法值
	if n, ok := ParseClearDays(map[string]any{"beforeDays": 30.0}); !ok || n != 30 {
		t.Fatalf("30 应接受，得到 %d %v", n, ok)
	}
	if n, ok := ParseClearDays(map[string]any{"beforeDays": 1}); !ok || n != 1 {
		t.Fatalf("1 应接受，得到 %d %v", n, ok)
	}
}

func TestBuildCSV(t *testing.T) {
	segs := []Segment{
		{App: "chrome", Title: `研究 "AI", 与, 逗号`, Start: dayAt("2026-10-31 09:00:00").Unix(), End: dayAt("2026-10-31 10:00:00").Unix()},
	}
	csv := string(buildCSV(segs))
	lines := strings.Split(strings.TrimRight(csv, "\r\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("应 1 表头 + 1 数据行，得到 %d 行", len(lines))
	}
	if !strings.HasPrefix(lines[0], "start,end,day,app,title") {
		t.Fatalf("表头列序不对: %s", lines[0])
	}
	// 含引号与逗号的标题必须被 CSV 转义（引号翻倍 + 整段包裹）
	if !strings.Contains(lines[1], `"研究 ""AI"", 与, 逗号"`) {
		t.Fatalf("标题转义不对: %s", lines[1])
	}
	// start/end 为 RFC3339（人类可读），day 为本地日
	if !strings.Contains(lines[1], "2026-10-31T09:00:00+08:00") && !strings.Contains(lines[1], "T09:00:00") {
		t.Fatalf("start 应为 RFC3339: %s", lines[1])
	}
	if !strings.Contains(lines[1], "2026-10-31,") {
		t.Fatalf("day 列应为本地日: %s", lines[1])
	}
}
