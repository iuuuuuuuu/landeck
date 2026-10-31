//go:build windows

package rd

import (
	"runtime"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// 会话期间屏幕顶部的常驻指示条：「正在被 <name> 远程控制」。
//
// 这是有意的隐私设计：被控的人必须随时知道屏幕正被谁看着。
// 实现为 WS_POPUP + TOPMOST 的小窗（不抢焦点、不在任务栏），
// 会话开始 show、结束 hide，随会话生灭。
//
// 为什么不用 LayeredWindow 半透明：GDI 分层窗要 UpdateLayeredWindow 的
// 全量像素维护，成本高且复杂；实色横条更醒目，隐私告示不需要精致。
//
// 线程模型：窗口在专属 goroutine 上创建（Windows 窗口必须由创建线程泵消息），
// 该 goroutine 用 PeekMessage + 30ms 轮询驱动消息泵，同时非阻塞消费 show/hide
// 通道——GetMessage 的阻塞式泵会饿死控制通道，所以不用。

var (
	procRegisterClass  = windows.NewLazySystemDLL("user32.dll").NewProc("RegisterClassExW")
	procCreateWindowEx = windows.NewLazySystemDLL("user32.dll").NewProc("CreateWindowExW")
	procShowWindowW    = windows.NewLazySystemDLL("user32.dll").NewProc("ShowWindow")
	procSetWindowTextW = windows.NewLazySystemDLL("user32.dll").NewProc("SetWindowTextW")
	procInvalidateRect = windows.NewLazySystemDLL("user32.dll").NewProc("InvalidateRect")
	procPeekMessageW   = windows.NewLazySystemDLL("user32.dll").NewProc("PeekMessageW")
	procTranslateMsg   = windows.NewLazySystemDLL("user32.dll").NewProc("TranslateMessage")
	procDispatchMsg    = windows.NewLazySystemDLL("user32.dll").NewProc("DispatchMessageW")
	procBeginPaintW    = windows.NewLazySystemDLL("user32.dll").NewProc("BeginPaint")
	procEndPaintW      = windows.NewLazySystemDLL("user32.dll").NewProc("EndPaint")
	procFillRectW      = windows.NewLazySystemDLL("user32.dll").NewProc("FillRect")
	procSetTextColorW  = windows.NewLazySystemDLL("user32.dll").NewProc("SetTextColorW")
	procSetBkModeW     = windows.NewLazySystemDLL("user32.dll").NewProc("SetBkMode")
	procDrawTextW      = windows.NewLazySystemDLL("user32.dll").NewProc("DrawTextW")
	procDefProc        = windows.NewLazySystemDLL("user32.dll").NewProc("DefWindowProcW")
	procGetModHandle   = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW")
	procCreateSolidBr  = gdi32.NewProc("CreateSolidBrush")
	procCreateFontW    = gdi32.NewProc("CreateFontW")
	procSelectObjectG  = gdi32.NewProc("SelectObject")
	procDeleteObjectG  = gdi32.NewProc("DeleteObject")
)

const (
	wsPopup          = 0x80000000
	wsExTopmost      = 0x00000008
	wsExToolWindow   = 0x00000080
	wsExNoActivate   = 0x08000000
	swShowNoActivate = 8
	swHideW          = 0
	wmPaintW         = 0x000F
	wmPaint          = 0x000F
	indicatorHeight  = 28
	indicatorRed     = 0x002E20B4 // COLORREF 0x00BBGGRR = RGB(180,32,46)
	textWhite        = 0xFFFFFF
)

type wndClassEx struct {
	CbSize   uint32
	Style    uint32
	WndProc  uintptr
	ClsExtra int32
	WndExtra int32
	Instance uintptr
	Icon     uintptr
	Cursor   uintptr
	Brush    uintptr
	Name     uintptr
	IconSm   uintptr
}

type paintStruct struct {
	HDC         uintptr
	FErase      int32
	RCPaint     [4]int32
	FRestore    int32
	FIncUpdate  int32
	RGBReserved [32]byte
}

type rect struct {
	Left, Top, Right, Bottom int32
}

// indicator 指示条窗口的持有者。
type indicator struct {
	once   sync.Once
	ready  chan struct{}
	showCh chan string
	hideCh chan struct{}
	hwnd   uintptr
	font   uintptr
	brush  uintptr
	mu     sync.Mutex
	name   string
}

func newIndicator() *indicator {
	ind := &indicator{
		ready:  make(chan struct{}),
		showCh: make(chan string, 4),
		hideCh: make(chan struct{}, 4),
	}
	go ind.run()
	<-ind.ready
	return ind
}

func (ind *indicator) show(name string) {
	select {
	case ind.showCh <- name:
	default:
	}
}

func (ind *indicator) hide() {
	select {
	case ind.hideCh <- struct{}{}:
	default:
	}
}

func (ind *indicator) run() {
	runtime.LockOSThread()
	clsName := "LanDeckRDIndicator"

	var wc wndClassEx
	wc.CbSize = uint32(unsafe.Sizeof(wc))
	wc.WndProc = windows.NewCallback(ind.wndProc)
	inst, _, _ := procGetModHandle.Call(0)
	wc.Instance = inst
	wc.Brush, _, _ = procCreateSolidBr.Call(indicatorRed)
	wc.Name = utf16Ptr(clsName)
	atom, _, _ := procRegisterClass.Call(uintptr(unsafe.Pointer(&wc)))
	if atom == 0 {
		close(ind.ready)
		return
	}

	sw, _ := primaryScreenSize()
	hwnd, _, _ := procCreateWindowEx.Call(
		uintptr(wsExTopmost|wsExToolWindow|wsExNoActivate),
		utf16Ptr(clsName), utf16Ptr(""),
		uintptr(wsPopup),
		0, 0, uintptr(sw), uintptr(indicatorHeight),
		0, 0, inst, 0,
	)
	ind.hwnd = hwnd
	ind.font, _, _ = procCreateFontW.Call(
		uintptr(uint32(varFontH)), 0, 0, 0,
		700, // FW_BOLD
		0, 0, 0, 0, 0, 0,
		4, // CLEARTYPE_QUALITY
		0, utf16Ptr("Segoe UI"),
	)
	close(ind.ready)

	if hwnd == 0 {
		return
	}

	var msg [7]uintptr // x64 的 MSG = 7 个机器字
	for {
		select {
		case name := <-ind.showCh:
			ind.mu.Lock()
			ind.name = name
			ind.mu.Unlock()
			procSetWindowTextW.Call(ind.hwnd, utf16Ptr(indicatorText(name)))
			procInvalidateRect.Call(ind.hwnd, 0, 1)
			procShowWindowW.Call(ind.hwnd, swShowNoActivate)
		case <-ind.hideCh:
			procShowWindowW.Call(ind.hwnd, swHideW)
		default:
		}
		ret, _, _ := procPeekMessageW.Call(uintptr(unsafe.Pointer(&msg[0])), 0, 0, 0, 1) // PM_REMOVE
		if ret != 0 {
			procTranslateMsg.Call(uintptr(unsafe.Pointer(&msg[0])))
			procDispatchMsg.Call(uintptr(unsafe.Pointer(&msg[0])))
		}
		time.Sleep(30 * time.Millisecond)
	}
}

func utf16Ptr(s string) uintptr {
	return uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(s)))
}

