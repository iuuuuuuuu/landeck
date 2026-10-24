package metrics

import (
	"net"
	"sort"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
	"github.com/shirou/gopsutil/v4/sensors"
)

type CPUStat struct {
	Percent float64   `json:"percent"`
	Model   string    `json:"model"`
	Cores   int       `json:"cores"`
	Threads int       `json:"threads"`
	FreqMhz float64   `json:"freqMhz"`
	PerCore []float64 `json:"perCore"`
	Load    [3]float64 `json:"load"`
}

type MemStat struct {
	Used      uint64  `json:"used"`
	Total     uint64  `json:"total"`
	Percent   float64 `json:"percent"`
	SwapUsed  uint64  `json:"swapUsed"`
	SwapTotal uint64  `json:"swapTotal"`
}

type DiskStat struct {
	Mount   string  `json:"mount"`
	FS      string  `json:"fs"`
	Used    float64 `json:"used"`
	Total   float64 `json:"total"`
	Percent float64 `json:"percent"`
}

type NetStat struct {
	RxBps float64 `json:"rxBps"`
	TxBps float64 `json:"txBps"`
	Iface string  `json:"iface"`
	IP    string  `json:"ip"`
	MAC   string  `json:"mac"`
}

type BatteryStat struct {
	Percent     float64 `json:"percent"`
	Charging    bool    `json:"charging"`
	TimeLeftMin *int    `json:"timeLeftMin"`
}

type TempStat struct {
	Name string  `json:"name"`
	C    float64 `json:"c"`
}

type ProcessStat struct {
	Total int `json:"total"`
	Top   []ProcessTop `json:"top"`
}

type ProcessTop struct {
	Name  string  `json:"name"`
	CPU   float64 `json:"cpu"`
	MemMb float64 `json:"memMb"`
}

type Status struct {
	Time      string       `json:"time"`
	CPU       CPUStat      `json:"cpu"`
	Mem       MemStat      `json:"mem"`
	Disks     []DiskStat   `json:"disks"`
	Net       NetStat      `json:"net"`
	Battery   *BatteryStat `json:"battery"`
	Temps     []TempStat   `json:"temps"`
	Processes ProcessStat  `json:"processes"`
	UptimeSec uint64       `json:"uptimeSec"`
	BootTime  string       `json:"bootTime"`
}

// Sampler 采集实时状态。磁盘/温度/进程/电池都带缓存，避免 2s 一次的推送把机器压着。
type Sampler struct {
	mu sync.Mutex

	lastNetRx uint64
	lastNetTx uint64
	lastNetAt time.Time

	diskCache []DiskStat
	diskAt    time.Time
	tempCache []TempStat
	tempAt    time.Time
	procCache ProcessStat
	procAt    time.Time
	batCache  *BatteryStat
	batAt     time.Time

	cpuModel   string
	cpuCores   int
	cpuThreads int
}

func NewSampler() *Sampler {
	s := &Sampler{}
	s.initCPU()
	return s
}

func (s *Sampler) initCPU() {
	if infos, err := cpu.Info(); err == nil && len(infos) > 0 {
		s.cpuModel = infos[0].ModelName
	}
	if physical, err := cpu.Counts(false); err == nil && physical > 0 {
		s.cpuCores = physical
	}
	if counts, err := cpu.Counts(true); err == nil {
		s.cpuThreads = counts
		if s.cpuCores == 0 {
			s.cpuCores = counts
		}
	}
	if s.cpuCores == 0 {
		s.cpuCores = 1
	}
	if s.cpuThreads == 0 {
		s.cpuThreads = s.cpuCores
	}
}

