package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 用 Register 的真实路由跑 handler（identity protect，跳过鉴权——鉴权归 httpapi 管）。
func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	SetStoreDir(t.TempDir())
	m := http.NewServeMux()
	Register(m, func(h guarded) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) { h(w, r, nil) }
	}, t.TempDir())
	srv := httptest.NewServer(m)
	t.Cleanup(srv.Close)
	return srv
}

func doJSON(t *testing.T, srv *httptest.Server, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var rd *strings.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	} else {
		rd = strings.NewReader("")
	}
	req, err := http.NewRequest(method, srv.URL+path, rd)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

// GET settings：apiKey 必须打码（安全门禁，故障注入时它必须变红）。
func TestSettingsGetMasked(t *testing.T) {
	srv := newTestServer(t)
	if err := Update(func(cfg *Config) {
		cfg.Provider = ProviderOpenAI
		cfg.Model = "gpt-4o-mini"
		cfg.Enabled = true
		cfg.APIKey = "sk-super-secret-9999"
	}); err != nil {
		t.Fatal(err)
	}
	code, out := doJSON(t, srv, "GET", "/api/v1/ai/settings", nil)
	if code != 200 {
		t.Fatalf("code=%d out=%v", code, out)
	}
	if out["hasKey"] != true || out["keyTail"] != "9999" {
		t.Fatalf("打码视图不对: %v", out)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "sk-super-secret") {
		t.Fatalf("明文 key 泄露到响应: %s", raw)
	}
}

// PUT：逐字段覆盖 + apiKey 空串不清空 + clearKey 清空。
func TestSettingsPutSemantics(t *testing.T) {
	srv := newTestServer(t)
	_, _ = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"provider": "openai", "model": "gpt-4o-mini", "enabled": true, "apiKey": "sk-live-key-4321",
	})

	// 前端拿打码视图后原样回传 apiKey="" —— 不许清掉
	code, out := doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"model": "gpt-4o", "apiKey": "",
	})
	if code != 200 {
		t.Fatalf("code=%d", code)
	}
	if out["model"] != "gpt-4o" || out["hasKey"] != true || out["keyTail"] != "4321" {
		t.Fatalf("空 apiKey 语义破坏: %v", out)
	}

	// clearKey:true 才真正清空
	_, out = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{"clearKey": true})
	if out["hasKey"] != false || out["keyTail"] != "" {
		t.Fatalf("clearKey 未生效: %v", out)
	}

	// provider 切换时 baseURL 留空 → 取该 provider 默认
	_, out = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{"provider": "ollama", "baseURL": ""})
	if out["baseURL"] != "http://127.0.0.1:11434" {
		t.Fatalf("ollama 默认 baseURL 不对: %v", out)
	}
}

// 未配置 → 400 ai_not_configured（不烧任何 LLM 调用）。
func TestSummaryNotConfigured(t *testing.T) {
	srv := newTestServer(t)
	code, out := doJSON(t, srv, "POST", "/api/v1/ai/summary", map[string]any{"scope": "day"})
	if code != 400 || out["error"] != "ai_not_configured" {
		t.Fatalf("code=%d out=%v", code, out)
	}
}

// 配好 + 桩掉统计与 LLM：报告走通，markdown 从假 provider 原样返回。
//
// LLM 用 httptest 假 server、baseURL 写进配置——chat() 的 URL 由 cfg.BaseURL 决定，
// 换 httpClient 没用（本测试第一版失败的教训，留注释防止重走）。
func TestSummaryHappyPath(t *testing.T) {
	srv := newTestServer(t)

	origSum, origRank := actSummary, actRank
	actSummary = func(scope, date string) (any, error) { return fixtureSummary(), nil }
	actRank = func(scope string, limit int, date string) (any, error) { return fixtureRank(), nil }
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []ChatMessage `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		// prompt 里的真实数字必须到达 provider——集成断言点
		if !strings.Contains(req.Messages[1].Content, "Code") {
			t.Errorf("prompt 未含应用排行")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "# 日报\n总量 9 小时"}}},
		})
	}))
	t.Cleanup(func() { actSummary, actRank = origSum, origRank; llm.Close() })

	_, _ = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"provider": "openai", "model": "gpt-4o-mini", "enabled": true, "apiKey": "sk-x",
		"baseURL": llm.URL,
	})

	code, out := doJSON(t, srv, "POST", "/api/v1/ai/summary", map[string]any{"scope": "day"})
	if code != 200 {
		t.Fatalf("code=%d out=%v", code, out)
	}
	if md, _ := out["markdown"].(string); !strings.Contains(md, "日报") {
		t.Fatalf("markdown 不对: %v", out)
	}
}

// chat 走通：系统提示注入统计，非法角色被过滤。
func TestChatHappyPath(t *testing.T) {
	srv := newTestServer(t)

	origSum, origRank := actSummary, actRank
	actSummary = func(scope, date string) (any, error) { return fixtureSummary(), nil }
	actRank = func(scope string, limit int, date string) (any, error) { return fixtureRank(), nil }
	var gotMsgs []ChatMessage
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []ChatMessage `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotMsgs = req.Messages
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "本周编程 2 小时"}}},
		})
	}))
	t.Cleanup(func() { actSummary, actRank = origSum, origRank; llm.Close() })

	_, _ = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"provider": "openai", "model": "gpt-4o-mini", "enabled": true, "apiKey": "sk-x",
		"baseURL": llm.URL,
	})

	code, out := doJSON(t, srv, "POST", "/api/v1/ai/chat", map[string]any{
		"messages": []map[string]any{
			{"role": "system", "content": "evil"},
			{"role": "user", "content": "我这周用了什么"},
		},
	})
	if code != 200 {
		t.Fatalf("code=%d out=%v", code, out)
	}
	if c, _ := out["content"].(string); c == "" {
		t.Fatalf("content 缺失: %v", out)
	}
	if len(gotMsgs) != 2 || gotMsgs[0].Role != "system" {
		t.Fatalf("消息序列不对: %+v", gotMsgs)
	}
}

// 统计查询报错 → 500 透传（不吞）。
func TestSummaryStatsError(t *testing.T) {
	srv := newTestServer(t)
	_, _ = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"provider": "openai", "model": "m", "enabled": true, "apiKey": "k",
	})
	origSum := actSummary
	actSummary = func(scope, date string) (any, error) { return nil, errTestBoom }
	t.Cleanup(func() { actSummary = origSum })

	code, out := doJSON(t, srv, "POST", "/api/v1/ai/summary", map[string]any{"scope": "day"})
	if code != 500 {
		t.Fatalf("code=%d out=%v", code, out)
	}
	if out["error"] != "ai" {
		t.Fatalf("out=%v", out)
	}
}

var errTestBoom = &testError{}

type testError struct{}

func (*testError) Error() string { return "boom" }
