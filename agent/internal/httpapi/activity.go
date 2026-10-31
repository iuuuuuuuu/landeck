package httpapi

// 活动采集（屏幕时间统计）的 HTTP 端点。
// 契约见 docs/design/hindsight-revamp-phase1.md 第 5 节。

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"landeck/internal/activity"
	"landeck/internal/config"
)

// activityBody 按现有惯例读取 JSON 请求体（16KB 上限）。
func activityBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return false
	}
	return true
}

// GET /api/v1/activity/summary?scope=day|week|month&date=YYYY-MM-DD
func (s *Server) handleActivitySummary(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	q := r.URL.Query()
	v, err := activity.GetSummary(q.Get("scope"), q.Get("date"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "activity", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// GET /api/v1/activity/rank?scope=…&limit=…&date=…
func (s *Server) handleActivityRank(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	q := r.URL.Query()
	limit := 10
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	v, err := activity.GetRank(q.Get("scope"), limit, q.Get("date"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "activity", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// GET /api/v1/activity/app/{name}?date=YYYY-MM-DD
func (s *Server) handleActivityApp(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	name := r.PathValue("name")
	if strings.TrimSpace(name) == "" {
		writeErr(w, http.StatusBadRequest, "bad-params", "缺少应用名")
		return
	}
	v, err := activity.GetAppDetail(name, r.URL.Query().Get("date"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "activity", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// GET /api/v1/activity/status
func (s *Server) handleActivityStatus(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	writeJSON(w, http.StatusOK, activity.GetStatus())
}

// GET /api/v1/activity/categories
func (s *Server) handleActivityCategoriesGet(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	writeJSON(w, http.StatusOK, map[string]any{"items": activity.GetSettings().Categories})
}

// PUT /api/v1/activity/categories  整表替换（body: {"items":[…]}）。
//
// 为什么是整表替换而不是逐条增删改：规则列表很小（几十条内），
// UI 侧的编辑本来就是「改完一份列表保存」，整表替换原子生效，
// 还免去逐条接口的并发顺序问题。
//
// items 为空数组 = 恢复内置默认规则（用户「清空」的场景远少于「重置」，
// 而且分类查询时才计算，重置后全部历史统计立即跟着恢复）。
func (s *Server) handleActivityCategoriesPut(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	var body struct {
		Items []activity.CategoryRule `json:"items"`
	}
	if !activityBody(w, r, &body) {
		return
	}
	if len(body.Items) == 0 {
		body.Items = activity.DefaultCategories()
	}
	err := activity.UpdateSettings(func(st *activity.Settings) { st.Categories = body.Items })
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "activity", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": activity.GetSettings().Categories})
}

// GET /api/v1/activity/settings
func (s *Server) handleActivitySettingsGet(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	writeJSON(w, http.StatusOK, activity.GetSettings())
}

// PUT /api/v1/activity/settings  部分更新：只覆盖请求体里出现的字段。
func (s *Server) handleActivitySettingsPut(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	var body map[string]any
	if !activityBody(w, r, &body) {
		return
	}
	err := activity.UpdateSettings(func(st *activity.Settings) {
		if v, ok := body["enabled"].(bool); ok {
			st.Enabled = v
		}
		if v, ok := body["intervalSec"].(float64); ok {
			st.IntervalSec = int(v)
		}
		if v, ok := body["idleSec"].(float64); ok {
			st.IdleSec = int(v)
		}
		if v, ok := body["workHoursEnabled"].(bool); ok {
			st.WorkHoursEnabled = v
		}
		if v, ok := body["workStart"].(string); ok {
			st.WorkStart = v
		}
		if v, ok := body["workEnd"].(string); ok {
			st.WorkEnd = v
		}
		if v, ok := body["retentionDays"].(float64); ok {
			st.RetentionDays = int(v)
		}
		if v, ok := body["privateRules"].([]any); ok {
			rules := make([]activity.PrivacyRule, 0, len(v))
			for _, item := range v {
				if m, ok := item.(map[string]any); ok {
					rules = append(rules, activity.PrivacyRule{
						ID:      pString(m, "id", ""),
						Kind:    pString(m, "kind", "app"),
						Pattern: pString(m, "pattern", ""),
					})
				}
			}
			st.PrivateRules = rules
		}
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "activity", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, activity.GetSettings())
}
