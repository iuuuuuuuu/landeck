package rd

import (
	"os"
	"testing"
)

// TestProbeBandwidthRealScreen 手动探针：真屏抓帧 + JPEG 各质量档的字节数。
// 默认跳过（CI 无真实交互桌面时 BitBlt 可能拿到黑帧或失败）；
// 本机跑：RD_PROBE=1 go test ./internal/rd/ -run TestProbeBandwidthRealScreen -v
func TestProbeBandwidthRealScreen(t *testing.T) {
	if os.Getenv("RD_PROBE") == "" {
		t.Skip("手动探针：设 RD_PROBE=1 启用")
	}
	b := &windowsBackend{}
	w, h, err := b.ScreenSize()
	if err != nil {
		t.Fatalf("ScreenSize: %v", err)
	}
	t.Logf("主屏: %dx%d", w, h)
	for _, q := range []int{30, 60, 90} {
		f, err := b.Capture()
		if err != nil {
			t.Fatalf("Capture: %v", err)
		}
		j, err := encodeJPEG(f, q)
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		t.Logf("JPEG q%d %dx%d: %d bytes (%.2f MB/帧, %.1f MB/s @10fps)",
			q, f.W, f.H, len(j), float64(len(j))/1048576, float64(len(j))*10/1048576)
	}
}
