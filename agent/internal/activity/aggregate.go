package activity

import (
	"errors"
	"fmt"
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

// TitleGroup 应用详情里按「窗口标题/网站域名」混合分组的行，按时长降序。
//
// 字段名 groups 对齐前端契约（activity-pages）；域名采集未实现前，
// 组键就是窗口标题——浏览器场景下标题通常已带站点信息，语义足够接近。
type TitleGroup struct {
	Title string `json:"title"`
	Secs  int64  `json:"secs"`
}

// AppDetail 单应用详情响应。
type AppDetail struct {
	App      string       `json:"app"`
	Category string       `json:"category"`
	Parent   string       `json:"parent"`
	Date     string       `json:"date"`
	TotalSec int64        `json:"totalSec"`
	Hours    []HourSec    `json:"hours"`
	Groups   []TitleGroup `json:"groups"`
}

// ---------- 范围计算 ----------

// rangeOf scope+锚点日期 → [from, to) 本地时刻。
// week 采用 ISO 周（周一起始），month 为自然月。
// ErrBadScope summary/rank 的 scope 或 date 参数非法。
// httpapi 层映射为 400——静默假响应是集成事故的根源
// （前端形状校验被假 200 骗过两轮验收）。
var ErrBadScope = errors.New("bad scope or date")

// rangeOf scope+锚点日期 → [from, to) 本地时刻。
// week 采用 ISO 周（周一起始），month 为自然月，year 为自然年。
//
// 错误语义（对齐「拒绝静默假响应」的契约）：scope 未知、date 与 scope 的
// 格式不符 → 返回 ErrBadScope，调用方必须回 400，而不是悄悄按「一天」算。
//
// 本函数区域整体重写过一次：该文件的旧注释含 GBK mojibake 字节
// （历史写入事故），任何依赖注释文本做锚点的编辑都会失败——
// 编辑一律用 ASCII 函数锚点做区域替换。
func rangeOf(scope, date string, now time.Time) (from, to time.Time, fromS, toS string, err error) {
	anchor := now
	if date != "" {
		// 各 scope 的锚点格式：day/week="YYYY-MM-DD"、month="YYYY-MM"、year="YYYY"
		// 格式不符 -> 显式报错（静默回退到今天是假 200 事故的根源）
		switch scope {
		case "year":
			if d, e := time.ParseInLocation("2006", date, time.Local); e == nil {
				anchor = d
			} else {
				err = fmt.Errorf("%w: year anchor must be YYYY, got %q", ErrBadScope, date)
				return
			}
		case "month":
			if d, e := time.ParseInLocation("2006-01", date, time.Local); e == nil {
				anchor = d
			} else if d, e := time.ParseInLocation("2006-01-02", date, time.Local); e == nil {
				anchor = d
			} else {
				err = fmt.Errorf("%w: month anchor must be YYYY-MM, got %q", ErrBadScope, date)
				return
			}
		default:
			if d, e := time.ParseInLocation("2006-01-02", date, time.Local); e == nil {
				anchor = d
			} else {
				err = fmt.Errorf("%w: %s anchor must be YYYY-MM-DD, got %q", ErrBadScope, scope, date)
				return
			}
		}
	}
	switch scope {
	case "year":
		from = time.Date(anchor.Year(), 1, 1, 0, 0, 0, 0, time.Local)
		to = from.AddDate(1, 0, 0)
	case "week":
		offset := (int(anchor.Weekday()) + 6) % 7
		from = time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, -offset)
		to = from.AddDate(0, 0, 7)
	case "month":
		from = time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, time.Local)
		to = from.AddDate(0, 1, 0)
	case "day":
		from = time.Date(anchor.Year(), anchor.Month(), anchor.Day(), 0, 0, 0, 0, time.Local)
		to = from.AddDate(0, 0, 1)
	default:
		err = fmt.Errorf("%w: 未知 scope %q", ErrBadScope, scope)
		return
	}
	return from, to, from.Format("2006-01-02"), to.AddDate(0, 0, -1).Format("2006-01-02"), nil
}

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
		d.Groups = append(d.Groups, TitleGroup{Title: t, Secs: secs})
	}
	sort.Slice(d.Groups, func(i, j int) bool {
		if d.Groups[i].Secs == d.Groups[j].Secs {
			return d.Groups[i].Title < d.Groups[j].Title
		}
		return d.Groups[i].Secs > d.Groups[j].Secs
	})
	if len(d.Groups) > 50 {
		d.Groups = d.Groups[:50]
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
