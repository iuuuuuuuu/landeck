//go:build !windows

package activity

// 非 Windows 平台：采集留接口、空实现。
//
// 与 metrics 的 *_other.go 惯例一致：接口已定，平台实现后补
// （macOS 走 NSWorkspace/frontmostApplication，Linux 走 X11 _NET_ACTIVE_WINDOW）。
// 在此期间 Status() 返回 unsupported，前端据此显示「不支持采集」，
// API 仍然可用（settings/categories 可配置，查询返回空数据）。

// Sample 一次前台采样。当前平台不支持。
func SampleForeground() (Sample, bool, error) {
	return Sample{}, false, errUnsupported
}

// sampleFunc 返回本平台的前台采样函数；第二返回值表示平台是否支持。
func sampleFunc() (func() (Sample, bool, error), bool) {
	return nil, false
}

func idleSeconds() int { return 0 }
