//go:build windows

package metrics

import (
	"encoding/json"
	"fmt"
	"os/exec"
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
$ev = Get-WinEvent -FilterHashtable @{LogName='System'; Id=6005,6006,1074,42,107} -MaxEvents 600 |
  Select-Object Id,TimeCreated
$ev | ConvertTo-Json -Compress -Depth 3
`

func collectBootEvents() ([]RawEvent, error) {
	raw, err := psRun(winBootScript)
	if err != nil {
		return nil, err
	}
	var items []struct {
		ID          int    `json:"Id"`
		TimeCreated string `json:"TimeCreated"`
	}
	if err := json.Unmarshal(trimBOM(raw), &items); err != nil {
		// 只有一条记录时 PowerShell 会退化成对象
		var one struct {
			ID          int    `json:"Id"`
			TimeCreated string `json:"TimeCreated"`
		}
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
		}
	}
	return out, nil
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
