package syncengine

// 同步引擎：push（本机段→WebDAV）+ pull（其他设备→activity 的 sync_segments）。
//
// 依赖倒置（可测性）：Engine 不直接摸 activity 包级单例——
// Source/Store 是最小接口，main 装配 production 适配器（activity 包），
// 测试装配内存假件（同一进程跑两台"设备"）。

import (
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"landeck/internal/activity"
)

// Source 本机段的数据源（activity 适配器实现）。
type Source interface {
	// SegmentsAfter 返回 end > after 的本机段（start 升序）。
	SegmentsAfter(after int64) []activity.Segment
	// Categories 当前分类规则的 JSON 序列化（rules.json 推送内容）。
	Categories() []byte
	DeviceName() string
}

// Store 同步视图的存储（activity 的 sync_segments 表适配器实现）。
type Store interface {
	// ReplaceDevice 用给定段替换某设备的同步视图（merge 已在内存完成），
	// 并记录设备名与快照时间。
	ReplaceDevice(deviceID, name string, savedAt int64, segs []activity.Segment) error
	// Devices 返回同步视图里的设备清单（status 端点）。
	Devices() []activity.SyncDevice
	// DeviceSegments 某设备已合并的段（merge 基线）。
	DeviceSegments(deviceID string) []activity.Segment
}

type Engine struct {
	mu       sync.Mutex
	src      Source
	store    Store
	st       *settingsStore
	stop     chan struct{}
	done     chan struct{}
	endpoint string // /landeck-sync
}

// NewEngine 组装（测试可直接传假件）。
func NewEngine(src Source, store Store, st *settingsStore) *Engine {
	return &Engine{src: src, store: store, st: st, stop: make(chan struct{}), done: make(chan struct{}), endpoint: "/landeck-sync"}
}

func (e *Engine) loop() {
	defer close(e.done)
	t := time.NewTicker(time.Duration(e.st.Get().IntervalSec) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-e.stop:
			return
		case <-t.C:
			st := e.st.Get()
			if !st.Enabled || st.URL == "" {
				continue
			}
			if sec := st.IntervalSec; sec >= intervalMin && sec <= intervalMax {
				t.Reset(time.Duration(sec) * time.Second)
			}
			_ = e.SyncNow()
		}
	}
}

// SyncResult 一次同步的结果（/sync/now 返回体）。
type SyncResult struct {
	Pushed int      `json:"pushed"`
	Pulled int      `json:"pulled"`
	Errors []string `json:"errors"`
}

func (e *Engine) enabled() (Settings, bool) {
	st := e.st.Get()
	if !st.Enabled || st.URL == "" {
		return st, false
	}
	return st, true
}

