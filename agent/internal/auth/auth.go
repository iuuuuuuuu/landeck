package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"landeck/internal/config"
)

var (
	ErrInvalidKey  = errors.New("invalid_key")
	ErrRateLimited = errors.New("rate_limited")
	ErrBadRequest  = errors.New("bad_request")
)

type PairResult struct {
	Token      string
	ClientID   string
	ClientName string
	Role       string
}

type Manager struct {
	store *config.Store

	mu       sync.Mutex
	code     string
	codeExp  time.Time
	attempts map[string][]time.Time
}

func New(store *config.Store) *Manager {
	m := &Manager{store: store, attempts: map[string][]time.Time{}}
	m.rotateLocked()
	return m
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand 不可用: " + err.Error())
	}
	return "ldk_" + base64.RawURLEncoding.EncodeToString(b)
}

func newCode() string {
	var buf [3]byte
	if _, err := rand.Read(buf[:]); err != nil {
		panic("crypto/rand 不可用: " + err.Error())
	}
	n := int(buf[0])<<16 | int(buf[1])<<8 | int(buf[2])
	n %= 1_000_000
	return fmt.Sprintf("%06d", n)
}

func (m *Manager) ttl() time.Duration {
	cfg := m.store.Get()
	sec := cfg.CodeTTL
	if sec <= 0 {
		sec = 300
	}
	return time.Duration(sec) * time.Second
}

func (m *Manager) rotateLocked() {
	m.code = newCode()
	m.codeExp = time.Now().Add(m.ttl())
}

// Code 返回当前随机码；过期自动轮换。
func (m *Manager) Code() (string, time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if time.Now().After(m.codeExp) {
		m.rotateLocked()
	}
	return m.code, m.codeExp
}

func (m *Manager) RotateCode() (string, time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rotateLocked()
	return m.code, m.codeExp
}

// allow 每 IP 每分钟最多 10 次配对尝试，防爆破。
func (m *Manager) allow(ip string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	cut := now.Add(-time.Minute)
	list := m.attempts[ip][:0]
	for _, t := range m.attempts[ip] {
		if t.After(cut) {
			list = append(list, t)
		}
	}
	if len(list) >= 10 {
		m.attempts[ip] = list
		return false
	}
	m.attempts[ip] = append(list, now)
	if len(m.attempts) > 4096 {
		for k := range m.attempts {
			if k != ip {
				delete(m.attempts, k)
			}
		}
	}
	return true
}

// Pair 校验密钥并下发 token。kind: fixed | random
func (m *Manager) Pair(ip, clientName, clientID, key, kind string) (*PairResult, error) {
	if !m.allow(ip) {
		return nil, ErrRateLimited
	}
	clientName = strings.TrimSpace(clientName)
	if clientName == "" {
		clientName = "未命名设备"
	}
	if len([]rune(clientName)) > 40 {
		clientName = string([]rune(clientName)[:40])
	}
	cfg := m.store.Get()

	ok := false
	switch kind {
	case "random", "":
		code, exp := m.Code()
		if cfg.RandomEnabled && time.Now().Before(exp) {
			ok = subtle.ConstantTimeCompare([]byte(strings.TrimSpace(key)), []byte(code)) == 1
		}
	case "fixed":
		ok = subtle.ConstantTimeCompare(
			[]byte(config.NormalizeFixedKey(key)),
			[]byte(config.NormalizeFixedKey(cfg.FixedKey)),
		) == 1
	default:
		return nil, ErrBadRequest
	}
	if !ok {
		return nil, ErrInvalidKey
	}

	token := newToken()
	role := "controller"
	if len(cfg.Clients) == 0 {
		role = "owner"
	}
	if clientID == "" {
		clientID = config.GenerateID()
	}

	now := time.Now()
	client := config.Client{
		ID:         clientID,
		Name:       clientName,
		Role:       role,
		TokenHash:  hashToken(token),
		IP:         ip,
		CreatedAt:  now,
		LastSeenAt: now,
	}
	err := m.store.Update(func(c *config.Config) error {
		for i, existing := range c.Clients {
			if existing.ID == clientID {
				client.CreatedAt = existing.CreatedAt
				client.Role = existing.Role
				c.Clients[i] = client
				return nil
			}
		}
		c.Clients = append(c.Clients, client)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &PairResult{Token: token, ClientID: client.ID, ClientName: client.Name, Role: client.Role}, nil
}

// Authenticate 校验 Bearer token，返回客户端。
func (m *Manager) Authenticate(token string) (*config.Client, bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, false
	}
	h := hashToken(token)
	cfg := m.store.Get()
	for i := range cfg.Clients {
		if subtle.ConstantTimeCompare([]byte(cfg.Clients[i].TokenHash), []byte(h)) == 1 {
			c := cfg.Clients[i]
			m.touch(c.ID)
			return &c, true
		}
	}
	return nil, false
}

// touch 记录最后活跃时间，最多每 30s 落盘一次，避免频繁写。
func (m *Manager) touch(id string) {
	cfg := m.store.Get()
	for _, c := range cfg.Clients {
		if c.ID == id && time.Since(c.LastSeenAt) < 30*time.Second {
			return
		}
	}
	_ = m.store.Update(func(c *config.Config) error {
		for i := range c.Clients {
			if c.Clients[i].ID == id {
				c.Clients[i].LastSeenAt = time.Now()
			}
		}
		return nil
	})
}

func (m *Manager) List() []config.Client {
	cfg := m.store.Get()
	out := make([]config.Client, len(cfg.Clients))
	copy(out, cfg.Clients)
	return out
}

func (m *Manager) Revoke(id string) bool {
	found := false
	_ = m.store.Update(func(c *config.Config) error {
		kept := c.Clients[:0]
		for _, cl := range c.Clients {
			if cl.ID == id {
				found = true
				continue
			}
			kept = append(kept, cl)
		}
		c.Clients = kept
		return nil
	})
	return found
}

// Rotate 换发某客户端的 token（原 token 立即失效）。
func (m *Manager) Rotate(id string) (string, bool) {
	token := newToken()
	ok := false
	_ = m.store.Update(func(c *config.Config) error {
		for i := range c.Clients {
			if c.Clients[i].ID == id {
				c.Clients[i].TokenHash = hashToken(token)
				ok = true
			}
		}
		return nil
	})
	return token, ok
}

func (m *Manager) SetFixedKey(key string) error {
	norm := config.NormalizeFixedKey(key)
	if len(norm) != 9 {
		return errors.New("密钥需要 8 位字符（会自动加上连字符）")
	}
	return m.store.Update(func(c *config.Config) error {
		c.FixedKey = norm
		return nil
	})
}
