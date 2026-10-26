package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"landeck/internal/config"
	"landeck/internal/icons"
)

// GET /api/v1/apps/icon?exe=<urlencoded 绝对路径>
//
// 为什么图标要单独开一个端点：<img src> 带不了 Authorization 头，
// 所以鉴权走 ?token=（bearer() 本来就兼容 query 里的 token，本机请求还免令牌）。
// 只读文件内容解析 PE 资源，不执行、不注入、不调用 Shell。
func (s *Server) handleAppIcon(w http.ResponseWriter, r *http.Request, c *config.Client) {
	_ = c // 鉴权已由 protect 完成，这里只需要「有权限看应用列表」这一件事
	// 进程能力被关掉时，应用面板也不可见 —— 图标一并拒绝，别成为侧门。
	if !s.Cfg.Get().Features.AllowProcessKill {
		iconNotFound(w)
		return
	}
	exe := strings.TrimSpace(r.URL.Query().Get("exe"))
	// 路径校验：必须是绝对路径、必须是可执行文件、必须真的存在且是普通文件。
	// 这样即使拿到令牌，也没法拿它当「任意文件读取/存在性探测」的探针。
	if exe == "" || !filepath.IsAbs(exe) {
		iconNotFound(w)
		return
	}
	exe = filepath.Clean(exe)
	switch strings.ToLower(filepath.Ext(exe)) {
	case ".exe", ".dll":
	default:
		iconNotFound(w)
		return
	}
	st, err := os.Stat(exe)
	if err != nil || st.IsDir() || !st.Mode().IsRegular() {
		iconNotFound(w)
		return
	}

	data, mime, err := icons.Extract(exe)
	if err != nil || len(data) == 0 {
		// 没有图标（控制台程序、静态编译的 exe）就走 404，前端回退字母占位
		iconNotFound(w)
		return
	}
	if mime == "" {
		mime = icons.MimeICO
	}
	w.Header().Set("Content-Type", mime)
	// 图标基本不随运行变化，让浏览器与中间层缓存一天；换了版本 exe 的 mtime 变了，服务端会重读
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// iconNotFound 统一 404，并且不要缓存「没图标」这个结论太久：
// 用户装完对应程序重启后应该尽快能看到图标。
func iconNotFound(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte("no icon"))
}
