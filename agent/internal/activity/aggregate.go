package activity

import (
	"sort"
	"time"
)

// ---------- 聚合结果形状（与 docs/design/hindsight-revamp-phase1.md 第 5 节对齐） ----------

// Bucket 一个时间桶（小时/天）内各类别的秒数。
// Secs 的 key 是小类名；图表堆叠与图例直接消费它。
type Bucket struct {
	Key  string           `json:"key"`  // day: "00".."23"；week/month: "2026-10-31"
	Secs map[string]int64 `json:"secs"` // 小类 → 秒
}

// CategoryTotal 一个分类在范围内的总时长。
type CategoryTotal struct {
	Category string `json:"category"` // 小类
	Parent   string `json:"parent"`   // 大类
	Secs     int64  `json:"secs"`
}

// Summary 统计主响应。
type Summary struct {
	Scope      string          `json:"scope"` // day | week | month
	Date       string          `json:"date"`  // 请求锚点日期
	From       string          `json:"from"`  // 实际覆盖起点（YYYY-MM-DD）
	To         string          `json:"to"`    // 实际覆盖终点（含）
	TotalSec   int64           `json:"totalSec"`
	Buckets    []Bucket        `json:"buckets"`
	Categories []CategoryTotal `json:"categories"`
}

// AppRank 应用排行行。
type AppRank struct {
	App      string `json:"app"`
	Category string `json:"category"`
	Parent   string `json:"parent"`
	Secs     int64  `json:"secs"`
}

// Rank 排行响应。
type Rank struct {
	Scope      string          `json:"scope"`
	Date       string          `json:"date"`
	From       string          `json:"from"`
	To         string          `json:"to"`
	TotalSec   int64           `json:"totalSec"`
	Apps       []AppRank       `json:"apps"`
	Categories []CategoryTotal `json:"categories"`
}

// HourSec 应用详情的小时分布行。
type HourSec struct {
	Hour string `json:"hour"` // "00".."23"
	Secs int64  `json:"secs"`
}

// TitleRank 应用详情里按窗口标题分组的行（浏览器场景即页面标题）。
type TitleRank struct {
	Title string `json:"title"`
	Secs  int64  `json:"secs"`
}

// AppDetail 单应用详情响应。
type AppDetail struct {
	App      string      `json:"app"`
	Category string      `json:"category"`
	Parent   string      `json:"parent"`
	Date     string      `json:"date"`
	TotalSec int64       `json:"totalSec"`
	Hours    []HourSec   `json:"hours"`
	ByTitle  []TitleRank `json:"byTitle"`
}

// ---------- 范围计算 ----------

// rangeOf scope+锚点日期 → [from, to) 本地时刻。
// week 采用 ISO 周（周一起始），month 为自然月。
func rangeOf(scope, date string, now time.Time) (time.Time, time.Time, string, string) {
	anchor := now
	if date != "" {
		if d, err := time.ParseInLocation("2006-01-02", date, time.Local); err == nil {
			anchor = d
		}
	}
	switch scope {
	case "week":
		offset := (int(anchor.Weekday()) + 6) % 7 // Monday=0
		from := time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, -offset)
		to := from.AddDate(0, 0, 7)
		return from, to, from.Format("2006-01-02"), to.AddDate(0, 0, -1).Format("2006-01-02")
	case "month":
		from := time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, time.Local)
		to := from.AddDate(0, 1, 0)
		return from, to, from.Format("2006-01-02"), to.AddDate(0, 0, -1).Format("2006-01-02")
	default: // day
		from := time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.Local)
		to := from.AddDate(0, 0, 1)
		return from, to, from.Format("2006-01-02"), to.Format("2006-01-02")
	}
}

// ---------- 纯聚合（BuildHistory 式拆分，全部可单测） ----------

