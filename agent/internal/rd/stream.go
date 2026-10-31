package rd

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"landeck/internal/config"
)

// WS 升级参数：帧可以到几百 KB（1080p JPEG），写缓冲给足。
// CheckOrigin 放行：鉴权由 protect（token/query）完成，viewer 的 web UI
// 可能与被控端不同源（手机浏览器开 PC 的页面）。
var upgrader = websocket.Upgrader{
	ReadBufferSize:  32 << 10,
	WriteBufferSize: 256 << 10,
	CheckOrigin:     func(*http.Request) bool { return true },
}

// wsConn 把 gorilla 连接适配成 FrameConn（session 层只认这个接口，便于测试）。
//
// 写必须串行：pump goroutine 发二进制帧、读循环发 pong/hello——
// gorilla 只允许一个并发写者，实测并发写直接 panic（全链路测试抓到）。
type wsConn struct {
	c   *websocket.Conn
	wmu sync.Mutex
}

func (w *wsConn) WriteBinary(j []byte, at int64) error {
	w.wmu.Lock()
	defer w.wmu.Unlock()
	_ = w.c.SetWriteDeadline(time.Now().Add(10 * time.Second))
	msg := make([]byte, 5+len(j))
	msg[0] = 0x01 // 帧类型：屏幕 JPEG（0x02 预留光标形状）
	binary.BigEndian.PutUint32(msg[1:5], uint32(at))
	copy(msg[5:], j)
	return w.c.WriteMessage(websocket.BinaryMessage, msg)
}

func (w *wsConn) WriteJSON(v any) error {
	w.wmu.Lock()
	defer w.wmu.Unlock()
	_ = w.c.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return w.c.WriteJSON(v)
}

func (w *wsConn) Close() error { return w.c.Close() }

// handleStream RD-1 的 WS 端点。经 protect 包裹（token 走 query 对齐 icons）。
func handleStream(w http.ResponseWriter, r *http.Request, _ *config.Client) {
	backend, err := newBackend()
	if err != nil {
		// 平台不支持（非 Windows 被控端）：给 web-rd 一个明确的 JSON 错误
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "rd_unsupported", "message": err.Error()})
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade 已写过 4xx
	}

	// 注意必须用指针：wsConn 内含写锁，按值拷贝会把锁也拷走（等于没锁）
	s := newSession(&wsConn{c: conn}, backend, SessionConfig{})
	if !tryAcquire(s) {
		// 单客户端语义：第二连接回 busy 后关闭
		_ = conn.WriteJSON(busyFrame{Type: "busy"})
		_ = conn.Close()
		return
	}

	// 空闲超时：60s 内没有任何来帧（含 ping）→ 会话结束。
	// 这是隐私/安全默认：无人值守的远程会话必须自动断。
	_ = conn.SetReadDeadline(time.Now().Add(s.cfg.IdleTimeout))

	// 帧泵（发送侧）在独立 goroutine；读侧在本 goroutine。
	pumpDone := make(chan struct{})
	go func() {
		defer close(pumpDone)
		s.pumpLoop()
	}()

	// 读循环：输入帧注入 + 刷新空闲计时。
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			// 读超时（空闲）、对端关闭、协议错——统一走 end
			s.end(readErrReason(err))
			break
		}
		if mt != websocket.TextMessage {
			continue // 忽略未知二进制上行（契约只有下行二进制）
		}
		now := time.Now()
		if err := s.handleFrame(data, now); err != nil {
			if errors.Is(err, errBye) {
				// 先 end（关 done 让 pump 退出、隐藏指示条、释放槽位）再等 pump，
				// 顺序反了就是死锁：pump 等 ended、这里等 pumpDone（实测踩过）。
				s.end("viewer bye")
				break
			}
			continue
		}
		_ = conn.SetReadDeadline(time.Now().Add(s.cfg.IdleTimeout))
	}

	// 会话必然已 end（bye / 空闲超时 / 对端断开），等 pump goroutine 收尾
	s.end("session over")
	<-pumpDone
}

func readErrReason(err error) string {
	if isTimeoutErr(err) {
		return "idle timeout"
	}
	return "peer closed"
}

func isTimeoutErr(err error) bool {
	var ne interface{ Timeout() bool }
	return errors.As(err, &ne) && ne.Timeout()
}

// pumpLoop 帧发送循环：按自适应间隔抓帧发送，直到会话结束。
// 空闲超时由读侧的 SetReadDeadline 统一执法——pump 只管按节奏出帧。
func (s *session) pumpLoop() {
	for !s.ended {
		now := time.Now()
		interval := frameInterval(s.lastInputAt, now, s.viewerFPS)
		_, _ = s.pumpOnce(now)
		// 用 timer 而非 ticker：间隔随输入/画质帧动态变化
		select {
		case <-time.After(interval):
		case <-s.done:
			return
		}
	}
}
