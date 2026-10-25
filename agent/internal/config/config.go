package config

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const DefaultPort = 8420

type TLSConfig struct {
	Enabled bool   `json:"enabled"`
	Cert    string `json:"cert"`
	Key     string `json:"key"`
}

type Features struct {
	AllowWol         bool `json:"allowWol"`
	AllowSchedules   bool `json:"allowSchedules"`
	AllowShell       bool `json:"allowShell"`
	AllowProcessKill bool `json:"allowProcessKill"`
}

type Client struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Role       string    `json:"role"`
	TokenHash  string    `json:"tokenHash"`
	IP         string    `json:"ip"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

type Config struct {
	DeviceID         string    `json:"deviceId"`
	DeviceName       string    `json:"deviceName"`
	Port             int       `json:"port"`
	Bind             string    `json:"bind"`
	TLS              TLSConfig `json:"tls"`
	FixedKey         string    `json:"fixedKey"`
	RandomEnabled    bool      `json:"randomEnabled"`
	CodeTTL          int       `json:"codeTTL"` // 秒
	RequireLocalCode bool      `json:"requireLocalCode"`
	AllowLanOnly     bool      `json:"allowLanOnly"`
	// AllowLocalNoAuth 允许本机（loopback）请求跳过令牌：本机就是运行 Agent 的那台机器，
	// 用户已经在物理上控制了它，再要求配对只会造成「本机设备一片空白」。
	AllowLocalNoAuth bool      `json:"allowLocalNoAuth"`
	Locale           string    `json:"locale"`
	Theme            string    `json:"theme"`
	CORSOrigins      []string  `json:"corsOrigins"`
	Features         Features    `json:"features"`
	Files            FilesConfig `json:"files"`
	Clients          []Client  `json:"clients"`
}

func (c Config) Clone() Config {
	out := c
	out.Clients = append([]Client(nil), c.Clients...)
	out.CORSOrigins = append([]string(nil), c.CORSOrigins...)
	out.Files.Roots = append([]string(nil), c.Files.Roots...)
	return out
}

// Store 是配置的唯一写入点：所有修改都要过 Update，落盘原子替换。
type Store struct {
	mu   sync.RWMutex
	dir  string
	path string
	c    Config
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	s := &Store{dir: dir, path: filepath.Join(dir, "config.json")}
	raw, err := os.ReadFile(s.path)
	switch {
	case err == nil:
		var c Config
		if err := json.Unmarshal(raw, &c); err != nil {
			return nil, fmt.Errorf("配置文件损坏 %s: %w", s.path, err)
		}
		s.c = c
		s.repair()
	case errors.Is(err, os.ErrNotExist):
		s.c = Default()
		s.repair()
		if err := s.persist(); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	return s, nil
}

// repair 补齐老版本缺失字段，避免升级后变成空值。
func (s *Store) repair() {
	changed := false
	d := Default()
	if s.c.DeviceID == "" {
		s.c.DeviceID, changed = d.DeviceID, true
	}
	if s.c.DeviceName == "" {
		s.c.DeviceName, changed = d.DeviceName, true
	}
	if s.c.Port == 0 {
		s.c.Port, changed = DefaultPort, true
	}
	if s.c.Bind == "" {
		s.c.Bind, changed = "0.0.0.0", true
	}
	if s.c.FixedKey == "" {
		s.c.FixedKey, changed = GenerateFixedKey(), true
	}
	if s.c.CodeTTL == 0 {
		s.c.CodeTTL, changed = 300, true
	}
	if !s.c.AllowLocalNoAuth {
		s.c.AllowLocalNoAuth = true
		changed = true
	}
	if s.c.Locale == "" {
		s.c.Locale, changed = "zh-CN", true
	}
	if s.c.Theme == "" {
		s.c.Theme, changed = "aurora", true
	}
	if !s.c.Features.AllowWol && !s.c.Features.AllowSchedules && s.c.Clients == nil {
		// 首次创建：打开非危险的默认能力
		s.c.Features = Features{AllowWol: true, AllowSchedules: true, AllowProcessKill: true}
		changed = true
	}
	if s.c.Clients == nil {
		s.c.Clients = []Client{}
		changed = true
	}
	// 老配置文件没有 files 段：整段都是零值。这时按「新功能默认开启」迁移，
	// 否则升级后文件管理永远是关的，用户会以为是坏的。
	if s.c.Files.Roots == nil {
		s.c.Files = FilesConfig{Enabled: true, AllowWrite: true, Roots: []string{}}
		changed = true
	}
	if changed {
		_ = s.persist()
	}
}

func (s *Store) Dir() string { return s.dir }

func (s *Store) Get() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.c.Clone()
}

func (s *Store) Update(fn func(*Config) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.c.Clone()
	if err := fn(&next); err != nil {
		return err
	}
	prev := s.c
	s.c = next
	if err := s.persist(); err != nil {
		s.c = prev
		return err
	}
	return nil
}

func (s *Store) persist() error {
	raw, err := json.MarshalIndent(s.c, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func Default() Config {
	host, _ := os.Hostname()
	if host == "" {
		host = "LanDeck"
	}
	return Config{
		DeviceID:      GenerateID(),
		DeviceName:    host,
		Port:          DefaultPort,
		Bind:          "0.0.0.0",
		FixedKey:      GenerateFixedKey(),
		RandomEnabled: true,
		// 新装即默认允许本机免令牌：否则「本机」页在全新机器上必然 401
		AllowLocalNoAuth: true,
		CodeTTL:       300,
		Locale:        "zh-CN",
		Theme:         "aurora",
		CORSOrigins:   []string{},
		Features:      Features{AllowWol: true, AllowSchedules: true, AllowProcessKill: true},
		Files:         FilesConfig{Enabled: true, AllowWrite: true, Roots: []string{}},
		Clients:       []Client{},
	}
}

const idAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

func randString(n int, alphabet string) string {
	b := make([]byte, n)
	max := big.NewInt(int64(len(alphabet)))
	for i := range b {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			b[i] = alphabet[0]
			continue
		}
		b[i] = alphabet[v.Int64()]
	}
	return string(b)
}

// GenerateID 生成 12 位设备/客户端 id。
func GenerateID() string { return randString(12, idAlphabet) }

// GenerateFixedKey 生成形如 7K9F-2M4Q 的固定密钥（去掉易混字符 0/O/1/I）。
func GenerateFixedKey() string {
	const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
	return randString(4, abc) + "-" + randString(4, abc)
}

// NormalizeFixedKey 允许用户输入小写或漏掉连字符。
func NormalizeFixedKey(in string) string {
	up := strings.ToUpper(strings.TrimSpace(in))
	up = strings.ReplaceAll(up, "-", "")
	up = strings.ReplaceAll(up, " ", "")
	if len(up) == 8 {
		return up[:4] + "-" + up[4:]
	}
	return up
}

func MaskKey(k string) string {
	if len(k) < 4 {
		return "••••"
	}
	return "••••-" + k[len(k)-4:]
}

// FilesConfig 文件管理的开关与范围。
type FilesConfig struct {
	Enabled         bool     `json:"enabled"`
	AllowWrite      bool     `json:"allowWrite"`
	AllowSystemDirs bool     `json:"allowSystemDirs"`
	Roots           []string `json:"roots"` // 为空则自动探测（家目录/桌面/下载/文档）
}
