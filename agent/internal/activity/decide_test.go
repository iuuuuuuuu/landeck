package activity

import (
	"testing"
	"time"
)

func st(enabled bool) Settings {
	s := DefaultSettings()
	s.Enabled = enabled
	s.PrivateRules = []PrivacyRule{{ID: "p1", Kind: "app", Pattern: "keepass"}}
	return s
}

func sampleAt(s string, idle int, app, title string) tickCtx {
	return tickCtx{
		Settings:   st(true),
		Now:        dayAt(s),
		Supported:  true,
		HaveSample: true,
		Sample:     Sample{App: app, Title: title, IdleSec: idle},
	}
}

func TestDecideDisabled(t *testing.T) {
	ctx := sampleAt("2026-10-31 10:00:00", 0, "chrome", "x")
	ctx.Settings.Enabled = false
	res := decide(ctx, &openSegment{App: "chrome", Title: "x", Start: 1, End: 2})
	if res.State != "stopped" || !res.Flush {
		t.Fatalf("总开关关闭应 stopped+Flush，得到 %+v", res)
	}
	// 无进行中段时不该谎报 Flush
	res2 := decide(ctx, nil)
	if res2.Flush {
		t.Fatal("无段时 Flush 应为 false")
	}
}

func TestDecideUnsupported(t *testing.T) {
	ctx := sampleAt("2026-10-31 10:00:00", 0, "chrome", "x")
	ctx.Supported = false
	res := decide(ctx, nil)
	if res.State != "unsupported" {
		t.Fatalf("不支持平台应 unsupported，得到 %+v", res)
	}
}

func TestDecideResting(t *testing.T) {
	ctx := sampleAt("2026-10-31 20:00:00", 0, "chrome", "x") // 20:00 不在 09-18
	ctx.Settings.WorkHoursEnabled = true
	res := decide(ctx, &openSegment{App: "chrome", Title: "x", Start: 1, End: 2})
	if res.State != "resting" || !res.Flush {
		t.Fatalf("工作时段外应 resting+Flush，得到 %+v", res)
	}
}

func TestDecideIdle(t *testing.T) {
	// 闲置 4 分钟 >= 阈值 3 分钟 → idle + Flush
	ctx := sampleAt("2026-10-31 10:00:00", 240, "chrome", "x")
	res := decide(ctx, &openSegment{App: "chrome", Title: "x", Start: 1, End: 2})
	if res.State != "idle" || !res.Flush {
		t.Fatalf("闲置应 idle+Flush，得到 %+v", res)
	}
	// 闲置 1 分钟 → 正常采集
	ctx2 := sampleAt("2026-10-31 10:00:00", 60, "chrome", "x")
	res2 := decide(ctx2, nil)
	if res2.State != "collecting" {
		t.Fatalf("未闲置应 collecting，得到 %+v", res2)
	}
}

func TestDecidePrivate(t *testing.T) {
	ctx := sampleAt("2026-10-31 10:00:00", 0, "KeepAss.exe", "密码库")
	res := decide(ctx, &openSegment{App: "chrome", Title: "x", Start: 1, End: 2})
	if res.State != "collecting" || !res.Flush || res.Skip != "private" {
		t.Fatalf("隐私命中应丢弃当前段且状态仍是 collecting，得到 %+v", res)
	}
	// 不开新段：被隐藏的采样不留任何痕迹
	if res.New != nil {
		t.Fatal("隐私命中不应开新段")
	}
}

func TestDecideNoForeground(t *testing.T) {
	ctx := sampleAt("2026-10-31 10:00:00", 0, "chrome", "x")
	ctx.HaveSample = false // 锁屏/UAC
	res := decide(ctx, &openSegment{App: "chrome", Title: "x", Start: 1, End: 2})
	if res.State != "collecting" || !res.Flush {
		t.Fatalf("无前台窗口应按离开处理（Flush），得到 %+v", res)
	}
}

func TestDecideKeepAndSwitch(t *testing.T) {
	at := dayAt("2026-10-31 10:00:00")
	// 同应用同标题 → Keep，且 New 的 End 推进到 now
	ctx := sampleAt("2026-10-31 10:00:00", 0, "chrome.exe", "新闻")
	cur := &openSegment{Start: at.Add(-30 * time.Second).Unix(), End: at.Add(-30 * time.Second).Unix(), App: "chrome", Title: "新闻"}
	res := decide(ctx, cur)
	if !res.Keep || res.Flush || res.New == nil {
		t.Fatalf("同应用应 Keep，得到 %+v", res)
	}
	if res.New.End != at.Unix() {
		t.Fatalf("End 应推进到 now，得到 %d", res.New.End)
	}
	if res.New.ID != cur.ID {
		t.Fatal("延续段必须保留 ID（否则会插出新行）")
	}
	// 应用切换 → Flush 旧段 + 开新段
	ctx2 := sampleAt("2026-10-31 10:00:00", 0, "Code", "main.go")
	res2 := decide(ctx2, cur)
	if !res2.Flush || res2.New == nil || res2.New.App != "code" {
		t.Fatalf("应用切换应 Flush+新段，得到 %+v", res2)
	}
	// 标题变化（同应用）也算切换（浏览器跳页要分开统计）
	ctx3 := sampleAt("2026-10-31 10:00:00", 0, "chrome", "另一页")
	res3 := decide(ctx3, cur)
	if !res3.Flush || res3.New == nil || res3.New.Title != "另一页" {
		t.Fatalf("标题变化应切段，得到 %+v", res3)
	}
}
