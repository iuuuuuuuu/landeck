package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"landeck/internal/config"
	"landeck/internal/files"
)

// 文件管理端点。所有路径都过 files.Manager.Resolve，不信任前端传来的绝对路径。

func (s *Server) filesManager() *files.Manager {
	cfg := s.Cfg.Get()
	return files.New(files.Options{
		AllowedRoots:    cfg.Files.Roots,
		AllowSystemDirs: cfg.Files.AllowSystemDirs,
		ReadOnly:        !cfg.Files.AllowWrite,
	})
}

func (s *Server) filesEnabled() bool { return s.Cfg.Get().Files.Enabled }

func (s *Server) handleFilesRoots(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	m := s.filesManager()
	writeJSON(w, http.StatusOK, map[string]any{
		"roots":     m.Roots(),
		"allowWrite": s.Cfg.Get().Files.AllowWrite,
	})
}

func (s *Server) handleFilesList(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	path := r.URL.Query().Get("path")
	items, err := s.filesManager().List(path)
	if err != nil {
		writeFileErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":  path,
		"items": items,
		"count": len(items),
	})
}

func (s *Server) handleFilesStat(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	e, err := s.filesManager().Stat(r.URL.Query().Get("path"))
	if err != nil {
		writeFileErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

// GET /files/download?path=... —— 带 Range，可断点续传
func (s *Server) handleFilesDownload(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	f, info, err := s.filesManager().Open(r.URL.Query().Get("path"))
	if err != nil {
		writeFileErr(w, err)
		return
	}
	defer f.Close()
	s.Acts.Add(store_activity("下载文件 "+info.Name(), c.Name, true, r.URL.Query().Get("path")))
	files.ServeContent(w, r, f, info, info.Name())
}

// GET /files/preview?path=... —— 文本预览（≤256KB，二进制拒绝）
func (s *Server) handleFilesPreview(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	text, truncated, err := s.filesManager().TextPreview(r.URL.Query().Get("path"), 0)
	if err != nil {
		writeFileErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"text": text, "truncated": truncated})
}

// POST /files/upload?dir=...&name=...&overwrite=1 —— 原始字节流上传（App/浏览器都简单）
func (s *Server) handleFilesUpload(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	q := r.URL.Query()
	dir := q.Get("dir")
	name := q.Get("name")
	if name == "" {
		name = "upload.bin"
	}
	overwrite := q.Get("overwrite") == "1"

	// 限制单文件 512MB，防止误传大镜像把磁盘打满
	const maxUpload = 512 << 20
	if r.ContentLength > maxUpload {
		writeErr(w, http.StatusRequestEntityTooLarge, "too_large", "单个文件上限 512 MB")
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxUpload)

	entry, err := s.filesManager().Upload(dir, name, body, overwrite)
	if err != nil {
		writeFileErr(w, err)
		return
	}
	s.Acts.Add(store_activity("上传文件 "+entry.Name, c.Name, true, entry.Path))
	writeJSON(w, http.StatusOK, entry)
}

func (s *Server) handleFilesMkdir(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	var body struct {
		Parent string `json:"parent"`
		Name   string `json:"name"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		return
	}
	entry, err := s.filesManager().Mkdir(body.Parent, body.Name)
	if err != nil {
		writeFileErr(w, err)
		return
	}
	s.Acts.Add(store_activity("新建目录 "+entry.Name, c.Name, true, entry.Path))
	writeJSON(w, http.StatusOK, entry)
}

func (s *Server) handleFilesRename(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	var body struct {
		Path    string `json:"path"`
		NewName string `json:"newName"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		return
	}
	entry, err := s.filesManager().Rename(body.Path, body.NewName)
	if err != nil {
		writeFileErr(w, err)
		return
	}
	s.Acts.Add(store_activity("重命名 "+entry.Name, c.Name, true, body.Path))
	writeJSON(w, http.StatusOK, entry)
}

func (s *Server) handleFilesDelete(w http.ResponseWriter, r *http.Request, c *config.Client) {
	if !s.filesEnabled() {
		writeErr(w, http.StatusConflict, "disabled", "文件管理已关闭")
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		var body struct {
			Path string `json:"path"`
		}
		if err := decodeJSON(w, r, &body); err != nil {
			return
		}
		path = body.Path
	}
	if err := s.filesManager().Delete(path); err != nil {
		writeFileErr(w, err)
		return
	}
	s.Acts.Add(store_activity("删除文件", c.Name, true, path))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// 只允许 http(s) 链接，避免 file:// 之类的本地协议被滥用
func validDownloadURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return u.Scheme == "http" || u.Scheme == "https"
}

func writeFileErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, files.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not_found", "路径不存在")
	case errors.Is(err, files.ErrDenied):
		writeErr(w, http.StatusForbidden, "denied", err.Error())
	default:
		msg := err.Error()
		if strings.Contains(msg, "已存在") {
			writeErr(w, http.StatusConflict, "exists", msg)
			return
		}
		writeErr(w, http.StatusBadRequest, "failed", msg)
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "请求体不是合法 JSON："+err.Error())
		return err
	}
	return nil
}
