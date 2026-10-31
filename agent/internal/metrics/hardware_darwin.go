//go:build darwin

package metrics

import (
	"encoding/json"
	"net"
	"os/exec"
	"strconv"
	"strings"
)

func sysctl(key string) string {
	out, err := exec.Command("sysctl", "-n", key).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func collectHardware() (Hardware, error) {
	hw := Hardware{GPUs: []GPUInfo{}, Disks: []HwDisk{}, NICs: []NICInfo{}, Memory: MemoryInfo{Slots: []MemoryModule{}}}

	hw.CPU.Model = sysctl("machdep.cpu.brand_string")
	hw.CPU.Vendor = sysctl("machdep.cpu.vendor")
	if n, err := strconv.Atoi(sysctl("hw.physicalcpu")); err == nil {
		hw.CPU.Cores = n
	}
	if n, err := strconv.Atoi(sysctl("hw.logicalcpu")); err == nil {
		hw.CPU.Threads = n
	}
	if n, err := strconv.Atoi(sysctl("hw.cpufrequency")); err == nil {
		hw.CPU.BaseMhz = n / 1_000_000
	}
	if n, err := strconv.ParseUint(sysctl("hw.memsize"), 10, 64); err == nil {
		hw.Memory.TotalBytes = n
	}

	hw.Board.Model = sysctl("hw.model")
	hw.Board.Manufacturer = "Apple"
	hw.Board.Bios = sysctl("machdep.efi_version")

	hw.OS.Name = strings.TrimSpace(sysctl("kern.osproductversion"))
	if hw.OS.Name != "" {
		hw.OS.Name = "macOS " + hw.OS.Name
	} else {
		hw.OS.Name = "macOS"
	}
	hw.OS.Version = sysctl("kern.osrelease")

	hw.GPUs = darwinGPUs()
	hw.Disks = darwinDisks()

	ips := ipByMAC()
	ifaces, err := net.Interfaces()
	if err == nil {
		for _, i := range ifaces {
			if i.Flags&net.FlagLoopback != 0 || len(i.HardwareAddr) == 0 {
				continue
			}
			mac := formatMAC(i.HardwareAddr.String())
			hw.NICs = append(hw.NICs, NICInfo{Name: i.Name, MAC: mac, IPv4: ips[mac]})
		}
	}
	return hw, nil
}

func darwinGPUs() []GPUInfo {
	out, err := exec.Command("system_profiler", "SPDisplaysDataType", "-json").Output()
	if err != nil {
		return []GPUInfo{}
	}
	var doc struct {
		Items []struct {
			Model string `json:"sppci_model"`
			VRAM  string `json:"spdisplays_vram"`
			Chip  string `json:"sppci_device_type"`
		} `json:"SPDisplaysDataType"`
	}
	if err := json.Unmarshal(out, &doc); err != nil {
		return []GPUInfo{}
	}
	gpus := make([]GPUInfo, 0, len(doc.Items))
	for _, it := range doc.Items {
		name := strings.TrimSpace(it.Model)
		if name == "" {
			continue
		}
		gpus = append(gpus, GPUInfo{Name: name})
	}
	return gpus
}

func darwinDisks() []HwDisk {
	out, err := exec.Command("diskutil", "list", "-plist").Output()
	if err != nil {
		return []HwDisk{}
	}
	// 只要物理盘的名字与容量，plist 解析用正则近似（避免引入 plist 依赖）
	_ = out
	return []HwDisk{}
}

