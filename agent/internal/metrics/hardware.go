package metrics

import (
	"net"
	"sync"
	"time"
)

type CPUInfo struct {
	Model    string `json:"model"`
	Vendor   string `json:"vendor"`
	Cores    int    `json:"cores"`
	Threads  int    `json:"threads"`
	BaseMhz  int    `json:"baseMhz"`
	CacheKb  int    `json:"cacheKb"`
	Socket   string `json:"socket"`
}

type MemoryModule struct {
	Bank         string `json:"bank"`
	SizeBytes    uint64 `json:"sizeBytes"`
	SpeedMhz     int    `json:"speedMhz"`
	Manufacturer string `json:"manufacturer"`
	PartNumber   string `json:"partNumber"`
}

type MemoryInfo struct {
	TotalBytes uint64         `json:"totalBytes"`
	Type       string         `json:"type"`
	SpeedMhz   int            `json:"speedMhz"`
	Slots      []MemoryModule `json:"slots"`
}

type GPUInfo struct {
	Name    string `json:"name"`
	VramMb  uint64 `json:"vramMb"`
	Driver  string `json:"driver"`
}

type HwDisk struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	SizeBytes uint64 `json:"sizeBytes"`
	Serial    string `json:"serial"`
	Health    string `json:"health"`
}

type NICInfo struct {
	Name      string   `json:"name"`
	MAC       string   `json:"mac"`
	SpeedMbps int      `json:"speedMbps"`
	IPv4      []string `json:"ipv4"`
}

type BoardInfo struct {
	Manufacturer string `json:"manufacturer"`
	Model        string `json:"model"`
	Bios         string `json:"bios"`
}

type OSInfo struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	InstalledAt string `json:"installedAt"`
}

type Hardware struct {
	CPU    CPUInfo    `json:"cpu"`
	Memory MemoryInfo `json:"memory"`
	GPUs   []GPUInfo  `json:"gpus"`
	Disks  []HwDisk   `json:"disks"`
	NICs   []NICInfo  `json:"nics"`
	Board  BoardInfo  `json:"board"`
	OS     OSInfo     `json:"os"`
}

var (
	hwMu     sync.Mutex
	hwCache  *Hardware
	hwAt     time.Time
	hwFlight bool
)

// HardwareCached 硬件枚举代价高（Windows 走 CIM，macOS 走 system_profiler），缓存 10 分钟。
func HardwareCached() Hardware {
	hwMu.Lock()
	if hwCache != nil && time.Since(hwAt) < 10*time.Minute {
		h := *hwCache
		hwMu.Unlock()
		return h
	}
	hwMu.Unlock()

	h, err := collectHardware()
	if err != nil && hwCache != nil {
		hwMu.Lock()
		cached := *hwCache
		hwMu.Unlock()
		return cached
	}
	hwMu.Lock()
	hwCache = &h
	hwAt = time.Now()
	hwMu.Unlock()
	return h
}

// WarmHardware 启动时后台预热，避免第一次点开详情页等两秒。
func WarmHardware() { go HardwareCached() }

// WarmUptime 同上，开机历史需要读事件日志。
func WarmUptime() { go CachedHistory(14) }

// ipByMAC 把 MAC 映射到 IPv4，硬件信息里给网卡补地址用。
func ipByMAC() map[string][]string {
	out := map[string][]string{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, i := range ifaces {
		mac := i.HardwareAddr.String()
		if mac == "" || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		key := formatMAC(mac)
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok {
				if v4 := ipnet.IP.To4(); v4 != nil {
					out[key] = append(out[key], v4.String())
				}
			}
		}
	}
	return out
}

func formatMAC(mac string) string {
	buf := make([]byte, 0, len(mac))
	for i := 0; i < len(mac); i++ {
		ch := mac[i]
		if ch >= 'a' && ch <= 'z' {
			ch -= 32
		}
		buf = append(buf, ch)
	}
	return string(buf)
}
