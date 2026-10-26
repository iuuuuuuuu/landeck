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
	writeIconData(w, data, mime)
}

// writeIconData 统一写图标响应：mime 兜底、缓存一天、显式 Content-Length。
func writeIconData(w http.ResponseWriter, data []byte, mime string) {
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

// handleSelfIcon 返回被控端**自身**的可执行文件图标。
//
// 用途：设备列表里每台设备目前只显示首字母色块，用户希望能看到"真实的样子"。
// 被控端自己的 exe 图标就是这台机器上最自然的身份标识（桌面上也是这个图标）。
// 与 /apps/icon 的区别：不需要传路径，端点自己取 os.Executable()，
// 也不依赖「允许结束进程」这个功能开关 —— 设备身份不属于进程管理能力。
func (s *Server) handleSelfIcon(w http.ResponseWriter, r *http.Request, c *config.Client) {
	_ = r
	_ = c
	exe, err := os.Executable()
	if err != nil {
		iconNotFound(w)
		return
	}
	data, mime, err := icons.Extract(exe)
	if err != nil || len(data) == 0 {
		// exe 里没有图标资源（Go 默认构建就是这种情况）→ 用内嵌图标兜底，
		// 保证设备列表总有一枚真实 logo，而不是退回符号块。
		if len(icons.SelfIcon) > 0 {
			writeIconData(w, icons.SelfIcon, icons.MimeICO)
			return
		}
		iconNotFound(w)
		return
	}
	writeIconData(w, data, mime)
}
