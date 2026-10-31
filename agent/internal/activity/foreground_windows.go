//go:build windows

package activity

import (
	"fmt"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// 前台应用采样：直接 user32 syscall，不走 PowerShell。
// 理由：30 秒一次的常驻轮询，PowerShell 进程启停（200ms+、几十 MB 峰值）完全不可接受；
// 这几个 API 都是 user32/kernel32 里的几行调用，syscall 是唯一正确姿势。

var (
	moduser32         = windows.NewLazySystemDLL("user32.dll")
	procGetFGWindow   = moduser32.NewProc("GetForegroundWindow")
	procGetWindowText = moduser32.NewProc("GetWindowTextW")
	procGetWinThread  = moduser32.NewProc("GetWindowThreadProcessId")
	procLastInput     = moduser32.NewProc("GetLastInputInfo")

	modkernel32      = windows.NewLazySystemDLL("kernel32.dll")
	procGetTickCount = modkernel32.NewProc("GetTickCount")
)

// LASTINPUTINFO 按 Winuser.h 的布局（cbSize 在前）。
type lastInputInfo struct {
	cbSize uint32
	dwTime uint32
}

// SampleForeground 返回当前前台应用。无前台窗口（锁屏/切换动画）返回 ok=false。
func SampleForeground() (Sample, bool, error) {
	hwnd, _, _ := procGetFGWindow.Call()
	if hwnd == 0 {
		return Sample{}, false, nil
	}

	title := readWindowTitle(hwnd)

	var pid uint32
	procGetWinThread.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	app, exePath := "", ""
	if pid != 0 {
		full, name, err := processImage(pid)
		if err == nil {
			app = name
			exePath = full
		}
		// 取不到名字（权限/瞬时退出）不报错：title 仍有效，app 留空归「其他」
	}

	return Sample{App: app, Title: title, IdleSec: idleSeconds(), ExePath: exePath}, true, nil
}

func readWindowTitle(hwnd uintptr) string {
	buf := make([]uint16, 512)
	n, _, _ := procGetWindowText.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 {
		return ""
	}
	return strings.TrimSpace(syscall.UTF16ToString(buf[:n]))
}

// idleSeconds 键鼠无操作秒数 = 系统运行毫秒 - 最后输入毫秒。
// GetTickCount 约 49.7 天回绕一次；用无符号减法，回绕时结果仍正确。
func idleSeconds() int {
	var li lastInputInfo
	li.cbSize = uint32(unsafe.Sizeof(li))
	r, _, _ := procLastInput.Call(uintptr(unsafe.Pointer(&li)))
	if r == 0 {
		return 0 // 取不到就当没闲置，宁可多记不漏记
	}
	now, _, _ := procGetTickCount.Call()
	elapsed := uint32(now) - li.dwTime
	return int(elapsed / 1000)
}

// processImage 返回 (完整路径, 归一化映像名)。
// 完整路径供图标提取（internal/icons 需要真实文件），名字供统计聚合。
// 只需要 PROCESS_QUERY_LIMITED_INFORMATION —— 普通权限进程就能查大多数窗口，
// 系统级进程查不到时返回错误，调用方按 app 为空处理。
func processImage(pid uint32) (full string, base string, err error) {
	const processQueryLimitedInformation = 0x1000
	h, err := windows.OpenProcess(processQueryLimitedInformation, false, pid)
	if err != nil {
		return "", "", err
	}
	defer windows.CloseHandle(h)

	buf := make([]uint16, 512)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return "", "", err
	}
	fullPath := syscall.UTF16ToString(buf[:size])
	name := fullPath
	if i := strings.LastIndexAny(name, `\/`); i >= 0 {
		name = name[i+1:]
	}
	if name == "" {
		return "", "", fmt.Errorf("空映像名 pid=%d", pid)
	}
	return fullPath, strings.ToLower(strings.TrimSuffix(name, ".exe")), nil
}

// sampleFunc 返回本平台的前台采样函数；第二返回值表示平台是否支持。
func sampleFunc() (func() (Sample, bool, error), bool) {
	return SampleForeground, true
}
