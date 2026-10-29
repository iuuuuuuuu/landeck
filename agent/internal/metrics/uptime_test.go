package metrics

import (
	"testing"
	"time"
)

func t2(s string) time.Time {
	tt, err := time.ParseInLocation("2006-01-02 15:04:05", s, time.Local)
	if err != nil {
		panic(err)
	}
	return tt
}

// 6008 消息解析：这是「关机时刻」唯一的精确来源，解析错就等于没修。
// 用真实机器上抓到的中英文原文，包含中文里夹的不可见方向控制符。
func TestParseUnexpectedShutdownTime(t *testing.T) {
	cases := []struct {
		name    string
		msg     string
		eventAt string
		want    string
		ok      bool
	}{
		{
			name:    "中文（含 U+200E 方向控制符）",
			msg:     "上一次系统的 9:26:54 在 \u200e2026/\u200e8/\u200e23 上的关闭是意外的。",
			eventAt: "2026-08-23 10:15:10",
			want:    "2026-08-23 09:26:54",
			ok:      true,
		},
		{
			name:    "中文下午时间",
			msg:     "上一次系统的 15:53:59 在 \u200e2026/\u200e10/\u200e17 上的关闭是意外的。",
			eventAt: "2026-10-17 15:58:07",
			want:    "2026-10-17 15:53:59",
			ok:      true,
		},
		{
			name:    "英文带 AM/PM",
			msg:     "The previous system shutdown at 9:26:54 AM on 8/23/2026 was unexpected.",
			eventAt: "2026-08-23 10:15:10",
			want:    "2026-08-23 09:26:54",
			ok:      true,
		},
		{
			name:    "英文 PM",
			msg:     "The previous system shutdown at 3:05:00 PM on 10/17/2026 was unexpected.",
			eventAt: "2026-10-17 15:10:00",
			want:    "2026-10-17 15:05:00",
			ok:      true,
		},
		{
			name:    "跨零点：关机在前一天",
			msg:     "上一次系统的 23:50:00 在 2026/8/22 上的关闭是意外的。",
			eventAt: "2026-08-23 10:15:10",
			want:    "2026-08-22 23:50:00",
			ok:      true,
		},
		{
			name:    "空消息",
			msg:     "",
			eventAt: "2026-08-23 10:15:10",
			ok:      false,
		},
		{
			name:    "没有时间",
			msg:     "系统已在未先正常关机的情况下重新启动。",
			eventAt: "2026-08-23 10:15:10",
			ok:      false,
		},
	}

	for _, c := range cases {
		eventAt := t2(c.eventAt)
		got, ok := parseUnexpectedShutdownTime(c.msg, eventAt)
		if ok != c.ok {
			t.Fatalf("%s: ok=%v want %v", c.name, ok, c.ok)
		}
		if !c.ok {
			continue
		}
		if got.Format("2006-01-02 15:04:05") != c.want {
			t.Fatalf("%s: got %s want %s", c.name, got.Format("2006-01-02 15:04:05"), c.want)
		}
	}
}

// 核心回归：缺少 6006 时，不能把「关机期间」整段算成开机。
//
// 三组数据都来自真实机器：
//  1. 只有 6008 —— 消息里给出了真实关机时刻，必须据此截断；
//  2. 只有 1074 —— 用户发起了关机，按请求时刻截断（比算到下次开机准确得多）；
//  3. 完全没有任何结束标记 —— 只能保守地算到下次开机（记录这个已知边界）。
func TestBuildHistory_UnpairedBootDoesNotCountOffTime(t *testing.T) {
	now := t2("2026-09-27 12:00:00")

	events := []RawEvent{
		// 前置：09-23 正常开关机（保证上一段是闭合的，不影响下面的断言）
		{At: t2("2026-09-23 09:00:00"), Kind: "boot"},
		{At: t2("2026-09-23 18:00:00"), Kind: "shutdown"},

		// 1) 09-24：开机 15:02，15:30 用户发起关机，直到 09-26 20:17 才再开机。
		//    修复前：因为没有 6006，会把 09-24 15:02 → 09-26 20:17 全算成开机
		//    （53 小时，09-25 显示满 24 小时）。
		{At: t2("2026-09-24 15:02:00"), Kind: "boot"},
		{At: t2("2026-09-24 15:30:00"), Kind: "shutdown-req"},
		{At: t2("2026-09-26 20:17:22"), Kind: "unexpected"},
		{At: t2("2026-09-26 20:17:30"), Kind: "boot"},
	}

	h := BuildHistory(events, now, 7)
	byDate := map[string]int64{}
	for _, d := range h.Days {
		byDate[d.Date] = d.OnSec
	}

	// 09-24 只应算 15:02→15:30（约 1680s）
	if got := byDate["2026-09-24"]; got > 3600 {
		t.Fatalf("2026-09-24 开机时长 %ds 偏大：1074 没有被用作结束标记（应在 ~1680s）", got)
	}
	if got := byDate["2026-09-24"]; got < 1600 {
		t.Fatalf("2026-09-24 开机时长 %ds 偏小：15:02→15:30 这段应被计入", got)
	}

	// 09-25 机器整天关着，必须为 0（修复前会被算成满 24 小时）
	if got := byDate["2026-09-25"]; got != 0 {
		t.Fatalf("2026-09-25 应为 0s（当天关机），实际 %ds", got)
	}
}

