package rd

import (
	"errors"
	"sync"
)

// windowsBackend Windows 平台的抓帧/SendInput/指示条实现。
type windowsBackend struct {
	mu  sync.Mutex
	ind *indicator // 懒创建：首个会话才起窗口与消息泵
}

func (b *windowsBackend) Capture() (Frame, error) { return captureScreen() }

func (b *windowsBackend) Inject(ev InputEvent) error { return injectEvent(ev) }

func (b *windowsBackend) ScreenSize() (int, int, error) {
	w, h := primaryScreenSize()
	if w <= 0 || h <= 0 {
		return 0, 0, errors.New("GetSystemMetrics 返回非法尺寸")
	}
	return w, h, nil
}

func (b *windowsBackend) IndicatorShow(name string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ind == nil {
		b.ind = newIndicator()
	}
	b.ind.show(name)
}

func (b *windowsBackend) IndicatorHide() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ind != nil {
		b.ind.hide()
	}
}

func newPlatformBackend() (Backend, error) { return &windowsBackend{}, nil }
