package memory

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func joinPath(dir, name string) string { return filepath.Join(dir, name) }

func readFile(path string) ([]byte, error) { return os.ReadFile(path) }

func unmarshalJSON(raw []byte, v any) error { return json.Unmarshal(raw, v) }

func marshalJSON(v any) ([]byte, error) { return json.Marshal(v) }

// writeAtomic 先写临时文件再 rename（对齐 config/activity 的落盘策略）。
func writeAtomic(path string, v any) error {
	// 父目录不存在就建：Start 时 memory/ 还没被第一次截屏创建，
	// OCR 脚本落盘会静默失败（实测踩过：ocrFail 连续计数全是它）
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func itoa64(n int64) string { return strconv.FormatInt(n, 10) }

func pad3(n int) string {
	s := strconv.Itoa(n)
	switch len(s) {
	case 1:
		return "00" + s
	case 2:
		return "0" + s
	}
	return s
}

// clampRunes 标题/文本入库截断（对齐 activity 的做法）。
func clampRunes(s string, max int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > max {
		r = r[:max]
	}
	return string(r)
}

var errMemoryNotStarted = errors.New("memory 未启动")

// fileETag 内容摘要（对齐 appicon 的 ETag 风格）。
func fileETag(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}
