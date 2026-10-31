package activity

// 数据管理：全量导出与手动清理。
//
// 设计要点：
// - export 是全量拉取（用户备份/迁移场景），不套 3 分钟查询缓存——
//   一次性大响应，缓存只会白占内存；
// - clear 复用保留期清理（pruneBefore），beforeDays 必须显式传——
//   「清空全部数据」是毁灭性操作，绝不允许被缺省参数误触。

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"time"
)

// ParseClearDays 从请求体解析 beforeDays。
// 返回 ok=false 时调用方应回 400：缺省、非数字、小于 1 都拒绝。
// （上限 3650 防呆；真想全删就传一个大数。）
func ParseClearDays(m map[string]any) (int, bool) {
	v, ok := m["beforeDays"]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		if n < 1 || n != float64(int(n)) || n > 3650 {
			return 0, false
		}
		return int(n), true
	case int:
		if n < 1 || n > 3650 {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

// Clear 删除 N 天前的段，返回删除条数。同时作废查询缓存——
// 不然用户清完数据，统计页在缓存 TTL 内还显示旧数字，像没删掉。
func Clear(beforeDays int) (int64, error) {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return 0, errNotStarted
	}
	cut := time.Now().AddDate(0, 0, -beforeDays).Unix()
	n, err := m.db.pruneBefore(cut)
	if err != nil {
		return 0, err
	}
	cacheMu.Lock()
	cache = map[string]cacheEntry{}
	cacheMu.Unlock()
	return n, nil
}

// buildCSV 把段序列化成 CSV 字节（列序固定：start,end,day,app,title）。
// 抽成纯函数便于单测（逗号/引号/换行的 CSV 转义都在 encoding/csv 里）。
func buildCSV(segs []Segment) []byte {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"start", "end", "day", "app", "title"})
	for _, g := range segs {
		_ = w.Write([]string{
			time.Unix(g.Start, 0).Format(time.RFC3339),
			time.Unix(g.End, 0).Format(time.RFC3339),
			dayOf(g.Start),
			g.App,
			g.Title,
		})
	}
	w.Flush()
	return buf.Bytes()
}

// Export 全量导出。format=json|csv。
// json 复用 Segment 结构（unix 秒），csv 用人类可读的 RFC3339。
func Export(format string) (data []byte, mime string, filename string, err error) {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return nil, "", "", errNotStarted
	}
	segs, err := m.db.allSegs()
	if err != nil {
		return nil, "", "", err
	}
	stamp := time.Now().Format("20060102-150405")
	switch format {
	case "csv":
		return buildCSV(segs), "text/csv; charset=utf-8",
			fmt.Sprintf("landeck-activity-%s.csv", stamp), nil
	default: // json（含空串：缺省给 json）
		payload, jerr := marshalJSON(map[string]any{
			"exportedAt": time.Now().Format(time.RFC3339),
			"count":      len(segs),
			"segments":   segs,
		})
		if jerr != nil {
			return nil, "", "", jerr
		}
		return payload, "application/json; charset=utf-8",
			fmt.Sprintf("landeck-activity-%s.json", stamp), nil
	}
}
