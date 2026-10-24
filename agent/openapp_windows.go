//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// 拉起控制端窗口。
//
// 顺序：
//  1. 已安装的 LanDeck 客户端（注册表/常见安装路径）
//  2. 同目录下的 landeck.exe（便携版）
//  3. 都没有 → 返回错误，由调用方退回浏览器
//
// 注意不要用 rundll32 url.dll 打开 http://127.0.0.1:8420 —— 那是浏览器，
// 用户明确要求托盘点开的是客户端窗口。
func openClientApp() error {
	candidates := []string{}

	// 0) 显式指定（环境变量优先，便于自定义安装位置）
	if p := strings.TrimSpace(os.Getenv("LANDECK_CLIENT")); p != "" {
		candidates = append(candidates, p)
	}

	// 1) 同目录便携版
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "landeck.exe"),
			filepath.Join(dir, "LanDeck.exe"),
		)
	}

	// 2) 常见安装位置
	localAppData := os.Getenv("LOCALAPPDATA")
	programFiles := os.Getenv("ProgramFiles")
	programFilesX86 := os.Getenv("ProgramFiles(x86)")
	for _, base := range []string{localAppData, programFiles, programFilesX86} {
		if base == "" {
			continue
		}
		candidates = append(candidates,
			filepath.Join(base, "LanDeck", "landeck.exe"),
			filepath.Join(base, "LanDeck", "LanDeck.exe"),
			filepath.Join(base, "Programs", "LanDeck", "landeck.exe"),
			filepath.Join(base, "Programs", "LanDeck", "LanDeck.exe"),
		)
	}

	// 3) 注册表里安装器登记的路径
	if fromReg := clientFromRegistry(); fromReg != "" {
		candidates = append([]string{fromReg}, candidates...)
	}

	// 3.5) Agent 上一级目录（便携包常把 agent 与客户端放同一层）
	if exe, err := os.Executable(); err == nil {
		parent := filepath.Dir(filepath.Dir(exe))
		candidates = append(candidates,
			filepath.Join(parent, "landeck.exe"),
			filepath.Join(parent, "LanDeck.exe"),
			filepath.Join(parent, "bin", "landeck.exe"),
		)
	}

	// 4) 开始菜单快捷方式（NSIS / MSI 都会建），解出 .lnk 的目标
	if fromLnk := clientFromStartMenu(); fromLnk != "" {
		candidates = append([]string{fromLnk}, candidates...)
	}

	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			cmd := exec.Command(p)
			cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
			if err := cmd.Start(); err == nil {
				return nil
			}
		}
	}
	return fmt.Errorf("没有找到已安装的 LanDeck 客户端")
}

// clientFromStartMenu 从开始菜单快捷方式里解出客户端真实路径。
// NSIS 默认装到 %LOCALAPPDATA%\LanDeck，但用户可能改路径，读快捷方式最可靠。
func clientFromStartMenu() string {
	roots := []string{
		os.Getenv("APPDATA") + `\Microsoft\Windows\Start Menu\Programs`,
		os.Getenv("ProgramData") + `\Microsoft\Windows\Start Menu\Programs`,
	}
	for _, root := range roots {
		if root == "" {
			continue
		}
		// 用 PowerShell 读 .lnk 的 TargetPath（无第三方依赖）
		script := fmt.Sprintf(
			`Get-ChildItem -Path '%s' -Filter 'LanDeck*.lnk' -Recurse -ErrorAction SilentlyContinue | `+
				`ForEach-Object { $s=(New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName); if ($s.TargetPath) { $s.TargetPath } } | Select-Object -First 1`,
			root,
		)
		out, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Output()
		if err != nil {
			continue
		}
		target := strings.TrimSpace(string(out))
		if target != "" {
			if st, err := os.Stat(target); err == nil && !st.IsDir() {
				return target
			}
		}
	}
	return ""
}

// clientFromRegistry 读安装器写入的 DisplayIcon / InstallLocation。
func clientFromRegistry() string {
	keys := []string{
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\LanDeck`,
		`HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\LanDeck`,
	}
	for _, key := range keys {
		out, err := exec.Command("reg.exe", "query", key, "/v", "InstallLocation").Output()
		if err != nil {
			continue
		}
		if loc := parseRegValue(string(out), "InstallLocation"); loc != "" {
			for _, name := range []string{"landeck.exe", "LanDeck.exe"} {
				p := filepath.Join(loc, name)
				if st, err := os.Stat(p); err == nil && !st.IsDir() {
					return p
				}
			}
		}
	}
	return ""
}

// parseRegValue 从 `reg query` 输出里取一个 REG_SZ 值。
func parseRegValue(out, name string) string {
	lines := splitLines(out)
	for _, line := range lines {
		fields := splitFields(line)
		if len(fields) >= 3 && fields[0] == name && fields[1] == "REG_SZ" {
			return joinFrom(fields, 2)
		}
	}
	return ""
}

func splitLines(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			out = append(out, line)
			start = i + 1
		}
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	return out
}

func splitFields(s string) []string {
	var out []string
	cur := make([]byte, 0, 64)
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == ' ' || c == '\t' {
			if len(cur) > 0 {
				out = append(out, string(cur))
				cur = cur[:0]
			}
			continue
		}
		cur = append(cur, c)
	}
	if len(cur) > 0 {
		out = append(out, string(cur))
	}
	return out
}

func joinFrom(fields []string, from int) string {
	out := ""
	for i := from; i < len(fields); i++ {
		if i > from {
			out += " "
		}
		out += fields[i]
	}
	return out
}
