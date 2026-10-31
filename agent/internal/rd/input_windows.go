//go:build windows

package rd

import (
	"errors"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// SendInput 输入注入。
//
// control 包里只有 keybd_event 的媒体键用法，没有鼠标、没有绝对坐标、
// 没有 UNICODE 文本——远程桌面需要完整 SendInput 路径，这里独立实现，
// 但沿用 control 的 user32 lazy-DLL 与错误约定。绝不走 PowerShell：
// 鼠标点击的时延要求（毫秒级）容不得进程启停。

var (
	procSendInput = windows.NewLazySystemDLL("user32.dll").NewProc("SendInput")
)

const (
	inputMouse    = 0
	inputKeyboard = 1

	mouseeventfMove      = 0x0001
	mouseeventfLeftDown  = 0x0002
	mouseeventfLeftUp    = 0x0004
	mouseeventfRightDown = 0x0008
	mouseeventfRightUp   = 0x0010
	mouseeventfMiddleDn  = 0x0020
	mouseeventfMiddleUp  = 0x0040
	mouseeventfWheel     = 0x0800
	mouseeventfAbsolute  = 0x8000

	keyeventfKeyup     = 0x0002
	keyeventfUnicode   = 0x0004
	keyeventfUnicodeUp = 0x0004 | 0x0002

	wheelDelta = 120

	vkShift = 0x10
	vkCtrl  = 0x11
	vkAlt   = 0x12
	vkLWin  = 0x5B
)

// inputUnion 取最大成员（MOUSEINPUT，x64 下 32 字节）；
// KEYBDINPUT（24 字节）经 unsafe 覆写进同一块内存。
type mouseInput struct {
	dx, dy      int32
	mouseData   uint32
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type keyboardInput struct {
	wVk, wScan  uint16
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type inputUnion struct{ mi mouseInput }

type sysInput struct {
	typ uint32
	u   inputUnion
}

func sendOne(in *sysInput) error {
	ret, _, _ := procSendInput.Call(1, uintptr(unsafe.Pointer(in)), unsafe.Sizeof(*in))
	if ret == 0 {
		return errors.New("SendInput 被拒绝（UIPI？前台提权窗口？）")
	}
	return nil
}

func sendKey(vk uint16, down bool) error {
	flags := uint32(0)
	if !down {
		flags |= keyeventfKeyup
	}
	var in sysInput
	in.typ = inputKeyboard
	*(*keyboardInput)(unsafe.Pointer(&in.u)) = keyboardInput{wVk: vk, dwFlags: flags}
	return sendOne(&in)
}

// injectEvent 把一条输入事件翻译成 SendInput 序列。
func injectEvent(ev InputEvent) error {
	switch ev.Kind {
	case "mouse":
		return injectMouse(ev)
	case "scroll":
		return injectWheel(ev.Dy)
	case "key":
		return injectKey(ev)
	case "text":
		return injectText(ev.Text)
	}
	return errors.New("未知输入类型 " + ev.Kind)
}

func injectMouse(ev InputEvent) error {
	switch ev.Action {
	case "move":
		px, py := mapPoint(ev.X, ev.Y, 65536, 65536) // 绝对坐标的 0..65535 空间
		var in sysInput
		in.typ = inputMouse
		in.u.mi = mouseInput{dx: int32(px), dy: int32(py), dwFlags: mouseeventfMove | mouseeventfAbsolute}
		return sendOne(&in)
	case "down", "up", "dbl":
		downFlag, upFlag := mouseeventfLeftDown, mouseeventfLeftUp
		switch ev.Button {
		case "r":
			downFlag, upFlag = mouseeventfRightDown, mouseeventfRightUp
		case "m":
			downFlag, upFlag = mouseeventfMiddleDn, mouseeventfMiddleUp
		}
		press := func(down bool) error {
			var in sysInput
			in.typ = inputMouse
			f := uint32(upFlag)
			if down {
				f = uint32(downFlag)
			}
			in.u.mi = mouseInput{dwFlags: f}
			return sendOne(&in)
		}
		if err := press(true); err != nil {
			return err
		}
		if err := press(false); err != nil {
			return err
		}
		if ev.Action == "dbl" {
			// 双击 = 第二次按下/抬起；两次之间不加 sleep——系统双击判定按
			// 注入时间戳即可，多一对连续事件足够触发。
			if err := press(true); err != nil {
				return err
			}
			return press(false)
		}
		return nil
	}
	return errors.New("未知鼠标动作 " + ev.Action)
}

func injectWheel(dy int) error {
	var in sysInput
	in.typ = inputMouse
	in.u.mi = mouseInput{mouseData: uint32(int32(dy * wheelDelta)), dwFlags: mouseeventfWheel}
	return sendOne(&in)
}

func injectKey(ev InputEvent) error {
	var mods []uint16
	for _, m := range ev.Mods {
		switch m {
		case "ctrl":
			mods = append(mods, vkCtrl)
		case "shift":
			mods = append(mods, vkShift)
		case "alt":
			mods = append(mods, vkAlt)
		case "win":
			mods = append(mods, vkLWin)
		}
	}
	// 修饰键包裹：down=true 时 mods 先按下、主键按下；down=false 时主键抬起、mods 后抬起。
	if ev.Down {
		for _, vk := range mods {
			if err := sendKey(vk, true); err != nil {
				return err
			}
		}
		return sendKey(uint16(ev.Code), true)
	}
	if err := sendKey(uint16(ev.Code), false); err != nil {
		return err
	}
	// 反序抬起修饰键
	for i := len(mods) - 1; i >= 0; i-- {
		if err := sendKey(mods[i], false); err != nil {
			return err
		}
	}
	return nil
}

func injectText(text string) error {
	for _, r := range utf16.Encode([]rune(text)) {
		// KEYEVENTF_UNICODE 的 wScan 携带 UTF-16 码元
		var in sysInput
		in.typ = inputKeyboard
		*(*keyboardInput)(unsafe.Pointer(&in.u)) = keyboardInput{wScan: r, dwFlags: keyeventfUnicode}
		if err := sendOne(&in); err != nil {
			return err
		}
		in2 := sysInput{typ: inputKeyboard}
		*(*keyboardInput)(unsafe.Pointer(&in2.u)) = keyboardInput{wScan: r, dwFlags: keyeventfUnicodeUp}
		if err := sendOne(&in2); err != nil {
			return err
		}
	}
	return nil
}
