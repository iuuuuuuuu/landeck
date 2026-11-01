package syncengine

// 同步设置：sync.json（0600，writeAtomic 风格，同 ai.json 口径）。
// lastPushedAt/lastSyncAt/lastError 也持久化在这里（崩溃后水位线不丢）。

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Settings struct {
	Enabled      bool   `json:"enabled"`
	URL          string `json:"url"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	IntervalSec  int    `json:"intervalSec"`
	DeviceID     string `json:"deviceId"`
	DeviceName   string `json:"deviceName"`
	LastPushedAt int64  `json:"lastPushedAt"`
	LastSyncAt   int64  `json:"lastSyncAt"`
	LastError    string `json:"lastError"`
}

// errSyncNotStarted agent 未装配同步引擎时的错误语义。
var errSyncNotStarted = errdefs()

const (
	intervalMin = 60
	intervalMax = 3600
	pushWindow  = 7 * 24 * time.Hour // 增量推的重叠窗口（契约：end > lastPushedAt-7d）
)

func (s *Settings) sanitize() {
	s.URL = strings.TrimRight(strings.TrimSpace(s.URL), "/")
	if s.IntervalSec < intervalMin || s.IntervalSec > intervalMax {
		s.IntervalSec = 300
	}
	s.Username = strings.TrimSpace(s.Username)
	s.DeviceName = strings.TrimSpace(s.DeviceName)
	if s.DeviceID == "" {
		s.DeviceID = newDeviceID()
	}
	if s.DeviceName == "" {
		s.DeviceName = hostnameOr("unknown-pc")
	}
}

func newDeviceID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "pc-" + hex.EncodeToString(b)
}

func hostnameOr(fallback string) string {
	h, err := os.Hostname()
	if err != nil || strings.TrimSpace(h) == "" {
		return fallback
	}
	return strings.TrimSpace(h)
}

func errdefs() error { return errors.New("sync not started") }

type settingsStore struct {
	mu   sync.Mutex
	path string
	st   Settings
}

func openSettings(dataDir string) (*settingsStore, error) {
	st := &settingsStore{path: filepath.Join(dataDir, "sync.json")}
	raw, err := os.ReadFile(st.path)
	switch {
	case err == nil:
		if err := json.Unmarshal(raw, &st.st); err != nil {
			// 文件坏了按默认重来（凭据丢失可重配，比卡死好）
			st.st = Settings{}
		}
	case os.IsNotExist(err):
		// 首次
	default:
		return nil, err
	}
	st.st.sanitize()
	return st, nil
}

func (s *settingsStore) Get() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.st
}

func (s *settingsStore) Update(fn func(*Settings)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.st)
	s.st.sanitize()
	raw, err := json.MarshalIndent(s.st, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// markSynced 记录一次同步的结果（水位线/时间/错误）。
func (s *settingsStore) markSynced(pushedAt int64, errStr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.st.LastSyncAt = time.Now().Unix()
	s.st.LastError = errStr
	if errStr == "" {
		s.st.LastPushedAt = pushedAt
	}
}
