package activity

// 应用图标缓存：新应用首次被采样到时，异步从其 exe 提取图标，
// 按 normalizeApp 名存内存 + 磁盘（dataDir/appicons/<name>.ico）。
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
	// 单个 ICO 10–100KB，512 个最坏 ~50MB，足够极端多应用用户。
	MAX_ICON_CACHE = 512
)

type iconEntry struct {
	data []byte
	mime string
	etag string // 内容摘要前 16 hex，写响应头用
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
		if ext != ".ico" && ext != ".png" {
			continue
		}
		// 键必须与查找侧同一归一（normalizeApp），否则磁盘上存的
		// 「Code.ico」和用户查的「code.EXE」永远对不上
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
		mime := icons.MimeICO
		if ext == ".png" {
			mime = "image/png"
		}
		iconMem[app] = newIconEntry(data, mime)
	}
}

func newIconEntry(data []byte, mime string) iconEntry {
	sum := sha256.Sum256(data)
	return iconEntry{data: data, mime: mime, etag: hexPrefix(sum[:8])}
}

// markIconSeen 声明「这个应用的图标提取已安排/已结论」。
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

	ext := ".ico"
	if mime != icons.MimeICO {
		ext = ".png"
	}

	iconMu.Lock()
	// 上限保护：满了不再新增（512 个应用还没到的场景不值得引入 LRU）
	if len(iconMem) >= MAX_ICON_CACHE {
		iconMu.Unlock()
		return
	}
	iconMem[app] = newIconEntry(data, mime)
	iconMu.Unlock()

	// 落盘失败不影响本次会话（内存里已有），下次启动重新提取
	if iconDir != "" {
		_ = os.WriteFile(filepath.Join(iconDir, app+ext), data, 0o644)
	}
}

// GetAppIcon 供 HTTP 端点查询：只按「已缓存的应用名」出图。
//
// 安全要点：这里不接受任何路径/通配，name 先过 normalizeApp
// （小写、去路径、去 .exe），命中不了缓存就是 404——
// 端点不可能被用来探测文件系统。
func GetAppIcon(name string) (data []byte, mime, etag string, ok bool) {
	app := normalizeApp(name)
	if app == "" {
		return nil, "", "", false
	}
	iconMu.RLock()
	defer iconMu.RUnlock()
	e, hit := iconMem[app]
	if !hit {
		return nil, "", "", false
	}
	return e.data, e.mime, e.etag, true
}
