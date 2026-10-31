//go:build !windows

package memory

import (
	"errors"
	"image"
)

// 非 Windows：截屏留接口空实现（对齐 activity/foreground_other 惯例）。
// macOS 走 ScreenCaptureKit、Linux 走 PipeWire/X11，v1 不做。
var errScreenUnsupported = errors.New("当前平台不支持屏幕截取")

func captureScreen() (image.Image, error) { return nil, errScreenUnsupported }
