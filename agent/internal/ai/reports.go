package ai

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// reports.go：报告持久化（dataDir/reports/）。
//
// 文件名即身份（契约）：日报 YYYY-MM-DD.md、周报 week-YYYY-Www.md。
// 覆盖语义：自动补缺**从不覆盖**（已有则跳过）；手动生成**总是覆盖**当日/当周文件。

// ReportMeta 是 GET /ai/reports 的列表项。
type ReportMeta struct {
	ID          string `json:"id"`   // day-2026-10-31 | week-2026-W44
	Type        string `json:"type"` // day | week
	Date        string `json:"date"` // day: 当天；week: 该周周一（便于前端展示区间）
	GeneratedAt string `json:"generatedAt"`
	Path        string `json:"path"`
}

// reportDir 报告目录。
func reportDir() string { return filepath.Join(storeDir, "reports") }

// anchorDate 把任意锚点规整为 YYYY-MM-DD（周锚点取该周周一）。
// 返回的日期同时是文件名的日期部分与列表里的 date 字段。
func anchorDate(scope, date string, now time.Time) (time.Time, error) {
	anchor := now
	if date != "" {
		if d, err := time.ParseInLocation("2006-01-02", date, now.Location()); err == nil {
			anchor = d
		} else if d, err := time.ParseInLocation("2006-01", date, now.Location()); err == nil {
			anchor = d
		}
	}
	switch scope {
	case "week":
		offset := (int(anchor.Weekday()) + 6) % 7 // Monday=0
		return time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -offset), nil
	case "month":
		return time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, now.Location()), nil
	case "day":
		return time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, now.Location()), nil
	default:
		return time.Time{}, fmt.Errorf("未知 scope: %s", scope)
	}
}

// reportFileName 报告文件名与 id。week 用 ISO 周号（Www 两位）。
func reportFileName(scope string, day time.Time) (name, id string, err error) {
	switch scope {
	case "day":
		d := day.Format("2006-01-02")
		return d + ".md", "day-" + d, nil
	case "week":
		y, w := day.ISOWeek()
		id = fmt.Sprintf("week-%04d-W%02d", y, w)
		return id + ".md", id, nil
	default:
		// month 报告契约未定义文件名，暂不落盘（见 generateReport）。
		return "", "", fmt.Errorf("scope %s 不支持落盘", scope)
	}
}

// saveReport 落盘一份报告。overwrite=false 且已存在时返回现有 meta（不重写）。
func saveReport(scope string, day time.Time, markdown string, overwrite bool) (ReportMeta, error) {
	name, id, err := reportFileName(scope, day)
	if err != nil {
		return ReportMeta{}, err
	}
	dir := reportDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return ReportMeta{}, err
	}
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err == nil && !overwrite {
		return statReport(path, id, scope, day)
	}
	// 原子写：临时文件 + rename，避免断电留半篇
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(markdown), 0o600); err != nil {
		return ReportMeta{}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return ReportMeta{}, err
	}
	return statReport(path, id, scope, day)
}

// statReport 从文件本身取 generatedAt（mtime）等元数据。
func statReport(path, id, scope string, day time.Time) (ReportMeta, error) {
	st, err := os.Stat(path)
	if err != nil {
		return ReportMeta{}, err
	}
	date := day.Format("2006-01-02")
	if scope == "week" {
		date = day.Format("2006-01-02") // 周一日期（anchorDate 已归一到周一）
	}
	return ReportMeta{
		ID:          id,
		Type:        scope,
		Date:        date,
		GeneratedAt: st.ModTime().Format(time.RFC3339),
		Path:        path,
	}, nil
}

// idToName id → 文件名。两类前缀的文件名规则不同：
//   - day-2026-10-31 → 2026-10-31.md（契约：日报文件名就是日期本身）
//   - week-2026-W44  → week-2026-W44.md（周报文件名带 week- 前缀）
//
// 第一版直接拿 id 拼 .md，日报读不到——就是这层映射漏了。
func idToName(id string) (string, bool) {
	if strings.HasPrefix(id, "day-") && len(id) == len("day-2006-01-02") {
		return strings.TrimPrefix(id, "day-") + ".md", true
	}
	if strings.HasPrefix(id, "week-") && len(id) == len("week-2006-W00") {
		return id + ".md", true
	}
	return "", false
}

// readReport 按 id 读正文。白名单校验防路径穿越（id 直接参与文件名）。
func readReport(id string) (string, error) {
	name, ok := idToName(id)
	if !ok {
		return "", fmt.Errorf("非法报告 id")
	}
	b, err := os.ReadFile(filepath.Join(reportDir(), name))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// listReports 扫描报告目录，新的在前。
// 目录名即契约来源，解析失败的文件跳过（不报错——手工放进去的杂物不影响列表）。
func listReports(limit int) []ReportMeta {
	entries, err := os.ReadDir(reportDir())
	if err != nil {
		return []ReportMeta{}
	}
	type item struct {
		meta ReportMeta
		sort string
	}
	var out []item
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".md") {
			continue
		}
		stem := strings.TrimSuffix(name, ".md")
		var meta ReportMeta
		sortKey := ""
		switch {
		case len(stem) == len("2006-01-02"): // 日报：文件名就是日期本身（无前缀）
			d, err := time.ParseInLocation("2006-01-02", stem, time.Local)
			if err != nil {
				continue
			}
			meta = ReportMeta{ID: "day-" + stem, Type: "day", Date: d.Format("2006-01-02")}
			sortKey = d.Format("2006-01-02") + "-day"
		case strings.HasPrefix(stem, "week-") && len(stem) == len("week-2006-W00"):
			var y, w int
			if _, err := fmt.Sscanf(stem, "week-%d-W%d", &y, &w); err != nil {
				continue
			}
			// 该周周一：以 1 月 4 日所在周推算（ISO 周定义）
			jan4 := time.Date(y, 1, 4, 0, 0, 0, 0, time.Local)
			monday := jan4.AddDate(0, 0, -((int(jan4.Weekday())+6)%7)).AddDate(0, 0, (w-1)*7)
			meta = ReportMeta{ID: stem, Type: "week", Date: monday.Format("2006-01-02")}
			sortKey = monday.Format("2006-01-02") + "-week"
		default:
			continue
		}
		if st, err := e.Info(); err == nil {
			meta.GeneratedAt = st.ModTime().Format(time.RFC3339)
		}
		meta.Path = filepath.Join(reportDir(), name)
		out = append(out, item{meta: meta, sort: sortKey})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].sort > out[j].sort })
	if limit <= 0 || limit > len(out) {
		limit = len(out)
	}
	metas := make([]ReportMeta, 0, limit)
	for _, it := range out[:limit] {
		metas = append(metas, it.meta)
	}
	return metas
}

// reportExists 报告是否已落盘（补缺跳过的判据）。
func reportExists(scope string, day time.Time) bool {
	name, _, err := reportFileName(scope, day)
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(reportDir(), name))
	return err == nil
}
