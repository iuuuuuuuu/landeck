package memory

// 采集循环与状态。

import (
	"fmt"
	"image"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"

	"landeck/internal/activity"
)

// Manager 屏幕记忆的运行体。与 activity.Manager 同构：
// 所有可变状态归采集 goroutine，查询走锁。
type Manager struct {
	mu       sync.Mutex
	dir      string     // dataDir（memory/ 子目录与其下 YYYY-MM/）
	ps1Path  string     // OCR 脚本落盘位置
	db       *shotStore // shots 表
	settings *settingsStore

	ocrJobs    chan ocrJob // OCR 队列（容量 1：忙时丢弃，绝不堆积）
	ocrDone    chan struct{}
	ocr        *ocrRunner
	ocrOk      int64 // 会话计数（status 端点）
	ocrFail    int64
	lastShotAt int64

	stop chan struct{}
	done chan struct{}
}

type ocrJob struct {
	id   int64
	path string
}

var (
	startMu sync.Mutex
	mgr     *Manager
)

// Start 启动屏幕记忆（默认关闭时也启动：设置端点要能改开关，
// 循环里按设置决定截不截）。OCR worker 一并起好。
func Start(dataDir string) *Manager {
	startMu.Lock()
	defer startMu.Unlock()
	if mgr != nil {
		return mgr
	}
	m := &Manager{
		dir:     dataDir,
		ps1Path: filepath.Join(dataDir, "memory", "ocr.ps1"),
		ocrJobs: make(chan ocrJob, 1),
		ocrDone: make(chan struct{}),
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}
	m.settings = openSettings(dataDir)

	db, err := openShotStore(filepath.Join(dataDir, "activity.db"))
	if err != nil {
		// 库打不开（\\?\ 路径等）：记忆功能整体降级，API 返回空但 agent 不死
		log.Printf("[memory] shots 库打开失败（记忆停用）: %v", err)
	} else {
		m.db = db
	}
	if err := m.settings.Update(func(*Settings) {}); err != nil {
		log.Printf("[memory] 设置落盘失败: %v", err)
	}
	// 脚本必须裸写：writeAtomic 会 json.Marshal，字符串会被整体 JSON 化
	// （引号包裹、\n 字面化），PowerShell 拿到的是垃圾——实测踩过。
	if err := os.MkdirAll(filepath.Dir(m.ps1Path), 0o755); err != nil {
		log.Printf("[memory] OCR 目录创建失败: %v", err)
		m.ps1Path = ""
	} else if err := os.WriteFile(m.ps1Path, []byte(ocrScript), 0o644); err != nil {
		log.Printf("[memory] OCR 脚本落盘失败: %v", err)
		m.ps1Path = ""
	}
	if m.db != nil {
		go m.retentionLoop() // 每小时清理（含启动后 5 分钟先跑一次）
	}
	mgr = m
	m.ocr = &ocrRunner{ps1: m.ps1Path}
	go m.loop()
	go m.ocrWorker()
	return m
}

// Stop 停循环、停 OCR worker、关库（资源归还，对齐 activity.Stop 的教训）。
func Stop() {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return
	}
	close(m.stop)
	<-m.done
	<-m.ocrDone
	if m.ocr != nil {
		m.ocr.close()
	}
	if m.db != nil {
		_ = m.db.db.Close()
	}
}

// retentionLoop 每小时清理过期截图（文件+行）。启动后 5 分钟先跑一次。
func (m *Manager) retentionLoop() {
	first := time.NewTimer(5 * time.Minute)
	defer first.Stop()
	hourly := time.NewTicker(time.Hour)
	defer hourly.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-first.C:
			m.prune()
		case <-hourly.C:
			m.prune()
		}
	}
}

func (m *Manager) prune() {
	st := m.settings.Get()
	cut := time.Now().AddDate(0, 0, -st.RetentionDays).Unix()
	files, n, err := m.db.pruneBefore(cut)
	if err != nil {
		log.Printf("[memory] 清理失败: %v", err)
		return
	}
	for _, f := range files {
		_ = os.Remove(filepath.Join(m.dir, "memory", f))
	}
	if n > 0 {
		log.Printf("[memory] 已清理 %d 张过期截图", n)
	}
	// 孤儿临时文件清扫：队列丢弃路径漏删、或进程被杀时遗留的 tmp-ocr-*.png
	entries, err := os.ReadDir(filepath.Join(m.dir, "memory"))
	if err != nil {
		return
	}
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "tmp-ocr-") || !strings.HasSuffix(e.Name(), ".png") {
			continue
		}
		if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > time.Hour {
			_ = os.Remove(filepath.Join(m.dir, "memory", e.Name()))
		}
	}
}