// BuildSummary 把段聚合为堆叠数据。segs 需已按 start 排序（SQL 保证）。
func BuildSummary(segs []Segment, rules []CategoryRule, scope string, from, to time.Time) Summary {
	fromU, toU := from.Unix(), to.Unix()
	// to 是排他边界（次日零点）；展示用含当天：统一往前推一天
	sum := Summary{Scope: scope, From: from.Format("2006-01-02"), To: to.AddDate(0, 0, -1).Format("2006-01-02")}

	bucketKeys := bucketKeysFor(scope, from, to)
	bucketIdx := map[string]int{}
	for i, k := range bucketKeys {
		bucketIdx[k] = i
		sum.Buckets = append(sum.Buckets, Bucket{Key: k, Secs: map[string]int64{}})
	}
	catSecs := map[string]int64{}
	catInfo := map[string]CategoryTotal{}

	for _, g := range segs {
		g = g.clip(fromU, toU)
		dur := g.Dur()
		if dur <= 0 {
			continue
		}
		_, cat := Classify(g.App, g.Title, rules)
		sum.TotalSec += dur
		catSecs[cat] += dur
		if _, ok := catInfo[cat]; !ok {
			p, c := Classify(g.App, g.Title, rules)
			catInfo[cat] = CategoryTotal{Category: c, Parent: p}
		}
		// 跨桶的段按桶切：对 day 是小时、week/month 是天。
		// 从段的起点逐桶推进，起点桶按段起点偏移。
		cur := g.Start
		for cur < g.End {
			bk := bucketKeyAt(scope, time.Unix(cur, 0))
			idx, ok := bucketIdx[bk]
			if !ok {
				// 段落在了范围外的桶（时钟微调等异常）：跳到下一个桶边界
				cur = nextBucketStart(scope, time.Unix(cur, 0)).Unix()
				if cur <= g.Start { // 防御：推进失败就退出，避免死循环
					break
				}
				continue
			}
			bEnd := nextBucketStart(scope, time.Unix(cur, 0)).Unix()
			end := g.End
			if bEnd < end {
				end = bEnd
			}
			if end > cur {
				sum.Buckets[idx].Secs[cat] += end - cur
				cur = end
			} else {
				break
			}
		}
	}

	for cat, secs := range catSecs {
		ct := catInfo[cat]
		ct.Secs = secs
		sum.Categories = append(sum.Categories, ct)
	}
	sort.Slice(sum.Categories, func(i, j int) bool {
		if sum.Categories[i].Secs == sum.Categories[j].Secs {
			return sum.Categories[i].Category < sum.Categories[j].Category
		}
		return sum.Categories[i].Secs > sum.Categories[j].Secs
	})
	return sum
}

// BuildRank 把段聚合为应用排行与分类排行。
func BuildRank(segs []Segment, rules []CategoryRule, scope string, from, to time.Time, limit int) Rank {
	fromU, toU := from.Unix(), to.Unix()
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	// to 是排他边界；展示用含当天（与 BuildSummary 一致）
	r := Rank{Scope: scope, From: from.Format("2006-01-02"), To: to.AddDate(0, 0, -1).Format("2006-01-02")}
	appSecs := map[string]int64{}
	catSecs := map[string]int64{}
	catInfo := map[string]CategoryTotal{}

	for _, g := range segs {
		g = g.clip(fromU, toU)
		dur := g.Dur()
		if dur <= 0 {
			continue
		}
		p, c := Classify(g.App, g.Title, rules)
		r.TotalSec += dur
		appSecs[g.App] += dur
		catSecs[c] += dur
		catInfo[c] = CategoryTotal{Category: c, Parent: p}
	}
	for app, secs := range appSecs {
		_, cat := Classify(app, "", rules)
		var p string
		for _, ct := range catInfo {
			if ct.Category == cat {
				p = ct.Parent
				break
			}
		}
		// 应用名可能是空的（取不到映像名）：归一为「未知」，否则前端排序渲染难看
		name := app
		if name == "" {
			name = "未知"
		}
		r.Apps = append(r.Apps, AppRank{App: name, Category: cat, Parent: p, Secs: secs})
	}
	for cat, secs := range catSecs {
		ct := catInfo[cat]
		ct.Secs = secs
		r.Categories = append(r.Categories, ct)
	}
	sort.Slice(r.Apps, func(i, j int) bool {
		if r.Apps[i].Secs == r.Apps[j].Secs {
			return r.Apps[i].App < r.Apps[j].App
		}
		return r.Apps[i].Secs > r.Apps[j].Secs
	})
	if len(r.Apps) > limit {
		r.Apps = r.Apps[:limit]
	}
	sort.Slice(r.Categories, func(i, j int) bool {
		if r.Categories[i].Secs == r.Categories[j].Secs {
			return r.Categories[i].Category < r.Categories[j].Category
		}
		return r.Categories[i].Secs > r.Categories[j].Secs
	})
	return r
}

