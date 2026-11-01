package syncengine

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"landeck/internal/activity"
)

// ---- 纯函数：合并三态（同键跳过 / 同键取 end 更晚 / 新键）----

func TestMergeInto(t *testing.T) {
	dst := map[segKey]RemoteSegment{}
	dev := "devA"
	base := []RemoteSegment{
		{Start: 100, End: 200, App: "chrome", Title: "t1"},
		{Start: 300, End: 400, App: "code", Title: "t2"},
	}
	st := MergeInto(dst, dev, base)
	if st.Added != 2 || st.Updated != 0 || st.Skipped != 0 {
		t.Fatalf("首次合并应 added=2，得到 %+v", st)
	}

	// 同键同内容 → skipped（采集幂等）
	st = MergeInto(dst, dev, base)
	if st.Added != 0 || st.Skipped != 2 {
		t.Fatalf("同内容应 skipped=2，得到 %+v", st)
	}

	// 同键 end 更晚 → updated（段延长）
	ext := []RemoteSegment{{Start: 100, End: 250, App: "chrome", Title: "t1"}}
	st = MergeInto(dst, dev, ext)
	if st.Updated != 1 || dst[segKey{dev, 100, "chrome"}].End != 250 {
		t.Fatalf("end 更晚应 updated，得到 %+v", st)
	}

	// 同键 end 更早 → skipped（不回退）
	st = MergeInto(dst, dev, []RemoteSegment{{Start: 100, End: 150, App: "chrome", Title: "t1"}})
	if st.Skipped != 1 || dst[segKey{dev, 100, "chrome"}].End != 250 {
		t.Fatalf("end 更早不应回退，得到 %+v", st)
	}

	// 删除不传播：dst 里没有的键不会因远端缺失而消失（MergeInto 只增改，
	// 这里验证重复合并不产生删除副作用）
	if len(dst) != 2 {
		t.Fatalf("合并不应删除条目: %d", len(dst))
	}

	// 坏段防御：End<=Start、空 app
	st = MergeInto(dst, dev, []RemoteSegment{
		{Start: 500, End: 400, App: "x"},
		{Start: 500, End: 600, App: ""},
	})
	if st.Added != 0 {
		t.Fatalf("坏段应被跳过，得到 %+v", st)
	}
}

// ---- 内存 WebDAV 服务器（E2E 用；真 HTTP 语义 + Basic auth）----

type memDAV struct {
	mu    sync.Mutex
	files map[string][]byte
	dirs  map[string]bool
	user  string
	pass  string
}

func newMemDAV(user, pass string) *memDAV {
	return &memDAV{files: map[string][]byte{}, dirs: map[string]bool{}, user: user, pass: pass}
}

func (m *memDAV) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if u, p, ok := r.BasicAuth(); !ok || u != m.user || p != m.pass {
		w.WriteHeader(401)
		return
	}
	path := r.URL.Path
	switch r.Method {
	case http.MethodPut:
		m.mu.Lock()
		m.files[path] = readAll(r)
		// PUT 隐含创建父目录（部分服务器行为；客户端须兼容 409 的那一类）
		for d := parentDir(path); d != "" && d != "/"; d = parentDir(d) {
			m.dirs[d] = true
		}
		m.mu.Unlock()
		w.WriteHeader(201)
	case http.MethodGet:
		m.mu.Lock()
		data, ok := m.files[path]
		m.mu.Unlock()
		if !ok {
			w.WriteHeader(404)
			return
		}
		_, _ = w.Write(data)
	case "MKCOL":
		m.mu.Lock()
		if _, exists := m.files[path]; exists {
			m.mu.Unlock()
			w.WriteHeader(405)
			return
		}
		m.dirs[path] = true
		m.mu.Unlock()
		w.WriteHeader(201)
	case "PROPFIND":
		m.mu.Lock()
		var hrefs []string
		for f := range m.files {
			if len(f) > len(path) && f[:len(path)] == path {
				rel := f[len(path):]
				if i := indexOf(rel[1:], '/'); i >= 0 {
					hrefs = append(hrefs, "<D:href>"+path+"/"+rel[1:i+1]+"</D:href>")
				} else {
					hrefs = append(hrefs, "<D:href>"+path+rel+"</D:href>")
				}
			}
		}
		for d := range m.dirs {
			if len(d) > len(path) && d[:len(path)] == path {
				rel := d[len(path):]
				if rel == "" || indexOf(rel[1:], '/') >= 0 {
					continue
				}
				hrefs = append(hrefs, "<D:href>"+path+rel+"/</D:href>")
			}
		}
		m.mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(207)
		_, _ = w.Write([]byte(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">` + join(hrefs) + `</D:multistatus>`))
	default:
		w.WriteHeader(405)
	}
}

func readAll(r *http.Request) []byte {
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, err := r.Body.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if err != nil {
			break
		}
	}
	return buf
}

func indexOf(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func join(parts []string) string {
	out := ""
	for _, p := range parts {
		out += p
	}
	return out
}

// ---- 假件：两台"设备" ----

type fakeSource struct {
	id    string
	name  string
	segs  []activity.Segment
	asked []int64 // 每次 SegmentsAfter 的 after 值（水位线增量验证）
}

func (f *fakeSource) SegmentsAfter(after int64) []activity.Segment {
	f.asked = append(f.asked, after)
	var out []activity.Segment
	for _, g := range f.segs {
		if g.End > after {
			out = append(out, g)
		}
	}
	return out
}
func (f *fakeSource) Categories() []byte { return []byte(`[]`) }
func (f *fakeSource) DeviceName() string { return f.name }

type fakeStore struct {
	mu  sync.Mutex
	dev map[string]struct {
		name string
		svAt int64
		segs []activity.Segment
	}
}

func (f *fakeStore) ReplaceDevice(deviceID, name string, savedAt int64, segs []activity.Segment) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.dev[deviceID] = struct {
		name string
		svAt int64
		segs []activity.Segment
	}{name, savedAt, segs}
	return nil
}
func (f *fakeStore) Devices() []activity.SyncDevice {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []activity.SyncDevice
	for id, d := range f.dev {
		out = append(out, activity.SyncDevice{DeviceID: id, Name: d.name, LastSeenAt: d.svAt, Segments: int64(len(d.segs))})
	}
	return out
}
func (f *fakeStore) DeviceSegments(deviceID string) []activity.Segment {
	f.mu.Lock()
	defer f.mu.Unlock()
	if d, ok := f.dev[deviceID]; ok {
		return d.segs
	}
	return nil
}

// json round-trip 验证快照信封（meta 头带 deviceId/name/savedAt）
func TestSnapshotWire(t *testing.T) {
	snap := Snapshot{Meta: Meta{DeviceID: "devA", Name: "PC-A", SavedAt: 1790000000},
		Segments: []RemoteSegment{{Start: 1, End: 2, App: "chrome", Title: "t", Domain: "x.com"}}}
	raw, _ := json.Marshal(snap)
	var back Snapshot
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	if back.Meta.DeviceID != "devA" || back.Meta.Name != "PC-A" || len(back.Segments) != 1 || back.Segments[0].Domain != "x.com" {
		t.Fatalf("快照信封字段丢失: %+v", back)
	}
}

var _ = httptest.NewRecorder // 占位（E2E 在 e2e_test.go）
