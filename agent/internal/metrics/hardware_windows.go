//go:build windows

package metrics

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func psRun(script string) ([]byte, error) {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.Output()
	if err != nil {
		return out, err
	}
	return out, nil
}

type winHardware struct {
	CPU struct {
		Name                      string  `json:"Name"`
		Manufacturer              string  `json:"Manufacturer"`
		NumberOfCores             int     `json:"NumberOfCores"`
		NumberOfLogicalProcessors int     `json:"NumberOfLogicalProcessors"`
		MaxClockSpeed             float64 `json:"MaxClockSpeed"`
		L2CacheSize               float64 `json:"L2CacheSize"`
		L3CacheSize               float64 `json:"L3CacheSize"`
		SocketDesignation         string  `json:"SocketDesignation"`
	} `json:"cpu"`
	Mem []struct {
		BankLabel        string  `json:"BankLabel"`
		Capacity         float64 `json:"Capacity"`
		Speed            int     `json:"Speed"`
		Manufacturer     string  `json:"Manufacturer"`
		PartNumber       string  `json:"PartNumber"`
		SMBIOSMemoryType int     `json:"SMBIOSMemoryType"`
	} `json:"mem"`
	GPU []struct {
		Name          string  `json:"Name"`
		AdapterRAM    float64 `json:"AdapterRAM"`
		DriverVersion string  `json:"DriverVersion"`
	} `json:"gpu"`
	Disk []struct {
		Model        string  `json:"Model"`
		Size         float64 `json:"Size"`
		SerialNumber string  `json:"SerialNumber"`
		InterfaceType string `json:"InterfaceType"`
		MediaType    string  `json:"MediaType"`
	} `json:"disk"`
	// 注意：Get-PhysicalDisk 的 MediaType / BusType 经 ConvertTo-Json 是字符串
	// （"SSD"/"HDD"/"Unspecified"、"NVMe"/"SATA"/"USB"），不是数字枚举。
	PD []struct {
		FriendlyName string  `json:"FriendlyName"`
		MediaType    string  `json:"MediaType"`
		BusType      string  `json:"BusType"`
		Size         float64 `json:"Size"`
		SerialNumber string  `json:"SerialNumber"`
	} `json:"pd"`
	NIC []struct {
		Name       string  `json:"Name"`
		MACAddress string  `json:"MACAddress"`
		Speed      float64 `json:"Speed"`
	} `json:"nic"`
	Board struct {
		Manufacturer string `json:"Manufacturer"`
		Product      string `json:"Product"`
	} `json:"board"`
	BIOS struct {
		SMBIOSBIOSVersion string `json:"SMBIOSBIOSVersion"`
		ReleaseDate       any    `json:"ReleaseDate"`
	} `json:"bios"`
	OS struct {
		Caption     string `json:"Caption"`
		Version     string `json:"Version"`
		InstallDate any    `json:"InstallDate"`
	} `json:"os"`
}