// SyncNow 立即执行一次 push+pull。任何步骤失败记入 Errors 与
// lastError，**绝不影响本机采集**（独立 goroutine/独立 DB 连接）。
func (e *Engine) SyncNow() SyncResult {
	var res SyncResult
	st, ok := e.enabled()
	if !ok {
		res.Errors = append(res.Errors, "sync disabled")
		return res
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	client := NewClient(st.URL, st.Username, st.Password)
	base := e.endpoint + "/" + st.DeviceID

	// ---- push：本机段（end > lastPushedAt-7d 增量；水位线 0=首推全量）----
	// WebDAV 没有 append/If-Match 增量语义，纯增量 PUT 会把远端自己的文件
	// 覆盖成空集（老数据丢失，新设备拉不到）——落地为 GET 自己的文件 →
	// merge 增量 → PUT 累计快照：远端文件单调不减，水位线只影响新增计数。
	after := st.LastPushedAt - int64(pushWindow/time.Second)
	segs := e.src.SegmentsAfter(after)
	view := map[segKey]RemoteSegment{}
	if old, err := client.Get(base + "/segments.json"); err == nil {
		var prev Snapshot
		if err := json.Unmarshal(old, &prev); err == nil {
			for _, rs := range prev.Segments {
				view[segKey{DeviceID: st.DeviceID, Start: rs.Start, App: rs.App}] = rs
			}
		}
	} else if err != ErrNotExist {
		res.Errors = append(res.Errors, "read own snapshot: "+err.Error())
	}
	ms := MergeInto(view, st.DeviceID, func() []RemoteSegment {
		var rs []RemoteSegment
		for _, g := range segs {
			rs = append(rs, RemoteSegment{Start: g.Start, End: g.End, App: g.App, Title: g.Title, Domain: g.Domain})
		}
		return rs
	}())
	snap := Snapshot{
		Meta: Meta{DeviceID: st.DeviceID, Name: e.src.DeviceName(), SavedAt: time.Now().Unix()},
	}
	for _, rs := range view {
		snap.Segments = append(snap.Segments, rs)
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		res.Errors = append(res.Errors, "marshal: "+err.Error())
	}
	if err == nil {
		if err := client.Put(base+"/segments.json", raw); err != nil {
			res.Errors = append(res.Errors, "push segments: "+err.Error())
		} else {
			res.Pushed = ms.Added + ms.Updated // 新增/更新的段数（同键跳过不计数）
		}
	}
	if rules := e.src.Categories(); len(rules) > 0 {
		if err := client.Put(base+"/rules.json", rules); err != nil {
			res.Errors = append(res.Errors, "push rules: "+err.Error())
		}
	}

	// ---- pull：其他设备的 segments.json ----
	deviceIDs, err := client.ListDevices(e.endpoint)
	if err != nil {
		if err != ErrNotExist {
			res.Errors = append(res.Errors, "list devices: "+err.Error())
		}
	}
	pulledTotal := 0
	for _, dev := range deviceIDs {
		if dev == st.DeviceID {
			continue // 自己的文件刚推过，跳过
		}
		raw, err := client.Get(e.endpoint + "/" + dev + "/segments.json")
		if err != nil {
			if err != ErrNotExist {
				res.Errors = append(res.Errors, "pull "+dev+": "+err.Error())
			}
			continue // 404=对方还没数据，正常态
		}
		var snap Snapshot
		if err := json.Unmarshal(raw, &snap); err != nil {
			res.Errors = append(res.Errors, "parse "+dev+": "+err.Error())
			continue
		}
		if snap.Meta.DeviceID == "" {
			snap.Meta.DeviceID = dev // 老格式兜底
		}
		// merge 纯函数在内存视图上做三态合并，再整体替换该设备的表内容
		existing := e.store.DeviceSegments(dev)
		view := map[segKey]RemoteSegment{}
		for _, g := range existing {
			view[segKey{DeviceID: dev, Start: g.Start, App: g.App}] = RemoteSegment{Start: g.Start, End: g.End, App: g.App, Title: g.Title, Domain: g.Domain}
		}
		ms := MergeInto(view, dev, snap.Segments)
		pulledTotal += ms.Added + ms.Updated + ms.Skipped
		var merged []activity.Segment
		for _, rs := range view {
			merged = append(merged, activity.Segment{Start: rs.Start, End: rs.End, App: rs.App, Title: rs.Title, Domain: rs.Domain})
		}
		if err := e.store.ReplaceDevice(snap.Meta.DeviceID, snap.Meta.Name, snap.Meta.SavedAt, merged); err != nil {
			res.Errors = append(res.Errors, "store "+dev+": "+err.Error())
		}
	}
	res.Pulled = pulledTotal

	// ---- 收尾：水位线/lastError（有错不推水位线，下次重试）----
	errStr := ""
	if len(res.Errors) > 0 {
		errStr = strings.Join(res.Errors, "; ")
		log.Printf("[sync] 同步完成（有错误）: %s", errStr)
	} else {
		log.Printf("[sync] 同步完成: pushed=%d pulled=%d", res.Pushed, res.Pulled)
	}
	e.st.markSynced(time.Now().Unix(), errStr)
	return res
}

// ---- production 适配器（activity 包级单例桥接）----

type activitySyncSource struct{}

func (activitySyncSource) SegmentsAfter(after int64) []activity.Segment {
	return activity.SegmentsAfter(after)
}

func (activitySyncSource) Categories() []byte { return activity.ExportCategoriesJSON() }

func (activitySyncSource) DeviceName() string { return activity.DeviceName() }

type activitySyncStore struct{}

func (activitySyncStore) ReplaceDevice(deviceID, name string, savedAt int64, segs []activity.Segment) error {
	return activity.ReplaceSyncDevice(deviceID, name, savedAt, segs)
}

func (activitySyncStore) Devices() []activity.SyncDevice { return activity.SyncDevices() }

// DeviceSegments 返回某设备已合并的段（merge 基线）。
func (activitySyncStore) DeviceSegments(deviceID string) []activity.Segment {
	return activity.SyncDeviceSegments(deviceID)
}
