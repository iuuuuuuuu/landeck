package control

import (
	"errors"
	"fmt"
	"net"
	"strings"
)

// 电源类动作
const (
	PowerShutdown  = "shutdown"
	PowerRestart   = "restart"
	PowerSleep     = "sleep"
	PowerHibernate = "hibernate"
	PowerLock      = "lock"
	PowerLogoff    = "logoff"
	PowerScreenOff = "screen_off"
	PowerCancel    = "cancel"
)

// 音量类动作
const (
	VolSet        = "set"
	VolUp         = "up"
	VolDown       = "down"
	VolMute       = "mute"
	VolUnmute     = "unmute"
	VolToggleMute = "toggle_mute"
)

// 媒体类动作
const (
	MediaPlayPause = "play_pause"
	MediaNext      = "next"
	MediaPrev      = "prev"
	MediaStop      = "stop"
)

var (
	ErrUnsupported = errors.New("unsupported")
	ErrFailed      = errors.New("failed")
)

type Caps struct {
	Sleep     bool `json:"sleep"`
	Hibernate bool `json:"hibernate"`
	Wake      bool `json:"wake"`
	ScreenOff bool `json:"screenOff"`
	Volume    bool `json:"volume"`
	Media     bool `json:"media"`
}

// MediaInfo 是当前媒体会话快照（Windows 走 SMTC，Linux 走 MPRIS，macOS 走 nowplaying-cli）。
type MediaInfo struct {
	Known       bool    `json:"known"`
	Active      bool    `json:"active"`
	Playing     bool    `json:"playing"`
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	Album       string  `json:"album"`
	App         string  `json:"app"`
	Status      string  `json:"status"`
	PositionSec float64 `json:"positionSec"`
	DurationSec float64 `json:"durationSec"`
	UpdatedAt   float64 `json:"updatedAt"`
}

type VolumeState struct {
	Level int  `json:"level"`
	Muted bool `json:"muted"`
	Known bool `json:"known"`
}

type Controller interface {
	Power(op string, delaySec int, force bool) error
	Volume(op string, value int) (VolumeState, error)
	VolumeState() (VolumeState, error)
	Media(op string) error
	// MediaState 返回当前播放内容与状态；拿不到时 Known=false
	MediaState() (MediaInfo, error)
	Wake(mac string) error
	Caps() Caps
	// DryRun 为真时电源/媒体动作只记录不执行（自检与首次配网用）
	DryRun() bool
}

// Options 是所有平台实现的公共开关
type Options struct {
	DryRun  bool
	DataDir string
}

func normalizeMAC(mac string) (net.HardwareAddr, error) {
	clean := strings.NewReplacer(":", "", "-", "", ".", "", " ", "").Replace(strings.TrimSpace(mac))
	if len(clean) != 12 {
		return nil, fmt.Errorf("MAC 地址格式不正确: %q", mac)
	}
	hw, err := net.ParseMAC(strings.Join(split2(clean), ":"))
	if err != nil {
		return nil, fmt.Errorf("MAC 地址格式不正确: %q", mac)
	}
	return hw, nil
}

func split2(s string) []string {
	out := make([]string, 0, len(s)/2)
	for i := 0; i+2 <= len(s); i += 2 {
		out = append(out, s[i:i+2])
	}
	return out
}

// sendMagicPacket 组装 WoL 魔术包：6 字节 0xFF + MAC 重复 16 次
func sendMagicPacket(mac string) error {
	hw, err := normalizeMAC(mac)
	if err != nil {
		return err
	}
	packet := make([]byte, 6+16*6)
	for i := 0; i < 6; i++ {
		packet[i] = 0xFF
	}
	for i := 1; i <= 16; i++ {
		copy(packet[i*6:], hw)
	}
	conn, err := net.Dial("udp4", "255.255.255.255:9")
	if err != nil {
		// 部分系统禁广播，退化到限定向导地址的尝试
		if c2, err2 := net.Dial("udp4", "239.255.255.250:9"); err2 == nil {
			_, _ = c2.Write(packet)
			_ = c2.Close()
			return nil
		}
		return err
	}
	defer conn.Close()
	if uc, ok := conn.(*net.UDPConn); ok {
		_ = uc.SetWriteBuffer(1024)
	}
	_, err = conn.Write(packet)
	return err
}
