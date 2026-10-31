package discovery

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"strings"
	"time"

	"github.com/grandcat/zeroconf"
)

const (
	Port       = 8421
	ProbeToken = "LANDECK_DISCOVER_V1"
	Service    = "_landeck._tcp"
	Domain     = "local."
)

type Node struct {
	V      int    `json:"v"`
	ID     string `json:"id"`
	Name   string `json:"name"`
	IP     string `json:"ip,omitempty"`
	Port   int    `json:"port"`
	TLS    bool   `json:"tls"`
	Ver    string `json:"ver"`
	OS     string `json:"os"`
	Arch   string `json:"arch"`
	Paired bool   `json:"paired"`
}

type Announcer struct {
	node   Node
	conn   *net.UDPConn
	zc     *zeroconf.Server
	stop   chan struct{}
	closed bool
}

// Start 开三个口子：UDP 应答、UDP 广播、mDNS 注册（含 <host>.local 域名）。
func Start(node Node, mdns bool) (*Announcer, error) {
	a := &Announcer{node: node, stop: make(chan struct{})}

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: Port})
	if err != nil {
		log.Printf("UDP 发现端口 %d 不可用（%v），仅保留 HTTP 发现", Port, err)
	} else {
		a.conn = conn
		go a.serveUDP()
		go a.broadcastLoop()
	}

	if mdns {
		a.startMDNS()
	}
	return a, nil
}

func (a *Announcer) payload() []byte {
	raw, _ := json.Marshal(a.node)
	return raw
}

func (a *Announcer) serveUDP() {
	buf := make([]byte, 1024)
	for {
		n, addr, err := a.conn.ReadFromUDP(buf)
		if err != nil {
			select {
			case <-a.stop:
				return
			default:
				continue
			}
		}
		msg := strings.TrimSpace(string(buf[:n]))
		if msg != ProbeToken {
			continue
		}
		reply := a.payload()
		if ip := localIPFor(addr.IP); ip != "" {
			// 应答里带上对方视角下的本机地址
			var n Node
			if err := json.Unmarshal(reply, &n); err == nil {
				n.IP = ip
				reply, _ = json.Marshal(n)
			}
		}
		_, _ = a.conn.WriteToUDP(reply, addr)
	}
}

func (a *Announcer) broadcastLoop() {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	// 先广播一次，客户端一启动就能收到
	a.broadcastOnce()
	for {
		select {
		case <-a.stop:
			return
		case <-ticker.C:
			a.broadcastOnce()
		}
	}
}

func (a *Announcer) broadcastOnce() {
	raw := a.payload()
	targets := []*net.UDPAddr{{IP: net.IPv4bcast, Port: Port}}
	if ifaces, err := net.Interfaces(); err == nil {
		for _, i := range ifaces {
			if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 || i.Flags&net.FlagBroadcast == 0 {
				continue
			}
			addrs, err := i.Addrs()
			if err != nil {
				continue
			}
			for _, ad := range addrs {
				ipnet, ok := ad.(*net.IPNet)
				if !ok || ipnet.IP.To4() == nil {
					continue
				}
				if bcast := broadcastAddr(ipnet); bcast != nil {
					targets = append(targets, &net.UDPAddr{IP: bcast, Port: Port})
				}
			}
		}
	}
	for _, t := range targets {
		_, _ = a.conn.WriteToUDP(raw, t)
	}
}

func broadcastAddr(n *net.IPNet) net.IP {
	ip := n.IP.To4()
	mask := n.Mask
	if ip == nil || len(mask) != 4 {
		return nil
	}
	out := make(net.IP, 4)
	for i := 0; i < 4; i++ {
		out[i] = ip[i] | ^mask[i]
	}
	return out
}

func (a *Announcer) startMDNS() {
	ips := localIPv4s()
	txt := []string{
		fmt.Sprintf("id=%s", a.node.ID),
		fmt.Sprintf("name=%s", a.node.Name),
		fmt.Sprintf("port=%d", a.node.Port),
		fmt.Sprintf("ver=%s", a.node.Ver),
		fmt.Sprintf("tls=%v", a.node.TLS),
	}
	host := sanitizeHost(a.node.Name)
	addrs := make([]string, 0, len(ips))
	for _, ip := range ips {
		addrs = append(addrs, ip.String())
	}
	server, err := zeroconf.RegisterProxy(host, Service, Domain, a.node.Port, host, addrs, txt, nil)
	if err != nil {
		log.Printf("mDNS 注册失败（不影响 HTTP 访问）: %v", err)
		return
	}
	a.zc = server
}

func sanitizeHost(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			b.WriteRune(r)
		case r == ' ' || r == '_' || r == '.':
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "landeck"
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func localIPv4s() []net.IP {
	out := []net.IP{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, ad := range addrs {
			if ipnet, ok := ad.(*net.IPNet); ok {
				if v4 := ipnet.IP.To4(); v4 != nil && v4.IsPrivate() {
					out = append(out, v4)
				}
			}
		}
	}
	return out
}

// localIPFor 选出与目标同网段的本机 IP（UDP 不 connect，靠路由表推断）。
func localIPFor(peer net.IP) string {
	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: peer, Port: 9})
	if err != nil {
		return ""
	}
	defer conn.Close()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP.String()
	}
	return ""
}

func (a *Announcer) Stop() {
	if a.closed {
		return
	}
	a.closed = true
	close(a.stop)
	if a.conn != nil {
		_ = a.conn.Close()
	}
	if a.zc != nil {
		a.zc.Shutdown()
	}
}
