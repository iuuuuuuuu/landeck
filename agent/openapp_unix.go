//go:build !windows

package main

import "errors"

// 非 Windows 平台没有托盘；桌面端 App 用各自的方式启动。
func openClientApp() error {
	return errors.New("当前平台不支持从托盘拉起客户端")
}
