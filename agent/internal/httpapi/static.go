package httpapi

import (
	"compress/gzip"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"sync"

	"landeck/internal/webui"
)

const notBuiltPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>LanDeck · Web UI 未构建</title>
<style>body{background:#06070c;color:#9aa2b8;font:14px/1.7 system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
code{color:#a78bfa}</style></head><body><div style="max-width:520px;text-align:center">
<h1 style="color:#edeff8;font-size:18px">LanDeck Agent 已启动，但 Web UI 还没构建</h1>
<p>执行 <code>pnpm --dir web build</code>，把 <code>web/dist/</code> 拷进 <code>agent/internal/webui/dist/</code> 后重新编译，
或直接跑 <code>bash tools/build.sh</code> 一步到位。</p>
<p>API 本身已经可用：<code>GET /api/v1/hello</code></p></div></body></html>`

var gzPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return w
	},
}

func (s *Server) staticHandler() http.Handler {
	dist, err := webui.FS()
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("Web UI 未构建：请先执行 pnpm --dir web build 再重新编译 Agent"))
		})
	}

	serve := func(w http.ResponseWriter, r *http.Request, name string, cache bool) {
		file, err := dist.Open(name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		ctype := mime.TypeByExtension(path.Ext(name))
		if ctype == "" {
			ctype = "application/octet-stream"
		}
		if strings.HasPrefix(ctype, "text/") || strings.Contains(ctype, "javascript") || strings.Contains(ctype, "json") {
			ctype += "; charset=utf-8"
		}
		w.Header().Set("Content-Type", ctype)
		if cache && strings.Contains(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}

		// 文本资源按需 gzip（前端产物 200KB+，局域网也值得省）
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") &&
			info.Size() > 1024 &&
			(strings.HasPrefix(ctype, "text/") || strings.Contains(ctype, "javascript") || strings.Contains(ctype, "json") || strings.Contains(ctype, "svg")) {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Set("Vary", "Accept-Encoding")
			gz := gzPool.Get().(*gzip.Writer)
			gz.Reset(w)
			defer func() {
				_ = gz.Close()
				gzPool.Put(gz)
			}()
			_, _ = io.Copy(gz, file)
			return
		}
		_, _ = io.Copy(w, file)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/mcp" {
			http.NotFound(w, r)
			return
		}
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" || p == "." {
			p = "index.html"
		}
		if _, err := fs.Stat(dist, p); err == nil {
			serve(w, r, p, true)
			return
		}
		// SPA fallback；没有 index.html 说明前端没构建
		if _, err := fs.Stat(dist, "index.html"); err != nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(notBuiltPage))
			return
		}
		serve(w, r, "index.html", false)
	})
}
