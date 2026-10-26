//go:build !windows

package icons

// extractIcon 非 Windows 平台没有 PE 资源段可取：
// Linux 的 .desktop 图标、macOS 的 .icns 都是另一套东西，这里统一报不支持，
// 由上层（前端）回退到字母占位。
func extractIcon(string) ([]byte, string, error) {
	return nil, "", ErrUnsupported
}
