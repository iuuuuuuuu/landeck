package memory

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func md(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("..", "..", "test-tmp", "memory", t.Name()))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func TestShotFilename(t *testing.T) {
	// 契约：unixMs-ms.png
	at := time.Unix(1790000000, 234*1e6)
	got := shotFilename(at)
	want := "1790000000234-234.png"
	if got != want {
		t.Fatalf("文件名应 %s，得到 %s", want, got)
	}
	// 同毫秒不同纳秒也不冲突（毫秒位区分）
	at2 := at.Add(time.Millisecond)
	if shotFilename(at2) == got {
		t.Fatal("相邻毫秒的文件名应不同")
	}
}

func TestMonthDir(t *testing.T) {
	at := time.Date(2026, 10, 31, 12, 0, 0, 0, time.Local)
	if got := monthDir(at); got != "2026-10" {
		t.Fatalf("月份目录应 2026-10，得到 %s", got)
	}
}

func TestSnippet(t *testing.T) {
	// 造 200 字符文本，命中在中间
	text := strings.Repeat("前", 100) + "目标词" + strings.Repeat("后", 100)
	i := len([]rune(strings.Repeat("前", 100)))
	got := snippet(text, i, len([]rune("目标词"))) // 命中长度按 rune 数
	if !strings.Contains(got, "目标词") {
		t.Fatalf("snippet 应包含命中词: %q", got)
	}
	if !strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "…") {
		t.Fatalf("中间命中两端都应有省略号: %q", got)
	}
	// 命中贴近开头：无前省略号
	got2 := snippet("目标词"+strings.Repeat("后", 100), 0, 3)
	if strings.HasPrefix(got2, "…") {
		t.Fatalf("开头命中不应有前省略号: %q", got2)
	}
	// 总长不超过 ±40 + 命中 + 2
	r := []rune(got)
	if len(r) > 40+40+3+2 {
		t.Fatalf("snippet 过长: %d", len(r))
	}
	// 宽度下限：文本足够长时，中间命中必须带满 ±40 上下文
	// （没有这条，窗口参数塌成 0 的故障不会被检测——实测注入过）
	if len(r) < 80+3 {
		t.Fatalf("snippet 应带满 ±40 上下文（至少 83 rune），得到 %d: %q", len(r), got)
	}
	if !strings.Contains(got, strings.Repeat("前", 40)) || !strings.Contains(got, strings.Repeat("后", 40)) {
		t.Fatalf("snippet 应含命中词前后各 40 字符: %q", got)
	}
}

func TestShouldShoot(t *testing.T) {
	st := DefaultSettings()
	st.Enabled = true
	noop := func(app, title string) bool { return false }

	if !shouldShoot(st, true, sampleView{App: "chrome", Title: "x"}, noop) {
		t.Fatal("开启且无隐私命中应截屏")
	}
	// 总开关关闭
	st2 := st
	st2.Enabled = false
	if shouldShoot(st2, true, sampleView{App: "chrome", Title: "x"}, noop) {
		t.Fatal("关闭应不截")
	}
	// 隐私命中：本 tick 整个跳过（契约）
	st3 := st
	isPrivate := func(app, title string) bool { return app == "keepass" }
	if shouldShoot(st3, true, sampleView{App: "keepass", Title: "密码"}, isPrivate) {
		t.Fatal("隐私命中应跳过截屏")
	}
	// 前台拿不到：也截（锁屏画面）
	if !shouldShoot(st3, false, sampleView{}, isPrivate) {
		t.Fatal("无前台信息应照常截屏")
	}
}

func TestSettingsSanitize(t *testing.T) {
	s := Settings{Enabled: true, IntervalSec: 5, RetentionDays: 0}
	s.sanitize()
	if s.IntervalSec != 60 || s.RetentionDays != 7 {
		t.Fatalf("越界值应回默认: %+v", s)
	}
	s2 := Settings{IntervalSec: 15, RetentionDays: 90}
	s2.sanitize()
	if s2.IntervalSec != 15 || s2.RetentionDays != 90 {
		t.Fatalf("边界值应保留: %+v", s2)
	}
	s3 := Settings{IntervalSec: 301, RetentionDays: 91}
	s3.sanitize()
	if s3.IntervalSec != 60 || s3.RetentionDays != 7 {
		t.Fatalf("超上限应回默认: %+v", s3)
	}
}

