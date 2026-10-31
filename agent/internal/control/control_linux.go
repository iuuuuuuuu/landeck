//go:build linux

package control

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type linuxController struct {
	opts Options
	sink string // 当前后端: wpctl | pactl | amixer
	caps Caps
}

func New(opts Options) Controller {
	c := &linuxController{opts: opts}
	c.sink = detectSinkBackend()
	hibernate := false
	if raw, err := os.ReadFile("/sys/power/state"); err == nil {
		hibernate = strings.Contains(string(raw), "disk")
	}
	c.caps = Caps{
		Sleep:     true,
		Hibernate: hibernate,
		Wake:      true,
		ScreenOff: true,
		Volume:    c.sink != "",
		Media:     hasBin("playerctl"),
	}
	return c
}

func (c *linuxController) Caps() Caps    { return c.caps }
func (c *linuxController) DryRun() bool  { return c.opts.DryRun }

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

func detectSinkBackend() string {
	for _, b := range []string{"wpctl", "pactl", "amixer"} {
		if hasBin(b) {
			return b
		}
	}
	return ""
}

func (c *linuxController) Power(op string, delaySec int, force bool) error {
	if c.opts.DryRun && op != PowerCancel {
		return nil
	}
	switch op {
	case PowerShutdown:
		if delaySec > 0 {
			return runErr("shutdown", "-h", "+"+strconv.Itoa(delaySec/60+1))
		}
		return systemctl("poweroff")
	case PowerRestart:
		return systemctl("reboot")
	case PowerSleep:
		return systemctl("suspend")
	case PowerHibernate:
		return systemctl("hibernate")
	case PowerLock:
		if _, err := run("loginctl", "lock-sessions"); err == nil {
			return nil
		}
		_, err := run("xdg-screensaver", "lock")
		return err
	case PowerLogoff:
		sid := os.Getenv("XDG_SESSION_ID")
		if sid == "" {
			return errors.New("找不到 XDG_SESSION_ID，无法注销")
		}
		_, err := run("loginctl", "terminate-session", sid)
		return err
	case PowerScreenOff:
		if _, err := run("xset", "dpms", "force", "off"); err == nil {
			return nil
		}
		if _, err := run("wlopm", "--off", "*"); err == nil {
			return nil
		}
		_, err := run("swaymsg", "output", "*", "power", "off")
		return err
	case PowerCancel:
		_, err := run("shutdown", "-c")
		return err
	}
	return ErrUnsupported
}

func systemctl(verb string) error { return runErr("systemctl", verb) }

func runErr(name string, args ...string) error {
	_, err := run(name, args...)
	return err
}

func (c *linuxController) Media(op string) error {
	if c.opts.DryRun {
		return nil
	}
	switch op {
	case MediaPlayPause:
		return runErr("playerctl", "play-pause")
	case MediaNext:
		return runErr("playerctl", "next")
	case MediaPrev:
		return runErr("playerctl", "previous")
	case MediaStop:
		return runErr("playerctl", "stop")
	}
	return ErrUnsupported
}

func (c *linuxController) VolumeState() (VolumeState, error) {
	switch c.sink {
	case "wpctl":
		out, err := run("wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@")
		if err != nil {
			return VolumeState{}, err
		}
		// Volume: 0.35 [MUTED]
		fields := strings.Fields(out)
		level := 0
		for _, f := range fields {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(f, ","), 64); err == nil {
				level = int(v*100 + 0.5)
				break
			}
		}
		return VolumeState{Level: level, Muted: strings.Contains(out, "MUTED"), Known: true}, nil
	case "pactl":
		out, err := run("pactl", "get-sink-volume", "@DEFAULT_SINK@")
		if err != nil {
			return VolumeState{}, err
		}
		level := 0
		if i := strings.Index(out, "%"); i > 0 {
			start := strings.LastIndexAny(out[:i], " \t") + 1
			if v, err := strconv.Atoi(out[start:i]); err == nil {
				level = v
			}
		}
		muteOut, _ := run("pactl", "get-sink-mute", "@DEFAULT_SINK@")
		return VolumeState{Level: level, Muted: strings.Contains(muteOut, "yes"), Known: true}, nil
	case "amixer":
		out, err := run("amixer", "get", "Master")
		if err != nil {
			return VolumeState{}, err
		}
		level := 0
		if i := strings.Index(out, "["); i >= 0 {
			if j := strings.Index(out[i:], "%"); j > 0 {
				level, _ = strconv.Atoi(strings.TrimSpace(out[i+1 : i+j]))
			}
		}
		return VolumeState{Level: level, Muted: strings.Contains(out, "[off]"), Known: true}, nil
	}
	return VolumeState{}, ErrUnsupported
}

