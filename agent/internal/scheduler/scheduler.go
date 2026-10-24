package scheduler

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"landeck/internal/config"
	"landeck/internal/control"
)

type When struct {
	Kind     string `json:"kind"` // daily | weekly | once
	Time     string `json:"time"` // HH:MM
	Weekdays []int  `json:"weekdays,omitempty"`
	At       string `json:"at,omitempty"` // 仅 once，RFC3339
}

type WakeOpt struct {
	Enabled bool `json:"enabled"`
	LeadSec int  `json:"leadSec"`
}

type Task struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Enabled   bool           `json:"enabled"`
	Action    string         `json:"action"`
	Params    map[string]any `json:"params"`
	When      When           `json:"when"`
	Wake      WakeOpt        `json:"wake"`
	LastRunAt *time.Time     `json:"lastRunAt,omitempty"`
	NextRunAt *time.Time     `json:"nextRunAt,omitempty"`
}

type Runner struct {
	mu    sync.RWMutex
	items []Task
	path  string
	ctrl  control.Controller
	exec  func(Task) error

	stop chan struct{}
	once sync.Once
}

func New(dir string, ctrl control.Controller, exec func(Task) error) (*Runner, error) {
	r := &Runner{
		path: filepath.Join(dir, "schedules.json"),
		ctrl: ctrl,
		exec: exec,
		stop: make(chan struct{}),
	}
	if err := r.load(); err != nil {
		return nil, err
	}
	r.recompute()
	return r, nil
}

func (r *Runner) load() error {
	raw, err := os.ReadFile(r.path)
	if err != nil {
		if os.IsNotExist(err) {
			r.items = []Task{}
			return nil
		}
		return err
	}
	if len(raw) == 0 {
		r.items = []Task{}
		return nil
	}
	return json.Unmarshal(raw, &r.items)
}

func (r *Runner) saveLocked() {
	raw, err := json.MarshalIndent(r.items, "", "  ")
	if err != nil {
		return
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		log.Printf("保存定时任务失败: %v", err)
		return
	}
	_ = os.Rename(tmp, r.path)
}

func (r *Runner) List() []Task {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Task, len(r.items))
	copy(out, r.items)
	return out
}

func (r *Runner) Get(id string) (Task, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, t := range r.items {
		if t.ID == id {
			return t, true
		}
	}
	return Task{}, false
}

func (r *Runner) Upsert(t Task) (Task, error) {
	if t.When.Kind == "" {
		t.When.Kind = "daily"
	}
	if t.Params == nil {
		t.Params = map[string]any{}
	}
	if t.When.Kind != "once" {
		if _, err := parseHHMM(t.When.Time); err != nil {
			return Task{}, fmt.Errorf("时间格式需为 HH:MM")
		}
	}
	if t.Wake.LeadSec <= 0 {
		t.Wake.LeadSec = 60
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if t.ID == "" {
		t.ID = "sch_" + config.GenerateID()
		next := computeNext(t, time.Now())
		t.NextRunAt = next
		r.items = append(r.items, t)
	} else {
		found := false
		for i := range r.items {
			if r.items[i].ID == t.ID {
				t.LastRunAt = r.items[i].LastRunAt
				t.NextRunAt = computeNext(t, time.Now())
				r.items[i] = t
				found = true
				break
			}
		}
		if !found {
			t.NextRunAt = computeNext(t, time.Now())
			r.items = append(r.items, t)
		}
	}
	sort.Slice(r.items, func(i, j int) bool { return r.items[i].Name < r.items[j].Name })
	r.saveLocked()
	return t, nil
}

func (r *Runner) Delete(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, t := range r.items {
		if t.ID == id {
			r.items = append(r.items[:i], r.items[i+1:]...)
			r.saveLocked()
			control.CancelWakeAlarm("LanDeckWake_" + id)
			return true
		}
	}
	return false
}

func (r *Runner) recompute() {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for i := range r.items {
		r.items[i].NextRunAt = computeNext(r.items[i], now)
	}
	r.saveLocked()
}

func (r *Runner) Start() {
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.stop:
				return
			case now := <-ticker.C:
				r.tick(now)
			}
		}
	}()
}

