package httpapi

// POST /api/v1/activity/domain（八期 A2）：MV3 扩展上报浏览器激活标签域名。
//
// 鉴权（契约，双层）：
//  1. 仅回环——非 127.0.0.1 直接 403（扩展只在本机跑，远程设备无权上报）
//  2. domainCapture=false → 501（不留暧昧端点：开关关了端点就不存在）
//  3. 双模式（activity settings 的 domainAuth）：
//     - "token"（默认）：?token= 或 Bearer，pairing.json 令牌口径
//     - "origin"：Origin 头 ∈ settings.DomainOrigins（商店上架后扩展 ID 稳定）
//
// body: {"browser":"chrome"|"edge"|"firefox", "domain":"youtube.com", "title"?}

import (
	"encoding/json"
	"net/http"
	"strings"

	"landeck/internal/activity"
	"landeck/internal/config"
)

type domainReport struct {
	Browser string `json:"browser"`
	Domain  string `json:"domain"`
	Title   string `json:"title"`
}

func (s *Server) handleActivityDomain(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method", "POST only")
		return
	}
	st := activity.GetSettings()
	if !st.DomainCapture {
		// 契约：关闭时 501，不留暧昧端点
		writeErr(w, http.StatusNotImplemented, "domain-capture-disabled", "domainCapture is off")
		return
	}
	// 仅回环：严格 127.0.0.1/::1（比 isLocalRequest 更严——本机网卡 IP 也拒绝，
	// 远程设备伪造本机内网 IP 的攻击面直接归零）
	host := clientIP(r)
	if host != "127.0.0.1" && host != "::1" {
		writeErr(w, http.StatusForbidden, "loopback-only", "domain reports are loopback-only")
		return
	}

	switch st.DomainAuth {
	case "origin":
		origin := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(r.Header.Get("Origin")), "/"))
		if origin == "" || !containsFoldStr(st.DomainOrigins, origin) {
			writeErr(w, http.StatusForbidden, "origin-not-allowed", "Origin is not whitelisted")
			return
		}
	default: // "token"
		if _, ok := s.Auth.Authenticate(bearer(r)); !ok {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
			return
		}
	}

	var rep domainReport
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	if err := json.NewDecoder(r.Body).Decode(&rep); err != nil {
		writeErr(w, http.StatusBadRequest, "bad-json", err.Error())
		return
	}
	if !activity.ValidBrowser(rep.Browser) {
		writeErr(w, http.StatusBadRequest, "bad-browser", "browser must be chrome|edge|firefox")
		return
	}
	if rep.Domain == "" {
		writeErr(w, http.StatusBadRequest, "bad-domain", "domain is required")
		return
	}

	activity.SetDomain(rep.Browser, rep.Domain, rep.Title)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// containsFoldStr 白名单匹配（与 activity.containsFold 同语义，本地复制避免导出内部助手）
func containsFoldStr(list []string, s string) bool {
	for _, p := range list {
		if p != "" && strings.Contains(strings.ToLower(s), strings.ToLower(p)) {
			return true
		}
	}
	return false
}
