//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const unitTemplate = `[Unit]
Description=LanDeck Agent（局域网 PC 控制台）
After=network-online.target sound.target

[Service]
Type=simple
ExecStart=%s --data %s
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`

func runService(args []string) {
	cmd := "status"
	if len(args) > 0 {
		cmd = args[0]
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Println("无法定位自身路径:", err)
		os.Exit(1)
	}
	dataDir := filepath.Join(filepath.Dir(exe), "data")
	home, _ := os.UserHomeDir()
	unitPath := filepath.Join(home, ".config/systemd/user/landeck-agent.service")

	switch cmd {
	case "install":
		if err := os.MkdirAll(filepath.Dir(unitPath), 0o755); err != nil {
			fmt.Println("创建 systemd 目录失败:", err)
			os.Exit(1)
		}
		unit := fmt.Sprintf(unitTemplate, exe, dataDir)
		if err := os.WriteFile(unitPath, []byte(unit), 0o644); err != nil {
			fmt.Println("写入 unit 失败:", err)
			os.Exit(1)
		}
		_ = exec.Command("systemctl", "--user", "daemon-reload").Run()
		out, err := exec.Command("systemctl", "--user", "enable", "--now", "landeck-agent.service").CombinedOutput()
		if err != nil {
			fmt.Printf("启用失败（可手动执行 systemctl --user enable --now landeck-agent）: %v\n%s\n", err, out)
			os.Exit(1)
		}
		fmt.Println("已安装并启动用户级 systemd 服务:", unitPath)
	case "uninstall":
		_ = exec.Command("systemctl", "--user", "disable", "--now", "landeck-agent.service").Run()
		_ = os.Remove(unitPath)
		fmt.Println("已卸载:", unitPath)
	case "status":
		out, _ := exec.Command("systemctl", "--user", "status", "landeck-agent.service", "--no-pager").CombinedOutput()
		fmt.Println(string(out))
	default:
		fmt.Println("用法: landeck-agent install|uninstall|status")
	}
}
