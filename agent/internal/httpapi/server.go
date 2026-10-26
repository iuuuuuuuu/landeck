package httpapi

import (
	"bufio"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"landeck/internal/auth"
	"landeck/internal/config"
	"landeck/internal/control"
	"landeck/internal/metrics"
	"landeck/internal/scheduler"
	"landeck/internal/store"
)

type Server struct {
	Cfg     *config.Store
	Auth    *auth.Manager
	Ctrl    control.Controller
	Sampler *metrics.Sampler
	Acts    *store.ActivityStore
	Sched   *scheduler.Runner
	Version string
	Started time.Time

	hub *hub
	mux *http.ServeMux
}

func New(cfg *config.Store, a *auth.Manager, ctrl control.Controller, sampler *metrics.Sampler,
	acts *store.ActivityStore, sched *scheduler.Runner, version string) *Server {
	s := &Server{
		Cfg: cfg, Auth: a, Ctrl: ctrl, Sampler: sampler, Acts: acts, Sched: sched,
		Version: version, Started: time.Now(),
	}
	s.hub = newHub(s)
	s.mux = http.NewServeMux()
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return withRecover(withLog(withCORS(s.mux)))
}

func (s *Server) routes() {
	m := s.mux

	// 公开端点
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok"))
	})
	m.HandleFunc("GET /api/v1/hello", s.handleHello)
	m.HandleFunc("POST /api/v1/pair", s.handlePair)

	// 需要 token
	m.HandleFunc("GET /api/v1/session", s.protect(s.handleSession))
	m.HandleFunc("GET /api/v1/system", s.protect(s.handleSystem))
	m.HandleFunc("GET /api/v1/status", s.protect(s.handleStatus))
	m.HandleFunc("GET /api/v1/hardware", s.protect(s.handleHardware))
	m.HandleFunc("GET /api/v1/uptime/history", s.protect(s.handleUptime))

	m.HandleFunc("GET /api/v1/actions", s.protect(s.handleActionList))
	m.HandleFunc("POST /api/v1/actions", s.protect(s.handleAction))
	m.HandleFunc("POST /api/v1/power", s.protect(s.handleAction))
	m.HandleFunc("GET /api/v1/volume", s.protect(s.handleVolumeGet))
	m.HandleFunc("POST /api/v1/volume", s.protect(s.handleAction))
	m.HandleFunc("GET /api/v1/media", s.protect(s.handleMediaGet))
	m.HandleFunc("POST /api/v1/media", s.protect(s.handleAction))

	m.HandleFunc("GET /api/v1/schedules", s.protect(s.handleSchedulesList))
	m.HandleFunc("POST /api/v1/schedules", s.protect(s.handleScheduleCreate))
	m.HandleFunc("PUT /api/v1/schedules/{id}", s.protect(s.handleScheduleUpdate))
	m.HandleFunc("DELETE /api/v1/schedules/{id}", s.protect(s.handleScheduleDelete))

	m.HandleFunc("GET /api/v1/clients", s.protect(s.handleClients))
	m.HandleFunc("DELETE /api/v1/clients/{id}", s.protect(s.handleClientRevoke))
	m.HandleFunc("POST /api/v1/clients/{id}/rotate", s.protect(s.handleClientRotate))

	m.HandleFunc("GET /api/v1/pairing", s.protect(s.handlePairingGet))
	m.HandleFunc("PUT /api/v1/pairing", s.protect(s.handlePairingPut))
	m.HandleFunc("POST /api/v1/pairing/code/rotate", s.protect(s.handleCodeRotate))

	m.HandleFunc("GET /api/v1/settings", s.protect(s.handleSettingsGet))
	m.HandleFunc("PUT /api/v1/settings", s.protect(s.handleSettingsPut))

	m.HandleFunc("GET /api/v1/activity", s.protect(s.handleActivity))
	m.HandleFunc("GET /api/v1/stats", s.protect(s.handleStats))

	m.HandleFunc("GET /api/v1/apps", s.protect(s.handleApps))
	m.HandleFunc("POST /api/v1/apps/kill", s.protect(s.handleKillApp))
	// 应用图标：从 exe 的 PE 资源段里抠出来（鉴权同其它端点，图片请求靠 ?token= 带令牌）
	m.HandleFunc("GET /api/v1/apps/icon", s.protect(s.handleAppIcon))
	// 被控端自身图标：设备列表用它当 logo（不依赖进程管理能力开关）
	m.HandleFunc("GET /api/v1/self/icon", s.protect(s.handleSelfIcon))

	m.HandleFunc("GET /api/v1/files/roots", s.protect(s.handleFilesRoots))
	m.HandleFunc("GET /api/v1/files/list", s.protect(s.handleFilesList))
	m.HandleFunc("GET /api/v1/files/stat", s.protect(s.handleFilesStat))
	m.HandleFunc("GET /api/v1/files/download", s.protect(s.handleFilesDownload))
	m.HandleFunc("GET /api/v1/files/preview", s.protect(s.handleFilesPreview))
	m.HandleFunc("POST /api/v1/files/upload", s.protect(s.handleFilesUpload))
	m.HandleFunc("POST /api/v1/files/mkdir", s.protect(s.handleFilesMkdir))
	m.HandleFunc("POST /api/v1/files/rename", s.protect(s.handleFilesRename))
	m.HandleFunc("POST /api/v1/files/delete", s.protect(s.handleFilesDelete))

	m.HandleFunc("GET /api/v1/processes", s.protect(s.handleProcesses))
	m.HandleFunc("POST /api/v1/processes/kill", s.protect(s.handleKillProcess))

	m.HandleFunc("GET /api/v1/ws", s.handleWS)

	// MCP（AI 控制面）：JSON-RPC over HTTP
	m.HandleFunc("POST /mcp", s.handleMCP)
	m.HandleFunc("GET /mcp", s.handleMCPInfo)

	// 前端静态资源（内嵌）
	m.Handle("/", s.staticHandler())
}

