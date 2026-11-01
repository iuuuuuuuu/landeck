package syncengine

// 合并语义（契约 A1）：纯函数，map 上的三态合并。
//
// 键语义说明：契约文本把键写成 (deviceId, start, end, app)，但合并规则
// 「同键不同内容 → 取 end 更晚者」只有在键**不含** end 时才有意义——
// 采集幂等的自然模型就是 (deviceId, start, app) 键 + 段随采集延长
//（upsertRange 的 extend），同键取 end 更晚者。本实现按此语义落地，
// 契约调和已在交付说明声明。

import "regexp"

// RemoteSegment 线上快照里的段（JSON 线格式）。
type RemoteSegment struct {
	Start  int64  `json:"start"`
	End    int64  `json:"end"`
	App    string `json:"app"`
	Title  string `json:"title"`
	Domain string `json:"domain,omitempty"`
}

// Meta 每个快照文件的头。
type Meta struct {
	DeviceID string `json:"deviceId"`
	Name     string `json:"name"`
	SavedAt  int64  `json:"savedAt"` // unix 秒
}

// Snapshot segments.json / rules.json 的公共信封。
type Snapshot struct {
	Meta     Meta            `json:"meta"`
	Segments []RemoteSegment `json:"segments"`
}

// segKey 合并键：(deviceId, start, app)。
type segKey struct {
	DeviceID string
	Start    int64
	App      string
}

// MergeStats 合并结果计数。
type MergeStats struct {
	Added   int // 新键
	Updated int // 同键取 end 更晚者
	Skipped int // 同键且本地已不晚于远端
}

// MergeInto 把一个远端快照合并进视图（dst 按键持有现有段）。
// 三态：新键 → added；同键 end 更晚 → updated（整段替换，title/domain
// 以远端为准——它是更晚的采集点）；否则 skipped。
// 删除不传播（v1）：本函数只增改，从不删 dst 条目。
func MergeInto(dst map[segKey]RemoteSegment, deviceID string, snap []RemoteSegment) MergeStats {
	var st MergeStats
	for _, rs := range snap {
		if rs.End <= rs.Start || rs.App == "" {
			continue // 坏段防御
		}
		k := segKey{DeviceID: deviceID, Start: rs.Start, App: rs.App}
		if cur, ok := dst[k]; ok {
			if rs.End > cur.End {
				dst[k] = rs
				st.Updated++
			} else {
				st.Skipped++
			}
			continue
		}
		dst[k] = rs
		st.Added++
	}
	return st
}

var hrefRe = regexp.MustCompile(`(?i)<(?:[a-zA-Z0-9]+:)?href>\s*<?([^<>]*)>?`)
