package activity

// 同步视图存储（十期 A1）：syncengine 包拉取其他设备的段后，
// 通过本文件的导出函数写入 activity.db 的 sync_segments 表；
// scopeAgg=all 的 summary/rank 读取它。删除不传播（v1）：
// 本机 Clear 只清本机段，sync_segments 是别人的数据不动。

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

// SyncDevice status 端点的设备条目。
type SyncDevice struct {
	DeviceID   string `json:"deviceId"`
	Name       string `json:"name"`
	Segments   int64  `json:"segments"`
	LastSeenAt int64  `json:"lastSeenAt"` // 对方快照的 savedAt
}

const syncSchema = `
CREATE TABLE IF NOT EXISTS sync_segments (
	deviceId TEXT NOT NULL,
	name     TEXT NOT NULL DEFAULT '',
	savedAt  INTEGER NOT NULL DEFAULT 0,
	start    INTEGER NOT NULL,
	"end"    INTEGER NOT NULL,
	app      TEXT    NOT NULL,
	title    TEXT    NOT NULL DEFAULT '',
	domain   TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sync_dev  ON sync_segments(deviceId);
CREATE INDEX IF NOT EXISTS idx_sync_end  ON sync_segments("end");
CREATE TABLE IF NOT EXISTS sync_devices (
	deviceId   TEXT PRIMARY KEY,
	name       TEXT NOT NULL DEFAULT '',
	savedAt    INTEGER NOT NULL DEFAULT 0,
	updatedAt  INTEGER NOT NULL DEFAULT 0
);
`

var (
	syncMu      sync.Mutex
	syncDBReady bool
)

// ensureSyncTable 在共享的 activity.db 连接上建表（幂等；activity 与
// memory 先例同款：多包各持连接，WAL 兜并发）。
func ensureSyncTable() {
	if syncDBReady {
		return
	}
	syncMu.Lock()
	defer syncMu.Unlock()
	if syncDBReady {
		return
	}
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return
	}
	_, _ = m.db.db.Exec(syncSchema)
	syncDBReady = true
}

// SegmentsAfter 本机段导出（同步推送用）：end > after，start 升序。
func SegmentsAfter(after int64) []Segment {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return nil
	}
	segs, err := m.db.rangeSegs(after, 1<<62)
	if err != nil {
		return nil
	}
	return segs
}

// ExportCategoriesJSON 当前分类规则的 JSON（rules.json 推送内容）。
func ExportCategoriesJSON() []byte {
	raw, err := json.Marshal(GetSettings().Categories)
	if err != nil {
		return nil
	}
	return raw
}

// DeviceName 本机显示名（快照 meta 用）。
func DeviceName() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "unknown-pc"
	}
	return h
}

// ReplaceSyncDevice 整体替换某设备的同步视图（merge 后调用）。
func ReplaceSyncDevice(deviceID, name string, savedAt int64, segs []Segment) error {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return errNotStarted
	}
	ensureSyncTable()
	db := m.db.db
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM sync_segments WHERE deviceId=?`, deviceID); err != nil {
		return err
	}
	for _, g := range segs {
		if _, err := tx.Exec(`INSERT INTO sync_segments(deviceId, name, savedAt, start, "end", app, title, domain) VALUES(?,?,?,?,?,?,?,?)`,
			deviceID, name, savedAt, g.Start, g.End, g.App, g.Title, g.Domain); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`INSERT INTO sync_devices(deviceId, name, savedAt, updatedAt) VALUES(?,?,?,?)
		ON CONFLICT(deviceId) DO UPDATE SET name=excluded.name, savedAt=excluded.savedAt, updatedAt=excluded.updatedAt`,
		deviceID, name, savedAt, time.Now().Unix())
	if err != nil {
		return err
	}
	return tx.Commit()
}

// SyncDevices 设备清单（status 端点）。
func SyncDevices() []SyncDevice {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return nil
	}
	ensureSyncTable()
	rows, err := m.db.db.Query(`SELECT deviceId, name, savedAt,
		(SELECT COUNT(*) FROM sync_segments s2 WHERE s2.deviceId = s1.deviceId) AS segs
		FROM sync_devices s1 ORDER BY name`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []SyncDevice
	for rows.Next() {
		var d SyncDevice
		if err := rows.Scan(&d.DeviceID, &d.Name, &d.LastSeenAt, &d.Segments); err != nil {
			continue
		}
		out = append(out, d)
	}
	return out
}

// SyncDeviceSegments 某设备的同步段（merge 基线）。
func SyncDeviceSegments(deviceID string) []Segment {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return nil
	}
	ensureSyncTable()
	rows, err := m.db.db.Query(`SELECT start, "end", app, title, domain FROM sync_segments WHERE deviceId=?`, deviceID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Segment
	for rows.Next() {
		var g Segment
		if err := rows.Scan(&g.Start, &g.End, &g.App, &g.Title, &g.Domain); err != nil {
			continue
		}
		out = append(out, g)
	}
	return out
}

// SyncSegsInRange scopeAgg=all 用：同步视图里落在 [from, to) 的段。
func SyncSegsInRange(from, to int64) []Segment {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return nil
	}
	ensureSyncTable()
	rows, err := m.db.db.Query(`SELECT start, "end", app, title, domain FROM sync_segments WHERE start < ? AND "end" > ?`, to, from)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []Segment
	for rows.Next() {
		var g Segment
		if err := rows.Scan(&g.Start, &g.End, &g.App, &g.Title, &g.Domain); err != nil {
			continue
		}
		out = append(out, g)
	}
	return out
}

// ClearSyncView 手动清空同步视图（设置页「清除同步数据」可后续接上）。
func ClearSyncView() error {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil || m.db == nil {
		return errNotStarted
	}
	ensureSyncTable()
	_, err := m.db.db.Exec(`DELETE FROM sync_segments`)
	_, err2 := m.db.db.Exec(`DELETE FROM sync_devices`)
	if err != nil {
		return err
	}
	return err2
}
