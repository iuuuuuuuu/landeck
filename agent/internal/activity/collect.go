package activity

import (
	"errors"
	"log"
	"sync"
	"time"
)

// openSegment 内存里「进行中」的一段。ID=0 表示还没落库
// （首次落库发生在第一个完整采样间隔后，避免留下大量零长度行）。
type openSegment struct {
	ID    int64
	Start int64
	End   int64
	App   string
	Title string
}

// upsertRange 把段的当前范围落库：新段 INSERT，已有段 UPDATE end。
// 每 30s 一次的写放大可忽略，换来的是进程被杀最多丢一个间隔的数据。
func (s *segmentStore) upsertRange(cur *openSegment) error {
	if cur.ID != 0 {
		return s.extend(cur.ID, cur.End)
	}
	if cur.End <= cur.Start {
		return nil
	}
	id, err := s.closeOpen(*cur)
	if err != nil {
		return err
	}
	cur.ID = id
	return nil
}

// ---------- tick 决策（纯函数，便于单测） ----------

// tickCtx 一次采样的全部输入。
type tickCtx struct {
	Settings   Settings
	Now        time.Time
	Supported  bool   // 平台是否实现了前台采样
	HaveSample bool   // SampleForeground 是否成功返回
	Sample     Sample // HaveSample 时有效
}

// tickResult 决策结果：状态 + 对当前段的动作。
type tickResult struct {
	State string // collecting | idle | resting | stopped | unsupported
	Flush bool   // 关闭当前段（落库并清空）
	Keep  bool   // 延续当前段（写 end）
	New   *openSegment
	Skip  string // 未采集原因（诊断用，仅测试与日志）
}

// decide 一次采样的完整决策。纯函数：不碰 IO、不碰时钟以外的可变状态。
//
// 决策优先级（从高到低）：总开关 → 平台支持 → 工作时段 → 采样成功 →
// 隐私命中 → 闲置 → 应用未变 → 应用切换。顺序错会让状态显示错乱
// （比如已停止时还显示「采集中」）。
func decide(t tickCtx, cur *openSegment) tickResult {
	if !t.Settings.Enabled {
		return tickResult{State: "stopped", Flush: cur != nil, Skip: "disabled"}
	}
	if !t.Supported {
		return tickResult{State: "unsupported", Skip: "unsupported"}
	}
	if t.Settings.WorkHoursEnabled && !inWorkHours(t.Now, t.Settings.WorkStart, t.Settings.WorkEnd) {
		return tickResult{State: "resting", Flush: cur != nil, Skip: "outside-work-hours"}
	}
	if !t.HaveSample {
		// 锁屏 / 切换动画 / UAC 安全桌面：前台窗口拿不到，按离开处理
		return tickResult{State: "collecting", Flush: cur != nil, Skip: "no-foreground"}
	}
	if IsPrivate(t.Sample.App, t.Sample.Title, t.Settings.PrivateRules) {
		// 隐私命中：整段丢弃，且不留任何「有一段被隐藏了」的痕迹
		return tickResult{State: "collecting", Flush: cur != nil, Skip: "private"}
	}
	if t.Sample.IdleSec >= t.Settings.IdleSec {
		return tickResult{State: "idle", Flush: cur != nil, Skip: "idle"}
	}

	app := normalizeApp(t.Sample.App)
	title := clipTitle(t.Sample.Title)
	if cur != nil && cur.App == app && cur.Title == title {
		return tickResult{State: "collecting", Keep: true,
			New: &openSegment{ID: cur.ID, Start: cur.Start, End: t.Now.Unix(), App: app, Title: title}}
	}
	return tickResult{State: "collecting", Flush: cur != nil,
		New: &openSegment{Start: t.Now.Unix(), End: t.Now.Unix(), App: app, Title: title}}
}

// ---------- 状态 ----------

// Status 采集状态（前端侧栏状态位）。
type Status struct {
	State    string `json:"state"` // collecting | idle | resting | stopped | unsupported
	Since    string `json:"since"` // 进入当前状态的 RFC3339 时刻
	App      string `json:"app,omitempty"`
	Category string `json:"category,omitempty"`
	Parent   string `json:"parent,omitempty"`
	Segments int64  `json:"segments"`
}

// ---------- Manager ----------

type Manager struct {
	mu        sync.Mutex
	db        *segmentStore
	settings  *settingsStore
	cur       *openSegment
	state     string
	stateAt   time.Time
	lastApp   string
	lastCat   string
	lastPar   string
	stop      chan struct{}
	done      chan struct{}
	supported bool
	sample    func() (Sample, bool, error)
}

var (
	startMu sync.Mutex
	mgr     *Manager
)

var (
	errNotStarted  = errors.New("activity 未启动")
	errUnsupported = errors.New("当前平台不支持前台采样")
)

