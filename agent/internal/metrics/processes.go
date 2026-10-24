package metrics

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

type ProcessInfo struct {
	PID       int32   `json:"pid"`
	Parent    int32   `json:"parent"`
	Name      string  `json:"name"`
	CPU       float64 `json:"cpu"`
	MemMb     float64 `json:"memMb"`
	User      string  `json:"user"`
	Status    string  `json:"status"`
	Exe       string  `json:"exe"`
	StartedAt string  `json:"startedAt"`
}

type ProcessQuery struct {
	Sort  string // cpu | mem | name | pid
	Limit int
	Query string
}

var (
	procMu    sync.Mutex
	procList  []ProcessInfo
	procListAt time.Time
)

// ListProcesses 返回进程列表。CPU 用两次采样（间隔 200ms）算瞬时占用，
// 结果缓存 2s，避免连续刷新把被控机拖慢。
func ListProcesses(q ProcessQuery) ([]ProcessInfo, error) {
	if q.Limit <= 0 || q.Limit > 400 {
		q.Limit = 60
	}
	all, err := cachedProcesses()
	if err != nil {
		return nil, err
	}

	key := strings.ToLower(strings.TrimSpace(q.Query))
	filtered := make([]ProcessInfo, 0, len(all))
	for _, p := range all {
		if key == "" || strings.Contains(strings.ToLower(p.Name), key) ||
			strings.Contains(strings.ToLower(p.Exe), key) ||
			strings.Contains(strings.ToLower(p.User), key) {
			filtered = append(filtered, p)
		}
	}

	switch q.Sort {
	case "mem":
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].MemMb > filtered[j].MemMb })
	case "name":
		sort.Slice(filtered, func(i, j int) bool {
			return strings.ToLower(filtered[i].Name) < strings.ToLower(filtered[j].Name)
		})
	case "pid":
		sort.Slice(filtered, func(i, j int) bool { return filtered[i].PID < filtered[j].PID })
	default:
		sort.Slice(filtered, func(i, j int) bool {
			if filtered[i].CPU == filtered[j].CPU {
				return filtered[i].MemMb > filtered[j].MemMb
			}
			return filtered[i].CPU > filtered[j].CPU
		})
	}
	if len(filtered) > q.Limit {
		filtered = filtered[:q.Limit]
	}
	return filtered, nil
}

func cachedProcesses() ([]ProcessInfo, error) {
	procMu.Lock()
	defer procMu.Unlock()
	if procList != nil && time.Since(procListAt) < 2*time.Second {
		return procList, nil
	}
	list, err := sampleProcesses()
	if err != nil {
		return nil, err
	}
	procList = list
	procListAt = time.Now()
	return list, nil
}

func sampleProcesses() ([]ProcessInfo, error) {
	procs, err := process.Processes()
	if err != nil {
		return nil, err
	}
	// 第一遍：建立基线
	for _, p := range procs {
		_, _ = p.Percent(0)
		_, _ = p.MemoryInfo()
	}
	time.Sleep(200 * time.Millisecond)
	cores := float64(runtime.NumCPU())
	if cores < 1 {
		cores = 1
	}
	out := make([]ProcessInfo, 0, len(procs))
	for _, p := range procs {
		info := ProcessInfo{PID: p.Pid}
		if name, err := p.Name(); err == nil {
			info.Name = name
		}
		if info.Name == "" {
			continue
		}
		if pct, err := p.Percent(0); err == nil {
			// gopsutil 在 Windows 上返回的是「所有核心累计」，除以核数才是任务管理器口径
			info.CPU = round1(pct / cores)
		}
		if mi, err := p.MemoryInfo(); err == nil && mi != nil {
			info.MemMb = round1(float64(mi.RSS) / (1024 * 1024))
		}
		if user, err := p.Username(); err == nil {
			info.User = shortUser(user)
		}
		if st, err := p.Status(); err == nil && len(st) > 0 {
			info.Status = st[0]
		}
		if exe, err := p.Exe(); err == nil {
			info.Exe = exe
		}
		if ppid, err := p.Ppid(); err == nil {
			info.Parent = ppid
		}
		if created, err := p.CreateTime(); err == nil && created > 0 {
			info.StartedAt = time.UnixMilli(created).Format(time.RFC3339)
		}
		out = append(out, info)
	}
	return out, nil
}

