//go:build windows

package control

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type windowsController struct {
	opts   Options
	volume *comVolume
	media  *smtcHelper
	caps   Caps
}

func New(opts Options) Controller {
	c := &windowsController{opts: opts}
	dataDir := opts.DataDir
	if dataDir == "" {
		dataDir = "."
	}
	c.media = newSMTC(dataDir)
	c.caps = Caps{
		Sleep:     true,
		Hibernate: hibernationEnabled(),
		Wake:      true,
		ScreenOff: true,
		Volume:    true,
		Media:     true,
	}
	if v, err := newCOMVolume(); err == nil {
		c.volume = v
	} else {
		c.caps.Volume = false
	}
	return c
}

func (c *windowsController) Caps() Caps { return c.caps }
func (c *windowsController) DryRun() bool { return c.opts.DryRun }

func runHidden(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if text != "" {
			return text, fmt.Errorf("%v: %s", err, text)
		}
		return text, err
	}
	return text, nil
}

func (c *windowsController) Power(op string, delaySec int, force bool) error {
	if c.opts.DryRun && op != PowerCancel {
		return nil
	}
	switch op {
	case PowerShutdown, PowerRestart, PowerLogoff:
		args := []string{}
		switch op {
		case PowerShutdown:
			args = []string{"/s"}
		case PowerRestart:
			args = []string{"/r"}
		case PowerLogoff:
			args = []string{"/l"}
		}
		if op != PowerLogoff {
			if delaySec < 0 {
				delaySec = 0
			}
			args = append(args, "/t", strconv.Itoa(delaySec))
		}
		if force && op != PowerLogoff {
			args = append(args, "/f")
		}
		_, err := runHidden("shutdown.exe", args...)
		return err
	case PowerCancel:
		_, err := runHidden("shutdown.exe", "/a")
		if err != nil && strings.Contains(strings.ToLower(err.Error()), "1116") {
			return nil // 没有待执行的关机
		}
		return err
	case PowerSleep:
		_, err := runHidden("rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0")
		return err
	case PowerHibernate:
		_, err := runHidden("shutdown.exe", "/h")
		return err
	case PowerLock:
		_, err := runHidden("rundll32.exe", "user32.dll,LockWorkStation")
		return err
	case PowerScreenOff:
		monitorOff()
		return nil
	}
	return ErrUnsupported
}

var (
	user32              = syscall.NewLazyDLL("user32.dll")
	procSendMessageW    = user32.NewProc("SendMessageTimeoutW")
	procKeybdEvent      = user32.NewProc("keybd_event")
)

const (
	hwndBroadcast    = 0xFFFF
	wmSysCommand     = 0x0112
	scMonitorPower   = 0xF170
	monitorPowerOff  = 2
	keyeventfKeyup   = 0x0002
)

func monitorOff() {
	var out uintptr
	// SMTO_ABORTIFHUNG | SMTO_BLOCK = 0x0002|0x0001
	procSendMessageW.Call(hwndBroadcast, wmSysCommand, scMonitorPower, uintptr(monitorPowerOff), 0x0002, 1000, uintptr(unsafe.Pointer(&out)))
}

var mediaKeys = map[string]byte{
	MediaPlayPause: 0xB3,
	MediaNext:      0xB0,
	MediaPrev:      0xB1,
	MediaStop:      0xB2,
}

func (c *windowsController) Media(op string) error {
	if _, ok := mediaKeys[op]; !ok {
		return ErrUnsupported
	}
	if c.opts.DryRun {
		return nil
	}
	// 优先走 SMTC：这样播放状态会立刻反映到控制端；没有活动会话时退回媒体键
	if c.media != nil {
		if _, err := c.media.call(op); err == nil {
			return nil
		}
	}
	return c.mediaByKeys(op)
}

func (c *windowsController) MediaState() (MediaInfo, error) {
	if c.media == nil {
		return MediaInfo{}, ErrUnsupported
	}
	return c.media.readMediaState()
}

func (c *windowsController) Volume(op string, value int) (VolumeState, error) {
	if c.volume == nil {
		return VolumeState{}, ErrUnsupported
	}
	switch op {
	case VolSet:
		if value < 0 {
			value = 0
		}
		if value > 100 {
			value = 100
		}
		if err := c.volume.SetLevel(float32(value) / 100); err != nil {
			return VolumeState{}, err
		}
		if value > 0 {
			_ = c.volume.SetMute(false)
		}
	case VolUp, VolDown:
		step := value
		if step <= 0 {
			step = 5
		}
		for i := 0; i < step/5; i++ {
			if op == VolUp {
				_ = c.volume.Step(true)
			} else {
				_ = c.volume.Step(false)
			}
		}
	case VolMute:
		if err := c.volume.SetMute(true); err != nil {
			return VolumeState{}, err
		}
	case VolUnmute:
		if err := c.volume.SetMute(false); err != nil {
			return VolumeState{}, err
		}
	case VolToggleMute:
		muted, err := c.volume.Mute()
		if err != nil {
			return VolumeState{}, err
		}
		if err := c.volume.SetMute(!muted); err != nil {
			return VolumeState{}, err
		}
	default:
		return VolumeState{}, ErrUnsupported
	}
	return c.volume.State()
}

func (c *windowsController) VolumeState() (VolumeState, error) {
	if c.volume == nil {
		return VolumeState{}, ErrUnsupported
	}
	return c.volume.State()
}

func (c *windowsController) Wake(mac string) error { return sendMagicPacket(mac) }

// hibernationEnabled 通过 powercfg 判断休眠是否可用（约 30ms，构造时一次）
func hibernationEnabled() bool {
	// powercfg 的本地化输出是 OEM 代码页，必须借 PowerShell 转 UTF-8 才能匹配中文
	script := "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; powercfg /a"
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	text := string(out)
	if strings.Contains(text, "尚未启用休眠") || strings.Contains(text, "Hibernation has not been enabled") {
		return false
	}
	return strings.Contains(text, "休眠") || strings.Contains(text, "Hibernate")
}

// WakeAlarm 用 Windows 计划任务实现 RTC 唤醒：任务本身什么都不做，靠 WakeToRun 触发开机。
func WakeAlarmAt(at time.Time, taskName string) error {
	script := fmt.Sprintf(
		`$s = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;`+
			`$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit';`+
			`$t = New-ScheduledTaskTrigger -Once -At '%s';`+
			`Register-ScheduledTask -TaskName '%s' -Action $a -Trigger $t -Settings $s -Force | Out-Null`,
		at.Format("2006-01-02T15:04:05"), taskName,
	)
	_, err := runHidden("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	return err
}

func CancelWakeAlarm(taskName string) {
	_, _ = runHidden("schtasks.exe", "/Delete", "/TN", taskName, "/F")
}
