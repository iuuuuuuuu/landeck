//go:build windows

package tray

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/getlantern/systray"
)

// Callbacks 由 main 注入：托盘只负责展示与转发，不持有业务状态。
type Callbacks struct {
	// Status 返回两行展示文本：设备名 + 配对码
	Status func() (title string, code string, paired int, consoleURL string)
	// ToggleAutostart 返回切换后的状态
	ToggleAutostart func() (enabled bool, err error)
	AutostartEnabled func() bool
	OnQuit           func()
}

var (
	cb        Callbacks
	mu        sync.Mutex
	titleItem *systray.MenuItem
	codeItem  *systray.MenuItem
	pairedItem *systray.MenuItem
	autoItem  *systray.MenuItem
	openItem  *systray.MenuItem
)

// Start 在独立 goroutine 里跑托盘事件循环；Quit 用于退出。
// 必须 LockOSThread：Win32 的消息队列属于线程，GetMessage 换了线程就收不到消息。
func Start(c Callbacks) {
	cb = c
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		systray.Run(onReady, onExit)
	}()
}

// Quit 让托盘循环退出（会触发 onExit）。
func Quit() { systray.Quit() }

func onReady() {
	systray.SetIcon(Icon)
	systray.SetTitle("")
	systray.SetTooltip("LanDeck · 局域网 PC 控制台")

	titleItem = systray.AddMenuItem("LanDeck", "设备名")
	titleItem.Disable()
	codeItem = systray.AddMenuItem("配对码：读取中…", "点击复制配对码")
	pairedItem = systray.AddMenuItem("已配对：0 台", "点击打开控制台查看详情")
	pairedItem.Disable()
	systray.AddSeparator()
	openItem = systray.AddMenuItem("打开控制台", "在浏览器里打开本机控制台")
	systray.AddSeparator()
	autoItem = systray.AddMenuItemCheckbox("开机自启", "登录 Windows 后自动运行", cb.AutostartEnabled())
	logItem := systray.AddMenuItem("打开数据目录", "查看配置与日志")
	systray.AddSeparator()
	quitItem := systray.AddMenuItem("退出 LanDeck", "停止被控服务")

	go func() {
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		refresh()
		for {
			select {
			case <-tick.C:
				refresh()
			case <-openItem.ClickedCh:
				openURL(consoleURL())
			case <-codeItem.ClickedCh:
				_, code, _, _ := cb.Status()
				if code != "" {
					_ = copyText(code)
					codeItem.SetTitle("已复制配对码：" + code)
					time.AfterFunc(2*time.Second, refresh)
				}
			case <-autoItem.ClickedCh:
				enabled, err := cb.ToggleAutostart()
				if err != nil {
					autoItem.SetTitle("开机自启（失败）")
					time.AfterFunc(2*time.Second, refresh)
					continue
				}
				if enabled {
					autoItem.Check()
				} else {
					autoItem.Uncheck()
				}
			case <-logItem.ClickedCh:
				dataDir := dataDirHint()
				openPath(dataDir)
			case <-quitItem.ClickedCh:
				if cb.OnQuit != nil {
					cb.OnQuit()
				}
				systray.Quit()
				return
			}
		}
	}()
}

func onExit() {}

// Supported 表示当前平台是否有托盘实现。
func Supported() bool { return true }

func refresh() {
	if cb.Status == nil {
		return
	}
	title, code, paired, _ := cb.Status()
	mu.Lock()
	defer mu.Unlock()
	if titleItem != nil && title != "" {
		titleItem.SetTitle("LanDeck · " + title)
		systray.SetTooltip("LanDeck · " + title + "\nhttp://127.0.0.1 上的控制台")
	}
	if codeItem != nil {
		if code == "" {
			codeItem.SetTitle("配对码：已关闭")
			codeItem.Disable()
		} else {
			codeItem.Enable()
			codeItem.SetTitle("配对码：" + code + "（点击复制）")
		}
	}
	if pairedItem != nil {
		pairedItem.SetTitle(fmt.Sprintf("已配对：%d 台", paired))
	}
}

var consoleURL = func() string { return "http://127.0.0.1:8420/" }

// SetConsoleURL 让 main 在端口确定后覆盖默认地址。
func SetConsoleURL(u string) {
	if u != "" {
		consoleURL = func() string { return u }
	}
}

var dataDir = "."

func dataDirHint() string { return dataDir }

// SetDataDir 让"打开数据目录"指向真实位置。
func SetDataDir(dir string) {
	if dir != "" {
		dataDir = dir
	}
}

func hide(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd
}

func openURL(url string) {
	// rundll32 是最省事的方式：不弹黑框，走默认浏览器
	_ = hide(exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)).Start()
}

func openPath(path string) {
	_ = hide(exec.Command("explorer.exe", path)).Start()
}

func copyText(text string) error {
	cmd := hide(exec.Command("cmd.exe", "/c", "clip"))
	cmd.Stdin = strings.NewReader(text)
	return cmd.Run()
}
