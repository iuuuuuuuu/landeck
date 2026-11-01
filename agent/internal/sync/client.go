package syncengine

// WebDAV 客户端：net/http 裸方法（PUT/GET/MKCOL）+ Basic auth，零新依赖。

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrNotExist 远端文件不存在（GET 404）——契约视为「对方还没有数据」正常态。
var ErrNotExist = errors.New("webdav: file not found")

type Client struct {
	base string // 形如 https://dav.example.com/dav（无尾斜杠）
	user string
	pass string
	hc   *http.Client
}

func NewClient(base, user, pass string) *Client {
	return &Client{
		base: strings.TrimRight(base, "/"),
		user: user,
		pass: pass,
		hc:   &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) do(method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, c.base+path, body)
	if err != nil {
		return nil, err
	}
	if c.user != "" || c.pass != "" {
		req.SetBasicAuth(c.user, c.pass)
	}
	return c.hc.Do(req)
}

// Get 拉文件。404 → ErrNotExist（正常态）。
func (c *Client) Get(path string) ([]byte, error) {
	resp, err := c.do(http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == 404:
		return nil, ErrNotExist
	case resp.StatusCode/100 != 2:
		return nil, fmt.Errorf("webdav GET %s: HTTP %d", path, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 64<<20)) // 同步快照上限 64MB
}

// Put 推文件。父目录不存在（409/404）时自动 MKCOL 后重试一次。
func (c *Client) Put(path string, data []byte) error {
	resp, err := c.do(http.MethodPut, path, strings.NewReader(string(data)))
	if err != nil {
		return err
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode/100 == 2 {
		return nil
	}
	retryable := resp.StatusCode == 409 || resp.StatusCode == 404
	code := resp.StatusCode
	if !retryable {
		return fmt.Errorf("webdav PUT %s: HTTP %d", path, code)
	}
	if err := c.mkcolAll(parentDir(path)); err != nil {
		return err
	}
	resp2, err := c.do(http.MethodPut, path, strings.NewReader(string(data)))
	if err != nil {
		return err
	}
	io.Copy(io.Discard, resp2.Body)
	resp2.Body.Close()
	if resp2.StatusCode/100 != 2 {
		return fmt.Errorf("webdav PUT %s: HTTP %d (after MKCOL)", path, resp2.StatusCode)
	}
	return nil
}

// mkcolAll 逐级创建目录集合。405（已存在）视为成功。
func (c *Client) mkcolAll(dir string) error {
	if dir == "" || dir == "/" {
		return nil
	}
	parts := strings.Split(strings.Trim(dir, "/"), "/")
	cur := ""
	for _, p := range parts {
		cur += "/" + p
		resp, err := c.do("MKCOL", cur, nil)
		if err != nil {
			return err
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		// 201 创建成功；405 已存在；301/403 部分服务器对根的怪癖——只在非 2xx
		// 且非 405 时报错
		if resp.StatusCode/100 != 2 && resp.StatusCode != 405 {
			return fmt.Errorf("webdav MKCOL %s: HTTP %d", cur, resp.StatusCode)
		}
	}
	return nil
}

// ListDevices PROPFIND 列出 /landeck-sync/ 下的设备目录（Depth=1）。
// 返回 deviceId 列表（目录名）。v1 简化：很多服务器 PROPFIND 响应格式不一，
// 解析 <D:href> / <href> 即可；解析失败返回错误由引擎兜底走「已知设备表」。
func (c *Client) ListDevices(collection string) ([]string, error) {
	body := `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`
	resp, err := c.do("PROPFIND", collection, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, ErrNotExist
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("webdav PROPFIND %s: HTTP %d", collection, resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	// 粗解析：抽 href，取 collection 下的一级子路径
	var out []string
	prefix := strings.TrimSuffix(collection, "/") + "/"
	for _, m := range hrefRe.FindAllSubmatch(raw, -1) {
		h := string(m[1])
		if idx := strings.Index(h, prefix); idx >= 0 {
			rest := h[idx+len(prefix):]
			rest = strings.Trim(rest, "/")
			if rest == "" {
				continue // collection 自身
			}
			if strings.Contains(rest, "/") {
				continue // 更深层
			}
			if unescaped, err := urlUnescape(rest); err == nil {
				rest = unescaped
			}
			out = append(out, rest)
		}
	}
	// 去重：同一设备目录可能同时以「文件 href 的父路径」与「目录条目」出现
	seen := map[string]bool{}
	dedup := out[:0]
	for _, d := range out {
		if !seen[d] {
			seen[d] = true
			dedup = append(dedup, d)
		}
	}
	return dedup, nil
}

func urlUnescape(s string) (string, error) {
	return url.PathUnescape(s)
}

func parentDir(path string) string {
	i := strings.LastIndexByte(path, '/')
	if i <= 0 {
		return ""
	}
	return path[:i]
}
