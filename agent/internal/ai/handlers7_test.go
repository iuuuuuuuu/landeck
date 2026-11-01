package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 七期 handler 级测试：报告落盘、citations、autoSummary 配置。

// 配好 AI 并桩掉统计与 LLM（七期版：baseURL 注入假 provider）。
func setupAI7(t *testing.T) (srv *httptest.Server, llmReq func() []ChatMessage, dir string) {
	t.Helper()
	srv = newTestServer(t)
	origSum, origRank := actSummary, actRank
	actSummary = func(scope, date string) (any, error) {
		return fixtureSummary(), nil // totalSec=9h，dataPresent=true
	}
	actRank = func(scope string, limit int, date string) (any, error) { return fixtureRank(), nil }
	t.Cleanup(func() { actSummary, actRank = origSum, origRank })

	var last []ChatMessage
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []ChatMessage `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		last = req.Messages
		content := "# 报告\n内容"
		// summary 与 chat 的响应由调用方通过 header 区分（测试桩的便利约定）
		if r.Header.Get("X-Test-Kind") == "chat" {
			content = "周二编程 3 小时[cite:2026-10-27]。范围内另有一天[cite:2026-10-20]。"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": content}}},
		})
	}))
	t.Cleanup(llm.Close)
	llmReq = func() []ChatMessage { return last }

	_, _ = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"provider": "openai", "model": "gpt-4o-mini", "enabled": true, "apiKey": "sk-x",
		"baseURL": llm.URL,
	})
	_ = dir
	return srv, llmReq, ""
}

// POST /ai/summary 生成成功 → 报告落盘 + saved 元数据 + 列表/正文端点可用。
func TestSummaryArchivesReport(t *testing.T) {
	srv, _, _ := setupAI7(t)

	code, out := doJSON(t, srv, "POST", "/api/v1/ai/summary", map[string]any{"scope": "day"})
	if code != 200 {
		t.Fatalf("code=%d out=%v", code, out)
	}
	saved, ok := out["saved"].(map[string]any)
	if !ok {
		t.Fatalf("响应缺 saved（落盘失败）: %v", out)
	}
	if saved["id"] != "day-"+time.Now().Format("2006-01-02") {
		t.Fatalf("saved.id 不对: %v", saved["id"])
	}

	// 列表可见
	code, out = doJSON(t, srv, "GET", "/api/v1/ai/reports?limit=30", nil)
	if code != 200 {
		t.Fatalf("reports code=%d", code)
	}
	items, _ := out["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("报告列表应 1 条: %v", out)
	}
	id, _ := items[0].(map[string]any)["id"].(string)

	// 正文端点
	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/ai/reports/content?id="+id, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("content code=%d", resp.StatusCode)
	}
	buf := make([]byte, 256)
	n, _ := resp.Body.Read(buf)
	if !strings.Contains(string(buf[:n]), "# 报告") {
		t.Fatalf("正文不对: %q", string(buf[:n]))
	}
}

// 重复生成（手动）= 覆盖语义：报告正文被替换，列表仍 1 条。
func TestSummaryRegenerateOverwrites(t *testing.T) {
	srv, _, _ := setupAI7(t)
	_, _ = doJSON(t, srv, "POST", "/api/v1/ai/summary", map[string]any{"scope": "day"})
	_, _ = doJSON(t, srv, "POST", "/api/v1/ai/summary", map[string]any{"scope": "day"})

	_, out := doJSON(t, srv, "GET", "/api/v1/ai/reports?limit=30", nil)
	items, _ := out["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("重复生成不应产生两条: %d", len(items))
	}
}

// month scope：契约未定义报告文件，不落盘（响应无 saved）。
func TestSummaryMonthNotArchived(t *testing.T) {
	srv, _, _ := setupAI7(t)
	code, out := doJSON(t, srv, "POST", "/api/v1/ai/summary", map[string]any{"scope": "month"})
	if code != 200 {
		t.Fatalf("code=%d", code)
	}
	if _, ok := out["saved"]; ok {
		t.Fatalf("month 不应落盘: %v", out)
	}
}

// chat：LLM 输出带 [cite:...] → content 剥标记 + citations 组装（范围外日期被滤掉）。
func TestChatCitationsEndToEnd(t *testing.T) {
	srv, _, _ := setupAI7(t)
	// 覆盖 baseURL 指向本测试专用的假 LLM（带标记的响应），
	// 不复用 setupAI7 的桩——它的响应形状是给 summary 用的。
	origSum, origRank := actSummary, actRank
	actSummary = func(scope, date string) (any, error) { return fixtureSummary(), nil }
	actRank = func(scope string, limit int, date string) (any, error) { return fixtureRank(), nil }
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "今天编程 3 小时[cite:2026-10-31]。范围外的幻觉日期[cite:2026-10-20]。"}}},
		})
	}))
	t.Cleanup(func() { actSummary, actRank = origSum, origRank; llm.Close() })
	_, _ = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"provider": "openai", "model": "m", "enabled": true, "apiKey": "k", "baseURL": llm.URL,
	})

	code, out := doJSON(t, srv, "POST", "/api/v1/ai/chat", map[string]any{
		"messages": []map[string]any{{"role": "user", "content": "最近怎么样"}},
	})
	if code != 200 {
		t.Fatalf("code=%d out=%v", code, out)
	}
	content, _ := out["content"].(string)
	if strings.Contains(content, "[cite:") {
		t.Fatalf("content 残留标记: %q", content)
	}
	cites, ok := out["citations"].([]any)
	if !ok || len(cites) != 1 {
		t.Fatalf("citations 应 1 条（范围外的被滤掉）: %v", out)
	}
	first, _ := cites[0].(map[string]any)
	if first["route"] != "#/activity/daily?date=2026-10-31" {
		t.Fatalf("route 不对: %v", first)
	}
	if first["label"] != "10月31日日报" {
		t.Fatalf("label 不对: %v", first)
	}
}

// LLM 没输出标记 → citations 字段省略（向后兼容）。
func TestChatNoCitationsField(t *testing.T) {
	srv := newTestServer(t)
	origSum, origRank := actSummary, actRank
	actSummary = func(scope, date string) (any, error) { return fixtureSummary(), nil }
	actRank = func(scope string, limit int, date string) (any, error) { return fixtureRank(), nil }
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "无标记回答"}}},
		})
	}))
	t.Cleanup(func() { actSummary, actRank = origSum, origRank; llm.Close() })
	_, _ = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"provider": "openai", "model": "m", "enabled": true, "apiKey": "k", "baseURL": llm.URL,
	})

	code, out := doJSON(t, srv, "POST", "/api/v1/ai/chat", map[string]any{
		"messages": []map[string]any{{"role": "user", "content": "hi"}},
	})
	if code != 200 {
		t.Fatalf("code=%d", code)
	}
	if _, ok := out["citations"]; ok {
		t.Fatalf("无标记时 citations 应省略: %v", out)
	}
}

// autoSummary PUT/GET 往返 + 非法时间回退默认。
func TestSettingsAutoSummary(t *testing.T) {
	srv := newTestServer(t)
	_, out := doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"autoSummary": map[string]any{"enabled": true, "time": "08:30"},
	})
	as, _ := out["autoSummary"].(map[string]any)
	if as["enabled"] != true || as["time"] != "08:30" {
		t.Fatalf("autoSummary 往返失败: %v", out)
	}

	_, out = doJSON(t, srv, "PUT", "/api/v1/ai/settings", map[string]any{
		"autoSummary": map[string]any{"enabled": true, "time": "不是时间"},
	})
	as, _ = out["autoSummary"].(map[string]any)
	if as["time"] != "23:00" {
		t.Fatalf("非法时间应回退 23:00: %v", as)
	}
}

// 真路径：runBackfill 用假 LLM 跑一遍，验证落盘产物与「无数据日跳过」。
func TestRunBackfillRealPath(t *testing.T) {
	dir := t.TempDir()
	SetStoreDir(dir)

	origSum, origRank := actSummary, actRank
	// 数据：今天有、昨天无（totalSec=0）
	today := time.Now()
	todayStr := today.Format("2006-01-02")
	yesterday := today.AddDate(0, 0, -1).Format("2006-01-02")
	actSummary = func(scope, date string) (any, error) {
		if date == yesterday {
			return map[string]any{"scope": scope, "from": date, "to": date, "totalSec": 0, "buckets": []any{}, "categories": []any{}}, nil
		}
		return fixtureSummary(), nil
	}
	actRank = func(scope string, limit int, date string) (any, error) { return fixtureRank(), nil }

	var calls int
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": "# 报告 " + time.Now().Format("15:04:05")}}},
		})
	}))
	t.Cleanup(func() { actSummary, actRank = origSum, origRank; llm.Close() })

	cfg := Config{Provider: ProviderOpenAI, BaseURL: llm.URL, Model: "m", APIKey: "k", Enabled: true}
	cache = &cfg

	generated, err := runBackfill(context.Background(), today)
	if err != nil {
		t.Fatalf("runBackfill: %v", err)
	}
	// 7 天日报（今天有数据、昨天无数据跳过 → 6）+ 上周周报 1 = 7
	if generated != 7 {
		t.Fatalf("应生成 7 份，实际 %d", generated)
	}
	if calls != 7 {
		t.Fatalf("LLM 调用应 7 次（无数据日不烧 token），实际 %d", calls)
	}
	// 今天日报已落盘
	if _, err := os.Stat(filepath.Join(reportDir(), todayStr+".md")); err != nil {
		t.Fatalf("今天日报未落盘: %v", err)
	}
	// 昨日（无数据）无文件
	if _, err := os.Stat(filepath.Join(reportDir(), yesterday+".md")); err == nil {
		t.Fatal("无数据日不应有报告")
	}
	// 再跑一遍：全部已存在 → 0 生成、0 次调用（幂等，不会重复烧 token）
	before := calls
	generated, err = runBackfill(context.Background(), today)
	if err != nil || generated != 0 {
		t.Fatalf("第二次补缺应 0 生成: %d %v", generated, err)
	}
	if calls != before {
		t.Fatalf("已存在的报告不应再调 LLM")
	}
}
