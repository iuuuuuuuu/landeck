package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// B4：chat.model 路由与往返。

// 核心验收：chat 上游收到的 model 随 chat.model 切换——
// 空 = 回退总结 model；非空 = 用 chat.model。
func TestChatModelRouting(t *testing.T) {
	var gotModel string
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotModel = req.Model
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "ok"}}},
		})
	}))
	defer llm.Close()

	origSum, origRank := actSummary, actRank
	actSummary = func(scope, date string) (any, error) { return fixtureSummary(), nil }
	actRank = func(scope string, limit int, date string) (any, error) { return fixtureRank(), nil }
	t.Cleanup(func() { actSummary, actRank = origSum, origRank })

	cases := []struct {
		name      string
		chatModel string
		wantModel string
	}{
		{"chat.model 为空 → 回退总结 model", "", "gpt-4o-mini"},
		{"chat.model 非空 → 用 chat.model", "qwen3:8b", "qwen3:8b"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := newTestServer(t)
			body := map[string]any{
				"provider": "openai", "model": "gpt-4o-mini", "enabled": true,
				"apiKey": "sk-x", "baseURL": llm.URL,
			}
			if c.chatModel != "" {
				body["chat"] = map[string]any{"model": c.chatModel}
			}
			if code, out := doJSON(t, srv, "PUT", "/api/v1/ai/settings", body); code != 200 {
				t.Fatalf("PUT code=%d out=%v", code, out)
			}
			if code, out := doJSON(t, srv, "POST", "/api/v1/ai/chat", map[string]any{
				"messages": []map[string]any{{"role": "user", "content": "hi"}},
			}); code != 200 {
				t.Fatalf("chat code=%d out=%v", code, out)
			}
			if gotModel != c.wantModel {
				t.Fatalf("上游 model=%q，期望 %q", gotModel, c.wantModel)
			}
		})
	}
}

// GET settings 回显 chat.model；PUT 空串 = 清除（回退语义）。
func TestChatModelSettingsRoundtrip(t *testing.T) {
	srv := newTestServer(t)
	if code, out := doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"model": "gpt-4o-mini",
		"chat":  map[string]any{"model": "deepseek-chat"},
	}); code != 200 {
		t.Fatalf("PUT code=%d out=%v", code, out)
	}
	code2, body := doJSON(t, srv, "GET", "/api/v1/ai/settings", nil)
	if code2 != 200 {
		t.Fatalf("GET code=%d", code2)
	}
	c, _ := body["chat"].(map[string]any)
	if c == nil || c["model"] != "deepseek-chat" {
		t.Fatalf("chat.model 往返失败: %v", body)
	}

	// 置空 = 回退（无专用模型）
	code, out := doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"chat": map[string]any{"model": ""},
	})
	if code != 200 {
		t.Fatalf("PUT code=%d", code)
	}
	_, out = doJSON(t, srv, "GET", "/api/v1/ai/settings", nil)
	c, _ = out["chat"].(map[string]any)
	if c["model"] != "" {
		t.Fatalf("置空失败: %v", out)
	}
}

// 旧格式 ai.json（没有 chat 字段）读取不炸且取零值。
func TestOldConfigWithoutChatField(t *testing.T) {
	dir := t.TempDir()
	body := []byte(`{"provider":"openai","baseURL":"https://x","apiKey":"k","model":"gpt-4o-mini","enabled":true}`)
	if err := os.WriteFile(filepath.Join(dir, "ai.json"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	SetStoreDir(dir)
	cfg := Get()
	if cfg.Chat.Model != "" {
		t.Fatalf("旧配置的 chat.model 应为零值: %+v", cfg.Chat)
	}
	if cfg.Model != "gpt-4o-mini" || !cfg.Enabled {
		t.Fatalf("旧配置其余字段丢失: %+v", cfg)
	}
	if !strings.Contains(cfg.Model, "gpt") {
		t.Fatal("unreachable")
	}
}

// 只配 chat.model（总结 model 留空）：对话就绪检查应通过——
// 对话路由改的是副本的 cfg.Model，configured() 看到的是有效模型。
func TestChatOnlyModelConfigured(t *testing.T) {
	srv := newTestServer(t)
	origSum, origRank := actSummary, actRank
	actSummary = func(scope, date string) (any, error) { return fixtureSummary(), nil }
	actRank = func(scope string, limit int, date string) (any, error) { return fixtureRank(), nil }
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Model != "deepseek-chat" {
			t.Errorf("上游 model=%q，期望 chat.model", req.Model)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "ok"}}},
		})
	}))
	t.Cleanup(func() { actSummary, actRank = origSum, origRank; llm.Close() })

	_, _ = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"provider": "openai", "enabled": true, "apiKey": "k", "baseURL": llm.URL,
		"chat": map[string]any{"model": "deepseek-chat"},
		// 注意：model 故意留空
	})
	code, out := doJSON(t, srv, "POST", "/api/v1/ai/chat", map[string]any{
		"messages": []map[string]any{{"role": "user", "content": "hi"}},
	})
	if code != 200 {
		t.Fatalf("只配 chat.model 的对话应可用: code=%d out=%v", code, out)
	}
}