func shortUser(u string) string {
	if i := strings.LastIndexAny(u, `\/`); i >= 0 && i < len(u)-1 {
		return u[i+1:]
	}
	return u
}

// 关键系统进程：杀它们会直接让机器蓝屏/注销，统一拒绝。
var protectedNames = map[string]bool{
	"system": true, "system idle process": true, "registry": true, "memory compression": true,
	"smss.exe": true, "csrss.exe": true, "wininit.exe": true, "winlogon.exe": true,
	"services.exe": true, "lsass.exe": true, "lsaiso.exe": true, "sihost.exe": true,
	"init": true, "systemd": true, "launchd": true, "kernel_task": true,
}

var (
	ErrProcessNotFound  = errors.New("进程不存在")
	ErrProcessProtected = errors.New("这是系统关键进程，已拒绝结束")
)

// KillProcess 结束单个进程。force=true 走 Kill（等价 TerminateProcess / SIGKILL）。
func KillProcess(pid int32, force bool) error {
	if pid <= 4 {
		return ErrProcessProtected
	}
	if pid == int32(os.Getpid()) {
		return errors.New("不能结束 Agent 自身进程")
	}
	p, err := process.NewProcess(pid)
	if err != nil {
		return ErrProcessNotFound
	}
	name, _ := p.Name()
	if protectedNames[strings.ToLower(name)] {
		return fmt.Errorf("%w（%s）", ErrProcessProtected, name)
	}
	if force {
		err = p.Kill()
	} else {
		err = p.Terminate()
	}
	if err != nil {
		return fmt.Errorf("结束 %s(%d) 失败: %w", name, pid, err)
	}
	procMu.Lock()
	procList = nil
	procMu.Unlock()
	return nil
}

// KillProcessByName 仅当同名进程唯一时才结束，避免误杀一批 svchost 之类的名字。
func KillProcessByName(name string, force bool) (int32, error) {
	procs, err := process.Processes()
	if err != nil {
		return 0, err
	}
	var matched []int32
	for _, p := range procs {
		n, err := p.Name()
		if err != nil {
			continue
		}
		if strings.EqualFold(n, name) {
			matched = append(matched, p.Pid)
		}
	}
	switch len(matched) {
	case 0:
		return 0, ErrProcessNotFound
	case 1:
		return matched[0], KillProcess(matched[0], force)
	default:
		return 0, fmt.Errorf("有 %d 个同名进程（%s），请用 PID 指定要结束哪一个", len(matched), name)
	}
}

// ---------- 按应用聚合 ----------
//
// 普通用户不认识 PID，也分不清 chrome.exe 的 20 个子进程谁是谁。
// 这里把进程按「可执行文件名」归成一个应用：总 CPU / 总内存 / 进程数 / 主 PID，
// 结束应用时按树状整组结束（先子后父），而不是让用户逐个杀。

type AppGroup struct {
	Key       string  `json:"key"`       // 归一化后的应用名（小写 exe 名）
	Name      string  `json:"name"`      // 展示名（去掉 .exe，首字母大写）
	PIDs      []int32 `json:"pids"`      // 该应用下所有进程
	MainPID   int32   `json:"mainPid"`   // 最像主进程的那个（内存最大 / 无同名父进程）
	Count     int     `json:"count"`
	CPU       float64 `json:"cpu"`       // 汇总 CPU%
	MemMb     float64 `json:"memMb"`     // 汇总内存
	User      string  `json:"user"`
	Exe       string  `json:"exe"`
	Protected bool    `json:"protected"` // 系统关键应用，不允许结束
}

type AppQuery struct {
	Sort  string // cpu | mem | name | count
	Limit int
	Query string
}

