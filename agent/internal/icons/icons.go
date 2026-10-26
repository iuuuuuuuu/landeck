// Package icons 从可执行文件里提取应用图标。
//
// 为什么要自己解析：Windows 上进程只给得到 exe 路径，图标藏在 PE 的资源段里
// （RT_GROUP_ICON 描述有哪些尺寸，RT_ICON 才是真正的图像数据）。
// 这里只用 debug/pe + encoding/binary 把资源段读出来，拼成一份合法的单条目 .ico，
// 不加载任何 DLL、不调用 Shell API、也不执行目标文件。
package icons

import (
	"errors"
	"fmt"
	"os"
	"sync"
)

var (
	// ErrUnsupported 当前平台不支持图标提取（只有 Windows 的 PE 有资源段）。
	ErrUnsupported = errors.New("当前平台不支持从可执行文件提取图标")
	// ErrNoIcon 文件里没有可用图标：控制台程序、Go 静态编译出的 exe 很常见。
	ErrNoIcon = errors.New("这个可执行文件里没有图标资源")
)

// MimeICO 返回体的 Content-Type。
const MimeICO = "image/x-icon"

const (
	// cacheLimit 内存缓存条数上限。图标单条通常 10–100KB，256 条最坏也就几十 MB。
	cacheLimit = 256
)

// entry 一条缓存。用「修改时间 + 大小」判新旧：换了版本的同名 exe 会自动重新读。
type entry struct {
	modTime int64
	size    int64
	data    []byte
	mime    string
	err     error
	used    uint64 // 最近一次命中序号，淘汰时挑最旧的
}

var (
	mu    sync.Mutex
	cache = make(map[string]*entry, cacheLimit)
	seq   uint64
)

// Extract 提取 exePath 里尺寸最大的那个应用图标，返回 .ico 字节与 MIME。
//
// 结果按路径缓存在内存里（带文件修改时间/大小校验），列表页反复刷新不会重复读盘；
// 失败的结论也缓存，避免对着一个没图标的 exe 每次都去解析一遍。
func Extract(exePath string) ([]byte, string, error) {
	if exePath == "" {
		return nil, "", ErrNoIcon
	}
	mod, size, err := fileStamp(exePath)
	if err != nil {
		return nil, "", err
	}

	mu.Lock()
	if e, ok := cache[exePath]; ok && e.modTime == mod && e.size == size {
		seq++
		e.used = seq
		data, mime, cachedErr := e.data, e.mime, e.err
		mu.Unlock()
		return data, mime, cachedErr
	}
	mu.Unlock()

	data, mime, exErr := extractIcon(exePath)

	mu.Lock()
	seq++
	cache[exePath] = &entry{modTime: mod, size: size, data: data, mime: mime, err: exErr, used: seq}
	if len(cache) > cacheLimit {
		evictLocked()
	}
	mu.Unlock()

	return data, mime, exErr
}

// CacheLen 当前缓存条数（测试与观测用）。
func CacheLen() int {
	mu.Lock()
	defer mu.Unlock()
	return len(cache)
}

// ResetCache 清空缓存（测试用）。
func ResetCache() {
	mu.Lock()
	defer mu.Unlock()
	cache = make(map[string]*entry, cacheLimit)
}

// fileStamp 取文件的「修改时间 + 大小」，顺便把目录挡在外面。
func fileStamp(path string) (int64, int64, error) {
	st, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	if st.IsDir() {
		return 0, 0, fmt.Errorf("%s 是目录，不是可执行文件", path)
	}
	return st.ModTime().UnixNano(), st.Size(), nil
}

// evictLocked 淘汰最久未使用的一条（条目最多 256，线性扫描足够）。
func evictLocked() {
	var oldestKey string
	var oldest uint64 = ^uint64(0)
	for k, e := range cache {
		if e.used < oldest {
			oldest = e.used
			oldestKey = k
		}
	}
	if oldestKey != "" {
		delete(cache, oldestKey)
	}
}