// BuildAppDetail 单应用下钻：小时分布 + 按窗口标题分组。
func BuildAppDetail(segs []Segment, rules []CategoryRule, appName string, from, to time.Time) AppDetail {
	fromU, toU := from.Unix(), to.Unix()
	d := AppDetail{App: appName, Date: from.Format("2006-01-02")}
	hours := make([]int64, 24)
	titleSecs := map[string]int64{}

	for _, g := range segs {
		if normalizeApp(g.App) != normalizeApp(appName) {
			continue
		}
		g = g.clip(fromU, toU)
		dur := g.Dur()
		if dur <= 0 {
			continue
		}
		d.TotalSec += dur
		title := g.Title
		if title == "" {
			title = "（无标题）"
		}
		titleSecs[title] += dur

		// 逐小时切分（跨小时的段按小时边界切开）
		cur := g.Start
		for cur < g.End {
			t := time.Unix(cur, 0)
			hEnd := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, t.Location()).Add(time.Hour).Unix()
			end := g.End
			if hEnd < end {
				end = hEnd
			}
			if end > cur {
				hours[t.Hour()] += end - cur
				cur = end
			} else {
				break
			}
		}
	}
	p, c := Classify(appName, "", rules)
	d.Parent, d.Category = p, c
	for h, secs := range hours {
		if secs == 0 {
			continue // 空小时不输出：图表从缺省就是 0，少几百个空对象
		}
		d.Hours = append(d.Hours, HourSec{Hour: fmtHour(h), Secs: secs})
	}
	sort.Slice(d.Hours, func(i, j int) bool { return d.Hours[i].Hour < d.Hours[j].Hour })
	for t, secs := range titleSecs {
		d.ByTitle = append(d.ByTitle, TitleRank{Title: t, Secs: secs})
	}
	sort.Slice(d.ByTitle, func(i, j int) bool {
		if d.ByTitle[i].Secs == d.ByTitle[j].Secs {
			return d.ByTitle[i].Title < d.ByTitle[j].Title
		}
		return d.ByTitle[i].Secs > d.ByTitle[j].Secs
	})
	if len(d.ByTitle) > 50 {
		d.ByTitle = d.ByTitle[:50]
	}
	return d
}

// ---------- 桶工具 ----------

func bucketKeysFor(scope string, from, to time.Time) []string {
	var keys []string
	switch scope {
	case "day":
		for h := 0; h < 24; h++ {
			keys = append(keys, fmtHour(h))
		}
	default:
		for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
			keys = append(keys, d.Format("2006-01-02"))
		}
	}
	return keys
}

func bucketKeyAt(scope string, t time.Time) string {
	if scope == "day" {
		return fmtHour(t.Hour())
	}
	return t.Format("2006-01-02")
}

func nextBucketStart(scope string, t time.Time) time.Time {
	if scope == "day" {
		return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, t.Location()).Add(time.Hour)
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location()).AddDate(0, 0, 1)
}

func fmtHour(h int) string {
	return string([]byte{'0' + byte(h/10), '0' + byte(h%10)})
}
