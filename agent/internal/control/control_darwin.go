//go:build darwin

package control

import (
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type darwinController struct {
	opts     Options
	caps     Caps
	mediaBin string
}

func New(opts Options) Controller {
	c := &darwinController{opts: opts}
	if hasBin("nowplaying-cli") {
		c.mediaBin = "nowplaying-cli"
	} else if hasBin("osascript") {
		c.mediaBin = "osascript"
	}
	c.caps = Caps{
		Sleep:     true,
		Hibernate: false, // macOS 没有用户态可触发的休眠
		Wake:      true,
		ScreenOff: true,
		Volume:    hasBin("osascript"),
		Media:     c.mediaBin != "",
	}
	return c
}

func (c *darwinController) Caps() Caps   { return c.caps }
func (c *darwinController) DryRun() bool { return c.opts.DryRun }

func hasBin(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func run(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if text != "" {
			return text, fmt.Errorf("%s: %v (%s)", name, err, text)
		}
		return text, fmt.Errorf("%s: %v", name, err)
	}
	return text, nil
}

func osa(script string) error {
	_, err := run("osascript", "-e", script)
	return err
}

func (c *darwinController) Power(op string, delaySec int, force bool) error {
	if c.opts.DryRun && op != PowerCancel {
		return nil
	}
	switch op {
	case PowerShutdown:
		if delaySec > 0 {
			// AppleScript 无法延迟关机，用后台 sleep 再触发
			return runErr("bash", "-c", fmt.Sprintf("(sleep %d; osascript -e 'tell application \"System Events\" to shut down') &", delaySec))
		}
		return osa(`tell application "System Events" to shut down`)
	case PowerRestart:
		if delaySec > 0 {
			return runErr("bash", "-c", fmt.Sprintf("(sleep %d; osascript -e 'tell application \"System Events\" to restart') &", delaySec))
		}
		return osa(`tell application "System Events" to restart`)
	case PowerSleep:
		return runErr("pmset", "sleepnow")
	case PowerLock:
		return osa(`tell application "System Events" to keystroke "q" using {control down, command down}`)
	case PowerLogoff:
		return osa(`tell application "System Events" to log out`)
	case PowerScreenOff:
		return runErr("pmset", "displaysleepnow")
	case PowerCancel:
		return errors.New("macOS 不支持取消已排定的关机")
	}
	return ErrUnsupported
}

func runErr(name string, args ...string) error {
	_, err := run(name, args...)
	return err
}

func (c *darwinController) Media(op string) error {
	if c.opts.DryRun {
		return nil
	}
	if c.mediaBin == "nowplaying-cli" {
		cmd := map[string]string{
			MediaPlayPause: "togglePlayPause",
			MediaNext:      "nextTrack",
			MediaPrev:      "previousTrack",
			MediaStop:      "pause",
		}[op]
		if cmd == "" {
			return ErrUnsupported
		}
		return runErr("nowplaying-cli", cmd)
	}
	// 退化：只对 Music.app 有效
	script := map[string]string{
		MediaPlayPause: `tell application "Music" to playpause`,
		MediaNext:      `tell application "Music" to next track`,
		MediaPrev:      `tell application "Music" to previous track`,
		MediaStop:      `tell application "Music" to stop`,
	}[op]
	if script == "" {
		return ErrUnsupported
	}
	return osa(script)
}

func (c *darwinController) VolumeState() (VolumeState, error) {
	out, err := run("osascript", "-e", "output volume of (get volume settings) & \",\" & output muted of (get volume settings)")
	if err != nil {
		return VolumeState{}, err
	}
	parts := strings.SplitN(strings.TrimSpace(out), ",", 2)
	if len(parts) != 2 {
		return VolumeState{}, errors.New("无法解析 macOS 音量输出")
	}
	level, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil {
		return VolumeState{}, err
	}
	return VolumeState{Level: level, Muted: strings.TrimSpace(parts[1]) == "true", Known: true}, nil
}

func (c *darwinController) Volume(op string, value int) (VolumeState, error) {
	switch op {
	case VolSet:
		if value < 0 {
			value = 0
		}
		if value > 100 {
			value = 100
		}
		if err := osa(fmt.Sprintf("set volume output volume %d", value)); err != nil {
			return VolumeState{}, err
		}
	case VolUp, VolDown:
		step := value
		if step <= 0 {
			step = 5
		}
		cur, err := c.VolumeState()
		if err != nil {
			return VolumeState{}, err
		}
		next := cur.Level + step
		if op == VolDown {
			next = cur.Level - step
		}
		next = max(0, min(100, next))
		if err := osa(fmt.Sprintf("set volume output volume %d", next)); err != nil {
			return VolumeState{}, err
		}
	case VolMute:
		if err := osa("set volume output muted true"); err != nil {
			return VolumeState{}, err
		}
	case VolUnmute:
		if err := osa("set volume output muted false"); err != nil {
			return VolumeState{}, err
		}
	case VolToggleMute:
		cur, err := c.VolumeState()
		if err != nil {
			return VolumeState{}, err
		}
		flag := "true"
		if cur.Muted {
			flag = "false"
		}
		if err := osa("set volume output muted " + flag); err != nil {
			return VolumeState{}, err
		}
	default:
		return VolumeState{}, ErrUnsupported
	}
	return c.VolumeState()
}

func (c *darwinController) MediaState() (MediaInfo, error) {
	if c.mediaBin != "nowplaying-cli" {
		// 没有 nowplaying-cli 时拿不到可靠状态，宁可不报
		return MediaInfo{Known: false}, nil
	}
	out, err := run("nowplaying-cli", "get", "title", "artist", "album", "playbackRate")
	if err != nil {
		return MediaInfo{Known: true, Active: false}, nil
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) < 4 {
		return MediaInfo{Known: true, Active: false}, nil
	}
	info := MediaInfo{
		Known: true, Active: true,
		Title:  strings.TrimSpace(lines[0]),
		Artist: strings.TrimSpace(lines[1]),
		Album:  strings.TrimSpace(lines[2]),
		App:    "系统媒体",
	}
	if rate, err := strconv.ParseFloat(strings.TrimSpace(lines[3]), 64); err == nil {
		info.Playing = rate > 0
	}
	info.Status = "Paused"
	if info.Playing {
		info.Status = "Playing"
	}
	info.UpdatedAt = float64(time.Now().Unix())
	if info.Title == "null" || info.Title == "" {
		info.Active = false
	}
	return info, nil
}

func (c *darwinController) Wake(mac string) error { return sendMagicPacket(mac) }

// WakeAlarmAt 用 pmset 安排一次性唤醒。
func WakeAlarmAt(at time.Time, _ string) error {
	arg := at.Format("01/02/06 15:04:05")
	if err := runErr("pmset", "schedule", "wake", arg); err != nil {
		return fmt.Errorf("pmset schedule 需要管理员权限: %w", err)
	}
	return nil
}

func CancelWakeAlarm(_ string) {
	_, _ = run("pmset", "schedule", "cancelall")
}
