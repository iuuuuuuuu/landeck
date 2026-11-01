package httpapi

// /api/v1/activity/domain 的鉴权与门禁测试（八期 A2 验收）。
// handler 直调（httptest），依赖 activity.Start 提供设置与内存表。

import (
	"net/http/httptest"
	"strings"
	"testing"

	"landeck/internal/activity"
	"landeck/internal/auth"
	"landeck/internal/config"
)

var testToken string // Pair 产出的真实令牌（SetFixedKey 要求 8 位归一口径）

func domainTestServer(t *testing.T) *Server {
	t.Helper()
	dir := t.TempDir()
	cfgStore, err := config.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	authMgr := auth.New(cfgStore)
	if err := authMgr.SetFixedKey("ABCD1234"); err != nil {
		t.Fatal(err)
	}
	// 走真实 Pair 流程拿到令牌（pairing.json 口径的最短闭环）
	res, err := authMgr.Pair("127.0.0.1", "test-ext", "test-ext-id", "ABCD1234", "fixed")
	if err != nil {
		t.Fatal(err)
	}
	testToken = res.Token
	activity.Start(dir + "/data")
	t.Cleanup(activity.Stop)

	// 默认开启 domainCapture（501 路径单独用关闭态测）
	if err := activity.UpdateSettings(func(s *activity.Settings) {
		s.DomainCapture = true
		s.DomainAuth = "token"
	}); err != nil {
		t.Fatal(err)
	}
	return &Server{Auth: authMgr, Cfg: cfgStore}
}

func postDomain(s *Server, remoteAddr, query, body, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "http://127.0.0.1:8420/api/v1/activity/domain"+query, strings.NewReader(body))
	req.RemoteAddr = remoteAddr
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	s.handleActivityDomain(w, req, nil)
	return w
}

func TestDomainTokenOK(t *testing.T) {
	s := domainTestServer(t)
	w := postDomain(s, "127.0.0.1:5555", "?token="+testToken,
		`{"browser":"chrome","domain":"https://www.youtube.com/watch?v=1","title":"t"}`, "")
	if w.Code != 200 {
		t.Fatalf("合法上报应 200，得到 %d: %s", w.Code, w.Body.String())
	}
}

func TestDomainTokenReject(t *testing.T) {
	s := domainTestServer(t)
	w := postDomain(s, "127.0.0.1:5555", "?token=wrong-token",
		`{"browser":"chrome","domain":"youtube.com"}`, "")
	if w.Code != 401 {
		t.Fatalf("错误 token 应 401，得到 %d: %s", w.Code, w.Body.String())
	}
	// 无 token 同样 401
	w2 := postDomain(s, "127.0.0.1:5555", "", `{"browser":"chrome","domain":"youtube.com"}`, "")
	if w2.Code != 401 {
		t.Fatalf("无 token 应 401，得到 %d: %s", w2.Code, w2.Body.String())
	}
}

func TestDomainNonLoopback403(t *testing.T) {
	s := domainTestServer(t)
	// httptest.NewRequest 默认 RemoteAddr=192.0.2.1（非回环）
	w := postDomain(s, "192.0.2.1:1234", "?token="+testToken,
		`{"browser":"chrome","domain":"youtube.com"}`, "")
	if w.Code != 403 {
		t.Fatalf("非回环应 403，得到 %d: %s", w.Code, w.Body.String())
	}
}

func TestDomainDisabled501(t *testing.T) {
	s := domainTestServer(t)
	// 关闭开关：501，且优先于鉴权（不留暧昧端点）
	if err := activity.UpdateSettings(func(s *activity.Settings) { s.DomainCapture = false }); err != nil {
		t.Fatal(err)
	}
	w := postDomain(s, "127.0.0.1:5555", "", `{"browser":"chrome","domain":"youtube.com"}`, "")
	if w.Code != 501 {
		t.Fatalf("domainCapture 关闭应 501，得到 %d: %s", w.Code, w.Body.String())
	}
	// 无 token 也 501（501 门在鉴权前）
	w2 := postDomain(s, "127.0.0.1:5555", "", `{"browser":"chrome","domain":"youtube.com"}`, "")
	if w2.Code != 501 {
		t.Fatalf("关闭态连鉴权都不该做，应 501，得到 %d", w2.Code)
	}
}

func TestDomainOriginMode(t *testing.T) {
	s := domainTestServer(t)
	if err := activity.UpdateSettings(func(s *activity.Settings) {
		s.DomainAuth = "origin"
		s.DomainOrigins = []string{"chrome-extension://abcdefghijklmnop"}
	}); err != nil {
		t.Fatal(err)
	}
	// 白名单 Origin：放行（无需 token）
	w := postDomain(s, "127.0.0.1:5555", "",
		`{"browser":"edge","domain":"github.com"}`, "chrome-extension://abcdefghijklmnop")
	if w.Code != 200 {
		t.Fatalf("白名单 Origin 应 200，得到 %d: %s", w.Code, w.Body.String())
	}
	// 非白名单 Origin：403
	w2 := postDomain(s, "127.0.0.1:5555", "",
		`{"browser":"edge","domain":"github.com"}`, "chrome-extension://zzzz")
	if w2.Code != 403 {
		t.Fatalf("非白名单 Origin 应 403，得到 %d: %s", w2.Code, w2.Body.String())
	}
	// token 模式下 origin 无效——切回 token 后带 Origin 不带 token 应 401
	if err := activity.UpdateSettings(func(s *activity.Settings) { s.DomainAuth = "token" }); err != nil {
		t.Fatal(err)
	}
	w3 := postDomain(s, "127.0.0.1:5555", "",
		`{"browser":"edge","domain":"github.com"}`, "chrome-extension://abcdefghijklmnop")
	if w3.Code != 401 {
		t.Fatalf("token 模式缺 token 应 401，得到 %d: %s", w3.Code, w3.Body.String())
	}
}

func TestDomainBodyValidation(t *testing.T) {
	s := domainTestServer(t)
	// 契约白名单外浏览器
	w := postDomain(s, "127.0.0.1:5555", "?token="+testToken,
		`{"browser":"safari","domain":"apple.com"}`, "")
	if w.Code != 400 {
		t.Fatalf("白名单外 browser 应 400，得到 %d", w.Code)
	}
	// 空 domain
	w2 := postDomain(s, "127.0.0.1:5555", "?token="+testToken,
		`{"browser":"chrome","domain":""}`, "")
	if w2.Code != 400 {
		t.Fatalf("空 domain 应 400，得到 %d", w2.Code)
	}
	// 坏 JSON
	w3 := postDomain(s, "127.0.0.1:5555", "?token="+testToken, `{bad`, "")
	if w3.Code != 400 {
		t.Fatalf("坏 JSON 应 400，得到 %d", w3.Code)
	}
}