const winHardwareScript = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,L2CacheSize,L3CacheSize,SocketDesignation
$mem = @(Get-CimInstance Win32_PhysicalMemory | Select-Object BankLabel,Capacity,Speed,Manufacturer,PartNumber,SMBIOSMemoryType)
$gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion)
$disk = @(Get-CimInstance Win32_DiskDrive | Select-Object Model,Size,SerialNumber,InterfaceType,MediaType)
$pd = @(Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType,Size,SerialNumber)
$nic = @(Get-CimInstance Win32_NetworkAdapter -Filter "NetEnabled=True" | Select-Object Name,MACAddress,Speed)
$board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer,Product
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1 SMBIOSBIOSVersion,ReleaseDate
$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 Caption,Version,InstallDate
[pscustomobject]@{cpu=$cpu;mem=$mem;gpu=$gpu;disk=$disk;pd=$pd;nic=$nic;board=$board;bios=$bios;os=$os} | ConvertTo-Json -Compress -Depth 6
`

func collectHardware() (Hardware, error) {
	raw, err := psRun(winHardwareScript)
	if err != nil {
		return Hardware{}, fmt.Errorf("读取硬件信息失败: %w", err)
	}
	var w winHardware
	if err := json.Unmarshal(trimBOM(raw), &w); err != nil {
		return Hardware{}, fmt.Errorf("解析硬件信息失败: %w", err)
	}

	hw := Hardware{
		CPU: CPUInfo{
			Model:   strings.TrimSpace(w.CPU.Name),
			Vendor:  strings.TrimSpace(w.CPU.Manufacturer),
			Cores:   w.CPU.NumberOfCores,
			Threads: w.CPU.NumberOfLogicalProcessors,
			BaseMhz: int(w.CPU.MaxClockSpeed),
			Socket:  strings.TrimSpace(w.CPU.SocketDesignation),
		},
		Memory: MemoryInfo{Slots: []MemoryModule{}},
		GPUs:   []GPUInfo{},
		Disks:  []HwDisk{},
		NICs:   []NICInfo{},
		Board: BoardInfo{
			Manufacturer: strings.TrimSpace(w.Board.Manufacturer),
			Model:        strings.TrimSpace(w.Board.Product),
			Bios:         strings.TrimSpace(w.BIOS.SMBIOSBIOSVersion),
		},
		OS: OSInfo{
			Name:    strings.TrimSpace(strings.TrimPrefix(w.OS.Caption, "Microsoft ")),
			Version: strings.TrimSpace(w.OS.Version),
		},
	}
	hw.CPU.CacheKb = int((w.CPU.L2CacheSize + w.CPU.L3CacheSize) / 1024)
	if hw.CPU.Cores == 0 {
		hw.CPU.Cores = w.CPU.NumberOfLogicalProcessors
	}
	hw.CPU.Model = strings.Join(strings.Fields(hw.CPU.Model), " ")

	for _, m := range w.Mem {
		hw.Memory.Slots = append(hw.Memory.Slots, MemoryModule{
			Bank:         strings.TrimSpace(m.BankLabel),
			SizeBytes:    uint64(m.Capacity),
			SpeedMhz:     m.Speed,
			Manufacturer: strings.TrimSpace(m.Manufacturer),
			PartNumber:   strings.TrimSpace(m.PartNumber),
		})
		hw.Memory.TotalBytes += uint64(m.Capacity)
		if m.Speed > hw.Memory.SpeedMhz {
			hw.Memory.SpeedMhz = m.Speed
		}
		if hw.Memory.Type == "" {
			hw.Memory.Type = smbiosMemoryType(m.SMBIOSMemoryType)
		}
	}
	for _, g := range w.GPU {
		hw.GPUs = append(hw.GPUs, GPUInfo{
			Name:   strings.TrimSpace(g.Name),
			VramMb: uint64(g.AdapterRAM) / (1024 * 1024),
			Driver: strings.TrimSpace(g.DriverVersion),
		})
	}
	if len(w.PD) > 0 {
		for _, d := range w.PD {
			kind := strings.TrimSpace(d.MediaType)
			switch strings.ToLower(kind) {
			case "hdd":
				kind = "HDD"
			case "ssd":
				kind = "SSD"
			case "scm":
				kind = "SCM"
			default:
				kind = "固定磁盘"
			}
			bus := strings.TrimSpace(d.BusType)
			if bus != "" && !strings.EqualFold(bus, "Unspecified") {
				kind = bus + " " + kind
			}
			ness := kind
			hw.Disks = append(hw.Disks, HwDisk{
				Name:      strings.TrimSpace(d.FriendlyName),
				Type:      ness,
				SizeBytes: uint64(d.Size),
				Serial:    strings.TrimSpace(d.SerialNumber),
				Health:    "ok",
			})
		}
	} else {
		for _, d := range w.Disk {
			typ := strings.TrimSpace(d.MediaType)
			if typ == "" {
				typ = strings.TrimSpace(d.InterfaceType)
			}
			hw.Disks = append(hw.Disks, HwDisk{
				Name:      strings.TrimSpace(d.Model),
				Type:      typ,
				SizeBytes: uint64(d.Size),
				Serial:    strings.TrimSpace(d.SerialNumber),
				Health:    "ok",
			})
		}
	}
	ips := ipByMAC()
	for _, n := range w.NIC {
		mac := strings.ToUpper(strings.TrimSpace(n.MACAddress))
		hw.NICs = append(hw.NICs, NICInfo{
			Name:      strings.TrimSpace(n.Name),
			MAC:       mac,
			SpeedMbps: int(n.Speed / 1_000_000),
			IPv4:      ips[mac],
		})
	}
	hw.OS.InstalledAt = parsePSDate(w.OS.InstallDate)
	return hw, nil
}

func smbiosMemoryType(t int) string {
	switch t {
	case 20:
		return "DDR"
	case 21:
		return "DDR2"
	case 24:
		return "DDR3"
	case 26:
		return "DDR4"
	case 34:
		return "DDR5"
	}
	return ""
}

// parsePSDate 处理 PowerShell 5.1 的 "\/Date(1699999999999)\/" 与 ISO 两种形态
func parsePSDate(v any) string {
	s, ok := v.(string)
	if !ok || s == "" {
		return ""
	}
	if strings.Contains(s, "Date(") {
		start := strings.Index(s, "Date(") + 5
		end := strings.Index(s[start:], ")")
		if end > 0 {
			if ms, err := strconv.ParseInt(s[start:start+end], 10, 64); err == nil {
				return time.Unix(0, ms*int64(time.Millisecond)).Format("2006-01-02")
			}
		}
		return ""
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.Format("2006-01-02")
	}
	if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
		return t.Format("2006-01-02")
	}
	return ""
}

func trimBOM(b []byte) []byte {
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return b[3:]
	}
	return b
}

const winBootScript = `
 $ErrorActionPreference='SilentlyContinue'
 [Console]::OutputEncoding=[System.Text.Encoding]::UTF8
 $ev = Get-WinEvent -FilterHashtable @{LogName='System'; Id=6005,6006,6008,41,1074,42,107} -MaxEvents 600 |
   Select-Object Id,TimeCreated,Message
 $ev | ConvertTo-Json -Compress -Depth 3
 `

// collectBootEvents 采集开关机事件。
//
// ID 取舍（为什么是这几个）：
//
//	6005 EventLog 启动       —— 最可靠的开机信号，每次开机必有
//	6006 EventLog 停止       —— 正常关机的确定时刻
//	6008 「上次关闭是意外的」 —— **消息正文里写着真实的关机时刻**。事件本身是
//	                            下次开机时才记录，但正文时间才是这段开机的结束点
//	41   Kernel-Power        —— 确定发生过异常断电/蓝屏；但事件时间约等于下次开机，
//	                            给不出关机时刻，只能作为「确实断过」的弱证据
//	1074 用户发起关机/重启     —— 只是请求，可能被取消，时刻也只比真正断电早一点
//
// 为什么不查 12/13（Kernel-General）：实测 12 每次开机会记 2~3 次（含休眠恢复），
// 噪声太大；13 的覆盖还不如 6006。用它们会凭空造出假开机。
//
// 老版本只查 6005/6006，于是「开机 → 意外断电 → 再开机」被当成一直在线。
// 实测某机器 27 次开机没有配对的关机事件，最长一次虚增 61.9 小时 ——
// 用户看到的就是「明明关了机，却显示两天多没关」。
func collectBootEvents() ([]RawEvent, error) {
	raw, err := psRun(winBootScript)
	if err != nil {
		return nil, err
	}
	type item struct {
		ID          int    `json:"Id"`
		TimeCreated string `json:"TimeCreated"`
		Message     string `json:"Message"`
	}
	var items []item
	if err := json.Unmarshal(trimBOM(raw), &items); err != nil {
		// 只有一条记录时 PowerShell 会退化成对象
		var one item
		if err2 := json.Unmarshal(trimBOM(raw), &one); err2 != nil {
			return nil, err
		}
		items = append(items, one)
	}
	out := make([]RawEvent, 0, len(items))
	for _, it := range items {
		at, err := parsePSTime(it.TimeCreated)
		if err != nil {
			continue
		}
		switch it.ID {
		case 6005, 12:
			out = append(out, RawEvent{At: at, Kind: "boot"})
		case 6006, 13:
			out = append(out, RawEvent{At: at, Kind: "shutdown"})
		case 6008:
			// 这条事件是「下次开机时」记的，但正文写了上次真正关机的时刻。
			// 解析成功就用那个时刻 —— 它才是这段开机的结束点。
			if t, ok := parseUnexpectedShutdownTime(it.Message, at); ok {
				out = append(out, RawEvent{At: t, Kind: "shutdown"})
			} else {
				out = append(out, RawEvent{At: at, Kind: "unexpected"})
			}
		case 41:
			out = append(out, RawEvent{At: at, Kind: "unexpected"})
		case 1074:
			out = append(out, RawEvent{At: at, Kind: "shutdown-req"})
		}
	}
	return out, nil
}

// 6008 消息里的关机时刻。中英文两种常见写法：
//
//	中文：上一次系统的 15:53:59 在 2026/10/17 上的关闭是意外的。
//	英文：The previous system shutdown at 9:26:54 AM on 8/23/2026 was unexpected.
//
// 中文消息里日期前后夹着 U+200E/U+200F 这类不可见方向控制符，
// 不剔掉会匹配不到日期，所以先清洗再解析。
var (
	reClock = regexp.MustCompile(`(\d{1,2}):(\d{2}):(\d{2})\s*(?i:(AM|PM))?`)
	reYMD   = regexp.MustCompile(`(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})`)
	reMDY   = regexp.MustCompile(`(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})`)
)

func parseUnexpectedShutdownTime(msg string, eventAt time.Time) (time.Time, bool) {
	if strings.TrimSpace(msg) == "" {
		return time.Time{}, false
	}
	clean := strings.Map(func(r rune) rune {
		switch r {
		case '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\ufeff', '\u00a0':
			return -1
		}
		return r
	}, msg)

	cm := reClock.FindStringSubmatch(clean)
	if cm == nil {
		return time.Time{}, false
	}
	hour, _ := strconv.Atoi(cm[1])
	minute, _ := strconv.Atoi(cm[2])
	sec, _ := strconv.Atoi(cm[3])
	switch strings.ToUpper(cm[4]) {
	case "PM":
		if hour < 12 {
			hour += 12
		}
	case "AM":
		if hour == 12 {
			hour = 0
		}
	}
	if hour > 23 || minute > 59 || sec > 59 {
		return time.Time{}, false
	}

	var year, month, day int
	if m := reYMD.FindStringSubmatch(clean); m != nil {
		year, _ = strconv.Atoi(m[1])
		month, _ = strconv.Atoi(m[2])
		day, _ = strconv.Atoi(m[3])
	} else if m := reMDY.FindStringSubmatch(clean); m != nil {
		month, _ = strconv.Atoi(m[1])
		day, _ = strconv.Atoi(m[2])
		year, _ = strconv.Atoi(m[3])
	} else {
		// 没写日期：按事件当天推，跨零点的情况下面再修正
		year, month, day = eventAt.Year(), int(eventAt.Month()), eventAt.Day()
	}
	if year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 {
		return time.Time{}, false
	}

	t := time.Date(year, time.Month(month), day, hour, minute, sec, 0, eventAt.Location())
	// 跨零点修正：只有当消息里的日期**就是事件当天**、而时刻却晚于事件时才退一天。
	// 真实场景里 6008 的日期只会是事件当天或前一天；若消息写的是别的日期，
	// 直接采信消息（否则会把 10-17 的关机错算成 10-16）。
	if t.Year() == eventAt.Year() && t.Month() == eventAt.Month() && t.Day() == eventAt.Day() && t.After(eventAt.Add(time.Minute)) {
		t = t.AddDate(0, 0, -1)
	}
	return t, true
}

func parsePSTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	// PowerShell 5.1 的 ConvertTo-Json 把 DateTime 写成 "\/Date(1699999999999)\/"
	if i := strings.Index(s, "Date("); i >= 0 {
		if j := strings.Index(s[i:], ")"); j > 0 {
			if ms, err := strconv.ParseInt(s[i+5:i+j], 10, 64); err == nil {
				return time.Unix(0, ms*int64(time.Millisecond)).Local(), nil
			}
		}
	}
	layouts := []string{
		"2006-01-02T15:04:05.9999999-07:00",
		"2006-01-02T15:04:05-07:00",
		"2006-01-02T15:04:05",
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.Local(), nil
		}
	}
	return time.Time{}, fmt.Errorf("无法解析时间: %s", s)
}
