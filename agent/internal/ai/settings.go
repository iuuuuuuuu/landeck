// Package ai：AI 日报/对话的服务端。
//
// 数据源是 internal/activity 的统计查询入口（GetSummary/GetRank，自带 3 分钟缓存），
// 本包只做三件事：配置持久化、prompt 组装（纯函数）、调 LLM（可注入 HTTP client）。
// 契约见 Lead 任务书与 docs/design/hindsight-revamp-phase1.md。
//
// 安全边界：apiKey 只落本地文件（0600），任何 HTTP 响应都只回 hasKey + 末 4 位；
// 用户配好的 key 属于被控端机主，绝不透传给控制端。
package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Provider 取值："openai"（OpenAI 兼容 /chat/completions）| "ollama"（本地 /api/chat）。
const (
	ProviderOpenAI = "openai"
	ProviderOllama = "ollama"
)

// Config 持久化到 dataDir/ai.json。
//
// APIKey 是敏感字段：json tag 有 omitempty 无用（持久化必须含它），
// 防泄漏靠两层：文件权限 0600 + 对外视图（View）永不序列化原始 key。
type Config struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseURL"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
	Enabled  bool   `json:"enabled"`
}

// View 是 GET /ai/settings 的响应形状：apiKey 打码。
type View struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseURL"`
	Model    string `json:"model"`
	Enabled  bool   `json:"enabled"`
	HasKey   bool   `json:"hasKey"`
	// KeyTail 明文 key 的末 4 位，帮用户辨认是哪把 key；无 key 时为空。
	KeyTail string `json:"keyTail"`
}

// 默认地址：openai 指官方 API（兼容任意 OpenAI 形状的中转，用户改 baseURL 即可）；
// ollama 指本机默认端口。留空 baseURL 时按 provider 取默认。
func defaultBaseURL(provider string) string {
	if provider == ProviderOllama {
		return "http://127.0.0.1:11434"
	}
	return "https://api.openai.com/v1"
}

func sanitize(cfg Config) Config {
	cfg.Provider = strings.TrimSpace(cfg.Provider)
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.Model = strings.TrimSpace(cfg.Model)
	if cfg.Provider != ProviderOpenAI && cfg.Provider != ProviderOllama {
		cfg.Provider = ProviderOpenAI
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultBaseURL(cfg.Provider)
	}
	return cfg
}

// view 打码视图。
func view(cfg Config) View {
	tail := ""
	if len(cfg.APIKey) >= 4 {
		tail = cfg.APIKey[len(cfg.APIKey)-4:]
	}
	return View{
		Provider: cfg.Provider,
		BaseURL:  cfg.BaseURL,
		Model:    cfg.Model,
		Enabled:  cfg.Enabled,
		HasKey:   cfg.APIKey != "",
		KeyTail:  tail,
	}
}

// configured 判断「能不能发起 LLM 调用」。
// openai 需要 key（官方/中转都要求）；ollama 本地无需 key。
func configured(cfg Config) bool {
	if !cfg.Enabled || cfg.Model == "" || cfg.BaseURL == "" {
		return false
	}
	if cfg.Provider == ProviderOpenAI && cfg.APIKey == "" {
		return false
	}
	return true
}

// ---------- 持久化（对齐 activity settings 的单互斥锁风格） ----------

var (
	mu       sync.Mutex
	storeDir string
	cache    *Config
)

func filePath() string { return filepath.Join(storeDir, "ai.json") }

// initStore 初始化存储目录并载入（不存在则用默认值，首次保存时落盘）。
// 出错只记日志不 panic——AI 是增强功能，坏了不影响 agent 主体。
func initStore(dir string) {
	storeDir = dir
	cfg, err := loadFile(filePath())
	if err != nil {
		fmt.Printf("[ai] 读取配置失败，使用默认值: %v\n", err)
	}
	cfg = sanitize(cfg)
	cache = &cfg
}

func loadFile(path string) (Config, error) {
	var cfg Config
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Config{Provider: ProviderOpenAI}, nil
		}
		return cfg, err
	}
	// 容忍 UTF-8 BOM（PowerShell 写入的文件带 BOM，json 直接解析会失败）。
	b = trimBOM(b)
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, fmt.Errorf("解析 %s: %w", path, err)
	}
	return cfg, nil
}

func trimBOM(b []byte) []byte {
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return b[3:]
	}
	return b
}

// save 原子落盘（临时文件 + rename），权限 0600——文件里有 apiKey。
func save(cfg Config) error {
	if storeDir == "" {
		return fmt.Errorf("ai 存储目录未初始化")
	}
	if err := os.MkdirAll(storeDir, 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := filePath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filePath())
}

// Get 配置快照。
func Get() Config {
	mu.Lock()
	defer mu.Unlock()
	if cache == nil {
		return Config{Provider: ProviderOpenAI}
	}
	return *cache
}

// Update 部分更新（逐字段覆盖，风格对齐 httpapi.handleActivitySettingsPut）。
//
// apiKey 特殊语义：传空串不清空（前端打码回显后无法重发明文，空串是「未修改」）、
// 传 clearKey:true 才真正清空。
func Update(mutate func(*Config)) error {
	mu.Lock()
	defer mu.Unlock()
	cfg := Config{Provider: ProviderOpenAI}
	if cache != nil {
		cfg = *cache
	}
	mutate(&cfg)
	cfg = sanitize(cfg)
	if err := save(cfg); err != nil {
		return err
	}
	cache = &cfg
	return nil
}

// SetStoreDir 供 Register 前注入数据目录（幂等，重复调用以首次为准，避免测试间串扰）。
func SetStoreDir(dir string) {
	mu.Lock()
	defer mu.Unlock()
	if storeDir == dir && cache != nil {
		return
	}
	initStore(dir)
}
