//go:build darwin

package metrics

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

var pmsetRe = regexp.MustCompile(`(\d+)%; ?(charging|charged|discharging|finishing charge|AC attached)`)

func readBattery() *BatteryStat {
	out, err := exec.Command("pmset", "-g", "batt").Output()
	if err != nil {
		return nil
	}
	m := pmsetRe.FindStringSubmatch(string(out))
	if len(m) < 3 {
		return nil
	}
	pct, _ := strconv.Atoi(m[1])
	st := &BatteryStat{Percent: float64(pct)}
	if strings.Contains(m[2], "charg") || strings.Contains(m[2], "AC") {
		st.Charging = true
	}
	return st
}