// ListApps 返回按应用聚合的列表。数据源复用 ListProcesses 的 2s 缓存。
func ListApps(q AppQuery) ([]AppGroup, error) {
	if q.Limit <= 0 || q.Limit > 300 {
		q.Limit = 80
	}
	all, err := cachedProcesses()
	if err != nil {
		return nil, err
	}

	byKey := map[string]*AppGroup{}
	parentOf := map[int32]int32{}
	for _, p := range all {
		parentOf[p.PID] = p.Parent
		key := strings.ToLower(strings.TrimSuffix(p.Name, ".exe"))
		if key == "" {
			key = strings.ToLower(p.Name)
		}
		g := byKey[key]
		if g == nil {
			g = &AppGroup{
				Key:  key,
				Name: displayName(p.Name),
				User: p.User,
				Exe:  p.Exe,
			}
			byKey[key] = g
		}
		g.PIDs = append(g.PIDs, p.PID)
		g.CPU += p.CPU
		g.MemMb += p.MemMb
		if p.Exe != "" && g.Exe == "" {
			g.Exe = p.Exe
		}
	}

	for key, g := range byKey {
		g.Count = len(g.PIDs)
		g.CPU = round1(g.CPU)
		g.MemMb = round1(g.MemMb)
		g.Protected = protectedNames[strings.ToLower(g.Name)] || protectedNames[key] ||
			protectedNames[key+".exe"]
		// 主进程：优先「父进程不属于本组」的那个，其次内存最大
		var best int32
		var bestMem float64 = -1
		for _, pid := range g.PIDs {
			parent := parentOf[pid]
			sameGroup := false
			for _, other := range g.PIDs {
				if other == parent {
					sameGroup = true
					break
				}
			}
			if !sameGroup {
				if g.MainPID == 0 {
					g.MainPID = pid
				}
			}
			if info := findProc(all, pid); info != nil && info.MemMb > bestMem {
				bestMem = info.MemMb
				best = pid
			}
		}
		if g.MainPID == 0 {
			g.MainPID = best
		}
		_ = key
	}

	key := strings.ToLower(strings.TrimSpace(q.Query))
	list := make([]AppGroup, 0, len(byKey))
	for _, g := range byKey {
		if key != "" &&
			!strings.Contains(strings.ToLower(g.Name), key) &&
			!strings.Contains(strings.ToLower(g.Exe), key) &&
			!strings.Contains(strings.ToLower(g.User), key) {
			continue
		}
		list = append(list, *g)
	}

	switch q.Sort {
	case "mem":
		sort.Slice(list, func(i, j int) bool { return list[i].MemMb > list[j].MemMb })
	case "name":
		sort.Slice(list, func(i, j int) bool {
			return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name)
		})
	case "count":
		sort.Slice(list, func(i, j int) bool { return list[i].Count > list[j].Count })
	default:
		sort.Slice(list, func(i, j int) bool {
			if list[i].CPU == list[j].CPU {
				return list[i].MemMb > list[j].MemMb
			}
			return list[i].CPU > list[j].CPU
		})
	}
	if len(list) > q.Limit {
		list = list[:q.Limit]
	}
	return list, nil
}

func findProc(all []ProcessInfo, pid int32) *ProcessInfo {
	for i := range all {
		if all[i].PID == pid {
			return &all[i]
		}
	}
	return nil
}

func displayName(name string) string {
	base := strings.TrimSuffix(name, ".exe")
	if base == "" {
		return name
	}
	return base
}

// KillApp 结束一个应用的全部进程。先子后父，避免父进程重启子进程。
func KillApp(key string, force bool) (int, error) {
	apps, err := ListApps(AppQuery{Limit: 300})
	if err != nil {
		return 0, err
	}
	var target *AppGroup
	for i := range apps {
		if apps[i].Key == key {
			target = &apps[i]
			break
		}
	}
	if target == nil {
		return 0, ErrProcessNotFound
	}
	if target.Protected {
		return 0, fmt.Errorf("%w（%s）", ErrProcessProtected, target.Name)
	}

	// 子进程先杀：按「有本组父进程」判定，简单起见用深度排序
	all, _ := cachedProcesses()
	parentOf := map[int32]int32{}
	for _, p := range all {
		parentOf[p.PID] = p.Parent
	}
	inGroup := map[int32]bool{}
	for _, pid := range target.PIDs {
		inGroup[pid] = true
	}
	depth := func(pid int32) int {
		d, cur, guard := 0, pid, 0
		for guard < 32 {
			p, ok := parentOf[cur]
			if !ok || !inGroup[p] {
				break
			}
			d++
			cur = p
			guard++
		}
		return d
	}
	sorted := append([]int32(nil), target.PIDs...)
	sort.Slice(sorted, func(i, j int) bool { return depth(sorted[i]) > depth(sorted[j]) })

	killed := 0
	var lastErr error
	for _, pid := range sorted {
		if err := KillProcess(pid, force); err != nil {
			lastErr = err
			continue
		}
		killed++
	}
	if killed == 0 && lastErr != nil {
		return 0, lastErr
	}
	procMu.Lock()
	procList = nil
	procMu.Unlock()
	return killed, nil
}
