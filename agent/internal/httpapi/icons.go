package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
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
	writeIconData(w, r, data, mime)
}

// writeIconData 统一写图标响应：mime 兜底、ETag 重验证、显式 Content-Length。
//
// 为什么不用 max-age 而用 no-cache + ETag：
//
//	图标的**内容会变** —— 用户换了 Windows 账户头像、或 agent 升级后 exe 图标变了。
//	原来设 public, max-age=86400，后果是：服务端已经返回新头像（2392 字节 PNG），
//	手机上的 <img> 却拿一天的旧缓存继续显示老图标。
//	（实测踩到：改完头像支持后手机上仍是旧的 ico，而接口本身返回的已是 PNG。）
//	改成 no-cache 后浏览器每次带 If-None-Match 来问一句：
//	没变回 304（几乎零成本），变了立刻拿到新图。
//	用 ETag 而不是 Last-Modified，因为头像可能来自 ProgramData / 注册表，
//	mtime 不一定可靠。
func writeIconData(w http.ResponseWriter, r *http.Request, data []byte, mime string) {
	if mime == "" {
		mime = icons.MimeICO
	}
	sum := sha256.Sum256(data)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)
	// no-cache = 可缓存，但每次必须回源重验证（配合 ETag 走 304）
	w.Header().Set("Cache-Control", "no-cache")

	if r != nil && strings.TrimSpace(r.Header.Get("If-None-Match")) == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", mime)
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

// handleSelfIcon 返回这台机器的身份头像。
//
// 用途：设备列表 / 详情页的头像。用户要求「从系统中获取头像」。
//
// 三级优先级：
//  1. Windows 账户头像（用户自己设置过的）—— 最能代表「这台机器是谁的」
//  2. 系统默认账户头像（user-192.png，未设置头像时的占位图）
//  3. 被控端 exe 里的图标资源 → 内嵌 landeck.ico 兜底
//
// 前两级由 icons.AccountAvatar() 负责；第三级是原有逻辑。
// 不依赖「允许结束进程」这个功能开关 —— 设备身份不属于进程管理能力。
func (s *Server) handleSelfIcon(w http.ResponseWriter, r *http.Request, c *config.Client) {
	_ = c

	// 1 & 2：系统账户头像（真实头像 or 系统默认）
	if data, mime, _ := icons.AccountAvatar(); len(data) > 0 {
		writeIconData(w, r, data, mime)
		return
	}

	// 3：exe 图标 → 内嵌图标
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
			writeIconData(w, r, icons.SelfIcon, icons.MimeICO)
			return
		}
		iconNotFound(w)
		return
	}
	writeIconData(w, r, data, mime)
}