// ---------- 中间件 ----------

func withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic %s %s: %v", r.Method, r.URL.Path, rec)
				writeErr(w, http.StatusInternalServerError, "internal", "服务内部错误")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

// WebSocket 升级需要 Hijacker；不转发会导致 gorilla 报「response does not implement http.Hijacker」。
func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("当前 ResponseWriter 不支持 Hijack")
	}
	return h.Hijack()
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func withLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, code: 200}
		next.ServeHTTP(rec, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && rec.code >= 400 {
			log.Printf("%s %s -> %d (%s)", r.Method, r.URL.Path, rec.code, time.Since(start).Round(time.Millisecond))
		}
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.Header().Set("Access-Control-Expose-Headers", "Mcp-Session-Id")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------- 鉴权 ----------

type ctxKey int

const clientKey ctxKey = 1

type authed func(w http.ResponseWriter, r *http.Request, client *config.Client)

func (s *Server) protect(h authed) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearer(r)
		if token != "" {
			if client, ok := s.Auth.Authenticate(token); ok {
				h(w, r, client)
				return
			}
			writeErr(w, http.StatusUnauthorized, "unauthorized", "令牌无效或已失效，请重新配对")
			return
		}
		// 本机免令牌：请求来自 127.0.0.1 / 本机网卡地址时直接放行。
		// 依据是「能在这台机器上发请求 = 已经拥有这台机器」，且本机页面（/local）
		// 本来就不该强迫用户给自己配对。
		if s.Cfg.Get().AllowLocalNoAuth && isLocalRequest(r) {
			h(w, r, &config.Client{ID: "local", Name: "本机", Role: "owner"})
			return
		}
		writeErr(w, http.StatusUnauthorized, "unauthorized", "令牌无效或已失效，请重新配对")
	}
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	if q := r.URL.Query().Get("token"); q != "" {
		return q
	}
	return ""
}

// ---------- 工具 ----------

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

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// 参数读取：都从 map[string]any 来（JSON 数字是 float64）
func pInt(m map[string]any, key string, def int) int {
	v, ok := m[key]
	if !ok {
		return def
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return int(i)
		}
	}
	return def
}

func pBool(m map[string]any, key string, def bool) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return def
}

func pString(m map[string]any, key, def string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return def
}

var errBadParams = errors.New("参数不合法")

// isLocalRequest 判断请求是否来自本机：loopback，或源地址等于本机任一网卡地址。
func isLocalRequest(r *http.Request) bool {
	host := clientIP(r)
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && ipnet.IP.Equal(ip) {
			return true
		}
	}
	return false
}
