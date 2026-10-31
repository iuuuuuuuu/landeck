package memory

import (
	"fmt"
	"strconv"
	"sync"
	"time"
)

// Settings 屏幕记忆的可调参数，落盘 dataDir/memory.json。
type Settings struct {
	// Enabled 总开关。默认 false：这是隐私敏感功能，必须用户显式开启。
	Enabled bool `json:"enabled"`
	// IntervalSec 截屏间隔秒。契约：默认 60，可配 15–300。
	IntervalSec int `json:"intervalSec"`
	// RetentionDays 保留天数。契约：默认 7，可配 1–90。
	RetentionDays int `json:"retentionDays"`
}

const (
	intervalDefault = 60
	intervalMin     = 15
	intervalMax     = 300
	retentionDef    = 7
	retentionMin    = 1
	retentionMax    = 90
)

func DefaultSettings() Settings {
	return Settings{Enabled: false, IntervalSec: intervalDefault, RetentionDays: retentionDef}
}

// sanitize 把越界值拉回契约区间（intervalSec 15–300、retentionDays 1–90）。
func (s *Settings) sanitize() {
	if s.IntervalSec < intervalMin || s.IntervalSec > intervalMax {
		s.IntervalSec = intervalDefault
	}
	if s.RetentionDays < retentionMin || s.RetentionDays > retentionMax {
		s.RetentionDays = retentionDef
	}
}

// ---------- 设置存储（对齐 activity 的原子替换风格） ----------

type settingsStore struct {
	mu   sync.RWMutex
	path string
	s    Settings
}

func openSettings(dir string) *settingsStore {
	st := &settingsStore{path: joinPath(dir, "memory.json"), s: DefaultSettings()}
	if raw, err := readFile(st.path); err == nil {
		var s Settings
		if unmarshalJSON(raw, &s) == nil {
			s.sanitize()
			st.s = s
		}
		// 损坏文件回默认，不阻塞启动
	}
	return st
}

func (st *settingsStore) Get() Settings {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return st.s
}

func (st *settingsStore) Update(fn func(*Settings)) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	next := st.s
	fn(&next)
	next.sanitize()
	if err := writeAtomic(st.path, next); err != nil {
		return err
	}
	st.s = next
	return nil
}

// ---------- 纯函数 ----------

// shotFilename 契约规定的文件名：unixMs-ms.png（毫秒时间戳 + 毫秒内余数，
// 同毫秒两张也不冲突）。抽成纯函数便于单测锁格式。
func shotFilename(at time.Time) string {
	return strconv.FormatInt(at.UnixMilli(), 10) + "-" + fmt.Sprintf("%03d", at.Nanosecond()/1e6) + ".png"
}

// monthDir 契约规定的月份子目录：YYYY-MM。
func monthDir(at time.Time) string {
	return at.Format("2006-01")
}

// snippet 命中词前后各 40 字符（契约 A 节）。
// 纯函数：i 为命中位置（runne 偏移），text 按 rune 切。
func snippet(text string, i, hitLen int) string {
	r := []rune(text)
	if i < 0 || i > len(r) {
		i = 0
	}
	const w = 40
	from := i - w
	if from < 0 {
		from = 0
	}
	to := i + hitLen + w
	if to > len(r) {
		to = len(r)
	}
	prefix, suffix := "", ""
	if from > 0 {
		prefix = "…"
	}
	if to < len(r) {
		suffix = "…"
	}
	return prefix + string(r[from:to]) + suffix
}

// sampleView 截屏瞬间的前台信息（与 activity.Sample 解耦，便于单测）。
type sampleView struct{ App, Title string }

// shouldShoot 截屏门（纯函数）：总开关 → 隐私命中。
// isPrivate 由调用方注入（生产传 activity.IsPrivate 包装），保持本包可测。
// 前台拿不到也截（锁屏时截到的是锁屏画面，无妨）。
func shouldShoot(st Settings, haveSample bool, sample sampleView,
	isPrivate func(app, title string) bool) bool {
	if !st.Enabled {
		return false
	}
	if haveSample && isPrivate(sample.App, sample.Title) {
		return false
	}
	return true
}
