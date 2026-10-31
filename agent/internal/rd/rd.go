// Package rd 实现局域网远程桌面（设计文档 phase4 B 节，RD-1 协议）。
//
// 架构：
//
//	WS 端点 GET /api/v1/rd/stream?token=（token 走 query，对齐 icons 模式）。
//	agent→viewer 二进制帧：[0x01][4B unixMs 大端][JPEG]；0x02 预留（光标形状）。
//	viewer→agent JSON 文本帧：m/w/k/txt 输入帧 + q/fps 画质帧率帧 + hello/bye/ping 控制帧。
//
// 帧来源与输入注入按平台分流（backend_windows.go / backend_other.go），
// 纯逻辑（会话状态机、坐标映射、跳帧、限流）在本文件与 session.go，全部可测。
//
// 线程模型：每个会话两条 goroutine——reader（输入帧 → 注入 + 刷新空闲计时）、
// pumper（按自适应间隔抓帧 → 跳帧 → 发送）。单客户端由 Manager 保证，
// 第二连接直接 {type:"busy"} 后关闭。
package rd

import (
	"net/http"
	"sync"

	"landeck/internal/config"
)

// Backend 屏幕抓帧 / 输入注入 / 被控端指示条的平台实现。
// Windows 见 backend_windows.go；其余平台 backend_other.go 返回 ErrUnsupported。
type Backend interface {
	// Capture 抓取主显示器全分辨率一帧（返回原始像素，JPEG 由会话层编码）。
	Capture() (Frame, error)
	// Inject 注入一条输入事件（SendInput 路径）。
	Inject(ev InputEvent) error
	// ScreenSize 主屏当前分辨率（坐标映射用；每次会话开始时读一次）。
	ScreenSize() (w, h int, err error)
	// IndicatorShow 在屏幕顶部常驻「正在被 name 远程控制」横条（会话开始）。
	IndicatorShow(name string)
	// IndicatorHide 会话结束即消失。
	IndicatorHide()
}

// Frame 一帧原始像素（顶层向下 RGBA）。
type Frame struct {
	RGBA  []byte // 长度 = W*H*4，字节序 R,G,B,A
	W, H  int
	Stride int
}

// Register 把 RD-1 的 WS 端点挂到 mux 上。
//
// 签名与 ai.Register 一致（protect 由 httpapi 传入，避免 rd 依赖 httpapi）；
// token 走 query 的鉴权由 protect 内的 bearer() 处理，rd 不重复做。
//
// 由 teammate agent-activity 在 server.go 统一接线：
//
//	rd.Register(mux, func(h func(http.ResponseWriter, *http.Request, *config.Client)) http.HandlerFunc {
//	    return s.protect(h)
//	})
func Register(mux *http.ServeMux, protect func(func(http.ResponseWriter, *http.Request, *config.Client)) http.HandlerFunc) {
	mux.HandleFunc("GET /api/v1/rd/stream", protect(handleStream))
}

// manager 全局会话管理器：单客户端语义的归属地。
var (
	mu     sync.Mutex
	active *session
)

// tryAcquire 抢占会话；已有活跃会话时返回 nil（调用方回 busy）。
func tryAcquire(s *session) bool {
	mu.Lock()
	defer mu.Unlock()
	if active != nil {
		return false
	}
	active = s
	return true
}

// release 释放会话（幂等：只有当前持有者才真正释放）。
func release(s *session) {
	mu.Lock()
	defer mu.Unlock()
	if active == s {
		active = nil
	}
}
