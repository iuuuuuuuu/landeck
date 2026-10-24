//go:build !windows

package main

import "errors"

// 非 Windows 平台没有托盘，也不做"一键自启"；用 `landeck-agent install` 交给 systemd/launchd。
func autostartSupported() bool { return false }

func autostartSelfInstall() error { return errors.New("请执行 landeck-agent install") }

func autostartSelfRemove() error { return errors.New("请执行 landeck-agent uninstall") }

func autostartSelfEnabled() bool { return false }