func (c *linuxController) Volume(op string, value int) (VolumeState, error) {
	if c.sink == "" {
		return VolumeState{}, ErrUnsupported
	}
	if op == VolSet && (value < 0 || value > 100) {
		value = max(0, min(100, value))
	}
	switch c.sink {
	case "wpctl":
		switch op {
		case VolSet:
			return c.after(runErr("wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", fmt.Sprintf("%d%%", value)))
		case VolUp, VolDown:
			step := value
			if step <= 0 {
				step = 5
			}
			sign := "+"
			if op == VolDown {
				sign = "-"
			}
			return c.after(runErr("wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", fmt.Sprintf("%s%d%%", sign, step)))
		case VolMute:
			return c.after(runErr("wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "1"))
		case VolUnmute:
			return c.after(runErr("wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "0"))
		case VolToggleMute:
			return c.after(runErr("wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"))
		}
	case "pactl":
		switch op {
		case VolSet:
			return c.after(runErr("pactl", "set-sink-volume", "@DEFAULT_SINK@", fmt.Sprintf("%d%%", value)))
		case VolUp, VolDown:
			step := value
			if step <= 0 {
				step = 5
			}
			sign := "+"
			if op == VolDown {
				sign = "-"
			}
			return c.after(runErr("pactl", "set-sink-volume", "@DEFAULT_SINK@", fmt.Sprintf("%s%d%%", sign, step)))
		case VolMute:
			return c.after(runErr("pactl", "set-sink-mute", "@DEFAULT_SINK@", "1"))
		case VolUnmute:
			return c.after(runErr("pactl", "set-sink-mute", "@DEFAULT_SINK@", "0"))
		case VolToggleMute:
			return c.after(runErr("pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"))
		}
	case "amixer":
		switch op {
		case VolSet:
			return c.after(runErr("amixer", "-q", "sset", "Master", fmt.Sprintf("%d%%", value)))
		case VolUp:
			return c.after(runErr("amixer", "-q", "sset", "Master", fmt.Sprintf("%d%%+", max(1, value))))
		case VolDown:
			return c.after(runErr("amixer", "-q", "sset", "Master", fmt.Sprintf("%d%%-", max(1, value))))
		case VolMute:
			return c.after(runErr("amixer", "-q", "sset", "Master", "mute"))
		case VolUnmute:
			return c.after(runErr("amixer", "-q", "sset", "Master", "unmute"))
		case VolToggleMute:
			return c.after(runErr("amixer", "-q", "sset", "Master", "toggle"))
		}
	}
	return VolumeState{}, ErrUnsupported
}

func (c *linuxController) after(err error) (VolumeState, error) {
	if err != nil {
		return VolumeState{}, err
	}
	return c.VolumeState()
}

func (c *linuxController) MediaState() (MediaInfo, error) {
	if !hasBin("playerctl") {
		return MediaInfo{}, ErrUnsupported
	}
	format := "{{status}}|{{title}}|{{artist}}|{{album}}|{{position}}|{{mpris:length}}|{{playerName}}"
	out, err := run("playerctl", "metadata", "--format", format)
	if err != nil {
		// 没有活动播放器时 playerctl 以非零退出，视为"无会话"而不是错误
		return MediaInfo{Known: true, Active: false}, nil
	}
	parts := strings.Split(out, "|")
	if len(parts) < 7 {
		return MediaInfo{Known: true, Active: false}, nil
	}
	info := MediaInfo{
		Known: true, Active: true,
		Status: strings.TrimSpace(parts[0]),
		Title:  strings.TrimSpace(parts[1]),
		Artist: strings.TrimSpace(parts[2]),
		Album:  strings.TrimSpace(parts[3]),
		App:    strings.TrimSpace(parts[6]),
	}
	info.Playing = strings.EqualFold(info.Status, "Playing")
	if pos, err := strconv.ParseFloat(strings.TrimSpace(parts[4]), 64); err == nil {
		info.PositionSec = pos
	}
	if dur, err := strconv.ParseFloat(strings.TrimSpace(parts[5]), 64); err == nil {
		info.DurationSec = dur / 1e6 // mpris:length 是微秒
	}
	info.UpdatedAt = float64(time.Now().Unix())
	if info.Title == "" && info.Artist == "" {
		info.Active = false
	}
	return info, nil
}

func (c *linuxController) Wake(mac string) error { return sendMagicPacket(mac) }

// WakeAlarmAt 用 rtcwake 设置一次性唤醒（需要 root 或 CAP_SYS_TIME）。
func WakeAlarmAt(at time.Time, _ string) error {
	if os.Geteuid() != 0 {
		return errors.New("Linux 设置 RTC 唤醒需要 root 权限（rtcwake）")
	}
	return runErr("rtcwake", "-m", "no", "-t", strconv.FormatInt(at.Unix(), 10))
}

func CancelWakeAlarm(_ string) {}
