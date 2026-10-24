package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"landeck/internal/store"
)

func store_activity(action, clientName string, ok bool, detail string) store.Activity {
	return store.Activity{
		Action:     action,
		ClientName: clientName,
		OK:         ok,
		Detail:     detail,
		At:         time.Now().Format(time.RFC3339),
	}
}

type wsClient struct {
	conn *websocket.Conn
	send chan []byte
	once sync.Once
}

func (c *wsClient) close() {
	c.once.Do(func() { close(c.send) })
}

type hub struct {
	s   *Server
	mu  sync.RWMutex
	all map[*wsClient]struct{}
}

func newHub(s *Server) *hub {
	h := &hub{s: s, all: make(map[*wsClient]struct{})}
	go h.ticker()
	return h
}

// ticker 统一采样一次再广播，N 个客户端也只算一次 status。
func (h *hub) ticker() {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for range t.C {
		h.mu.RLock()
		if len(h.all) == 0 {
			h.mu.RUnlock()
			continue
		}
		h.mu.RUnlock()
		frame, err := json.Marshal(map[string]any{"type": "status", "data": h.s.Sampler.Snapshot()})
		if err != nil {
			continue
		}
		h.fanout(frame)
	}
}

func (h *hub) fanout(frame []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.all {
		select {
		case c.send <- frame:
		default:
			// 客户端读得慢就丢帧，不阻塞整体推送
		}
	}
}

func (h *hub) broadcastEvent(ev map[string]any) {
	frame, err := json.Marshal(map[string]any{"type": "event", "data": ev})
	if err != nil {
		return
	}
	h.fanout(frame)
}

func (h *hub) add(c *wsClient) {
	h.mu.Lock()
	h.all[c] = struct{}{}
	h.mu.Unlock()
}

func (h *hub) remove(c *wsClient) {
	h.mu.Lock()
	if _, ok := h.all[c]; ok {
		delete(h.all, c)
		c.close()
	}
	h.mu.Unlock()
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  512,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	client, ok := s.Auth.Authenticate(bearer(r))
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "令牌无效或已失效，请重新配对")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &wsClient{conn: conn, send: make(chan []byte, 8)}
	s.hub.add(c)
	defer func() {
		s.hub.remove(c)
		_ = conn.Close()
	}()

	// 首帧立刻给一份，避免首屏等 2 秒
	if frame, err := json.Marshal(map[string]any{"type": "status", "data": s.Sampler.Snapshot()}); err == nil {
		select {
		case c.send <- frame:
		default:
		}
	}

	// 写循环
	go func() {
		ping := time.NewTicker(30 * time.Second)
		defer ping.Stop()
		for {
			select {
			case msg, ok := <-c.send:
				if !ok {
					_ = conn.WriteControl(websocket.CloseMessage,
						websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
					return
				}
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-ping.C:
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	conn.SetReadLimit(4096)
	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	})
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		var msg struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == "ping" {
			if frame, err := json.Marshal(map[string]string{"type": "pong"}); err == nil {
				select {
				case c.send <- frame:
				default:
				}
			}
		}
	}
	_ = client
	log.Printf("ws 断开: %s", client.Name)
}
