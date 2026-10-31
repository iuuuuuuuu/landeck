package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// openai 形状：请求头带 Bearer、模型/消息透传、choices 提取。
func TestChatOpenAI(t *testing.T) {
	var gotAuth, gotModel string
	var gotMsgs []ChatMessage
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		var req struct {
			Model    string        `json:"model"`
			Messages []ChatMessage `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		gotModel = req.Model
		gotMsgs = req.Messages
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"role": "assistant", "content": "你好，今天编程 2 小时"}},
			},
		})
	}))
	defer srv.Close()

	cfg := Config{Provider: ProviderOpenAI, BaseURL: srv.URL, Model: "gpt-4o-mini", APIKey: "sk-test", Enabled: true}
	out, err := chat(context.Background(), cfg, []ChatMessage{{Role: "user", Content: "hi"}})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if out != "你好，今天编程 2 小时" {
		t.Fatalf("content=%q", out)
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("Authorization=%q", gotAuth)
	}
	if gotModel != "gpt-4o-mini" || len(gotMsgs) != 1 || gotMsgs[0].Content != "hi" {
		t.Fatalf("请求体不对: model=%q msgs=%+v", gotModel, gotMsgs)
	}
}

// ollama 形状：无 Authorization、响应在 message.content。
func TestChatOllama(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Fatalf("路径=%s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" {
			t.Fatal("ollama 不应带 Authorization")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"message": map[string]any{"role": "assistant", "content": "本地模型回复"},
		})
	}))
	defer srv.Close()

	cfg := Config{Provider: ProviderOllama, BaseURL: srv.URL, Model: "qwen3:8b", Enabled: true}
	out, err := chat(context.Background(), cfg, []ChatMessage{{Role: "user", Content: "hi"}})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if out != "本地模型回复" {
		t.Fatalf("content=%q", out)
	}
}

// provider 错误透传：非 200 必须携带状态码与响应片段，前端才能提示具体原因。
func TestChatErrorPassthrough(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"Incorrect API key provided"}}`))
	}))
	defer srv.Close()

	cfg := Config{Provider: ProviderOpenAI, BaseURL: srv.URL, Model: "m", APIKey: "bad", Enabled: true}
	_, err := chat(context.Background(), cfg, []ChatMessage{{Role: "user", Content: "hi"}})
	if err == nil {
		t.Fatal("应返回错误")
	}
	for _, want := range []string{"401", "Incorrect API key"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("错误信息缺 %q: %v", want, err)
		}
	}
}

// openai 响应体里的 error 字段（200 但业务错）也要透传。
func TestChatOpenAIErrorField(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"error":{"message":"model not found"}}`))
	}))
	defer srv.Close()

	cfg := Config{Provider: ProviderOpenAI, BaseURL: srv.URL, Model: "nope", APIKey: "k", Enabled: true}
	_, err := chat(context.Background(), cfg, []ChatMessage{{Role: "user", Content: "hi"}})
	if err == nil || !strings.Contains(err.Error(), "model not found") {
		t.Fatalf("应透传 error 字段: %v", err)
	}
}
