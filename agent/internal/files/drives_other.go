//go:build !windows

package files

// 非 Windows 没有盘符概念，返回空：根目录由家目录等候选承担。
func windowsDrives() []string { return nil }
