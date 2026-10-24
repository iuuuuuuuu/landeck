package metrics

import (
	"sort"
	"sync"
	"time"
)

type RawEvent struct {
	At   time.Time
	Kind string // boot | shutdown
}

type UptimeDay struct {
	Date    string  `json:"date"`
	OnSec   int64   `json:"onSec"`
	Boots   int     `json:"boots"`
	FirstOn *string `json:"firstOn"`
	LastOff *string `json:"lastOff"`
}

type BootEntry struct {
	At        string `json:"at"`
	Kind      string `json:"kind"`
	UptimeSec int64  `json:"uptimeSec"`
}

type UptimeTotals struct {
	OnSec7d      int64 `json:"onSec7d"`
	Boots7d      int   `json:"boots7d"`
	AvgUptimeSec int64 `json:"avgUptimeSec"`
	LongestSec   int64 `json:"longestSec"`
}

type UptimeHistory struct {
	Days   []UptimeDay  `json:"days"`
	Boots  []BootEntry  `json:"boots"`
	Totals UptimeTotals `json:"totals"`
}

var (
	upMu    sync.Mutex
	upCache *UptimeHistory
	upAt    time.Time
)

// CachedHistory 平台事件日志读取代价大（Get-WinEvent / last），缓存 3 分钟。
func CachedHistory(days int) UptimeHistory {
	if days <= 0 || days > 90 {
		days = 14
	}
	upMu.Lock()
	if upCache != nil && time.Since(upAt) < 3*time.Minute && len(upCache.Days) == days {
		h := *upCache
		upMu.Unlock()
		return h
	}
	upMu.Unlock()

	events, err := collectBootEvents()
	if err != nil {
		events = []RawEvent{}
	}
	h := BuildHistory(events, time.Now(), days)
	upMu.Lock()
	upCache = &h
	upAt = time.Now()
	upMu.Unlock()
	return h
}

type session struct {
	start time.Time
	end   time.Time
}

// BuildHistory 把 boot/shutdown 事件摊成按天开机时长。纯函数，便于单测。
func BuildHistory(events []RawEvent, now time.Time, days int) UptimeHistory {
	sorted := append([]RawEvent(nil), events...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].At.Before(sorted[j].At) })

	sessions := make([]session, 0, len(sorted)/2+1)
	var cur *session
	for _, ev := range sorted {
		switch ev.Kind {
		case "boot":
			if cur != nil {
				cur.end = ev.At // 前一段没有关机记录，按下次开机收尾
				if cur.end.Before(cur.start) {
					cur.end = cur.start
				}
				sessions = append(sessions, *cur)
			}
			cur = &session{start: ev.At}
		case "shutdown":
			if cur != nil {
				if ev.At.After(cur.start) || ev.At.Equal(cur.start) {
					cur.end = ev.At
				} else {
					cur.end = cur.start
				}
				sessions = append(sessions, *cur)
				cur = nil
			}
		}
	}
	if cur != nil {
		cur.end = now
		if cur.end.Before(cur.start) {
			cur.end = cur.start
		}
		sessions = append(sessions, *cur)
	}

	out := UptimeHistory{
		Days:  make([]UptimeDay, 0, days),
		Boots: make([]BootEntry, 0, 32),
	}
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	for i := days - 1; i >= 0; i-- {
		dayStart := today.AddDate(0, 0, -i)
		dayEnd := dayStart.AddDate(0, 0, 1)
		d := UptimeDay{Date: dayStart.Format("2006-01-02")}
		for _, s := range sessions {
			if s.end.Before(dayStart) || s.start.After(dayEnd) {
				continue
			}
			from := s.start
			if from.Before(dayStart) {
				from = dayStart
			}
			to := s.end
			if to.After(dayEnd) {
				to = dayEnd
			}
			if to.After(from) {
				d.OnSec += int64(to.Sub(from).Seconds())
			}
			if s.start.After(dayStart) && s.start.Before(dayEnd) {
				d.Boots++
				label := s.start.Format("15:04")
				if d.FirstOn == nil {
					d.FirstOn = &label
				}
			}
			if s.end.After(dayStart) && s.end.Before(dayEnd) && d.Boots > 0 {
				label := s.end.Format("15:04")
				d.LastOff = &label
			}
		}
		out.Days = append(out.Days, d)
	}

	// 最近启动事件（倒序，最多 30 条）
	for i := len(sorted) - 1; i >= 0 && len(out.Boots) < 30; i-- {
		ev := sorted[i]
		if ev.Kind != "boot" {
			continue
		}
		var uptime int64
		for _, s := range sessions {
			if s.start.Equal(ev.At) {
				uptime = int64(s.end.Sub(s.start).Seconds())
				break
			}
		}
		out.Boots = append(out.Boots, BootEntry{
			At:        ev.At.Format(time.RFC3339),
			Kind:      ev.Kind,
			UptimeSec: uptime,
		})
	}

	// 7 天总览
	weekAgo := now.AddDate(0, 0, -7)
	var on7, longest, sum int64
	var boots7 int
	active := 0
	for _, s := range sessions {
		if s.end.After(weekAgo) {
			from := s.start
			if from.Before(weekAgo) {
				from = weekAgo
			}
			on7 += int64(s.end.Sub(from).Seconds())
		}
		if s.start.After(weekAgo) {
			boots7++
		}
		if dur := int64(s.end.Sub(s.start).Seconds()); dur > 0 {
			sum += dur
			active++
			if dur > longest {
				longest = dur
			}
		}
	}
	out.Totals = UptimeTotals{OnSec7d: on7, Boots7d: boots7, LongestSec: longest}
	if active > 0 {
		out.Totals.AvgUptimeSec = sum / int64(active)
	}
	return out
}
