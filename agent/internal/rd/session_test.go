package rd

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// fakeConn 记录所有出帧，测试里逐条断言。
type fakeConn struct {
	binaries [][]byte
	jsons    []json.RawMessage
	closed   bool
}

func (c *fakeConn) WriteBinary(j []byte, at int64) error {
	c.binaries = append(c.binaries, j)
	return nil
}
func (c *fakeConn) WriteJSON(v any) error {
	b, _ := json.Marshal(v)
	c.jsons = append(c.jsons, b)
	return nil
}
func (c *fakeConn) Close() error { c.closed = true; return nil }
func (c *fakeConn) lastJSON() map[string]any {
	if len(c.jsons) == 0 {
		return nil
	}
	var m map[string]any
	_ = json.Unmarshal(c.jsons[len(c.jsons)-1], &m)
	return m
}

// fakeBackend 桩：合成帧序列 + 注入/指示条记录器。
type fakeBackend struct {
	frames      []Frame // 依次返回；用尽后重复最后一帧
	idx         int
	injected    []InputEvent
	shownNames  []string
	hiddenCount int
	failCapture bool // 故障注入：抓帧始终失败
	screen      [2]int
}

func (b *fakeBackend) Capture() (Frame, error) {
	if b.failCapture {
		return Frame{}, errors.New("inject: capture failed")
	}
	if len(b.frames) == 0 {
		return makeFrame(64, 48, 1), nil
	}
	f := b.frames[min(b.idx, len(b.frames)-1)]
	if b.idx < len(b.frames) {
		b.idx++
	}
	return f, nil
}
func (b *fakeBackend) Inject(ev InputEvent) error { b.injected = append(b.injected, ev); return nil }
func (b *fakeBackend) ScreenSize() (int, int, error) {
	if b.screen[0] == 0 {
		return 1920, 1080, nil
	}
	return b.screen[0], b.screen[1], nil
}
func (b *fakeBackend) IndicatorShow(name string) { b.shownNames = append(b.shownNames, name) }
func (b *fakeBackend) IndicatorHide()            { b.hiddenCount++ }

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func newTestSession(b *fakeBackend) (*session, *fakeConn) {
	conn := &fakeConn{}
	s := newSession(conn, b, SessionConfig{IdleTimeout: 60 * time.Second})
	return s, conn
}

// hello：指示条显示来源 + agent 回 hello（带主屏尺寸）。
func TestSessionHello(t *testing.T) {
	b := &fakeBackend{}
	s, conn := newTestSession(b)

	if err := s.handleFrame([]byte(`{"t":"hello","name":"我的手机","os":"android"}`), time.Now()); err != nil {
		t.Fatalf("hello 出错: %v", err)
	}
	if len(b.shownNames) != 1 || b.shownNames[0] != "我的手机" {
		t.Fatalf("指示条未显示来源: %v", b.shownNames)
	}
	m := conn.lastJSON()
	if m == nil || m["t"] != "hello" || m["w"].(float64) != 1920 {
		t.Fatalf("agent 未回 hello（含主屏尺寸）: %v", m)
	}
}

// ping → pong；q/fps 参数生效。
func TestSessionControlFrames(t *testing.T) {
	b := &fakeBackend{}
	s, conn := newTestSession(b)
	now := time.Now()

	_ = s.handleFrame([]byte(`{"t":"ping"}`), now)
	if m := conn.lastJSON(); m == nil || m["t"] != "pong" {
		t.Fatalf("ping 未回 pong: %v", m)
	}

	_ = s.handleFrame([]byte(`{"t":"q","quality":85}`), now)
	if s.quality != 85 {
		t.Fatalf("画质未生效: %d", s.quality)
	}
	_ = s.handleFrame([]byte(`{"t":"fps","fps":15}`), now)
	if s.viewerFPS != 15 {
		t.Fatalf("帧率未生效: %d", s.viewerFPS)
	}
	// 越界画质钳回契约范围
	_ = s.handleFrame([]byte(`{"t":"q","quality":5}`), now)
	if s.quality != 30 {
		t.Fatalf("画质下限 30 未生效: %d", s.quality)
	}
}

// 输入帧到达后注入器收到对应事件。
func TestSessionInputInjection(t *testing.T) {
	b := &fakeBackend{}
	s, _ := newTestSession(b)
	now := time.Now()

	_ = s.handleFrame([]byte(`{"t":"m","x":0.25,"y":0.75,"b":"l","a":"down"}`), now)
	_ = s.handleFrame([]byte(`{"t":"k","code":65,"mods":["ctrl"],"down":true}`), now)
	_ = s.handleFrame([]byte(`{"t":"txt","text":"OK"}`), now)
	_ = s.handleFrame([]byte(`{"t":"w","dy":2}`), now)

	if len(b.injected) != 4 {
		t.Fatalf("注入事件数 %d != 4", len(b.injected))
	}
	if b.injected[0].Kind != "mouse" || b.injected[1].Kind != "key" ||
		b.injected[2].Kind != "text" || b.injected[3].Kind != "scroll" {
		t.Fatalf("注入事件类型不符: %+v", b.injected)
	}
}