func (r *Runner) Stop() { r.once.Do(func() { close(r.stop) }) }

func (r *Runner) tick(now time.Time) {
	r.mu.Lock()
	var due []Task
	for i := range r.items {
		t := &r.items[i]
		if !t.Enabled || t.NextRunAt == nil {
			continue
		}
		if !now.Before(*t.NextRunAt) {
			due = append(due, *t)
			t.LastRunAt = &now
			t.NextRunAt = computeNext(*t, now.Add(time.Minute))
			if t.When.Kind == "once" {
				t.Enabled = false
				t.NextRunAt = nil
			}
		}
	}
	if len(due) > 0 {
		r.saveLocked()
	}
	r.mu.Unlock()

	for _, t := range due {
		// 关机/睡眠前为下一个带唤醒的任务挂 RTC 闹钟
		if isPowerOff(t.Action) {
			r.armWakeBeforeOff(t)
		}
		if err := r.exec(t); err != nil {
			log.Printf("定时任务 %s 执行失败: %v", t.Name, err)
		}
	}
}

func isPowerOff(action string) bool {
	switch action {
	case "power.shutdown", "power.sleep", "power.hibernate", "power.restart":
		return true
	}
	return false
}

// armWakeBeforeOff 找下一个启用唤醒的任务，把 RTC 闹钟挂在关机前。
func (r *Runner) armWakeBeforeOff(self Task) {
	r.mu.RLock()
	var target *Task
	var best time.Time
	for i := range r.items {
		t := r.items[i]
		if !t.Enabled || !t.Wake.Enabled || t.ID == self.ID || t.NextRunAt == nil {
			continue
		}
		if best.IsZero() || t.NextRunAt.Before(best) {
			cp := t
			target = &cp
			best = *t.NextRunAt
		}
	}
	ctrl := r.ctrl
	r.mu.RUnlock()
	if target == nil || ctrl == nil {
		return
	}
	lead := time.Duration(target.Wake.LeadSec) * time.Second
	at := best.Add(-lead)
	if err := control.WakeAlarmAt(at, "LanDeckWake_"+target.ID); err != nil {
		log.Printf("设置 RTC 唤醒失败: %v", err)
	}
}

func parseHHMM(s string) (int, error) {
	for _, layout := range []string{"15:04", "15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Hour()*60 + t.Minute(), nil
		}
	}
	return 0, fmt.Errorf("时间格式需为 HH:MM")
}

func computeNext(t Task, from time.Time) *time.Time {
	if !t.Enabled && t.When.Kind != "once" {
		return nil
	}
	switch t.When.Kind {
	case "once":
		if t.When.At == "" {
			return nil
		}
		at, err := time.ParseInLocation(time.RFC3339, t.When.At, from.Location())
		if err != nil {
			return nil
		}
		if at.Before(from) {
			return nil
		}
		return &at
	case "weekly":
		mins, err := parseHHMM(t.When.Time)
		if err != nil || len(t.When.Weekdays) == 0 {
			return nil
		}
		allowed := map[int]bool{}
		for _, d := range t.When.Weekdays {
			allowed[d%7] = true
		}
		for day := 0; day < 8; day++ {
			base := from.AddDate(0, 0, day)
			cand := time.Date(base.Year(), base.Month(), base.Day(), mins/60, mins%60, 0, 0, from.Location())
			if !cand.After(from) {
				continue
			}
			if allowed[int(cand.Weekday())] {
				return &cand
			}
		}
		return nil
	default: // daily
		mins, err := parseHHMM(t.When.Time)
		if err != nil {
			return nil
		}
		cand := time.Date(from.Year(), from.Month(), from.Day(), mins/60, mins%60, 0, 0, from.Location())
		if !cand.After(from) {
			cand = cand.AddDate(0, 0, 1)
		}
		return &cand
	}
}
