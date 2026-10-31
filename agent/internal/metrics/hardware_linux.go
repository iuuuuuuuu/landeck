//go:build linux

package metrics

import (
	"bufio"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

func collectHardware() (Hardware, error) {
	hw := Hardware{GPUs: []GPUInfo{}, Disks: []HwDisk{}, NICs: []NICInfo{}, Memory: MemoryInfo{Slots: []MemoryModule{}}}
	readCPU(&hw)
	readMem(&hw)
	readDisks(&hw)
	readNICs(&hw)
	readDMI(&hw)
	readOSRelease(&hw)
	return hw, nil
}

func readCPU(hw *Hardware) {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	threads := 0
	for sc.Scan() {
		line := sc.Text()
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		switch key {
		case "processor":
			threads++
		case "model name":
			if hw.CPU.Model == "" {
				hw.CPU.Model = strings.Join(strings.Fields(val), " ")
			}
		case "vendor_id":
			if hw.CPU.Vendor == "" {
				hw.CPU.Vendor = val
			}
		case "cpu MHz":
			if mhz, err := strconv.ParseFloat(val, 64); err == nil && float64(hw.CPU.BaseMhz) < mhz {
				hw.CPU.BaseMhz = int(mhz)
			}
		case "cache size":
			if hw.CPU.CacheKb == 0 {
				fields := strings.Fields(val)
				if len(fields) > 0 {
					if n, err := strconv.Atoi(fields[0]); err == nil {
						hw.CPU.CacheKb = n
					}
				}
			}
		}
	}
	hw.CPU.Threads = threads
	if raw, err := os.ReadFile("/sys/devices/system/cpu/cpu0/topology/core_cpus_list"); err == nil {
		if n := len(strings.Split(strings.TrimSpace(string(raw)), ",")); n > 0 {
			hw.CPU.Cores = n
		}
	}
	if hw.CPU.Cores == 0 {
		hw.CPU.Cores = threads
	}
	if raw, err := os.ReadFile("/sys/devices/system/cpu/cpu0/topology/physical_package_id"); err == nil {
		_ = raw
	}
}

func readMem(hw *Hardware) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		if fields[0] == "MemTotal:" {
			if kb, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
				hw.Memory.TotalBytes = kb * 1024
			}
		}
	}
}

func readDisks(hw *Hardware) {
	out, err := exec.Command("lsblk", "-dbno", "NAME,MODEL,SIZE,TRAN,ROTA").Output()
	if err != nil {
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		size, _ := strconv.ParseUint(fields[2], 10, 64)
		typ := fields[3]
		if fields[4] == "1" {
			typ = "HDD"
		} else if typ == "" {
			typ = "SSD"
		}
		model := strings.TrimSpace(strings.TrimSuffix(line[strings.Index(line, fields[1]):], strings.Join(fields[2:], " ")))
		hw.Disks = append(hw.Disks, HwDisk{Name: model, Type: strings.ToUpper(typ), SizeBytes: size, Health: "ok"})
	}
}

func readNICs(hw *Hardware) {
	ips := ipByMAC()
	ifaces, err := net.Interfaces()
	if err != nil {
		return
	}
	for _, i := range ifaces {
		if i.Flags&net.FlagLoopback != 0 || len(i.HardwareAddr) == 0 {
			continue
		}
		speed := 0
		if raw, err := os.ReadFile("/sys/class/net/" + i.Name + "/speed"); err == nil {
			if v, err := strconv.Atoi(strings.TrimSpace(string(raw))); err == nil && v > 0 {
				speed = v
			}
		}
		mac := formatMAC(i.HardwareAddr.String())
		hw.NICs = append(hw.NICs, NICInfo{Name: i.Name, MAC: mac, SpeedMbps: speed, IPv4: ips[mac]})
	}
}

func readDMI(hw *Hardware) {
	read := func(p string) string {
		raw, err := os.ReadFile(p)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(raw))
	}
	hw.Board.Manufacturer = read("/sys/class/dmi/id/board_vendor")
	hw.Board.Model = read("/sys/class/dmi/id/board_name")
	hw.Board.Bios = read("/sys/class/dmi/id/bios_version")
}

func readOSRelease(hw *Hardware) {
	f, err := os.Open("/etc/os-release")
	if err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			key, val, ok := strings.Cut(sc.Text(), "=")
			if !ok {
				continue
			}
			if key == "PRETTY_NAME" {
				hw.OS.Name = strings.Trim(val, `"`)
			}
		}
	}
	if hw.OS.Name == "" {
		hw.OS.Name = "Linux"
	}
	if out, err := exec.Command("uname", "-r").Output(); err == nil {
		hw.OS.Version = strings.TrimSpace(string(out))
	}
	// 显卡：lspci 里挑 VGA/3D 控制器
	if out, err := exec.Command("lspci").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, "VGA compatible controller") || strings.Contains(line, "3D controller") {
				if idx := strings.Index(line, ": "); idx > 0 {
					hw.GPUs = append(hw.GPUs, GPUInfo{Name: strings.TrimSpace(line[idx+2:])})
				}
			}
		}
	}
}