// Start 打开存储并启动采集循环。重复调用返回已有实例。
// 数据库/设置初始化失败只打日志不 panic —— 采集是附加功能，
// 不能因为它把整个被控端拖死。
func Start(dir string) *Manager {
	startMu.Lock()
	defer startMu.Unlock()
	if mgr != nil {
		return mgr
	}
	sf, supported := sampleFunc()
	m := &Manager{
		state:     "stopped",
		stateAt:   time.Now(),
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
		supported: supported,
		sample:    sf,
	}
	db, err := openDB(joinPath(dir, "activity.db"))
	if err != nil {
		log.Printf("[activity] 段库打开失败（采集停用）: %v", err)
		m.supported = false
	} else {
		m.db = &segmentStore{db: db}
	}
	m.settings = openSettings(dir)

	// 启动即写一次设置文件：用户能在数据目录看到可编辑的默认值
	if err := m.settings.Update(func(*Settings) {}); err != nil {
		log.Printf("[activity] 设置落盘失败: %v", err)
	}
	if m.db != nil {
		if n, err := m.db.prune(m.settings.Get().RetentionDays, time.Now()); err != nil {
			log.Printf("[activity] 清理过期数据失败: %v", err)
		} else if n > 0 {
			log.Printf("[activity] 已清理 %d 条过期段", n)
		}
	}
	mgr = m
	go m.loop()
	return m
}

// Stop 停止采集循环并把进行中的段落库。幂等。
func Stop() {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return
	}
	close(m.stop)
	<-m.done
}

// loop 采集主循环。每个 tick：取设置 → decide → 执行。
// 所有可变状态都在本 goroutine 内，只有查询路径需要锁。
func (m *Manager) loop() {
	defer close(m.done)
	// 第一个 tick 立刻跑（启动后 1 秒内状态就绪），之后按设置间隔
	interval := time.Duration(m.settings.Get().IntervalSec) * time.Second
	if interval < time.Duration(intervalMin)*time.Second {
		interval = 30 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()

	first := time.NewTimer(time.Second)
	defer first.Stop()

	pruneT := time.NewTicker(24 * time.Hour)
	defer pruneT.Stop()

	for {
		select {
		case <-m.stop:
			m.mu.Lock()
			if m.cur != nil {
				_ = m.db.upsertRange(m.cur)
				m.cur = nil
			}
			m.mu.Unlock()
			return
		case <-first.C:
			m.tick()
		case <-t.C:
			// 间隔被改小/改大：跟随最新设置
			if sec := m.settings.Get().IntervalSec; sec > 0 {
				ni := time.Duration(sec) * time.Second
				if ni != interval {
					interval = ni
					t.Reset(ni)
				}
			}
			m.tick()
		case <-pruneT.C:
			if m.db != nil {
				if n, err := m.db.prune(m.settings.Get().RetentionDays, time.Now()); err == nil && n > 0 {
					log.Printf("[activity] 已清理 %d 条过期段", n)
				}
			}
		}
	}
}

// tick 执行一次采样决策。决策逻辑全部在 decide（纯函数），这里只做 IO。
func (m *Manager) tick() {
	st := m.settings.Get()
	ctx := tickCtx{Settings: st, Now: time.Now(), Supported: m.supported}
	if m.supported && m.sample != nil {
		s, ok, err := m.sample()
		if err != nil {
			// 偶发取不到（权限/会话切换）不算致命，按无前台处理
			ctx.HaveSample = false
		} else {
			ctx.HaveSample = ok
			ctx.Sample = s
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	res := decide(ctx, m.cur)

	if res.Flush && m.cur != nil {
		if err := m.db.upsertRange(m.cur); err != nil {
			log.Printf("[activity] 落库失败: %v", err)
		}
	}
	if res.New != nil {
		m.cur = res.New
		// 延续段每个 tick 推进 end；全新段（End==Start）upsertRange 会跳过，
		// 等下一个 tick 有真实时长才落库 —— 库里不会出现零长度行。
		if res.Keep {
			if err := m.db.upsertRange(m.cur); err != nil {
				log.Printf("[activity] 落库失败: %v", err)
			}
		}
	}

	if res.State != m.state || (res.State == "collecting" && (res.New == nil || res.New.App != m.lastApp)) {
		m.stateAt = ctx.Now
	}
	m.state = res.State
	if res.New != nil {
		m.lastApp = res.New.App
		p, c := Classify(res.New.App, res.New.Title, st.Categories)
		m.lastCat, m.lastPar = c, p
	}
}

// GetStatus 当前采集状态。
func GetStatus() Status {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return Status{State: "stopped", Since: time.Now().Format(time.RFC3339)}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	st := Status{State: m.state, Since: m.stateAt.Format(time.RFC3339), App: m.lastApp, Category: m.lastCat, Parent: m.lastPar}
	if m.db != nil {
		if n, err := m.db.count(); err == nil {
			st.Segments = n
		}
	}
	return st
}
