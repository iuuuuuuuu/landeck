package activity

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
)

// hexPrefix 摘要前 16 个 hex 字符（ETag 用，对齐 httpapi icons 的风格）。
func hexPrefix(sum []byte) string { return hex.EncodeToString(sum) }

func joinPath(dir, name string) string { return filepath.Join(dir, name) }

func readFile(path string) ([]byte, error) { return os.ReadFile(path) }

func unmarshalJSON(raw []byte, v any) error { return json.Unmarshal(raw, v) }

func marshalJSON(v any) ([]byte, error) { return json.Marshal(v) }

// writeAtomic 先写临时文件再 rename，避免写一半断电留下坏 JSON
// （对齐 config.Store 的落盘策略）。
func writeAtomic(path string, v any) error {
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
