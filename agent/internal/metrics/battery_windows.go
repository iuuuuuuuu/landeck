//go:build windows

package metrics

import (
	"encoding/json"
	"os/exec"
	"strings"
	"syscall"
)

// readBattery 用 Win32_Battery 读电池；台式机返回 nil。
func readBattery() *BatteryStat {
	script := `$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;` +
		`$b = Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime;` +
		`if ($b) { $b | ConvertTo-Json -Compress }`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.Output()
	if err != nil || len(strings.TrimSpace(string(out))) == 0 {
		return nil
	}
	var raw struct {
		Remaining int `json:"EstimatedChargeRemaining"`
		Status    int `json:"BatteryStatus"`
		RunTime   int `json:"EstimatedRunTime"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil
	}
	st := &BatteryStat{Percent: float64(raw.Remaining)}
	// BatteryStatus: 2 = 接通电源（充电/满电）
	if raw.Status == 2 {
		st.Charging = true
	}
	if raw.RunTime > 0 && raw.RunTime < 71582788 {
		mins := raw.RunTime
		st.TimeLeftMin = &mins
	}
	return st
}
