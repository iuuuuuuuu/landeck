package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"landeck/internal/activity"
	"landeck/internal/config"
)

// handlers.go：HTTP 端点 + Register。
//
// 为什么自带 writeJSON/writeErr 而不用 httpapi 的：httpapi 整个包都不在本批
// 文件范围里（server.go 归 agent-activity 接线），为几个辅助函数去扩可见性
// 反而制造跨包耦合。形状与 httpapi 完全一致（{"error","message"}），前端无感。
//
// protect 的函数类型与 httpapi 的 (authed) http.HandlerFunc 结构化等价
// （第三参 *config.Client 是导出类型），ai 包不 import httpapi。

const llmTimeout = 60 * time.Second

// activity 查询入口做成包级变量：测试里可替换成桩，不必真的 Start 采集。
var (
	actSummary = activity.GetSummary
	actRank    = activity.GetRank
)

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, map[string]string{"error": errCode, "message": msg})
}

// body 按 activityBody 的惯例读取 JSON 请求体（16KB 上限）。
func body(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求格式不正确")
		return false
	}
	return true
}

// guarded 与 httpapi 的 authed 同构。
type guarded = func(w http.ResponseWriter, r *http.Request, client *config.Client)

// Register 注册路由。protect 由 httpapi 侧提供（token 校验包装），
// dataDir 为 agent 数据目录（配置落 dataDir/ai.json）。
func Register(m *http.ServeMux, protect func(guarded) http.HandlerFunc, dataDir string) {
	SetStoreDir(dataDir)
	m.HandleFunc("GET /api/v1/ai/settings", protect(func(w http.ResponseWriter, r *http.Request, _ *config.Client) {
		writeJSON(w, http.StatusOK, view(Get()))
	}))
	m.HandleFunc("PUT /api/v1/ai/settings", protect(func(w http.ResponseWriter, r *http.Request, _ *config.Client) {
		var bodyMap map[string]any
		if !body(w, r, &bodyMap) {
			return
		}
		err := Update(func(cfg *Config) {
			if v, ok := bodyMap["provider"].(string); ok {
				cfg.Provider = v
			}
			if v, ok := bodyMap["baseURL"].(string); ok {
				cfg.BaseURL = v
			}
			if v, ok := bodyMap["model"].(string); ok {
				cfg.Model = v
			}
			if v, ok := bodyMap["enabled"].(bool); ok {
				cfg.Enabled = v
			}
			// apiKey：空串=未修改（前端拿到的是打码视图，无法重发明文）；
			// clearKey:true 才真正清空。
			if v, ok := bodyMap["apiKey"].(string); ok && v != "" {
				cfg.APIKey = v
			}
			if v, ok := bodyMap["clearKey"].(bool); ok && v {
				cfg.APIKey = ""
			}
		})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "ai", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, view(Get()))
	}))
	m.HandleFunc("POST /api/v1/ai/summary", protect(func(w http.ResponseWriter, r *http.Request, _ *config.Client) {
		var req struct {
			Scope string `json:"scope"`
			Date  string `json:"date"`
		}
		if !body(w, r, &req) {
			return
		}
		scope := req.Scope
		if scope != "day" && scope != "week" && scope != "month" {
			scope = "day"
		}
		cfg := Get()
		if !configured(cfg) {
			writeErr(w, http.StatusBadRequest, "ai_not_configured", "尚未配置 AI 提供方（在设置里填模型与密钥并启用）")
			return
		}
		summary, err := actSummary(scope, req.Date)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "ai", err.Error())
			return
		}
		rank, err := actRank(scope, 10, req.Date)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "ai", err.Error())
			return
		}
		msgs, err := BuildReportPrompt(scope, summary, rank)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "ai", err.Error())
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), llmTimeout)
		defer cancel()
		md, err := chat(ctx, cfg, msgs)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "ai_provider", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"markdown": md})
	}))
	m.HandleFunc("POST /api/v1/ai/chat", protect(func(w http.ResponseWriter, r *http.Request, _ *config.Client) {
		var req struct {
			Messages []ChatMessage `json:"messages"`
		}
		if !body(w, r, &req) {
			return
		}
		cfg := Get()
		if !configured(cfg) {
			writeErr(w, http.StatusBadRequest, "ai_not_configured", "尚未配置 AI 提供方（在设置里填模型与密钥并启用）")
			return
		}
		// 最近 7 天口径 = activity 的 week scope（ISO 周一起始，带缓存）。
		// 滚动 7 天要 7 次查询，收益不成比例；取舍理由见 BuildChatMessages 注释。
		summary, err := actSummary("week", "")
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "ai", err.Error())
			return
		}
		rank, err := actRank("week", 10, "")
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "ai", err.Error())
			return
		}
		msgs, err := BuildChatMessages(summary, rank, req.Messages)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), llmTimeout)
		defer cancel()
		content, err := chat(ctx, cfg, msgs)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "ai_provider", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"content": content})
	}))
}
