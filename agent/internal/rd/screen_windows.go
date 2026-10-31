//go:build windows

package rd

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// GDI 抓帧：BitBlt 主屏 → 32bpp 顶层向下 DIB → Frame（BGRA 字节序，
// codec.encodeJPEG 负责换成交互需要的 RGBA）。全部 syscall，不走 PowerShell——
// 10fps 的常驻抓帧，进程启停的代价完全不可接受（与 activity/foreground 同理）。

var (
	gdi32         = windows.NewLazySystemDLL("gdi32.dll")
	procCreateDC  = gdi32.NewProc("CreateDCW")
	procCreateCompatDC = gdi32.NewProc("CreateCompatibleDC")
	procCreateDIB = gdi32.NewProc("CreateDIBSection")
	procSelectObj = gdi32.NewProc("SelectObject")
	procBitBlt    = gdi32.NewProc("BitBlt")
	procDeleteDC  = gdi32.NewProc("DeleteDC")
	procDeleteObj = gdi32.NewProc("DeleteObject")
	procGetStock  = gdi32.NewProc("GetStockObject")

	user32Metrics  = windows.NewLazySystemDLL("user32.dll")
	procGetSM      = user32Metrics.NewProc("GetSystemMetrics")
	procGetDC     = user32Metrics.NewProc("GetDC")
	procReleaseDC = user32Metrics.NewProc("ReleaseDC")
)

const (
	smCXScreen = 0
	smCYScreen = 1
	srCCOPY    = 0x00CC0020
	dibRGBMode = 0 // BI_RGB
)

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32 // 负值 = 顶层向下
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type bitmapInfo struct {
	Header bitmapInfoHeader
	Colors [1]uint32
}

func primaryScreenSize() (int, int) {
	w, _, _ := procGetSM.Call(smCXScreen)
	h, _, _ := procGetSM.Call(smCYScreen)
	return int(w), int(h)
}

// captureScreen 抓主屏一帧。失败返回错误（会话层有连续失败熔断）。
func captureScreen() (Frame, error) {
	w, h := primaryScreenSize()
	if w <= 0 || h <= 0 {
		return Frame{}, errors.New("无法读取主屏尺寸")
	}

	// lpszDriver 必须显式 "DISPLAY"：全 NULL 在部分系统上返回 0（实测踩过）
	srcDC, _, _ := procCreateDC.Call(utf16Ptr("DISPLAY"), 0, 0, 0)
	if srcDC == 0 {
		return Frame{}, errors.New("CreateDC 失败")
	}
	defer procDeleteDC.Call(srcDC)

	memDC, _, _ := procCreateCompatDC.Call(srcDC)
	if memDC == 0 {
		return Frame{}, errors.New("CreateCompatibleDC 失败")
	}
	defer procDeleteDC.Call(memDC)

	bmi := bitmapInfo{}
	bmi.Header.Size = uint32(unsafe.Sizeof(bmi.Header))
	bmi.Header.Width = int32(w)
	bmi.Header.Height = int32(-h) // 顶层向下
	bmi.Header.Planes = 1
	bmi.Header.BitCount = 32
	bmi.Header.Compression = dibRGBMode

	var bits unsafe.Pointer
	// 签名 6 参：hdc, pbmi, usage(DIB_RGB_COLORS), ppvBits, hSection(NULL), dwOffset(0)。
	// 少传 dwOffset 会参数错位（实测 "The parameter is incorrect"）。
	dib, _, _ := procCreateDIB.Call(memDC, uintptr(unsafe.Pointer(&bmi)), 0,
		uintptr(unsafe.Pointer(&bits)), 0, 0)
	if dib == 0 || bits == nil {
		return Frame{}, errors.New("CreateDIBSection 失败")
	}
	defer procDeleteObj.Call(dib)

	if ret, _, _ := procSelectObj.Call(memDC, dib); ret == 0 {
		return Frame{}, errors.New("SelectObject 失败")
	}
	// SRCCOPY 全屏拷贝
	if ret, _, _ := procBitBlt.Call(memDC, 0, 0, uintptr(w), uintptr(h), srcDC, 0, 0, srCCOPY); ret == 0 {
		return Frame{}, errors.New("BitBlt 失败")
	}

	stride := w * 4
	pix := make([]byte, stride*h)
	// DIB section 的内存映射区直接拷贝（顶层向下，行序已正）
	copy(pix, unsafe.Slice((*byte)(bits), stride*h))

	return Frame{RGBA: pix, W: w, H: h, Stride: stride}, nil
}