// varFontH：CreateFontW 的字高按 int32 语义是 -19（负=字符高度），
// 但 uintptr 的常量转换会溢出报错，只能经运行期变量中转。
var varFontH = int32(-19)

func indicatorText(name string) string {
	if name == "" {
		return "正在被远程控制"
	}
	return "正在被 " + name + " 远程控制"
}

// wndProc 只处理 WM_PAINT；WM_DESTROY 不退出线程（指示条与进程同生命周期，
// 隐藏即可，销毁逻辑省掉一套竞态）。
func (ind *indicator) wndProc(hwnd, msg, wp, lp uintptr) uintptr {
	if msg == wmPaint {
		var ps paintStruct
		hdc, _, _ := procBeginPaintW.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		if hdc == 0 {
			return 0
		}
		defer procEndPaintW.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		rc := rect{Left: ps.RCPaint[0], Top: ps.RCPaint[1], Right: ps.RCPaint[2], Bottom: ps.RCPaint[3]}
		procFillRectW.Call(hdc, uintptr(unsafe.Pointer(&rc)), ind.brush)
		procSetBkModeW.Call(hdc, 1) // TRANSPARENT
		procSetTextColorW.Call(hdc, textWhite)
		old, _, _ := procSelectObjectG.Call(hdc, ind.font)
		ind.mu.Lock()
		text := indicatorText(ind.name)
		ind.mu.Unlock()
		w16 := windows.StringToUTF16Ptr(text)
		r := rect{Left: rc.Left + 12, Top: rc.Top, Right: rc.Right, Bottom: rc.Bottom}
		procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(w16)), ^uintptr(0),
			uintptr(unsafe.Pointer(&r)), 0x0025) // DT_SINGLELINE|DT_VCENTER|DT_LEFT
		procSelectObjectG.Call(hdc, old)
		return 0
	}
	ret, _, _ := procDefProc.Call(hwnd, msg, wp, lp)
	return ret
}
