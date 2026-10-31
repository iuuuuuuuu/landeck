package rd

import (
	"errors"
	"sync"
	"time"
)

// FrameConn 会话对底层连接的最小需求；gorilla 连接在 stream.go 适配，
// 测试用内存假连接替换。
type FrameConn interface {
	// WriteBinary 发二进制帧（0x01 + 4B unixMs + JPEG）。
	WriteBinary(jpeg []byte, at int64) error
	// WriteJSON 发 JSON 文本帧（控制帧）。
	WriteJSON(v any) error
	// Close 关闭连接。
	Close() error
}

// SessionConfig 会话参数（B 节默认值）。
type SessionConfig struct {
	IdleTimeout time.Duration // 无输入自动结束（默认 60s）
	Quality     int           // 默认 JPEG 质量（60）
	MaxConsecErr int          // 抓帧连续失败上限（默认 10）
}

func (c SessionConfig) withDefaults() SessionConfig {
	if c.IdleTimeout <= 0 {
		c.IdleTimeout = 60 * time.Second
	}
	c.Quality = clampQuality(c.Quality)
	if c.MaxConsecErr <= 0 {
		c.MaxConsecErr = 10
	}
	return c
}

// session 一次远程桌面的全部状态。
// 生命周期：tryAcquire → hello → 输入/帧泵 → bye/空闲超时/对端断开 → release。
type session struct {
	conn    FrameConn
	backend Backend
	cfg     SessionConfig

	viewerName string
	os         string

	// 会话参数（viewer 的 q/fps 帧可改）
	quality   int
	viewerFPS int

	lastInputAt time.Time
	prevHash    uint64
	prevLen     int
	hasPrev     bool
	consecErr   int
	ended       bool
	endReason   string
	done        chan struct{}
	once        sync.Once
}

func newSession(conn FrameConn, backend Backend, cfg SessionConfig) *session {
	cfg = cfg.withDefaults()
	return &session{
		conn:        conn,
		backend:     backend,
		cfg:         cfg,
		quality:     cfg.Quality,
		lastInputAt: time.Time{}, // 零值 = 尚无输入（帧泵按静止 1fps 起步）
		done:        make(chan struct{}),
	}
}

// handleFrame 处理 viewer 的一帧输入。
// 返回 error 仅表示协议致命错误（关闭会话）；输入注入失败不致命（记录后继续）。
func (s *session) handleFrame(data []byte, now time.Time) error {
	ev, ctrl, isInput, err := parseInputFrame(data)
	if err != nil {
		// 无法解析的帧：忽略但不刷新空闲计时（避免恶意/坏帧保活）
		return nil
	}

	// 任何合法来帧都刷新空闲计时（ping 也算——viewer 明确活着）
	s.lastInputAt = now

	if !isInput {
		return s.handleControl(ctrl, now)
	}

	if err := s.backend.Inject(ev); err != nil {
		// 注入失败（如平台不支持）不结束会话：viewer 看得到画面不动，自行判断
		return nil
	}
	return nil
}

// handleControl 处理控制帧。返回 errIndicate 会话需结束。
func (s *session) handleControl(c controlFrame, now time.Time) error {
	switch c.T {
	case "hello":
		s.viewerName = c.Name
		s.os = c.OS
		s.backend.IndicatorShow(c.Name)
		w, h, err := s.backend.ScreenSize()
		if err == nil {
			_ = s.conn.WriteJSON(helloFrame{T: "hello", Name: c.Name, OS: c.OS, W: w, H: h})
		}
	case "q":
		s.quality = clampQuality(c.Quality)
	case "fps":
		s.viewerFPS = c.FPS
	case "bye":
		return errBye
	case "ping":
		_ = s.conn.WriteJSON(map[string]string{"t": "pong"})
	}
	return nil
}

var errBye = errors.New("viewer bye")

// idleExpired 空闲判定：最后一次来帧距今超过 IdleTimeout。
func (s *session) idleExpired(now time.Time) bool {
	if s.lastInputAt.IsZero() {
		// 从未收到任何来帧：按会话建立时间算不到（由 stream 层用首帧超时兜底）
		return false
	}
	return now.Sub(s.lastInputAt) > s.cfg.IdleTimeout
}

// pumpOnce 抓帧 → 跳帧 → 编码 → 发送。
// 返回 (sent, err)：err 非空表示抓帧/编码失败（由调用方累计连续失败）。
func (s *session) pumpOnce(now time.Time) (bool, error) {
	if s.ended {
		return false, nil
	}
	f, err := s.backend.Capture()
	if err != nil {
		s.consecErr++
		if s.consecErr >= s.cfg.MaxConsecErr {
			return false, errors.New("抓帧连续失败")
		}
		return false, err
	}
	s.consecErr = 0

	cur := frameHash(f)
	if s.hasPrev && shouldSkip(s.prevHash, cur, s.prevLen, len(f.RGBA)) {
		return false, nil
	}

	j, err := encodeJPEG(f, s.quality)
	if err != nil {
		return false, err
	}
	if err := s.conn.WriteBinary(j, now.UnixMilli()); err != nil {
		return true, err
	}
	s.prevHash = cur
	s.prevLen = len(f.RGBA)
	s.hasPrev = true
	return true, nil
}

// end 结束会话（幂等）：指示条消失 + 连接关闭 + 释放单客户端槽位。
func (s *session) end(reason string) {
	s.once.Do(func() {
		s.ended = true
		s.endReason = reason
		close(s.done)
		s.backend.IndicatorHide()
		_ = s.conn.Close()
		release(s)
	})
}
