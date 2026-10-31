package memory

// 查询 API（httpapi 调用的包级入口）。

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SearchItem 检索结果行（契约 A 节）。
type SearchItem struct {
	ID      int64  `json:"id"`
	Ts      int64  `json:"ts"`      // unix 秒
	App     string `json:"app"`     // 截屏瞬间前台应用
	Snippet string `json:"snippet"` // 命中词前后各 40 字符
	File    string `json:"file"`    // 文件名（不含目录，绝对路径不出库）
}

// buildSnippet 找到 q 在 text 中的首个不区分大小写命中，取前后各 40 字符。
// 未命中（理论不可达：LIKE 已过滤）返回文本前 80 字符兜底。
func buildSnippet(text, q string) string {
	i := strings.Index(strings.ToLower(text), strings.ToLower(q))
	if i < 0 {
		if len(text) > 120 {
			text = text[:120] + "…"
		}
		return text
	}
	// 命中位置按字节找到后换算 rune 偏移，snippet 按 rune 切（中文安全）
	ri := len([]rune(text[:i]))
	hitLen := len([]rune(q))
	return snippet(text, ri, hitLen)
}

// Search 关键词检索。from/to 传 "YYYY-MM-DD"（本地日，含当天）或空。
func Search(q, from, to string, limit int) (map[string]any, error) {
	items := []SearchItem{}
	if strings.TrimSpace(q) == "" {
		return map[string]any{"items": items}, nil // 空关键词：空结果，不做全量扫
	}
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return map[string]any{"items": items}, nil
	}
	f, t := dayRange(from, to)
	rows, err := m.db.search(q, f, t, limit)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": rows}, nil
}

// dayRange 把日期参数换算成 unix 秒范围。
func dayRange(from, to string) (int64, int64) {
	var f, t int64
	if from != "" {
		if d, err := time.ParseInLocation("2006-01-02", from, time.Local); err == nil {
			f = d.Unix()
		}
	}
	if to != "" {
		if d, err := time.ParseInLocation("2006-01-02", to, time.Local); err == nil {
			t = d.AddDate(0, 0, 1).Unix() - 1 // 含当天全天
		}
	}
	return f, t
}

// Status 状态端点（契约：enabled, intervalSec, retentionDays, lastShotAt, shotsCount, ocrOk, ocrFail）。
type Status struct {
	Enabled       bool  `json:"enabled"`
	IntervalSec   int   `json:"intervalSec"`
	RetentionDays int   `json:"retentionDays"`
	LastShotAt    int64 `json:"lastShotAt"` // unix 秒，0=尚未截过
	ShotsCount    int64 `json:"shotsCount"` // 库内总数
	OcrOk         int64 `json:"ocrOk"`      // 会话计数：OCR 成功
	OcrFail       int64 `json:"ocrFail"`    // 会话计数：OCR 失败（NOLANG 不算失败）
}

// GetStatus 状态查询。
func GetStatus() Status {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	st := m.settings.Get()
	out := Status{
		Enabled:       st.Enabled,
		IntervalSec:   st.IntervalSec,
		RetentionDays: st.RetentionDays,
	}
	if m != nil && m.db != nil {
		out.ShotsCount, out.LastShotAt = m.db.stats()
	}
	if m != nil {
		m.mu.Lock()
		out.OcrOk, out.OcrFail, out.LastShotAt = m.ocrOk, m.ocrFail, m.lastShotAt
		m.mu.Unlock()
	}
	return out
}

// GetSettings 当前设置。
func GetSettings() Settings {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return DefaultSettings()
	}
	return m.settings.Get()
}

// UpdateSettings 部分更新（httpapi 层把 body 字段映射进来）。
func UpdateSettings(fn func(*Settings)) error {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return errNotStarted
	}
	return m.settings.Update(fn)
}

// Image 按 id 取截图 PNG 字节（文件名→磁盘读）。
func Image(id int64) (data []byte, etag string, ok bool) {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return nil, "", false
	}
	file, hit := m.db.get(id)
	if !hit {
		return nil, "", false
	}
	// file 只允许是纯文件名（写入方保证），拼回月份目录需要 ts——
	// 直接从库里的 file 名反查目录太绕；文件名本身已含时间戳，
	// 用库行 ts 定位月份目录。
	var ts int64
	if err := m.db.db.QueryRow(`SELECT ts FROM shots WHERE id=?`, id).Scan(&ts); err != nil {
		return nil, "", false
	}
	month := monthDir(time.Unix(ts, 0))
	path := filepath.Join(m.dir, "memory", month, file)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", false
	}
	etag = fileETag(data)
	return data, etag, true
}

var errNotStarted = errMemoryNotStarted
