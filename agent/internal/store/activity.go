package store

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

// ---------- 统计聚合 ----------

// ActionCount 是某类动作的计数。
type ActionCount struct {
	Action string `json:"action"`
	Label  string `json:"label"`
	Total  int    `json:"total"`
	OK     int    `json:"ok"`
	Failed int    `json:"failed"`
}

// DayCount 是某天的操作次数。
type DayCount struct {
	Date   string `json:"date"`
	Total  int    `json:"total"`
	Failed int    `json:"failed"`
}

// ClientCount 是某个客户端的操作次数。
type ClientCount struct {
	Name     string `json:"name"`
	Total    int    `json:"total"`
	LastSeen string `json:"lastSeen"`
}

// Stats 是活动日志的聚合结果。
type Stats struct {
	Total      int           `json:"total"`
	Failed     int           `json:"failed"`
	Actions    []ActionCount `json:"actions"`
	Days       []DayCount    `json:"days"`
	Clients    []ClientCount `json:"clients"`
	FirstAt    string        `json:"firstAt"`
	LastAt     string        `json:"lastAt"`
	BusiestDay string        `json:"busiestDay"`
}

// Aggregate 汇总内存里的活动记录。days 为要返回的最近天数（按自然日补零）。
func (s *ActivityStore) Aggregate(days int) Stats {
	if days <= 0 || days > 90 {
		days = 14
	}
	s.mu.RLock()
	items := make([]Activity, len(s.items))
	copy(items, s.items)
	s.mu.RUnlock()

	out := Stats{
		Actions: []ActionCount{},
		Days:    []DayCount{},
		Clients: []ClientCount{},
	}
	if len(items) == 0 {
		return out
	}

	byAction := map[string]*ActionCount{}
	byDay := map[string]*DayCount{}
	byClient := map[string]*ClientCount{}

	for _, a := range items {
		out.Total++
		if !a.OK {
			out.Failed++
		}
		if out.FirstAt == "" || a.At < out.FirstAt {
			out.FirstAt = a.At
		}
		if a.At > out.LastAt {
			out.LastAt = a.At
		}

		// 动作名里带具体对象（如「新建定时任务 每天 23:30」），归一到前缀便于统计
		key := normalizeAction(a.Action)
		ac := byAction[key]
		if ac == nil {
			ac = &ActionCount{Action: key}
			byAction[key] = ac
		}
		ac.Total++
		if a.OK {
			ac.OK++
		} else {
			ac.Failed++
		}

		if len(a.At) >= 10 {
			date := a.At[:10]
			dc := byDay[date]
			if dc == nil {
				dc = &DayCount{Date: date}
				byDay[date] = dc
			}
			dc.Total++
			if !a.OK {
				dc.Failed++
			}
		}

		name := a.ClientName
		if name == "" {
			name = "未知"
		}
		cc := byClient[name]
		if cc == nil {
			cc = &ClientCount{Name: name}
			byClient[name] = cc
		}
		cc.Total++
		if a.At > cc.LastSeen {
			cc.LastSeen = a.At
		}
	}

	for _, v := range byAction {
		out.Actions = append(out.Actions, *v)
	}
	sort.Slice(out.Actions, func(i, j int) bool {
		if out.Actions[i].Total == out.Actions[j].Total {
			return out.Actions[i].Action < out.Actions[j].Action
		}
		return out.Actions[i].Total > out.Actions[j].Total
	})

	for _, v := range byClient {
		out.Clients = append(out.Clients, *v)
	}
	sort.Slice(out.Clients, func(i, j int) bool { return out.Clients[i].Total > out.Clients[j].Total })

	// 最近 N 天补零：缺数据的日子也要出现，否则图表会塌成一条
	now := time.Now()
	best := 0
	for i := days - 1; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		dc := byDay[date]
		if dc == nil {
			dc = &DayCount{Date: date}
		}
		out.Days = append(out.Days, *dc)
		if dc.Total > best {
			best = dc.Total
			out.BusiestDay = date
		}
	}
	if len(out.Actions) > 12 {
		out.Actions = out.Actions[:12]
	}
	if len(out.Clients) > 8 {
		out.Clients = out.Clients[:8]
	}
	return out
}

// normalizeAction 把带参数的动作文案归到稳定类别，便于按类统计。
func normalizeAction(s string) string {
	if s == "" {
		return "未知操作"
	}
	// 「新建定时任务 xxx」「结束应用 xxx」「MCP 电源 sleep」这类取前缀
	prefixes := []string{
		"新建定时任务", "结束应用", "结束进程", "下载文件", "上传文件", "新建目录", "重命名",
		"MCP 电源", "MCP 音量", "MCP 媒体", "MCP 结束进程", "配对成功",
	}
	for _, p := range prefixes {
		if strings.HasPrefix(s, p) {
			return p
		}
	}
	return s
}
