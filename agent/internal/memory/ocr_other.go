//go:build !windows

package memory

// 非 Windows：OCR 空实现（截图本身也不支持，见 screen_other.go）。
type ocrResult struct{}

func (r ocrResult) Text() string { return "" }

type ocrRunner struct{}

func (r *ocrRunner) run(pngPath string) (ocrResult, error) { return ocrResult{}, nil }
func (r *ocrRunner) close()                                {}
