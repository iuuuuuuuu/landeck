//go:build windows

package main

import (
	"os"
	"path/filepath"
)

func autostartSupported() bool { return true }

func autostartSelfInstall() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return installAutostart(exe, filepath.Join(filepath.Dir(exe), "data"))
}

func autostartSelfRemove() error { return removeAutostart() }

func autostartSelfEnabled() bool { return autostartEnabled() }