// bye → 会话结束（指示条消失、连接关闭、槽位释放）。
func TestSessionBye(t *testing.T) {
	b := &fakeBackend{}
	s, conn := newTestSession(b)
	if !tryAcquire(s) {
		t.Fatal("初始获取会话失败")
	}
	if err := s.handleFrame([]byte(`{"t":"bye"}`), time.Now()); !errors.Is(err, errBye) {
		t.Fatalf("bye 应返回 errBye，得 %v", err)
	}
	s.end("bye")
	if !conn.closed || b.hiddenCount != 1 {
		t.Fatalf("bye 后未清理: closed=%v hidden=%d", conn.closed, b.hiddenCount)
	}
	// 槽位释放：新会话可获取
	s2, _ := newTestSession(b)
	if !tryAcquire(s2) {
		t.Fatal("槽位未释放")
	}
	release(s2)
}

// 空闲判定。
func TestSessionIdleExpired(t *testing.T) {
	b := &fakeBackend{}
	s, _ := newTestSession(b)
	now := time.Now()
	if s.idleExpired(now) {
		t.Fatal("尚无来帧不应判空闲（由读侧超时兜底）")
	}
	_ = s.handleFrame([]byte(`{"t":"ping"}`), now)
	if s.idleExpired(now.Add(30 * time.Second)) {
		t.Fatal("30s 不算空闲（阈值 60s）")
	}
	if !s.idleExpired(now.Add(61 * time.Second)) {
		t.Fatal("61s 应判空闲")
	}
}

// 帧泵：同帧跳过、变帧发送、质量变化影响 JPEG 尺寸。
func TestPumpOnce(t *testing.T) {
	b := &fakeBackend{frames: []Frame{makeFrame(64, 48, 10), makeFrame(64, 48, 10), makeFrame(64, 48, 200)}}
	s, conn := newTestSession(b)
	now := time.Now()

	sent, err := s.pumpOnce(now)
	if err != nil || !sent {
		t.Fatalf("首帧应发送: sent=%v err=%v", sent, err)
	}
	firstLen := len(conn.binaries[0])

	// 相同画面（b.frames[1] 与 [0] 相同）→ 跳帧
	sent, err = s.pumpOnce(now.Add(100 * time.Millisecond))
	if err != nil || sent {
		t.Fatalf("同帧应跳过: sent=%v err=%v", sent, err)
	}
	if len(conn.binaries) != 1 {
		t.Fatalf("跳帧不应出帧: %d", len(conn.binaries))
	}

	// 画面变化 → 发送
	sent, err = s.pumpOnce(now.Add(200 * time.Millisecond))
	if err != nil || !sent {
		t.Fatalf("变帧应发送: sent=%v err=%v", sent, err)
	}
	if len(conn.binaries[1]) == firstLen {
		t.Fatal("不同画面 JPEG 长度恰好相同？哈希逻辑可能坏了")
	}
}

// 抓帧连续失败熔断：故障注入证明门禁会红。
func TestPumpOnceConsecutiveFailure(t *testing.T) {
	b := &fakeBackend{failCapture: true}
	s, _ := newTestSession(b)
	now := time.Now()
	var last error
	for i := 0; i < s.cfg.MaxConsecErr; i++ {
		_, last = s.pumpOnce(now.Add(time.Duration(i) * time.Second))
	}
	if last == nil {
		t.Fatal("连续抓帧失败应熔断报错")
	}
}

// 会话结束后 pump 不再出帧。
func TestSessionEndStopsPump(t *testing.T) {
	b := &fakeBackend{frames: []Frame{makeFrame(64, 48, 10)}}
	s, conn := newTestSession(b)
	tryAcquire(s)
	s.end("test")
	n := len(conn.binaries)
	_, _ = s.pumpOnce(time.Now())
	if len(conn.binaries) != n {
		t.Fatal("会话结束后不应出帧")
	}
	if b.hiddenCount != 1 {
		t.Fatalf("end 应恰好隐藏一次指示条: %d", b.hiddenCount)
	}
}

// 单客户端语义：第二会话获取失败。
func TestSingleClient(t *testing.T) {
	b1 := &fakeBackend{}
	b2 := &fakeBackend{}
	s1, _ := newTestSession(b1)
	s2, _ := newTestSession(b2)
	if !tryAcquire(s1) {
		t.Fatal("第一会话应获取成功")
	}
	if tryAcquire(s2) {
		t.Fatal("第二会话不应获取成功")
	}
	s1.end("test")
	if !tryAcquire(s2) {
		t.Fatal("释放后第二会话应能获取")
	}
	s2.end("test")
}
