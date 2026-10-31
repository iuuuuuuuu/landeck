package ai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 配置往返：写盘重读必须一致（含 key——文件里就是明文，靠 0600 权限与打码视图保护）。
func TestConfigRoundtrip(t *testing.T) {
	dir := t.TempDir()
	SetStoreDir(dir)

	if err := Update(func(cfg *Config) {
		cfg.Provider = ProviderOllama
		cfg.BaseURL = "http://127.0.0.1:11434"
		cfg.Model = "qwen3:8b"
		cfg.Enabled = true
		cfg.APIKey = "" // ollama 无需 key
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	// 直接读文件核验落盘（不是读内存缓存）
	b, err := os.ReadFile(filepath.Join(dir, "ai.json"))
	if err != nil {
		t.Fatalf("配置文件未落盘: %v", err)
	}
	if !strings.Contains(string(b), `"provider": "ollama"`) {
		t.Fatalf("落盘内容不对: %s", b)
	}

	// 重新初始化（模拟重启）后仍能读到
	cache = nil
	storeDir = ""
	SetStoreDir(dir)
	cfg := Get()
	if cfg.Provider != ProviderOllama || cfg.Model != "qwen3:8b" || !cfg.Enabled {
		t.Fatalf("重启后配置丢失: %+v", cfg)
	}
}

// 打码视图：任何情况下不能把明文 key 泄露到 HTTP 响应形状里。
func TestViewMasksAPIKey(t *testing.T) {
	SetStoreDir(t.TempDir())
	if err := Update(func(cfg *Config) {
		cfg.Provider = ProviderOpenAI
		cfg.Model = "gpt-4o-mini"
		cfg.Enabled = true
		cfg.APIKey = "sk-abcdef1234567890"
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	v := view(Get())
	if !v.HasKey {
		t.Fatal("hasKey 应为 true")
	}
	if v.KeyTail != "7890" {
		t.Fatalf("keyTail 应为末 4 位，实际 %q", v.KeyTail)
	}
	// 视图结构里根本没有明文字段——防呆靠结构不靠自觉
	if strings.Contains(v.KeyTail, "sk-") {
		t.Fatal("keyTail 泄露了前缀")
	}
}

// openai 未配 key = 未配置；ollama 无 key 也可用。
func TestConfiguredSemantics(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
		want bool
	}{
		{"未启用", Config{Provider: ProviderOpenAI, Model: "gpt-4o-mini", BaseURL: "https://x", APIKey: "k"}, false},
		{"openai 缺 key", Config{Provider: ProviderOpenAI, Model: "m", BaseURL: "https://x", Enabled: true}, false},
		{"openai 缺模型", Config{Provider: ProviderOpenAI, BaseURL: "https://x", APIKey: "k", Enabled: true}, false},
		{"ollama 免 key", Config{Provider: ProviderOllama, Model: "qwen3:8b", BaseURL: "http://127.0.0.1:11434", Enabled: true}, true},
		{"openai 就绪", Config{Provider: ProviderOpenAI, Model: "m", BaseURL: "https://x", APIKey: "k", Enabled: true}, true},
	}
	for _, c := range cases {
		if got := configured(sanitize(c.cfg)); got != c.want {
			t.Fatalf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

// 文件带 UTF-8 BOM 也能读（PowerShell Set-Content 的产物）。
func TestLoadToleratesBOM(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "ai.json")
	body := []byte{0xEF, 0xBB, 0xBF}
	body = append(body, []byte(`{"provider":"ollama","model":"qwen3:8b","enabled":true}`)...)
	if err := os.WriteFile(p, body, 0o600); err != nil {
		t.Fatal(err)
	}
	SetStoreDir(dir)
	if Get().Model != "qwen3:8b" {
		t.Fatalf("BOM 文件读取失败: %+v", Get())
	}
}
