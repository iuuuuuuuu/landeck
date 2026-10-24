package metrics

import (
	"math"
	"os"
	"runtime"
	"strings"
)

// loadAvg 只有 unix 有真正的 load average；Windows 用 CPU 队列近似（返回 0 表示不可用）。
func loadAvg() ([3]float64, error) {
	out := [3]float64{}
	if runtime.GOOS == "windows" {
		return out, nil
	}
	raw, err := os.ReadFile("/proc/loadavg")
	if err == nil {
		fields := strings.Fields(string(raw))
		for i := 0; i < 3 && i < len(fields); i++ {
			out[i] = parseFloat(fields[i])
		}
		return out, nil
	}
	return out, nil
}

func parseFloat(s string) float64 {
	var f float64
	var seen bool
	var frac float64
	var div float64 = 1
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case ch >= '0' && ch <= '9':
			if seen {
				frac = frac*10 + float64(ch-'0')
				div *= 10
			} else {
				f = f*10 + float64(ch-'0')
			}
		case ch == '.':
			seen = true
		default:
			return f + frac/div
		}
	}
	return f + frac/div
}

func isVirtualMount(fstype, mount string) bool {
	switch fstype {
	case "squashfs", "overlay", "tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "none":
		return true
	}
	if strings.HasPrefix(mount, "/snap/") || strings.HasPrefix(mount, "/var/lib/docker") {
		return true
	}
	return false
}

func clamp(n, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, n))
}
