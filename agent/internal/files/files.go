package files

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// 文件管理：只读浏览 + 受控写操作。
//
// 安全边界（必须遵守）：
// 1. 所有路径都过 Resolve 归一化，禁止 .. 逃逸出允许的根目录。
// 2. 默认只开放用户目录（家目录 + 常见盘符根），系统目录（Windows/System32、
//    /etc、/System 等）默认拒绝，除非显式在设置里打开 allowSystemDirs。
// 3. 写操作（删除/重命名/新建目录）都要经过服务端二次校验，不信任前端传来的绝对路径。

// Entry 是目录里的一项。
type Entry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Dir     bool   `json:"dir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
	Ext     string `json:"ext"`
	Hidden  bool   `json:"hidden"`
}

type Roots struct {
	Path  string `json:"path"`
	Label string `json:"label"`
	Kind  string `json:"kind"` // home | drive | custom
}

var ErrDenied = errors.New("路径不在允许范围内")
var ErrNotFound = errors.New("路径不存在")

// Options 由调用方（配置）注入，避免包之间循环依赖。
type Options struct {
	// AllowedRoots 为空时自动探测（家目录 + 盘符）
	AllowedRoots []string
	// AllowSystemDirs 为真时才允许碰系统目录
	AllowSystemDirs bool
	// ReadOnly 为真时所有写操作直接拒绝
	ReadOnly bool
}

type Manager struct {
	opts Options
}

func New(opts Options) *Manager {
	if len(opts.AllowedRoots) == 0 {
		opts.AllowedRoots = detectRoots()
	}
	return &Manager{opts: opts}
}

func detectRoots() []string {
	var out []string
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		out = append(out, home)
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		// Windows 常见位置：桌面/下载/文档
		for _, sub := range []string{"Desktop", "Downloads", "Documents", "桌面", "下载", "文档"} {
			p := filepath.Join(home, sub)
			if st, err := os.Stat(p); err == nil && st.IsDir() {
				out = append(out, p)
			}
		}
	}
	// Windows 盘符
	if vol := os.Getenv("SystemDrive"); vol != "" {
		out = append(out, vol+string(os.PathSeparator))
	}
	return dedupe(out)
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, p := range in {
		clean := filepath.Clean(p)
		if seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	return out
}

// Roots 返回前端可选的入口列表。
func (m *Manager) Roots() []Roots {
	out := make([]Roots, 0, len(m.opts.AllowedRoots))
	for _, p := range m.opts.AllowedRoots {
		label := filepath.Base(p)
		kind := "custom"
		if p == string(os.PathSeparator) || (len(p) == 3 && p[1] == ':' && p[2] == '\\') {
			label = strings.ToUpper(strings.TrimRight(p, `\/`))
			kind = "drive"
		} else if home, err := os.UserHomeDir(); err == nil && p == home {
			label = "主目录"
			kind = "home"
		}
		out = append(out, Roots{Path: p, Label: label, Kind: kind})
	}
	return out
}

var systemDirs = []string{
	`c:\windows`, `c:\program files`, `c:\program files (x86)`, `c:\programdata`,
	"/etc", "/usr", "/bin", "/sbin", "/var", "/boot", "/sys", "/proc",
	"/system", "/library", "/private",
}

// Resolve 把用户传来的路径归一化并校验在允许范围内。
func (m *Manager) Resolve(p string) (string, error) {
	if strings.TrimSpace(p) == "" {
		return "", fmt.Errorf("%w: 空路径", ErrDenied)
	}
	clean := filepath.Clean(p)
	if !filepath.IsAbs(clean) {
		return "", fmt.Errorf("%w: 需要绝对路径", ErrDenied)
	}

	// 系统目录拦截
	if !m.opts.AllowSystemDirs {
		lower := strings.ToLower(strings.ReplaceAll(clean, "\\", "/"))
		for _, sys := range systemDirs {
			s := strings.ReplaceAll(sys, "\\", "/")
			if lower == s || strings.HasPrefix(lower, s+"/") {
				return "", fmt.Errorf("%w: 系统目录默认不可访问（可在设置里打开）", ErrDenied)
			}
		}
	}

	for _, root := range m.opts.AllowedRoots {
		r := filepath.Clean(root)
		if clean == r {
			return clean, nil
		}
		// Windows 盘符根 `C:\` 拼出来是 `C:\foo`，用分隔符判断避免 C:\foo 匹配 C:\foobar
		rel, err := filepath.Rel(r, clean)
		if err != nil {
			continue
		}
		if rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)) {
			return clean, nil
		}
	}
	return "", ErrDenied
}

// List 列目录。dir 为空时返回根列表的首页。
func (m *Manager) List(dir string) ([]Entry, error) {
	if dir == "" {
		// 虚拟根：把每个允许根当成一项
		out := make([]Entry, 0, len(m.opts.AllowedRoots))
		for _, r := range m.opts.AllowedRoots {
			st, err := os.Stat(r)
			if err != nil {
				continue
			}
			out = append(out, Entry{
				Name:    filepath.Base(strings.TrimRight(r, `\/`)),
				Path:    r,
				Dir:     st.IsDir(),
				Size:    st.Size(),
				ModTime: st.ModTime().Format(time.RFC3339),
			})
		}
		return out, nil
	}

	clean, err := m.Resolve(dir)
	if err != nil {
		return nil, err
	}
	items, err := os.ReadDir(clean)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		if os.IsPermission(err) {
			return nil, fmt.Errorf("%w: 没有读取权限", ErrDenied)
		}
		return nil, err
	}

	out := make([]Entry, 0, len(items))
	for _, it := range items {
		info, err := it.Info()
		if err != nil {
			continue
		}
		name := it.Name()
		out = append(out, Entry{
			Name:    name,
			Path:    filepath.Join(clean, name),
			Dir:     it.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Format(time.RFC3339),
			Ext:     strings.ToLower(strings.TrimPrefix(filepath.Ext(name), ".")),
			Hidden:  strings.HasPrefix(name, "."),
		})
	}
	// 目录在前，再按名称（忽略大小写）
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// Stat 返回单个路径的信息（预览用）。
func (m *Manager) Stat(p string) (Entry, error) {
	clean, err := m.Resolve(p)
	if err != nil {
		return Entry{}, err
	}
	st, err := os.Stat(clean)
	if err != nil {
		if os.IsNotExist(err) {
			return Entry{}, ErrNotFound
		}
		return Entry{}, err
	}
	return Entry{
		Name:    filepath.Base(clean),
		Path:    clean,
		Dir:     st.IsDir(),
		Size:    st.Size(),
		ModTime: st.ModTime().Format(time.RFC3339),
		Ext:     strings.ToLower(strings.TrimPrefix(filepath.Ext(clean), ".")),
	}, nil
}

// Open 打开文件供下载；调用方负责关闭。
func (m *Manager) Open(p string) (*os.File, os.FileInfo, error) {
	clean, err := m.Resolve(p)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(clean)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	if info.IsDir() {
		f.Close()
		return nil, nil, fmt.Errorf("%w: 这是一个目录", ErrDenied)
	}
	return f, info, nil
}

// TextPreview 读取文本文件前 maxBytes 字节（超过则截断）。
func (m *Manager) TextPreview(p string, maxBytes int64) (string, bool, error) {
	f, info, err := m.Open(p)
	if err != nil {
		return "", false, err
	}
	defer f.Close()
	if maxBytes <= 0 || maxBytes > 512*1024 {
		maxBytes = 256 * 1024
	}
	truncated := info.Size() > maxBytes
	buf := make([]byte, maxBytes)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", false, err
	}
	buf = buf[:n]
	// 简单二进制判定：出现 NUL 就当二进制
	if strings.IndexByte(string(buf), 0) >= 0 {
		return "", truncated, fmt.Errorf("%w: 二进制文件无法预览", ErrDenied)
	}
	return string(buf), truncated, nil
}

// Upload 把请求体写成文件。存在时按 overwrite 决定覆盖还是报错。
func (m *Manager) Upload(dir, name string, r io.Reader, overwrite bool) (Entry, error) {
	cleanDir, err := m.Resolve(dir)
	if err != nil {
		return Entry{}, err
	}
	if st, err := os.Stat(cleanDir); err != nil || !st.IsDir() {
		return Entry{}, fmt.Errorf("%w: 目标不是目录", ErrDenied)
	}
	base := filepath.Base(name)
	if base == "." || base == ".." || strings.ContainsAny(base, `/\`) {
		return Entry{}, fmt.Errorf("%w: 文件名不合法", ErrDenied)
	}
	target := filepath.Join(cleanDir, base)
	if _, err := os.Stat(target); err == nil && !overwrite {
		return Entry{}, fmt.Errorf("同名文件已存在")
	}
	tmp := target + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return Entry{}, err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return Entry{}, err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return Entry{}, err
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return Entry{}, err
	}
	return m.Stat(target)
}

// Mkdir 新建目录。
func (m *Manager) Mkdir(parent, name string) (Entry, error) {
	if m.opts.ReadOnly {
		return Entry{}, fmt.Errorf("%w: 只读模式", ErrDenied)
	}
	cleanParent, err := m.Resolve(parent)
	if err != nil {
		return Entry{}, err
	}
	base := filepath.Base(name)
	if base == "." || base == ".." || strings.ContainsAny(base, `/\`) {
		return Entry{}, fmt.Errorf("%w: 目录名不合法", ErrDenied)
	}
	target := filepath.Join(cleanParent, base)
	if _, err := os.Stat(target); err == nil {
		return Entry{}, fmt.Errorf("同名目录已存在")
	}
	if err := os.Mkdir(target, 0o755); err != nil {
		return Entry{}, err
	}
	return m.Stat(target)
}

// Rename 重命名（同目录内）。
func (m *Manager) Rename(p, newName string) (Entry, error) {
	if m.opts.ReadOnly {
		return Entry{}, fmt.Errorf("%w: 只读模式", ErrDenied)
	}
	clean, err := m.Resolve(p)
	if err != nil {
		return Entry{}, err
	}
	base := filepath.Base(newName)
	if base == "." || base == ".." || strings.ContainsAny(base, `/\`) {
		return Entry{}, fmt.Errorf("%w: 名称不合法", ErrDenied)
	}
	target := filepath.Join(filepath.Dir(clean), base)
	if _, err := os.Stat(target); err == nil {
		return Entry{}, fmt.Errorf("目标已存在")
	}
	if err := os.Rename(clean, target); err != nil {
		return Entry{}, err
	}
	return m.Stat(target)
}

// Delete 删除文件或目录（目录递归）。
func (m *Manager) Delete(p string) error {
	if m.opts.ReadOnly {
		return fmt.Errorf("%w: 只读模式", ErrDenied)
	}
	clean, err := m.Resolve(p)
	if err != nil {
		return err
	}
	// 禁止删掉允许根目录本身
	for _, root := range m.opts.AllowedRoots {
		if clean == filepath.Clean(root) {
			return fmt.Errorf("%w: 不能删除根目录", ErrDenied)
		}
	}
	return os.RemoveAll(clean)
}

// ServeContent 带 Range 的文件下载（浏览器/App 都能断点续传）。
func ServeContent(w http.ResponseWriter, r *http.Request, f *os.File, info os.FileInfo, name string) {
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, sanitizeHeader(name)))
	http.ServeContent(w, r, name, info.ModTime(), f)
}

func sanitizeHeader(s string) string {
	s = strings.ReplaceAll(s, `"`, "")
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", "")
	return s
}
