//go:build windows

package files

import "syscall"

// windowsDrives 返回所有存在的本地盘符根路径（如 C:\、D:\）。
//
// 用 GetLogicalDrives 的位掩码：bit0=A、bit1=B ……，
// 比逐个 os.Stat 26 次快，也不会因为空光驱/断开的映射盘卡住。
func windowsDrives() []string {
	mask, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetLogicalDrives").Call()
	if mask == 0 {
		return nil
	}
	out := make([]string, 0, 8)
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		out = append(out, string(rune('A'+i))+`:\`)
	}
	return out
}
