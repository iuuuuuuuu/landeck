package httpapi

// /sync/* 端点测试（十期 A1）：打码、部分更新、故障注入联动
//（WebDAV 不可达 → lastError 有内容且不影响本机采集）。

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"landeck/internal/activity"
	syncengine "landeck/internal/sync"
)

func syncTestSetup(t *testing.T) *Server {
	t.Helper()
	// %TEMP% 不可写——test-tmp 口径（与各包 testDir 同款）
	abs, err := filepath.Abs(filepath.Join("..", "test-tmp", "httpapi-sync", t.Name()))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		t.Fatal(err)
	}
	dir := abs
	activity.Start(dir)
	t.Cleanup(activity.Stop)
	if _, err := syncengine.StartProduction(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = syncengine.StopProduction() })
	return &Server{}
}

func TestSyncSettingsMasking(t *testing.T) {
	s := syncTestSetup(t)

	// PUT 真实凭据
	req := httptest.NewRequest("PUT", "/api/v1/sync/settings",
		strings.NewReader(`{"enabled":true,"url":"http://127.0.0.1:19876/dav","username":"u","password":"secret123","intervalSec":300}`))
	w := httptest.NewRecorder()
	s.handleSyncSettingsPut(w, req, nil)
	if w.Code != 200 {
		t.Fatalf("PUT 应 200，得到 %d: %s", w.Code, w.Body.String())
	}

	// GET：密码打码
	req2 := httptest.NewRequest("GET", "/api/v1/sync/settings", nil)
	w2 := httptest.NewRecorder()
	s.handleSyncSettingsGet(w2, req2, nil)
	body := w2.Body.String()
	if w2.Code != 200 || !strings.Contains(body, maskedPassword) {
		t.Fatalf("GET 应打码，得到 %d %s", w2.Code, body)
	}
	if strings.Contains(body, "secret123") {
		t.Fatal("GET 泄漏明文密码")
	}
	// 落盘真实值还在（0600 文件）
	if got := syncengine.GetSettings().Password; got != "secret123" {
		t.Fatalf("落盘密码应保持: %q", got)
	}

	// 前端把打码串 PUT 回来 → 不应覆盖真实密码
	req3 := httptest.NewRequest("PUT", "/api/v1/sync/settings",
		strings.NewReader(`{"password":"`+maskedPassword+`"}`))
	w3 := httptest.NewRecorder()
	s.handleSyncSettingsPut(w3, req3, nil)
	if got := syncengine.GetSettings().Password; got != "secret123" {
		t.Fatalf("回显打码串不应覆盖密码: %q", got)
	}

	// PUT 新密码 → 更新
	req4 := httptest.NewRequest("PUT", "/api/v1/sync/settings",
		strings.NewReader(`{"password":"newpass456"}`))
	w4 := httptest.NewRecorder()
	s.handleSyncSettingsPut(w4, req4, nil)
	if got := syncengine.GetSettings().Password; got != "newpass456" {
		t.Fatalf("新密码应生效: %q", got)
	}
}

// 故障注入：WebDAV 不可达 → /sync/now 返回 errors、lastError 落盘，
// 且本机采集/统计接口完全不受影响。
func TestSyncFaultUnreachable(t *testing.T) {
	s := syncTestSetup(t)
	if err := syncengine.UpdateSettings(func(st *syncengine.Settings) {
		st.Enabled = true
		st.URL = "http://127.0.0.1:1" // 不可达
		st.Username = "u"
		st.Password = "p"
	}); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", "/api/v1/sync/now", nil)
	w := httptest.NewRecorder()
	s.handleSyncNow(w, req, nil)
	if w.Code != 200 {
		t.Fatalf("/sync/now 应 200（错误在响应体里），得到 %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "errors") || strings.Contains(w.Body.String(), `"errors":[]`) {
		t.Fatalf("errors 应有内容: %s", w.Body.String())
	}

	// status：lastError 有内容
	req2 := httptest.NewRequest("GET", "/api/v1/sync/status", nil)
	w2 := httptest.NewRecorder()
	s.handleSyncStatus(w2, req2, nil)
	if !strings.Contains(w2.Body.String(), `"lastError":"`) || strings.Contains(w2.Body.String(), `"lastError":""`) {
		t.Fatalf("status.lastError 应有内容: %s", w2.Body.String())
	}

	// 本机采集不受影响：activity 的状态/统计照常工作
	st := activity.GetStatus()
	if st.State == "" {
		t.Fatal("activity 状态应正常返回")
	}
	if _, err := activity.GetSummary("day", "", ""); err != nil {
		t.Fatalf("本机统计应不受影响: %v", err)
	}
}
