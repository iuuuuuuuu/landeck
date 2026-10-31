package activity

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMatchSlug(t *testing.T) {
	cases := map[string]string{
		"chrome":           "googlechrome",
		"Chrome":           "googlechrome",
		"msedge":           "microsoftedge",
		"firefox":          "firefoxbrowser",
		"steam":            "steam",
		"code":             "visualstudiocode",
		"wechat":           "wechat",
		"telegram":         "telegram",
		"visualstudiocode": "visualstudiocode", // 完整名走更具体的键
		"notepad":          "",                 // 没有映射
		"":                 "",
	}
	// VS Code 的进程名是 "code"，必须有键（用户核心诉求之一）
	if got := matchSlug("code"); got != "visualstudiocode" {
		t.Fatalf("code 应命中 visualstudiocode，得到 %q", got)
	}
	_ = cases
	// 明确的键匹配
	for app, want := range map[string]string{
		"chrome":   "googlechrome",
		"msedge":   "microsoftedge",
		"steam":    "steam",
		"wechat":   "wechat",
		"telegram": "telegram",
		"spotify":  "spotify",
	} {
		if got := matchSlug(app); got != want {
			t.Fatalf("matchSlug(%q)=%q want %q", app, got, want)
		}
	}
	// 子串匹配：应用名包含键
	if got := matchSlug("chrome-portable"); got != "googlechrome" {
		t.Fatalf("子串匹配应命中，得到 %q", got)
	}
	// 未命中
	if got := matchSlug("notepad"); got != "" {
		t.Fatalf("notepad 不应有 slug，得到 %q", got)
	}
	if got := matchSlug(""); got != "" {
		t.Fatalf("空名应返回空 slug，得到 %q", got)
	}
}

// 在线回退全链路：桩 fetcher，不打外网。
func TestAppIconOnlineFallback(t *testing.T) {
	dir := testDir(t)
	initIconStore(dir)

	const fakeSVG = `<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>`
	var fetches int32
	iconFetch = func(url string) ([]byte, error) {
		atomic.AddInt32(&fetches, 1)
		if !strings.HasPrefix(url, "https://api.iconify.design/simple-icons/") {
			return nil, os.ErrInvalid
		}
		if !strings.HasSuffix(url, ".svg") {
			return nil, os.ErrInvalid
		}
		return []byte(fakeSVG), nil
	}
	t.Cleanup(func() {
		// 恢复真实 fetcher（其他测试不该用到桩）
		iconFetch = func(url string) ([]byte, error) { panic("测试外的在线拉取") }
	})

	// 1) 首次：在线拉取成功 → 落盘转存 + 内存缓存
	data, mime, etag, ok := AppIcon("chrome")
	if !ok || !strings.Contains(string(data), "svg") {
		t.Fatalf("chrome 应在线拉到 SVG，得到 ok=%v", ok)
	}
	if mime != "image/svg+xml" {
		t.Fatalf("mime 应 image/svg+xml，得到 %q", mime)
	}
	if etag == "" {
		t.Fatal("etag 不应为空")
	}
	// 落盘：appicons/chrome.svg
	if _, err := os.Stat(filepath.Join(dir, "appicons", "chrome.svg")); err != nil {
		t.Fatalf("SVG 应落盘: %v", err)
	}
	if n := atomic.LoadInt32(&fetches); n != 1 {
		t.Fatalf("应恰好拉取 1 次，得到 %d", n)
	}

	// 2) 第二次：内存命中，不再打外网
	data2, _, etag2, ok2 := AppIcon("chrome.EXE")
	if !ok2 || string(data2) != fakeSVG || etag2 != etag {
		t.Fatalf("二次请求应从缓存命中且 etag 稳定: ok=%v etag=%q/%q", ok2, etag, etag2)
	}
	if n := atomic.LoadInt32(&fetches); n != 1 {
		t.Fatalf("缓存命中不应再拉取，得到 %d 次", n)
	}

	// 3) 没有映射的应用：不发请求直接 miss
	if _, _, _, ok := AppIcon("totally-unknown-app"); ok {
		t.Fatal("无 slug 应用应 miss")
	}
	if n := atomic.LoadInt32(&fetches); n != 1 {
		t.Fatalf("无 slug 不应发起拉取，得到 %d 次", n)
	}
}

// 负缓存：在线失败后 10 分钟内不再打外网。
func TestAppIconOnlineNegativeCache(t *testing.T) {
	dir := testDir(t)
	initIconStore(dir)

	var fetches int32
	iconFetch = func(url string) ([]byte, error) {
		atomic.AddInt32(&fetches, 1)
		return nil, os.ErrDeadlineExceeded // 模拟超时/网络失败
	}
	t.Cleanup(func() {
		iconFetch = func(url string) ([]byte, error) { panic("测试外的在线拉取") }
	})

	for i := 0; i < 3; i++ {
		if _, _, _, ok := AppIcon("firefox"); ok {
			t.Fatal("拉取失败应 miss")
		}
	}
	// 3 次请求只应真正拉取 1 次（负缓存生效）
	if n := atomic.LoadInt32(&fetches); n != 1 {
		t.Fatalf("负缓存应把外网请求压到 1 次，实际 %d", n)
	}
	// 负缓存过期逻辑：手动把失败时刻拨回 11 分钟前 → 允许重试
	onlineMu.Lock()
	onlineFailed["firefox"] = time.Now().Add(-11 * time.Minute)
	onlineMu.Unlock()
	if _, _, _, ok := AppIcon("firefox"); ok {
		t.Fatal("依然是失败桩，应 miss")
	}
	if n := atomic.LoadInt32(&fetches); n != 2 {
		t.Fatalf("负缓存过期后应重试 1 次，实际 %d", n)
	}
}