func TestShotStoreRoundtrip(t *testing.T) {
	dir := md(t)
	s, err := openShotStore(filepath.Join(dir, "activity.db"))
	if err != nil {
		t.Fatalf("openShotStore: %v", err)
	}
	defer s.db.Close()

	now := time.Now()
	old := now.AddDate(0, 0, -30)

	// 1) insert + setOCR
	id, err := s.insert(now.Unix(), "chrome", shotFilename(now))
	if err != nil || id == 0 {
		t.Fatalf("insert: id=%d err=%v", id, err)
	}
	if err := s.setOCR(id, "会议纪要 50% 进度，含特殊字符 % _"); err != nil {
		t.Fatalf("setOCR: %v", err)
	}
	// 2) get
	file, ok := s.get(id)
	if !ok || !strings.HasSuffix(file, ".png") {
		t.Fatalf("get 应返回文件名: %q %v", file, ok)
	}
	// 3) search：普通词
	items, err := s.search("会议纪要", 0, 0, 20)
	if err != nil || len(items) != 1 {
		t.Fatalf("search 应命中 1 条，得到 %d err=%v", len(items), err)
	}
	if !strings.Contains(items[0].Snippet, "会议纪要") {
		t.Fatalf("snippet 应含命中词: %q", items[0].Snippet)
	}
	// 4) search：含 % 的关键词不被当通配（escape 生效）
	items2, err := s.search("50% 进", 0, 0, 20)
	if err != nil || len(items2) != 1 {
		t.Fatalf("含 %% 的关键词应字面匹配，得到 %d err=%v", len(items2), err)
	}
	// 5) search：from/to 范围
	// from/to 是 unix 秒（日期解析在 API 层）
	f := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).Unix()
	t2 := f + 86400 - 1
	items3, err := s.search("会议纪要", f, t2, 20)
	if err != nil || len(items3) != 1 {
		t.Fatalf("日期范围内应命中，得到 %d err=%v", len(items3), err)
	}
	items4, _ := s.search("会议纪要", f+2*86400, 0, 20)
	if len(items4) != 0 {
		t.Fatalf("范围外不应命中，得到 %d", len(items4))
	}
	// 6) prune：只删旧行
	oldID, _ := s.insert(old.Unix(), "oldapp", "old.png")
	_ = oldID
	files, n, err := s.pruneBefore(now.AddDate(0, 0, -7).Unix())
	if err != nil || n < 1 {
		t.Fatalf("prune 应删旧行，得到 %d err=%v", n, err)
	}
	found := false
	for _, f := range files {
		if f == "old.png" {
			found = true
		}
	}
	if !found {
		t.Fatalf("prune 返回的文件列表应含旧文件名: %v", files)
	}
	var cnt int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM shots WHERE app='oldapp'`).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("旧行应被删除，还剩 %d", cnt)
	}
	// 边界行：ts 恰好等于 cut 的必须存活（DELETE 是 ts < cut，不是 <=；
	// 没有这条，边界写成 <= 的故障不会被检测——实测注入过）
	boundary := now.AddDate(0, 0, -7).Unix()
	if _, err := s.db.Exec(`INSERT INTO shots(ts,app,ocr,file) VALUES(?,?,'','boundary.png')`,
		boundary, "boundaryapp"); err != nil {
		t.Fatalf("种边界行失败: %v", err)
	}
	_, _, _ = s.pruneBefore(boundary)
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM shots WHERE app='boundaryapp'`).Scan(&cnt); err != nil {
		t.Fatalf("查边界行失败: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("ts==cut 的边界行必须存活（< 语义），剩 %d", cnt)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM shots WHERE app='chrome'`).Scan(&cnt); err != nil || cnt != 1 {
		t.Fatalf("新行不应被删，cnt=%d err=%v", cnt, err)
	}
}
