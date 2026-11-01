package syncengine

// 包级单例（main 生产装配）；测试用 NewEngine 直造实例。

import (
	"sync"

	"landeck/internal/activity"
)

var (
	startMu sync.Mutex
	mgr     *Engine
)

// StartProduction 生产装配（main 调用）：activity 适配器 + 定时循环。
// 返回的停止函数供 main 的 Stop 流程调用。幂等（重复 Start 返回既有实例）。
func StartProduction(dataDir string) (stop func(), err error) {
	startMu.Lock()
	defer startMu.Unlock()
	if mgr != nil {
		e := mgr
		return func() {
			close(e.stop)
			<-e.done
			startMu.Lock()
			mgr = nil
			startMu.Unlock()
		}, nil
	}
	st, err := openSettings(dataDir)
	if err != nil {
		return nil, err
	}
	e := NewEngine(activitySyncSource{}, activitySyncStore{}, st)
	mgr = e
	go e.loop()
	return func() {
		close(e.stop)
		<-e.done
		startMu.Lock()
		mgr = nil
		startMu.Unlock()
	}, nil
}

// StopProduction 停止引擎（测试用；main 用 StartProduction 返回的闭包）。
func StopProduction() error {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return errSyncNotStarted
	}
	close(m.stop)
	<-m.done
	startMu.Lock()
	mgr = nil
	startMu.Unlock()
	return nil
}

// GetSettings 设置（含水位线/lastError；password 不打码——打码在 httpapi 层）。
func GetSettings() Settings {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return Settings{IntervalSec: 300, DeviceName: hostnameOr("unknown-pc")}
	}
	return m.st.Get()
}

// UpdateSettings 部分更新（httpapi PUT）。
func UpdateSettings(fn func(*Settings)) error {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return errSyncNotStarted
	}
	return m.st.Update(fn)
}

// SyncNow 立即同步（httpapi POST /sync/now）。
func SyncNow() SyncResult {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return SyncResult{Errors: []string{errSyncNotStarted.Error()}}
	}
	return m.SyncNow()
}

// StatusView /sync/status 响应体。
type StatusView struct {
	Enabled    bool                  `json:"enabled"`
	LastSyncAt int64                 `json:"lastSyncAt"`
	LastError  string                `json:"lastError"`
	Devices    []activity.SyncDevice `json:"devices"`
}

// StatusViewOf 组装 status。
func StatusViewOf() StatusView {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return StatusView{Devices: []activity.SyncDevice{}}
	}
	st := m.st.Get()
	return StatusView{
		Enabled:    st.Enabled,
		LastSyncAt: st.LastSyncAt,
		LastError:  st.LastError,
		Devices:    m.store.Devices(),
	}
}
