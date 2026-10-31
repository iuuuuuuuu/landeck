//go:build !windows

package rd

import "errors"

// 非 Windows 被控端：远程桌面 v1 不支持（GDI/SendInput 是 Windows 专有）。
// 端点仍然注册（返回明确的 rd_unsupported JSON），web-rd 据此显示引导。

type unsupportedBackend struct{}

func (unsupportedBackend) Capture() (Frame, error) {
	return Frame{}, errors.New("当前平台不支持远程桌面抓帧")
}
func (unsupportedBackend) Inject(InputEvent) error {
	return errors.New("当前平台不支持远程输入注入")
}
func (unsupportedBackend) ScreenSize() (int, int, error) {
	return 0, 0, errors.New("当前平台不支持远程桌面")
}
func (unsupportedBackend) IndicatorShow(string) {}
func (unsupportedBackend) IndicatorHide()       {}

func newPlatformBackend() (Backend, error) {
	return nil, errors.New("当前平台不支持远程桌面（v1 仅 Windows 被控端）")
}