// loop 截屏主循环。
func (m *Manager) loop() {
	defer close(m.done)
	t := time.NewTicker(time.Duration(m.settings.Get().IntervalSec) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-t.C:
			// 间隔跟随设置：每个 tick 按当前设置重置（重置成同值无害，
			// 设置变更最多延迟一个旧周期生效，与 activity 同款取舍）
			if sec := m.settings.Get().IntervalSec; sec >= intervalMin && sec <= intervalMax {
				t.Reset(time.Duration(sec) * time.Second)
			}
			m.tick()
		}
	}
}

// tick 一次截屏决策 + 落盘 + 排队 OCR。
func (m *Manager) tick() {
	st := m.settings.Get()
	if m.db == nil {
		return
	}

	// 隐私门：前台命中 activity 隐私规则 → 本 tick 整个跳过（截图都不落盘）
	var sample sampleView
	haveSample := false
	if s, ok, err := activity.SampleForeground(); err == nil && ok {
		sample = sampleView{App: s.App, Title: s.Title}
		haveSample = true
	}
	// activity.IsPrivate 是三参（带规则表），包一层拿到「按当前规则」的谓词
	isPrivate := func(app, title string) bool {
		return activity.IsPrivate(app, title, activity.GetSettings().PrivateRules)
	}
	if !shouldShoot(st, haveSample, sample, isPrivate) {
		return
	}

	img, err := captureScreen()
	if err != nil {
		log.Printf("[memory] 截屏失败: %v", err)
		return
	}

	now := time.Now()
	dir := filepath.Join(m.dir, "memory", monthDir(now))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("[memory] 建目录失败: %v", err)
		return
	}
	name := shotFilename(now)
	path := filepath.Join(dir, name)

	// 契约存档：长边 >1920 等比降。⚠️多屏拼接（如 4608x1440）会被压到
	// 1920x600，每屏文字只剩 41% 大小——OCR 全是乱码（集成实测抓过）。
	// 所以 OCR 消费**全分辨率**临时文件（识别后即删），落盘仍按契约。
	// 两条路径分叉是刻意的：存档给人看（1920 足够锐利），OCR 给机器读。
	scaled := downscale(img)
	if err := writePNG(path, scaled); err != nil {
		log.Printf("[memory] PNG 写盘失败: %v", err)
		return
	}

	id, err := m.db.insert(now.Unix(), sample.App, name)
	if err != nil {
		log.Printf("[memory] 元数据落库失败: %v", err)
		return
	}
	m.mu.Lock()
	m.lastShotAt = now.Unix()
	m.mu.Unlock()

	// 全分辨率临时文件给 OCR：4608 宽下 Windows OCR 能读出
	// 「LanDeck / Firefox / music.163.com / git 提交」等真实词（降采样版全是乱码）
	tmpPath := filepath.Join(m.dir, "memory", fmt.Sprintf("tmp-ocr-%d.png", now.UnixMilli()))
	if err := writePNG(tmpPath, img); err != nil {
		log.Printf("[memory] OCR 临时文件写盘失败（跳过 OCR）: %v", err)
		return
	}

	// OCR 异步排队：忙时丢弃（队列容量 1），OCR 慢一拍不影响采集节奏；
	// 丢弃时临时文件立即删（否则要等孤儿清扫）
	select {
	case m.ocrJobs <- ocrJob{id: id, path: tmpPath}:
	default:
		_ = os.Remove(tmpPath)
	}
}

// downscale 长边 >1920 时等比降（契约），CatmullRom 对文字足够清晰。
func downscale(img image.Image) image.Image {
	const maxSide = 1920
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= maxSide && h <= maxSide {
		return img
	}
	scale := float64(maxSide) / float64(max(w, h))
	nw, nh := int(float64(w)*scale), int(float64(h)*scale)
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
	return dst
}

func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return fmt.Errorf("PNG 编码失败: %w", err)
	}
	return f.Close()
}

// ocrWorker 串行消化 OCR 队列。结果回填 shots.ocr。
func (m *Manager) ocrWorker() {
	for {
		select {
		case <-m.stop:
			close(m.ocrDone)
			return
		case job := <-m.ocrJobs:
			if m.ps1Path == "" || m.ocr == nil || m.db == nil {
				m.mu.Lock()
				m.ocrFail++
				m.mu.Unlock()
				continue
			}
			r, err := m.ocr.run(job.path)
			_ = os.Remove(job.path) // 临时文件：OCR 完（无论成败）即删
			if err != nil {
				log.Printf("[memory] OCR 失败: %v", err)
				m.mu.Lock()
				m.ocrFail++
				m.mu.Unlock()
				continue
			}
			_ = m.db.setOCR(job.id, clampRunes(r.Text(), 20000))
			m.mu.Lock()
			m.ocrOk++
			m.mu.Unlock()
		}
	}
}

// DownscaleForTest 探针用：暴露降采样。
func DownscaleForTest(img image.Image) image.Image { return downscale(img) }
