package rd

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"landeck/internal/config"
)

// stubBackend 供 Register 全链路测试：合成变帧 + 记录注入与指示条。
type stubBackend struct {
	mu         sync.Mutex
	frameSeq   int
	injected   []InputEvent
	shownNames []string
	hidden     int
}

func (b *stubBackend) Capture() (Frame, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.frameSeq++
	return makeFrame(64, 48, byte(b.frameSeq*17)), nil
}
func (b *stubBackend) Inject(ev InputEvent) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.injected = append(b.injected, ev)
	return nil
}
func (b *stubBackend) ScreenSize() (int, int, error) { return 1920, 1080, nil }
func (b *stubBackend) IndicatorShow(name string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.shownNames = append(b.shownNames, name)
}
func (b *stubBackend) IndicatorHide() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.hidden++
}

// newRDServer：mux + rd.Register + 免鉴权 protect（真签名）。
func newRDServer(t *testing.T, backend Backend) *httptest.Server {
	t.Helper()
	old := newBackend
	newBackend = func() (Backend, error) { return backend, nil }
	t.Cleanup(func() { newBackend = old })

	mux := http.NewServeMux()
	Register(mux, func(h func(http.ResponseWriter, *http.Request, *config.Client)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			h(w, r, &config.Client{ID: "test", Name: "测试查看端", Role: "owner"})
		}
	})
	return httptest.NewServer(mux)
}

func dialWS(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ws, _, err := websocket.DefaultDialer.Dial(strings.Replace(url, "http://", "ws://", 1), nil)
	if err != nil {
		t.Fatalf("WS 拨号失败: %v", err)
	}
	return ws
}

func readJSONDeadline(t *testing.T, ws *websocket.Conn) map[string]any {
	t.Helper()
	_ = ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	// 二进制帧（pump 发的屏幕帧）可能与控制 JSON 并发到达——跳过它们等 JSON
	for {
		mt, data, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("读 JSON 帧: %v", err)
		}
		if mt != websocket.TextMessage {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("JSON 解析: %v (raw=%s)", err, string(data))
		}
		return m
	}
}

// 全链路：hello → 二进制帧（0x01 头 + ms + JPEG）→ 输入注入 → bye。
func TestStreamFullChain(t *testing.T) {
	backend := &stubBackend{}
	srv := newRDServer(t, backend)
	defer srv.Close()

	ws := dialWS(t, srv.URL+"/api/v1/rd/stream?token=test-token")
	defer ws.Close()

	// hello（会话建立 + 指示条）
	if err := ws.WriteJSON(map[string]any{"t": "hello", "name": "我的手机", "os": "android"}); err != nil {
		t.Fatalf("发 hello: %v", err)
	}
	hello := readJSONDeadline(t, ws)
	if hello["t"] != "hello" || hello["w"].(float64) != 1920 {
		t.Fatalf("agent 未回 hello: %v", hello)
	}

	// 二进制帧：0x01 头 + 4B unixMs + JPEG（激活期 10fps，稍等就有几帧）
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	mt, data, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("读二进制帧: %v", err)
	}
	if mt != websocket.BinaryMessage {
		t.Fatalf("帧类型应为二进制: %v", mt)
	}
	if len(data) < 6 || data[0] != 0x01 {
		t.Fatalf("帧头应为 0x01 + ms: % x", data[:min(5, len(data))])
	}
	if len(data) <= 5 || data[5] != 0xFF || data[6] != 0xD8 {
		t.Fatalf("负载应为 JPEG（FFD8 开头）: % x", data[5:9])
	}

	// 输入注入：viewer 发鼠标帧 → backend 记录
	if err := ws.WriteJSON(map[string]any{"t": "m", "x": 0.3, "y": 0.6, "b": "l", "a": "down"}); err != nil {
		t.Fatalf("发鼠标帧: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		backend.mu.Lock()
		n := len(backend.injected)
		backend.mu.Unlock()
		if n > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("鼠标帧未到达注入器")
		}
		time.Sleep(50 * time.Millisecond)
	}

	// bye → 服务端关闭
	if err := ws.WriteJSON(map[string]any{"t": "bye"}); err != nil {
		t.Fatalf("发 bye: %v", err)
	}
	_ = ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		if _, _, err := ws.ReadMessage(); err != nil {
			break // 关闭即成功
		}
	}
	deadline = time.Now().Add(2 * time.Second)
	for {
		backend.mu.Lock()
		hidden := backend.hidden
		backend.mu.Unlock()
		if hidden > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("bye 后指示条未隐藏")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// 单客户端：第一连接占住会话，第二连接收到 {type:"busy"} 后被关闭。
func TestStreamBusy(t *testing.T) {
	backend := &stubBackend{}
	srv := newRDServer(t, backend)
	defer srv.Close()

	ws1 := dialWS(t, srv.URL+"/api/v1/rd/stream?token=a")
	defer ws1.Close()
	// 第一连接必须完成升级并占住会话（handleStream 在升级后立即 tryAcquire）
	if err := ws1.WriteJSON(map[string]any{"t": "hello", "name": "A", "os": "windows"}); err != nil {
		t.Fatalf("ws1 hello: %v", err)
	}
	readJSONDeadline(t, ws1) // 等 hello 回执 = 会话已建立

	ws2 := dialWS(t, srv.URL+"/api/v1/rd/stream?token=b")
	defer ws2.Close()
	busy := readJSONDeadline(t, ws2)
	if busy["type"] != "busy" {
		t.Fatalf("第二连接应收 {type:busy}，得 %v", busy)
	}
	// busy 后服务端主动关闭
	_ = ws2.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := ws2.ReadMessage(); err == nil {
		t.Fatal("busy 后连接应被服务端关闭")
	}
}

// 未注册路由（非 Windows 平台的 rd_unsupported）是另一条路径，
// 这里验证 protect 链接正常（无 token 且非本机 → 401）。
func TestStreamAuth(t *testing.T) {
	backend := &stubBackend{}
	srv := newRDServer(t, backend)
	resp, err := http.Get(srv.URL + "/api/v1/rd/stream?token=bad-token")
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	defer resp.Body.Close()
	// 测试 protect 恒放行（桩），真 protect 的 401 由 httpapi 自己的测试管。
	// 这里只断言路由已注册（非 404）。
	if resp.StatusCode == http.StatusNotFound {
		t.Fatal("rd/stream 路由未注册")
	}
}
