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

const (
	autostartTask = "LanDeckAgent"
	runKey        = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
)

// 自启走 HKCU\...\Run 注册表项：不需要管理员权限，登录后就在用户会话里跑，
// 这对音频/媒体/SMTC 是必须的（服务跑在 Session 0，摸不到用户桌面）。
// runCmd 跑一个隐藏窗口的外部命令，返回合并输出。
func runCmd(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func autostartCommand(exe, dataDir string) string {
	return fmt.Sprintf(`"%s" --data "%s"`, exe, dataDir)
}

func installAutostart(exe, dataDir string) error {
	_, err := runCmd("reg.exe", "add", runKey, "/v", autostartTask, "/t", "REG_SZ", "/d", autostartCommand(exe, dataDir), "/f")
	return err
}

func removeAutostart() error {
	_, err := runCmd("reg.exe", "delete", runKey, "/v", autostartTask, "/f")
	return err
}

func autostartEnabled() bool {
	out, err := runCmd("reg.exe", "query", runKey, "/v", autostartTask)
	return err == nil && strings.Contains(out, autostartTask)
}

// runService 用「登录时启动」的计划任务做自启：音频/媒体键这类操作必须在用户会话里，
// 注册成 Windows 服务（Session 0）会摸不到桌面，所以不用 sc create。
func runService(args []string) {
	cmd := ""
	if len(args) > 0 {
		cmd = args[0]
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Println("无法定位自身路径:", err)
		os.Exit(1)
	}
	dataDir := filepath.Join(filepath.Dir(exe), "data")
	taskName := autostartTask

	switch cmd {
	case "install":
		if err := installAutostart(exe, dataDir); err != nil {
			fmt.Println("安装自启失败:", err)
			os.Exit(1)
		}
		fmt.Println("已注册登录自启任务:", taskName)
	case "uninstall":
		_ = removeAutostart()
		fmt.Println("已移除登录自启任务:", taskName)
	case "status":
		out, _ := exec.Command("schtasks.exe", "/Query", "/TN", taskName).CombinedOutput()
		fmt.Println(string(out))
	case "start":
		startDetached(exe, "--data", dataDir)
		fmt.Println("已后台启动 Agent")
	default:
		fmt.Println("用法: landeck-agent install|uninstall|status|start")
	}
}

func startDetached(exe string, args ...string) {
	cmd := exec.Command(exe, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000 | 0x00000008}
	_ = cmd.Start()
}
