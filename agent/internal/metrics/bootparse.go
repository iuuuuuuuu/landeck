//go:build !windows

package metrics

import (
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var lastLineRe = regexp.MustCompile(`^(reboot|shutdown)\s+\S+\s+\S+\s+\S*\s*(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2})`)

// collectBootEvents 通过 `last -x` 读开关机记录（linux 与 macOS 同款命令）。
func collectBootEvents() ([]RawEvent, error) {
	cmd := exec.Command("last", "-x", "reboot", "shutdown")
	cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return parseLastOutput(string(out)), nil
}

// parseLastOutput 解析 `last -x` 的 reboot/shutdown 行（C locale）。
func parseLastOutput(text string) []RawEvent {
	var events []RawEvent
	now := time.Now()
	for _, line := range strings.Split(text, "\n") {
		m := lastLineRe.FindStringSubmatch(strings.TrimSpace(line))
		if len(m) != 3 {
			continue
		}
		kind := "boot"
		if m[1] == "shutdown" {
			kind = "shutdown"
		}
		t, err := time.ParseInLocation("Mon Jan 2 15:04", strings.Join(strings.Fields(m[2]), " "), now.Location())
		if err != nil {
			continue
		}
		// last 不输出年份：落到今天，若在未来则往前推一年
		t = time.Date(now.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
		if t.After(now.Add(2 * time.Hour)) {
			t = t.AddDate(-1, 0, 0)
		}
		events = append(events, RawEvent{At: t, Kind: kind})
	}
	return events
}

