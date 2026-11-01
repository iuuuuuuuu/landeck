//go:build !windows

package memory

// 非 Windows：OCR 空实现（截图本身也不支持，见 screen_other.go）。
type ocrResult struct{}

func (r ocrResult) Text() string { return "" }

// ps1 字段仅 Windows 实现使用；非 Windows 平台保留字段名以匹配
// collect.go 共享路径的字面量构造（CI linux/mac 目标曾因此编不过）。
type ocrRunner struct{ ps1 string }

func (r *ocrRunner) run(pngPath string) (ocrResult, error) { return ocrResult{}, nil }
func (r *ocrRunner) close()                                {}
