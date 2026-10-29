package metrics

import (
	"sort"
	"sync"
	"time"
)

// RawEvent 一条开关机线索。
//
// Kind 的取值与可信度强相关（见 endRank）：
//
//	boot          开机（Windows 6005 事件日志启动 / 其它平台 last reboot）
//	shutdown      关机的**确定**时刻（Windows 6006 事件日志停止；
//	              或 6008「非正常关机」消息里写明的真实关机时间）
//	unexpected    已知发生过异常关机，但时刻不明（Kernel-Power 41）。
//	              它的事件时间约等于**下次开机**，拿它当结束点等于没截断，
//	              所以只能作为「这段不是正常关机结束」的证据，排在最后
//	shutdown-req  用户发起关机/重启（1074）。只是请求（可能被取消），
//	              时间比真正断电早几秒到几分钟，但**时刻可用**，优先于 41
//
// 为什么要分级：Windows 上并非每次关机都会留下 6006（断电、蓝屏、强按电源键都没有）。
// 只认 boot/shutdown 两级时，一段「开机 → 意外断电 → 再次开机」会被当成
// 一直在线，把整段关机时间算成开机时长 —— 实测某机器 27 次开机没有配对关机，
// 最长一次虚增 61.9 小时，用户看到的就是「两天多没关机」。
type RawEvent struct {
	At   time.Time
	Kind string // boot | shutdown | unexpected | shutdown-req
}

// endRank 给「结束标记」的可信度打分，数值越大越可信。
// 配对时同一段区间内取分数最高的那个作为这段开机的结束时刻。
//
// 排序依据是**这个标记给出的时刻能不能用**，而不只是「确定结束过」：
//
//	shutdown(3)      6006 / 6008 消息里的真实时间 —— 精确
//	shutdown-req(2)  1074 —— 比真正断电早几秒到几分钟，可用
//	unexpected(1)    41 —— 时间约等于**下次开机**，拿它当结束点等于没截断，
//	                 所以只能排在最后；它的价值只是「证明这段不是正常关机结束」
//
// 反例（实测）：若把 41 排到 1074 前面，一段「开机 → 用户关机 → 两天后才开机」
// 会被 41（时间在下次开机）判成连续两天在线，等于没修。
func endRank(kind string) int {
	switch kind {
	case "shutdown":
		return 3
	case "shutdown-req":
		return 2
	case "unexpected":
		return 1
	}
	return 0
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
	Days   []UptimeDay   `json:"days"`
	Months []UptimeMonth `json:"months"`
	Boots  []BootEntry   `json:"boots"`
	Totals UptimeTotals  `json:"totals"`
}

// UptimeMonth 按月聚合的开机统计。
// 用户要求「开机统计按照月统计，不要只统计一周的」——按天铺 90 天太碎，
// 按月给总量才看得出趋势。
type UptimeMonth struct {
	// Month 形如 2026-10
	Month string `json:"month"`
	// OnSec 当月累计开机秒数（跨月的会话按天切分后累加）
	OnSec int64 `json:"onSec"`
	// Boots 当月开机次数
	Boots int `json:"boots"`
	// AvgUptimeSec 当月平均单次开机时长
	AvgUptimeSec int64 `json:"avgUptimeSec"`
	// LongestSec 当月最长一次
	LongestSec int64 `json:"longestSec"`
}

var (
	upMu    sync.Mutex
	upCache *UptimeHistory
	upAt    time.Time
)