// 回归：6008 解析出的真实关机时刻，优先级高于 41/1074。
func TestBuildHistory_6008TimeCapsSession(t *testing.T) {
	now := t2("2026-08-24 12:00:00")
	events := []RawEvent{
		// 08-23：开机 09:26:30，6008 解析出关机在 09:26:54，10:15 再次开机
		{At: t2("2026-08-23 09:26:30"), Kind: "boot"},
		{At: t2("2026-08-23 09:26:54"), Kind: "shutdown"},
		{At: t2("2026-08-23 10:15:04"), Kind: "unexpected"},
		{At: t2("2026-08-23 10:15:10"), Kind: "boot"},
	}
	h := BuildHistory(events, now, 7)
	var got int64
	for _, d := range h.Days {
		if d.Date == "2026-08-23" {
			got = d.OnSec
		}
	}
	// 09:26:30→09:26:54 = 24s，加上 10:15:10→now 那段中落在 08-23 的部分
	dayEnd := t2("2026-08-24 00:00:00")
	second := int64(dayEnd.Sub(t2("2026-08-23 10:15:10")).Seconds())
	want := 24 + second
	if got != want {
		t.Fatalf("2026-08-23 应为 %ds，实际 %ds（6008 的关机时刻没被采用）", want, got)
	}
}

// 回归：正常关机场景不能被改坏（6006 仍然精确）。
func TestBuildHistory_CleanShutdownUnchanged(t *testing.T) {
	now := t2("2026-10-29 12:00:00")
	events := []RawEvent{
		{At: t2("2026-10-28 09:00:00"), Kind: "boot"},
		{At: t2("2026-10-28 18:00:00"), Kind: "shutdown"},
	}
	h := BuildHistory(events, now, 7)
	var got int64
	for _, d := range h.Days {
		if d.Date == "2026-10-28" {
			got = d.OnSec
		}
	}
	if want := int64(9 * 3600); got != want {
		t.Fatalf("2026-10-28 应为 %ds，实际 %ds", want, got)
	}
}

// 回归：totals 的四个字段都必须限定在 7 天窗口。
// 修复前 longest/avg 拿全部历史算，把几个月前的一次长开机报成「最近一周最长」。
func TestBuildHistory_TotalsScopedToWindow(t *testing.T) {
	now := t2("2026-10-29 12:00:00")
	events := []RawEvent{
		// 很久以前的一次 10 天连开（远超 7 天窗口）
		{At: t2("2026-06-01 00:00:00"), Kind: "boot"},
		{At: t2("2026-06-11 00:00:00"), Kind: "shutdown"},
		// 窗口内的一次 2 小时
		{At: t2("2026-10-28 10:00:00"), Kind: "boot"},
		{At: t2("2026-10-28 12:00:00"), Kind: "shutdown"},
	}
	h := BuildHistory(events, now, 7)

	const tenDays = 10 * 24 * 3600
	if h.Totals.LongestSec >= tenDays {
		t.Fatalf("longestSec=%d 把窗口外的 10 天长开机算进来了（应只看 7 天内）", h.Totals.LongestSec)
	}
	if want := int64(2 * 3600); h.Totals.LongestSec != want {
		t.Fatalf("longestSec=%d，期望 %d（窗口内最长一次 2 小时）", h.Totals.LongestSec, want)
	}
	if h.Totals.AvgUptimeSec >= tenDays {
		t.Fatalf("avgUptimeSec=%d 明显超出窗口范围", h.Totals.AvgUptimeSec)
	}
	if h.Totals.Boots7d != 1 {
		t.Fatalf("boots7d=%d，期望 1（窗口内只开过 1 次机）", h.Totals.Boots7d)
	}
}
