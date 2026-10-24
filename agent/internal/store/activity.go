package store

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"landeck/internal/config"
)

type Activity struct {
	ID         string         `json:"id"`
	At         string         `json:"at"`
	ClientName string         `json:"clientName"`
	Action     string         `json:"action"`
	Params     map[string]any `json:"params,omitempty"`
	OK         bool           `json:"ok"`
	Detail     string         `json:"detail"`
}

const (
	maxMemory     = 600
	maxFileBytes  = 2 << 20 // 2 MB 后换文件，避免无限增长
)

// ActivityStore 内存环形 + JSONL 追加。写盘失败不影响控制链路。
type ActivityStore struct {
	mu    sync.RWMutex
	items []Activity
	dir   string
	file  *os.File
	size  int64
}

func NewActivityStore(dir string) *ActivityStore {
	s := &ActivityStore{dir: dir, items: make([]Activity, 0, maxMemory)}
	s.loadRecent()
	return s
}

func (s *ActivityStore) path() string { return filepath.Join(s.dir, "activity.jsonl") }

// loadRecent 启动时回读最后 200 条，重启后 UI 不至于空白。
func (s *ActivityStore) loadRecent() {
	f, err := os.Open(s.path())
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	all := make([]Activity, 0, 200)
	for sc.Scan() {
		var a Activity
		if err := json.Unmarshal(sc.Bytes(), &a); err == nil {
			all = append(all, a)
		}
	}
	if len(all) > maxMemory {
		all = all[len(all)-maxMemory:]
	}
	s.items = all
	if st, err := f.Stat(); err == nil {
		s.size = st.Size()
	}
}

func (s *ActivityStore) Add(a Activity) Activity {
	if a.ID == "" {
		a.ID = config.GenerateID()
	}
	if a.At == "" {
		a.At = time.Now().Format(time.RFC3339)
	}
	s.mu.Lock()
	s.items = append(s.items, a)
	if len(s.items) > maxMemory {
		s.items = s.items[len(s.items)-maxMemory:]
	}
	s.append(a)
	s.mu.Unlock()
	return a
}

func (s *ActivityStore) append(a Activity) {
	if s.size > maxFileBytes {
		if s.file != nil {
			_ = s.file.Close()
			s.file = nil
		}
		rotated := filepath.Join(s.dir, "activity-"+time.Now().Format("20060102-150405")+".jsonl")
		_ = os.Rename(s.path(), rotated)
		s.size = 0
	}
	if s.file == nil {
		f, err := os.OpenFile(s.path(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return
		}
		s.file = f
	}
	raw, err := json.Marshal(a)
	if err != nil {
		return
	}
	n, _ := s.file.Write(append(raw, '\n'))
	s.size += int64(n)
}

// List 倒序返回，before 为上一页最旧一条的时间（RFC3339）。
func (s *ActivityStore) List(limit int, before string) []Activity {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Activity, 0, limit)
	for i := len(s.items) - 1; i >= 0 && len(out) < limit; i-- {
		if before != "" && s.items[i].At >= before {
			continue
		}
		out = append(out, s.items[i])
	}
	return out
}

func (s *ActivityStore) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file != nil {
		_ = s.file.Close()
		s.file = nil
	}
}
