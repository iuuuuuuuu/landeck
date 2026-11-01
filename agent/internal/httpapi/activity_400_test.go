package httpapi

import (
	"net/http/httptest"
	"testing"

	"landeck/internal/activity"
)

// 400 路径测试（七期追加任务的核心验收）：未知 scope 必须显式 400，
// 静默假 200 是全部历史页渲染垃圾数据的事故根源。
// handler 只依赖 activity 包级状态（未启动 → 内存空响应），
// 零值 Server 即可直调，无需构造完整依赖。
func TestActivitySummaryUnknownScope400(t *testing.T) {
	// 注意：scope=year 现在是合法的（本期实现）——未知 scope 用 "hour"
	// date 校验发生在 rangeOf（mgr 启动后才会走到），所以这里也要 Start
	st := activity.Start(t.TempDir())
	t.Cleanup(activity.Stop)
	_ = st

	s := &Server{}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/v1/activity/summary?scope=hour&date=2026", nil)
	s.handleActivitySummary(w, r, nil)
	if w.Code != 400 {
		t.Fatalf("未知 scope 应 400，得到 %d: %s", w.Code, w.Body.String())
	}
}

func TestActivityRankUnknownScope400(t *testing.T) {
	s := &Server{}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/v1/activity/rank?scope=nonsense", nil)
	s.handleActivityRank(w, r, nil)
	if w.Code != 400 {
		t.Fatalf("未知 scope 应 400，得到 %d: %s", w.Code, w.Body.String())
	}
}

// date 格式与 scope 不符同样 400（day 锚点给了 YYYY-MM）
func TestActivitySummaryBadDate400(t *testing.T) {
	st := activity.Start(t.TempDir())
	t.Cleanup(activity.Stop)
	_ = st

	s := &Server{}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/v1/activity/summary?scope=day&date=2026-10", nil)
	s.handleActivitySummary(w, r, nil)
	if w.Code != 400 {
		t.Fatalf("date 格式不符应 400，得到 %d: %s", w.Code, w.Body.String())
	}
}
