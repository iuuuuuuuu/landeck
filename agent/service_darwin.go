//go:build darwin

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const plistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.landeck.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>%s</string>
    <string>--data</string>
    <string>%s</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
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
	plistPath := filepath.Join(home, "Library/LaunchAgents/com.landeck.agent.plist")

	switch cmd {
	case "install":
		if err := os.MkdirAll(filepath.Dir(plistPath), 0o755); err != nil {
			fmt.Println("创建 LaunchAgents 目录失败:", err)
			os.Exit(1)
		}
		plist := fmt.Sprintf(plistTemplate, exe, dataDir)
		if err := os.WriteFile(plistPath, []byte(plist), 0o644); err != nil {
			fmt.Println("写入 plist 失败:", err)
			os.Exit(1)
		}
		out, err := exec.Command("launchctl", "load", "-w", plistPath).CombinedOutput()
		if err != nil {
			fmt.Printf("launchctl load 失败: %v\n%s\n", err, out)
			os.Exit(1)
		}
		fmt.Println("已安装 LaunchAgent:", plistPath)
	case "uninstall":
		_ = exec.Command("launchctl", "unload", "-w", plistPath).Run()
		_ = os.Remove(plistPath)
		fmt.Println("已卸载:", plistPath)
	case "status":
		out, _ := exec.Command("launchctl", "list", "com.landeck.agent").CombinedOutput()
		fmt.Println(string(out))
	default:
		fmt.Println("用法: landeck-agent install|uninstall|status")
	}
}
