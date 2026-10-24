//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

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
	taskName := "LanDeckAgent"

	switch cmd {
	case "install":
		script := fmt.Sprintf(
			`$a = New-ScheduledTaskAction -Execute '%s' -Argument '--data "%s"';`+
				`$t = New-ScheduledTaskTrigger -AtLogOn;`+
				`$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero);`+
				`Register-ScheduledTask -TaskName '%s' -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force | Out-Null`,
			exe, dataDir, taskName,
		)
		out, err := exec.Command("powershell.exe", "-NoProfile", "-Command", script).CombinedOutput()
		if err != nil {
			fmt.Println("安装自启失败:", err, string(out))
			os.Exit(1)
		}
		fmt.Println("已注册登录自启任务:", taskName)
	case "uninstall":
		_ = exec.Command("schtasks.exe", "/Delete", "/TN", taskName, "/F").Run()
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
