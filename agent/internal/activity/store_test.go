package activity

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// testDir 与 metrics 测试同款约定：%TEMP% 在本机沙箱里不可写（os error 5），
// 统一用仓库内 test-tmp（.gitignore 已覆盖）。
func testDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("..", "..", "test-tmp", "activity", t.Name()))
	if err != nil {
		t.Fatalf("解析目录失败: %v", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("创建测试目录失败: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func TestSegmentStoreRoundtrip(t *testing.T) {
	dir := testDir(t)
	db, err := openDB(filepath.Join(dir, "activity.db"))
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	defer db.Close()
	s := &segmentStore{db: db}

	base := dayAt("2026-10-31 09:00:00").Unix()

	// 1) INSERT
	id, err := s.closeOpen(openSegment{Start: base, End: base + 600, App: "code", Title: "main.go"})
	if err != nil || id == 0 {
		t.Fatalf("插入段失败: id=%d err=%v", id, err)
	}
	// 2) EXTEND
	if err := s.extend(id, base+1200); err != nil {
		t.Fatalf("extend: %v", err)
	}
	// 3) 查询：范围相交裁剪
	segs, err := s.rangeSegs(base+900, base+1100) // 只取段中段 900-1100
	if err != nil {
		t.Fatalf("rangeSegs: %v", err)
	}
	if len(segs) != 1 {
		t.Fatalf("应返回 1 段，得到 %d", len(segs))
	}
	got := segs[0].clip(base+900, base+1100)
	if got.Dur() != 200 {
		t.Fatalf("裁剪后应 200s，得到 %d", got.Dur())
	}
	// 4) 零长度段不落库
	id2, err := s.closeOpen(openSegment{Start: base, End: base, App: "x", Title: ""})
	if err != nil || id2 != 0 {
		t.Fatalf("零长度段应跳过，得到 id=%d err=%v", id2, err)
	}
	if n, _ := s.count(); n != 1 {
		t.Fatalf("库中应只有 1 段，得到 %d", n)
	}
	// 5) prune：早于保留期的删除
	cut := time.Now().AddDate(0, 0, -30).Unix()
	if _, err := s.db.Exec(`INSERT INTO segments(day,start,"end",app,title) VALUES(?,?,?,?,?)`,
		"2026-01-01", cut-7200, cut-3600, "old", ""); err != nil {
		t.Fatalf("插入过期段失败: %v", err)
	}
	removed, err := s.prune(30, time.Now())
	if err != nil || removed != 1 {
		t.Fatalf("prune 应删 1 条，得到 %d err=%v", removed, err)
	}
}

func TestSettingsStoreRoundtrip(t *testing.T) {
	dir := testDir(t)
	st := openSettings(dir)
	// 默认值
	got := st.Get()
	if !got.Enabled || got.IntervalSec != 30 || got.IdleSec != 180 || len(got.Categories) == 0 {
		t.Fatalf("默认设置不对: %+v", got)
	}
	// 更新并落盘
	if err := st.Update(func(s *Settings) {
		s.Enabled = false
		s.IdleSec = 600
		s.PrivateRules = []PrivacyRule{{ID: "p1", Kind: "title", Pattern: "银行"}}
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	// 重新打开：读回磁盘值（关键：重启不丢）
	st2 := openSettings(dir)
	g2 := st2.Get()
	if g2.Enabled {
		t.Fatal("Enabled=false 应已落盘")
	}
	if g2.IdleSec != 600 {
		t.Fatalf("IdleSec 应 600，得到 %d", g2.IdleSec)
	}
	if len(g2.PrivateRules) != 1 || g2.PrivateRules[0].Pattern != "银行" {
		t.Fatalf("隐私规则应落盘，得到 %+v", g2.PrivateRules)
	}
	// 默认分类被保留（Update 不清空未触碰字段）
	if len(g2.Categories) == 0 {
		t.Fatal("分类规则不应被清空")
	}
	// 荒谬值被拉回合法区间
	if err := st2.Update(func(s *Settings) { s.IntervalSec = 1; s.RetentionDays = 0 }); err != nil {
		t.Fatalf("Update2: %v", err)
	}
	g3 := st2.Get()
	if g3.IntervalSec != 30 || g3.RetentionDays != 90 {
		t.Fatalf("sanitize 未生效: %+v", g3)
	}
}

// 损坏的设置文件：回默认值，不能让启动失败。
func TestSettingsCorruptFile(t *testing.T) {
	dir := testDir(t)
	if err := os.WriteFile(filepath.Join(dir, "activity.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatalf("写坏文件失败: %v", err)
	}
	st := openSettings(dir)
	if !st.Get().Enabled {
		t.Fatal("损坏文件应回默认值（Enabled=true）")
	}
}
