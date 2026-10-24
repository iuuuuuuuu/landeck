//go:build linux

package metrics

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func readBattery() *BatteryStat {
	matches, _ := filepath.Glob("/sys/class/power_supply/BAT*")
	if len(matches) == 0 {
		return nil
	}
	dir := matches[0]
	read := func(name string) string {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(raw))
	}
	capRaw := read("capacity")
	if capRaw == "" {
		return nil
	}
	pct, err := strconv.Atoi(capRaw)
	if err != nil {
		return nil
	}
	st := &BatteryStat{Percent: float64(pct)}
	status := read("status")
	if status == "Charging" || status == "Full" {
		st.Charging = true
	}
	return st
}
