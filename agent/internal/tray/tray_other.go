//go:build !windows

package tray

// Callbacks 在非 Windows 平台不使用；保留同名类型让 main 不用分平台写代码。
type Callbacks struct {
	Status           func() (title string, code string, paired int, consoleURL string)
	ToggleAutostart  func() (enabled bool, err error)
	AutostartEnabled func() bool
	OpenApp          func() error
	OnQuit           func()
}

// Start 在非 Windows 平台是空操作：这些系统用 systemd/launchd 管理守护进程。
func Start(cb Callbacks) {}

// Quit 空操作。
func Quit() {}

// SetConsoleURL 空操作。
func SetConsoleURL(u string) {}

// SetDataDir 空操作。
func SetDataDir(dir string) {}

// Supported 表示当前平台是否有托盘实现。
func Supported() bool { return false }
