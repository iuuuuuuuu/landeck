package httpapi

// 十期 A1：同步设置/手动同步/状态（契约 API 表）。
// 凭据 0600 同 ai.json 口径（sync 包负责落盘），GET 打码；
// PUT 部分更新，password 字段出现且 ≠ 打码值才改（防前端把打码串写回）。

import (
	"encoding/json"
	"net/http"

	"landeck/internal/config"
	syncengine "landeck/internal/sync"
)

const maskedPassword = "••••••"

func (s *Server) handleSyncSettingsGet(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	st := syncengine.GetSettings()
	type view struct {
		Enabled     bool   `json:"enabled"`
		URL         string `json:"url"`
		Username    string `json:"username"`
		Password    string `json:"password"`
		IntervalSec int    `json:"intervalSec"`
		LastSyncAt  int64  `json:"lastSyncAt"`
		LastError   string `json:"lastError"`
		DeviceID    string `json:"deviceId"`
		DeviceName  string `json:"deviceName"`
	}
	v := view{
		Enabled: st.Enabled, URL: st.URL, Username: st.Username,
		Password: maskedPassword, IntervalSec: st.IntervalSec,
		LastSyncAt: st.LastSyncAt, LastError: st.LastError,
		DeviceID: st.DeviceID, DeviceName: st.DeviceName,
	}
	if st.Password == "" {
		v.Password = ""
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleSyncSettingsPut(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	var req struct {
		Enabled     *bool   `json:"enabled"`
		URL         *string `json:"url"`
		Username    *string `json:"username"`
		Password    *string `json:"password"`
		IntervalSec *int    `json:"intervalSec"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad-json", err.Error())
		return
	}
	err := syncengine.UpdateSettings(func(st *syncengine.Settings) {
		if req.Enabled != nil {
			st.Enabled = *req.Enabled
		}
		if req.URL != nil {
			st.URL = *req.URL
		}
		if req.Username != nil {
			st.Username = *req.Username
		}
		if req.Password != nil && *req.Password != maskedPassword {
			st.Password = *req.Password
		}
		if req.IntervalSec != nil {
			st.IntervalSec = *req.IntervalSec
		}
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "sync", err.Error())
		return
	}
	// PUT 后回读（打码），前端拿最新口径
	s.handleSyncSettingsGet(w, r, nil)
}

func (s *Server) handleSyncNow(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	res := syncengine.SyncNow()
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleSyncStatus(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	writeJSON(w, http.StatusOK, syncengine.StatusViewOf())
}
