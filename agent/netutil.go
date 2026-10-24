package main

import "net"

// netInterfaces 返回第一个私有 IPv4 地址，用于启动横幅。
func netInterfaces() (string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", err
	}
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := i.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			v4 := ipnet.IP.To4()
			if v4 != nil && v4.IsPrivate() {
				return v4.String(), nil
			}
		}
	}
	return "127.0.0.1", nil
}
