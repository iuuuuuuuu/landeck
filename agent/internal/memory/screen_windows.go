//go:build windows

package memory

import (
	"fmt"
	"image"
	"unsafe"

	"golang.org/x/sys/windows"
)

// GDI 全屏截取：BitBlt 一次抓整个虚拟桌面（多显示器自动拼接为一张宽图，
// 契约 v1 口径），读 DIB 内存转 RGBA。风格对齐 foreground_windows 的直连
// syscall——常驻定时任务禁不起 PowerShell 进程启停。

var (
	modUser32 = windows.NewLazySystemDLL("user32.dll")
	procGetDC = modUser32.NewProc("GetDC")
	procRelDC = modUser32.NewProc("ReleaseDC")

	procGetSysMetrics = modUser32.NewProc("GetSystemMetrics")

	modGdi32         = windows.NewLazySystemDLL("gdi32.dll")
	procCreateCompDC = modGdi32.NewProc("CreateCompatibleDC")
	procDelDC        = modGdi32.NewProc("DeleteDC")
	procDelObject    = modGdi32.NewProc("DeleteObject")
	procCreateDIB    = modGdi32.NewProc("CreateDIBSection")
	procSelectObject = modGdi32.NewProc("SelectObject")
	procBitBlt       = modGdi32.NewProc("BitBlt")
)

const (
	smXVirtual  = 76
	smYVirtual  = 77
	smxVirtual  = 78
	smyVirtual  = 79
	srCopy      = 0x00CC0020
	captureBlt  = 0x40000000
	dibRGBColor = 0 // BI_RGB
)

// BITMAPINFOHEADER 按 wingdi.h 布局。biHeight 取负 = 自上而下行序。
type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

func sysMetrics(n int) int {
	v, _, _ := procGetSysMetrics.Call(uintptr(n))
	return int(v)
}

// captureScreen 抓整个虚拟桌面，返回 RGBA 图。
// 失败返回 error；调用方本 tick 跳过（不重试——下一 tick 自然再来）。
func captureScreen() (image.Image, error) {
	x := sysMetrics(smXVirtual)
	y := sysMetrics(smYVirtual)
	w := sysMetrics(smxVirtual)
	h := sysMetrics(smyVirtual)
	if w <= 0 || h <= 0 || w > 32768 || h > 32768 {
		return nil, fmt.Errorf("虚拟桌面尺寸异常: %dx%d", w, h)
	}

	screenDC, _, _ := procGetDC.Call(0)
	if screenDC == 0 {
		return nil, fmt.Errorf("GetDC(0) 失败")
	}
	defer procRelDC.Call(0, screenDC)

	memDC, _, _ := procCreateCompDC.Call(screenDC)
	if memDC == 0 {
		return nil, fmt.Errorf("CreateCompatibleDC 失败")
	}
	defer procDelDC.Call(memDC)

	bmi := bitmapInfoHeader{
		Size:     uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		Width:    int32(w),
		Height:   int32(-h), // 负值 = top-down，行序与 image.RGBA 一致
		Planes:   1,
		BitCount: 32, // BGRA
	}
	var bitsPtr unsafe.Pointer
	dib, _, _ := procCreateDIB.Call(memDC, uintptr(unsafe.Pointer(&bmi)), dibRGBColor,
		uintptr(unsafe.Pointer(&bitsPtr)), 0, 0)
	if dib == 0 || bitsPtr == nil {
		return nil, fmt.Errorf("CreateDIBSection 失败")
	}
	defer procDelObject.Call(dib)

	prev, _, _ := procSelectObject.Call(memDC, dib)
	defer procSelectObject.Call(memDC, prev)

	// SRCCOPY|CAPTUREBLT：把分层窗口（半透明浮层）也抓进来，观感与用户所见一致
	if r, _, _ := procBitBlt.Call(memDC, 0, 0, uintptr(w), uintptr(h),
		screenDC, uintptr(x), uintptr(y), srCopy|captureBlt); r == 0 {
		return nil, fmt.Errorf("BitBlt 失败")
	}

	// DIB 是 BGRA 顶下行；直接构造在底层内存上的 RGBA 视图再拷贝，
	// 拷贝时做 B->R 通道交换（32 位对齐，一次扫完）
	src := unsafe.Slice((*uint8)(bitsPtr), w*h*4)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	dst := img.Pix
	for i := 0; i < len(dst); i += 4 {
		dst[i] = src[i+2]   // R <- B
		dst[i+1] = src[i+1] // G
		dst[i+2] = src[i]   // B <- R
		dst[i+3] = 0xFF     // A（屏幕无透明）
	}
	return img, nil
}

// CaptureScreenForTest 探针用：暴露截屏（仅测试/诊断二进制引用）。
func CaptureScreenForTest() (image.Image, error) { return captureScreen() }
