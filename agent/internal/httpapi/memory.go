package httpapi

// 屏幕记忆（internal/memory）的四个端点。契约：docs/design/phase4-memory-and-remote-desktop.md A 节。

import (
	"net/http"
	"strconv"
	"strings"

	"landeck/internal/config"
	"landeck/internal/memory"
)

// GET /api/v1/memory/search?q=&from=&to=&limit=
// from/to 为 YYYY-MM-DD（含当天）。空 q 返回空结果（不做全量扫）。
func (s *Server) handleMemorySearch(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	q := r.URL.Query()
	limit := 20
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	v, err := memory.Search(q.Get("q"), q.Get("from"), q.Get("to"), limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "memory", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// GET /api/v1/memory/image?id=
// PNG 原图。?token= 免头鉴权走 protect 的既有逻辑（与 appicon 同模式）；
// ETag/304，未命中 404。
func (s *Server) handleMemoryImage(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "bad-params", "id 必须是正整数")
		return
	}
	data, etag, ok := memory.Image(id)
	if !ok {
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeErr(w, http.StatusNotFound, "not-found", "截图不存在或已过保留期")
		return
	}
	etagQ := `"` + etag + `"`
	w.Header().Set("ETag", etagQ)
	w.Header().Set("Cache-Control", "no-cache")
	if strings.TrimSpace(r.Header.Get("If-None-Match")) == etagQ {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// GET /api/v1/memory/status
func (s *Server) handleMemoryStatus(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	writeJSON(w, http.StatusOK, memory.GetStatus())
}

// GET /api/v1/memory/settings
func (s *Server) handleMemorySettingsGet(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	writeJSON(w, http.StatusOK, memory.GetSettings())
}

// PUT /api/v1/memory/settings  body: {enabled?, intervalSec?, retentionDays?} 部分更新。
func (s *Server) handleMemorySettingsPut(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	var body map[string]any
	if !activityBody(w, r, &body) {
		return
	}
	err := memory.UpdateSettings(func(st *memory.Settings) {
		if v, ok := body["enabled"].(bool); ok {
			st.Enabled = v
		}
		if v, ok := body["intervalSec"].(float64); ok {
			st.IntervalSec = int(v)
		}
		if v, ok := body["retentionDays"].(float64); ok {
			st.RetentionDays = int(v)
		}
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "memory", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, memory.GetSettings())
}
