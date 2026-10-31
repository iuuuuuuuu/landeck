package activity

// 应用图标缓存：新应用首次被采样到时，异步从其 exe 提取图标，
// 按 normalizeApp 名存内存 + 磁盘（dataDir/appicons/<name>.ico）。
// 本地没有的应用再走在线回退（iconify.go）。
//
// 为什么异步：icons.Extract 要解析 PE 资源段（几 ms~几十 ms），
// 绝不能进 30s 采样热路径；首次见到应用时起一个 goroutine 一次性完成。
//
// 为什么有负缓存：控制台程序 / Go 静态编译的 exe 没有图标资源（ErrNoIcon），
// 不记负缓存就会每次见到都白解析一遍。失败按会话期记忆（重启后再试一次，
// 因为 exe 可能升级换了图标）。
//
// 磁盘缓存在启动时整体扫进内存索引：图标文件很小（10–100KB），
// 全量驻留换来查询零 IO；上限由 MAX_ICON_CACHE 兜底。

import (
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"landeck/internal/icons"
)

const (
	// MAX_ICON_CACHE 内存里最多驻留多少个应用的图标。
	// 单个 ICO/SVG 10–100KB，512 个最坏 ~50MB，足够极端多应用用户。
	MAX_ICON_CACHE = 512
)

type iconEntry struct {
	data []byte
	mime string
	etag string // 内容摘要 hex，写响应头用
}

var (
	iconMu     sync.RWMutex
	iconMem    map[string]iconEntry
	iconFailed = map[string]bool{}
	iconDir    string
)

// initIconStore 建目录 + 把磁盘上已有的图标扫回内存。
func initIconStore(dataDir string) {
	iconDir = filepath.Join(dataDir, "appicons")
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		iconDir = "" // 目录建不出来（只读盘等）：图标功能静默降级为仅内存
	}
	iconMu.Lock()
	defer iconMu.Unlock()
	iconMem = make(map[string]iconEntry, 64)
	if iconDir == "" {
		return
	}
	entries, err := os.ReadDir(iconDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(name))
		mime := mimeByExt(ext)
		if mime == "" {
			continue
		}
		// 键必须与查找侧同一归一（normalizeApp），否则磁盘上存的
		// 「Code.ico」和用户查的「code.EXE」永远对不上（实测踩过）
		app := normalizeApp(strings.TrimSuffix(name, ext))
		if app == "" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(iconDir, name))
		if err != nil || len(data) == 0 {
			continue
		}
		if len(iconMem) >= MAX_ICON_CACHE {
			break
		}
		iconMem[app] = newIconEntry(data, mime)
	}
}

func mimeByExt(ext string) string {
	switch ext {
	case ".ico":
		return icons.MimeICO
	case ".png":
		return "image/png"
	case ".svg":
		return "image/svg+xml"
	}
	return ""
}

func newIconEntry(data []byte, mime string) iconEntry {
	sum := sha256.Sum256(data)
	return iconEntry{data: data, mime: mime, etag: hexPrefix(sum[:8])}
}

// markIconSeen 声明「这个应用的本地图标提取已安排/已结论」。
// 采集循环在新应用首次出现时调用：true=此前没见过（调用方应发起提取）。
func markIconSeen(app string) bool {
	iconMu.Lock()
	defer iconMu.Unlock()
	if _, ok := iconMem[app]; ok {
		return false
	}
	if iconFailed[app] {
		return false
	}
	// 占位：防止同一应用被并发提取两次（真数据由 extract 回填）
	if _, pending := iconPending[app]; pending {
		return false
	}
	iconPending[app] = true
	return true
}

// iconPending 提取中的占位集合（见 markIconSeen）。
var iconPending = map[string]bool{}

// extractAppIcon 提取并落盘。独立 goroutine 里跑，绝不阻塞采样。
func extractAppIcon(app, exePath string) {
	defer func() {
		iconMu.Lock()
		delete(iconPending, app)
		iconMu.Unlock()
	}()
	data, mime, err := icons.Extract(exePath)
	if err != nil || len(data) == 0 {
		iconMu.Lock()
		iconFailed[app] = true
		iconMu.Unlock()
		return
	}
	persistIcon(app, data, mime)
}

// persistIcon 图标写内存 + 磁盘（本地提取与在线转存共用一条路径）。
// 落盘失败不影响本次会话（内存里已有），下次启动重新提取/拉取。
func persistIcon(app string, data []byte, mime string) {
	ext := ".ico"
	switch mime {
	case "image/svg+xml":
		ext = ".svg"
	case "image/png":
		ext = ".png"
	}

	iconMu.Lock()
	// 上限保护：满了不再新增（512 个应用还没到的场景不值得引入 LRU）
	if len(iconMem) >= MAX_ICON_CACHE {
		iconMu.Unlock()
		return
	}
	iconMem[app] = newIconEntry(data, mime)
	iconDirCopy := iconDir
	iconMu.Unlock()

	if iconDirCopy != "" {
		_ = os.WriteFile(filepath.Join(iconDirCopy, app+ext), data, 0o644)
	}
}

// lookupIcon 纯内存查找（AppIcon 链的第一环）。
func lookupIcon(app string) (iconEntry, bool) {
	iconMu.RLock()
	defer iconMu.RUnlock()
	e, hit := iconMem[app]
	return e, hit
}

// AppIcon 图标端点的完整查找链：
//
//	本地缓存（内存/磁盘启动时灌入）→ slug 匹配 → 在线拉取（iconify）→ miss
//
// name 先过 normalizeApp：端点只按缓存键出图，请求路径上零文件系统访问。
func AppIcon(name string) (data []byte, mime, etag string, ok bool) {
	app := normalizeApp(name)
	if app == "" {
		return nil, "", "", false
	}
	if e, hit := lookupIcon(app); hit {
		return e.data, e.mime, e.etag, true
	}

	// 在线回退：slug 没命中不发请求；失败负缓存 10 分钟不打外网
	slug := matchSlug(app)
	if slug == "" {
		return nil, "", "", false
	}
	if onlineFailedRecently(app) {
		return nil, "", "", false
	}
	if d, ok := fetchOnlineIcon(app, slug); ok {
		e, hit := lookupIcon(app)
		if !hit {
			return nil, "", "", false // 理论不可达：fetch 成功必已写入缓存
		}
		_ = d
		return e.data, e.mime, e.etag, true
	}
	return nil, "", "", false
}
