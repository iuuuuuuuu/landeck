package activity

import "time"

// Sample 一次前台采样（平台无关定义；字段由各平台实现填充）。
type Sample struct {
	App     string // 进程映像名（小写、无路径、无 .exe），如 "code"
	Title   string // 前台窗口标题
	IdleSec int    // 键鼠无操作秒数
	// ExePath 前台进程的完整可执行文件路径。
	// 用途：新应用首次出现时提取图标（internal/icons）。
	// 取不到（权限/瞬时退出）为空串，图标提取自然跳过。
	ExePath string
}

var _ = time.Now
