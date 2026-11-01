package syncengine

// E2E（十期验收核心）：内存 WebDAV 服务器 + 两台"设备"互相同步，
// 双方同步视图都覆盖两台数据。故障注入：WebDAV 不可达 → lastError。

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"landeck/internal/activity"
)

func newEngineOnDAV(t *testing.T, davURL, deviceID, deviceName string, segs []activity.Segment) (*Engine, *fakeStore, *fakeSource) {
	t.Helper()
	st, err := openSettings(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Update(func(s *Settings) {
		s.Enabled = true
		s.URL = davURL
		s.Username = "u"
		s.Password = "p"
		s.DeviceID = deviceID
		s.DeviceName = deviceName
		s.IntervalSec = 300
		s.LastPushedAt = 0 // 首推全量
	}); err != nil {
		t.Fatal(err)
	}
	src := &fakeSource{id: deviceID, name: deviceName, segs: segs}
	store := &fakeStore{dev: map[string]struct {
		name string
		svAt int64
		segs []activity.Segment
	}{}}
	return NewEngine(src, store, st), store, src
}

func TestE2ETwoDevices(t *testing.T) {
	dav := newMemDAV("u", "p")
	server := httptest.NewServer(dav)
	t.Cleanup(server.Close)

	// 设备 A：两段；设备 B：一段（不同 app/时间）
	segA := []activity.Segment{
		{Start: 1790000000, End: 1790001800, App: "chrome", Title: "A1", Domain: "youtube.com"},
		{Start: 1790003600, End: 1790005400, App: "code", Title: "A2"},
	}
	segB := []activity.Segment{
		{Start: 1790010000, End: 1790011200, App: "firefox", Title: "B1"},
	}
	eA, storeA, srcA := newEngineOnDAV(t, server.URL, "devA", "PC-A", segA)
	eB, storeB, srcB := newEngineOnDAV(t, server.URL, "devB", "PC-B", segB)

	// 各推一次
	resA := eA.SyncNow()
	if len(resA.Errors) > 0 || resA.Pushed != 2 {
		t.Fatalf("A 推送应 2 段无错，得到 %+v", resA)
	}
	resB := eB.SyncNow()
	if len(resB.Errors) > 0 || resB.Pushed != 1 {
		t.Fatalf("B 推送应 1 段无错，得到 %+v", resB)
	}

	// 各拉一次（互相同步）
	resA = eA.SyncNow()
	if len(resA.Errors) > 0 || resA.Pulled != 1 {
		t.Fatalf("A 拉取应 1 段无错，得到 %+v", resA)
	}
	resB = eB.SyncNow()
	if len(resB.Errors) > 0 || resB.Pulled != 2 {
		t.Fatalf("B 拉取应 2 段无错，得到 %+v", resB)
	}

	// 同步视图含「对方」设备（本机段不进视图——scopeAgg=all 时由
	// activity 侧把本机段与视图合并统计，见 activity 的 scopeAgg 测试）
	if devs := storeA.Devices(); len(devs) != 1 || devs[0].DeviceID != "devB" || devs[0].Name != "PC-B" {
		t.Fatalf("A 视图应恰含 devB(PC-B)，得到 %+v", devs)
	}
	if devs := storeB.Devices(); len(devs) != 1 || devs[0].DeviceID != "devA" {
		t.Fatalf("B 视图应恰含 devA，得到 %+v", devs)
	}
	// 对方的段完整到达
	if got := storeA.DeviceSegments("devB"); len(got) != 1 || got[0].App != "firefox" {
		t.Fatalf("A 视图里 devB 段不对: %+v", got)
	}
	gotA := storeB.DeviceSegments("devA")
	if len(gotA) != 2 {
		t.Fatalf("B 视图里 devA 应 2 段: %+v", gotA)
	}
	titles := map[string]bool{}
	for _, g := range gotA {
		titles[g.Title] = true
	}
	if !titles["A1"] || !titles["A2"] {
		t.Fatalf("B 视图里 devA 段缺 A1/A2（map 迭代序无关）: %+v", gotA)
	}
	_ = srcA
	_ = srcB

	// 合并幂等：再拉一遍 → skipped（新增 0）
	before := len(storeA.DeviceSegments("devB"))
	resA = eA.SyncNow()
	if len(resA.Errors) > 0 {
		t.Fatalf("重拉不应有错: %+v", resA)
	}
	if after := len(storeA.DeviceSegments("devB")); after != before {
		t.Fatalf("重拉不应改变视图: %d -> %d", before, after)
	}
}

// 水位线增量：首推后 lastPushedAt 记账，第二次只推 7 天窗口内的段
// （fake source 记录每次被问到的 after 值）。
func TestWatermarkIncrement(t *testing.T) {
	dav := newMemDAV("u", "p")
	server := httptest.NewServer(dav)
	t.Cleanup(server.Close)

	now := time.Now().Unix()
	segOld := activity.Segment{Start: now - 40*86400, End: now - 40*86400 + 600, App: "code", Title: "old"} // 40 天前：首推含（水位线 0 全量）、二推排除
	segNew := activity.Segment{Start: now - 3600, End: now - 1800, App: "chrome", Title: "new"}             // 1 小时前：窗口内
	eA, _, src := newEngineOnDAV(t, server.URL, "devA", "PC-A", []activity.Segment{segOld, segNew})

	res := eA.SyncNow()
	if len(res.Errors) > 0 || res.Pushed != 2 {
		t.Fatalf("首推应全量 2 段，得到 %+v", res)
	}
	if len(src.asked) == 0 || src.asked[0] > 0 {
		t.Fatalf("首推水位线应为 0（全量），得到 %v", src.asked)
	}
	// 第二次：lastPushedAt 已记账，after = lastPushedAt - 7d
	eA.SyncNow()
	if len(src.asked) < 2 {
		t.Fatalf("应有两次查询，得到 %v", src.asked)
	}
	second := src.asked[1]
	if second != eA.st.Get().LastPushedAt-int64(pushWindow/time.Second) {
		t.Fatalf("二次 after 应 = lastPushedAt-7d: %d", second)
	}
	// 二次推送里 40 天前的老段不在窗口（end > after 才推）
	// fake source 只返回窗口内的段 → 若 segOld.end < after，它不会出现在响应里
	if segOld.End > second {
		t.Fatalf("测试数据设计错误：老段应落在窗口外")
	}
	// 水位线记账
	if eA.st.Get().LastPushedAt == 0 {
		t.Fatal("同步成功应记账 lastPushedAt")
	}
}

// MKCOL：干净服务器（无目录）上首次 PUT 也要成功——
// 内存服务器隐含建目录，无法触发 409；用「严格服务器」验证 MKCOL 路径。
func TestPutMkcolStrict(t *testing.T) {
	strict := newStrictDAV()
	server := httptest.NewServer(strict)
	t.Cleanup(server.Close)
	c := NewClient(server.URL, "u", "p")

	// 目录不存在时 PUT 会 409，客户端应自动 MKCOL 后重试成功
	if err := c.Put("/landeck-sync/devA/segments.json", []byte(`{}`)); err != nil {
		t.Fatalf("严格服务器上 PUT 应自动 MKCOL 重试成功: %v", err)
	}
	data, err := c.Get("/landeck-sync/devA/segments.json")
	if err != nil || string(data) != `{}` {
		t.Fatalf("PUT 后 GET 应一致: %v %q", err, string(data))
	}
}

// 404 正常态：对方还没有数据 → ErrNotExist
func TestGet404IsNormal(t *testing.T) {
	dav := newMemDAV("u", "p")
	server := httptest.NewServer(dav)
	t.Cleanup(server.Close)
	c := NewClient(server.URL, "u", "p")
	if _, err := c.Get("/landeck-sync/nobody/segments.json"); err != ErrNotExist {
		t.Fatalf("404 应映射 ErrNotExist，得到 %v", err)
	}
}

// ---- 故障注入：WebDAV 不可达 → lastError 有内容 ----

func TestFaultUnreachable(t *testing.T) {
	st, err := openSettings(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Update(func(s *Settings) {
		s.Enabled = true
		s.URL = "http://127.0.0.1:1" // 不可达端口
		s.DeviceID = "devX"
		s.DeviceName = "X"
	}); err != nil {
		t.Fatal(err)
	}
	e := NewEngine(&fakeSource{id: "devX", name: "X"}, &fakeStore{dev: map[string]struct {
		name string
		svAt int64
		segs []activity.Segment
	}{}}, st)

	res := e.SyncNow()
	if len(res.Errors) == 0 {
		t.Fatal("不可达应产生错误")
	}
	got := st.Get()
	if got.LastError == "" {
		t.Fatal("lastError 应有内容")
	}
	if got.LastSyncAt == 0 {
		t.Fatal("lastSyncAt 应记账")
	}
	// lastError 有错时不推水位线（下次重试增量窗口不变）
	if got.LastPushedAt != 0 {
		t.Fatal("有错不应推进 lastPushedAt")
	}
}

// 严格 WebDAV：PUT 无父目录 → 409（逼客户端走 MKCOL 路径）
type strictDAV struct {
	mu    sync.Mutex
	files map[string][]byte
	dirs  map[string]bool
}

func newStrictDAV() *strictDAV {
	return &strictDAV{files: map[string][]byte{}, dirs: map[string]bool{}}
}

func (m *strictDAV) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch r.Method {
	case http.MethodPut:
		m.mu.Lock()
		parent := parentDir(path)
		if parent != "" && !m.dirs[parent] {
			m.mu.Unlock()
			w.WriteHeader(409)
			return
		}
		m.files[path] = readAll(r)
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
		m.dirs[path] = true
		m.mu.Unlock()
		w.WriteHeader(201)
	default:
		w.WriteHeader(405)
	}
}
