package memory

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 性能门禁（五期体检）：memory search/export 在 400+ 截图（每张 ~1.5KB OCR 文本）下的表现。
// 阈值 = Owner 定的热点线：热态 >200ms 视为需修。
// testDir 与 memory_test.go 同款（%TEMP% 不可写，用仓库内 test-tmp）。
func testDir(t *testing.T) string {
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

func TestPerfMemorySearchExport(t *testing.T) {
	if testing.Short() {
		t.Skip("short 模式跳过性能门禁")
	}
	dir := testDir(t)
	s, err := openShotStore(filepath.Join(dir, "activity.db"))
	if err != nil {
		t.Fatalf("openShotStore: %v", err)
	}
	defer s.db.Close()

	// ---- 种 400 张截图：OCR 文本 ~1.5KB，30 天分布，10% 含关键词「会议」----
	const total = 400
	const days = 30
	now := time.Now()
	filler := strings.Repeat("系统 进程 内存 网络 报表 dashboard render layout ", 30) // ~1.5KB
	if _, err := s.db.Exec(`BEGIN`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < total; i++ {
		text := filler
		if i%10 == 0 {
			text = "项目 周会 会议纪要 预算 审批 " + filler // 10% 含「会议」
		}
		ts := now.AddDate(0, 0, -(i * days / total)).Add(time.Duration(i%7) * time.Hour).Unix()
		if _, err := s.insert(ts, fmt.Sprintf("app%d", i%9), fmt.Sprintf("shot-%04d.png", i)); err != nil {
			t.Fatalf("seed: %v", err)
		}
		if err := s.setOCR(int64(i+1), text); err != nil {
			t.Fatalf("setOCR: %v", err)
		}
	}
	if _, err := s.db.Exec(`COMMIT`); err != nil {
		t.Fatal(err)
	}

	threshold := 200 * time.Millisecond

	// ---- search：命中约 40 行 ----
	t0 := time.Now()
	items, err := s.search("会议", 0, 0, 20)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	d1 := time.Since(t0)
	t.Logf("  %-28s %v  hits=%d", `search "会议" (40 命中池)`, d1, len(items))
	if d1 > threshold {
		t.Errorf("search %v 超过热点阈值 %v", d1, threshold)
	}
	if len(items) == 0 || len(items) > 20 {
		t.Fatalf("search 应命中 1-20 条，得到 %d", len(items))
	}
	if !strings.Contains(items[0].Snippet, "会议") {
		t.Fatalf("snippet 应含命中词: %q", items[0].Snippet)
	}

	// ---- search：无命中（最坏情况：全表 LIKE 扫描）----
	t0 = time.Now()
	items2, err := s.search("完全不存在的关键词xyz", 0, 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	d2 := time.Since(t0)
	t.Logf("  %-28s %v  hits=%d", "search 无命中（全表扫）", d2, len(items2))
	if d2 > threshold {
		t.Errorf("无命中 search %v 超过阈值 %v", d2, threshold)
	}
	if len(items2) != 0 {
		t.Fatalf("无命中应返回 0 条，得到 %d", len(items2))
	}

	// （契约里 memory 没有 export 端点；全量导出基准见 activity 包的 perf_test）
}