func (s *Sampler) Snapshot() Status {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := Status{Time: time.Now().Format(time.RFC3339)}

	// CPU
	percent := 0.0
	if list, err := cpu.Percent(0, false); err == nil && len(list) > 0 {
		percent = list[0]
	}
	perCore, _ := cpu.Percent(0, true)
	load, _ := loadAvg()
	out.CPU = CPUStat{
		Percent: round1(percent),
		Model:   s.cpuModel,
		Cores:   s.cpuCores,
		Threads: s.cpuThreads,
		Load:    load,
	}
	if infos, err := cpu.Info(); err == nil && len(infos) > 0 {
		out.CPU.FreqMhz = round1(infos[0].Mhz)
	}
	out.CPU.PerCore = make([]float64, 0, len(perCore))
	for _, p := range perCore {
		out.CPU.PerCore = append(out.CPU.PerCore, round1(p))
	}

	// 内存
	if vm, err := mem.VirtualMemory(); err == nil {
		out.Mem = MemStat{Used: vm.Total - vm.Available, Total: vm.Total, Percent: round1(vm.UsedPercent)}
	}
	if sw, err := mem.SwapMemory(); err == nil {
		out.Mem.SwapUsed = sw.Used
		out.Mem.SwapTotal = sw.Total
	}

	// 磁盘（15s 缓存）
	if s.diskCache == nil || time.Since(s.diskAt) > 15*time.Second {
		s.diskCache = collectDisks()
		s.diskAt = time.Now()
	}
	out.Disks = s.diskCache

	// 网络速率（差分）
	out.Net = s.netStat()

	// 电池（30s 缓存）
	if s.batCache == nil || time.Since(s.batAt) > 30*time.Second {
		s.batCache = readBattery()
		s.batAt = time.Now()
	}
	out.Battery = s.batCache

	// 温度（20s 缓存）
	if s.tempCache == nil || time.Since(s.tempAt) > 20*time.Second {
		s.tempCache = collectTemps()
		s.tempAt = time.Now()
	}
	out.Temps = s.tempCache

	// 进程（15s 缓存）
	if s.procAt.IsZero() || time.Since(s.procAt) > 15*time.Second {
		s.procCache = collectProcesses()
		s.procAt = time.Now()
	}
	out.Processes = s.procCache

	if up, err := host.Uptime(); err == nil {
		out.UptimeSec = up
	}
	if bt, err := host.BootTime(); err == nil {
		out.BootTime = time.Unix(int64(bt), 0).Format(time.RFC3339)
	}
	return out
}

func (s *Sampler) netStat() NetStat {
	out := NetStat{}
	counters, err := gnet.IOCounters(false)
	if err != nil || len(counters) == 0 {
		return out
	}
	var rx, tx uint64
	for _, c := range counters {
		rx += c.BytesRecv
		tx += c.BytesSent
	}
	now := time.Now()
	if !s.lastNetAt.IsZero() && rx >= s.lastNetRx && tx >= s.lastNetTx {
		dt := now.Sub(s.lastNetAt).Seconds()
		if dt > 0.2 {
			out.RxBps = round1(float64(rx-s.lastNetRx) / dt)
			out.TxBps = round1(float64(tx-s.lastNetTx) / dt)
		}
	}
	s.lastNetRx, s.lastNetTx, s.lastNetAt = rx, tx, now

	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := i.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok {
				if v4 := ipnet.IP.To4(); v4 != nil && v4.IsPrivate() {
					out.Iface = i.Name
					out.IP = v4.String()
					out.MAC = i.HardwareAddr.String()
					return out
				}
			}
		}
	}
	return out
}

func collectDisks() []DiskStat {
	parts, err := disk.Partitions(false)
	if err != nil {
		return []DiskStat{}
	}
	seen := map[string]bool{}
	out := make([]DiskStat, 0, len(parts))
	for _, p := range parts {
		if isVirtualMount(p.Fstype, p.Mountpoint) || seen[p.Mountpoint] {
			continue
		}
		u, err := disk.Usage(p.Mountpoint)
		if err != nil || u.Total == 0 {
			continue
		}
		seen[p.Mountpoint] = true
		out = append(out, DiskStat{
			Mount:   p.Mountpoint,
			FS:      p.Fstype,
			Used:    round1(float64(u.Used) / (1 << 30)),
			Total:   round1(float64(u.Total) / (1 << 30)),
			Percent: round1(u.UsedPercent),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Mount < out[j].Mount })
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func collectTemps() []TempStat {
	list, err := sensors.SensorsTemperatures()
	if err != nil {
		return []TempStat{}
	}
	out := make([]TempStat, 0, len(list))
	for _, t := range list {
		if t.Temperature <= 0 || t.Temperature > 125 {
			continue
		}
		name := t.SensorKey
		if name == "" {
			name = "sensor"
		}
		out = append(out, TempStat{Name: name, C: round1(t.Temperature)})
		if len(out) >= 4 {
			break
		}
	}
	return out
}

func collectProcesses() ProcessStat {
	out := ProcessStat{Top: []ProcessTop{}}
	procs, err := process.Processes()
	if err != nil {
		return out
	}
	out.Total = len(procs)
	return out
}

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}