// CachedHistory 平台事件日志读取代价大（Get-WinEvent / last），缓存 3 分钟。
func CachedHistory(days int) UptimeHistory {
	if days <= 0 || days > 400 {
		days = 90
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

	// 把事件拆成「开机时刻」和「结束候选」，再按区间配对。
	//
	// 为什么不沿用「顺序扫描、遇到 shutdown 就收尾」的老写法：
	// 那种写法在缺少关机事件时只好拿「下一次开机」当收尾，
	// 于是把中间那段关机时间整段算成开机。实测某机器 27 次开机没有配对的
	// 关机事件（断电/蓝屏/强按电源都不会留下 6006），最长一次虚增 61.9 小时，
	// 用户看到的就是「关了机却显示两天多没关」。
	//
	// 现在改成：每一段开机都在「它自己」和「下一次开机」之间挑一个
	// 最可信的结束标记（6006 > 6008 消息里的真实时间 > 41 > 1074），
	// 用次一级证据把区间截断，而不是一路算到下次开机。
	var boots []time.Time
	type endCand struct {
		at   time.Time
		rank int
	}
	var ends []endCand
	for _, ev := range sorted {
		if ev.Kind == "boot" {
			boots = append(boots, ev.At)
			continue
		}
		if r := endRank(ev.Kind); r > 0 {
			ends = append(ends, endCand{at: ev.At, rank: r})
		}
	}

	for i, b := range boots {
		hasNext := i+1 < len(boots)
		var next time.Time
		if hasNext {
			next = boots[i+1]
		}

		bestRank := 0
		var best time.Time
		for _, e := range ends {
			if e.at.Before(b) {
				continue
			}
			if hasNext && !e.at.Before(next) {
				continue // 落在下一次开机之后，不属于这一段
			}
			if !hasNext && e.at.After(now) {
				continue
			}
			// 同分取更晚的那个：关机标记越晚，越接近真正断电的时刻
			if e.rank > bestRank || (e.rank == bestRank && e.at.After(best)) {
				bestRank, best = e.rank, e.at
			}
		}

		end := best
		if bestRank == 0 {
			// 这一段没有任何结束证据：
			//  - 还有下一次开机 → 仍用下次开机收尾（最保守，至少不会算到未来）
			//  - 没有下一次 → 这就是当前这次，收尾到 now
			if hasNext {
				end = next
			} else {
				end = now
			}
		}
		if end.Before(b) {
			end = b
		}
		if end.After(now) {
			end = now
		}
		sessions = append(sessions, session{start: b, end: end})
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

	// 按月聚合：最近 12 个月，按时间正序。
	// 跨月的会话要按天切开分别累加到各自月份，否则一个横跨月末的长开机
	// 会被整段算进某一个月，另一个月凭空为 0。
	{
		months := make([]UptimeMonth, 0, 12)
		byKey := map[string]*UptimeMonth{}
		order := make([]string, 0, 12)
		thisMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		for i := 11; i >= 0; i-- {
			m := thisMonth.AddDate(0, -i, 0)
			key := m.Format("2006-01")
			byKey[key] = &UptimeMonth{Month: key}
			order = append(order, key)
		}
		for _, se := range sessions {
			if se.end.Before(thisMonth.AddDate(0, -11, 0)) {
				continue
			}
			// 逐月切分这段会话
			cursor := se.start
			for !cursor.After(se.end) {
				monthStart := time.Date(cursor.Year(), cursor.Month(), 1, 0, 0, 0, 0, loc)
				monthEnd := monthStart.AddDate(0, 1, 0)
				segEnd := se.end
				if segEnd.After(monthEnd) {
					segEnd = monthEnd
				}
				segSec := int64(segEnd.Sub(cursor).Seconds())
				key := monthStart.Format("2006-01")
				if mm, ok := byKey[key]; ok {
					if segSec > 0 {
						mm.OnSec += segSec
						if segSec > mm.LongestSec {
							mm.LongestSec = segSec
						}
					}
					// 开机次数记在会话真正开始的那个月
					if se.start.Equal(cursor) || (se.start.After(monthStart) && se.start.Before(monthEnd)) {
						mm.Boots++
					}
				}
				if !segEnd.After(cursor) {
					break
				}
				cursor = segEnd
				if cursor.Equal(se.end) {
					break
				}
			}
		}
		for _, key := range order {
			mm := byKey[key]
			if mm.Boots > 0 {
				mm.AvgUptimeSec = mm.OnSec / int64(mm.Boots)
			}
			months = append(months, *mm)
		}
		out.Months = months
	}

	// 7 天总览。
	//
	// 注意：四个字段全部**限定在 7 天窗口内**。
	// 原来只有 onSec7d / boots7d 限了窗口，longest / avg 却是拿全部历史会话算的，
	// 结果「最长一次开机」会把几个月前的一次长开机报进来（实测报 4.79 天），
	// 而它和 onSec7d 并排展示，用户自然理解成「最近一周最久开了这么久」。
	weekAgo := now.AddDate(0, 0, -7)
	var on7, longest, sum int64
	var boots7 int
	active := 0
	for _, s := range sessions {
		if s.start.After(weekAgo) {
			boots7++
		}
		if !s.end.After(weekAgo) {
			continue // 整段都在窗口之前
		}
		from := s.start
		if from.Before(weekAgo) {
			from = weekAgo
		}
		to := s.end
		if to.After(now) {
			to = now
		}
		if !to.After(from) {
			continue
		}
		dur := int64(to.Sub(from).Seconds())
		on7 += dur
		sum += dur
		active++
		if dur > longest {
			longest = dur
		}
	}
	out.Totals = UptimeTotals{OnSec7d: on7, Boots7d: boots7, LongestSec: longest}
	if active > 0 {
		out.Totals.AvgUptimeSec = sum / int64(active)
	}
	return out
}
