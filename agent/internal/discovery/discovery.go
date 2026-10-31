package discovery

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/grandcat/zeroconf"
)

const (
	Port       = 8421
	ProbeToken = "LANDECK_DISCOVER_V1"
	Service    = "_landeck._tcp"
	Domain     = "local."
)

// listenPort 实际监听的 UDP 端口。生产恒为 Port；测试覆盖成高位端口，
// 避免与本机正在运行的真实 agent 冲突。
var listenPort = Port

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
	node Node
	mdns bool

	conn *net.UDPConn
	zc   *zeroconf.Server
	// announceStop 每次重建都会换新通道；watchStop 只在 Start 创建一次
	//（watch goroutine 是常驻的，绝不随 rebuild 重启——否则第一次唤醒后自愈就死了）
	announceStop chan struct{}
	closed       bool

	closeWatchOnce sync.Once
	watchStop      chan struct{}
}

// Start 启动发现：UDP 应答 + UDP 广播 + mDNS 注册（可选）+ 唤醒/网络变化自愈。
func Start(node Node, mdns bool) (*Announcer, error) {
	a := &Announcer{
		node:         node,
		mdns:         mdns,
		announceStop: make(chan struct{}),
		watchStop:    make(chan struct{}),
	}

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: listenPort})
	if err != nil {
		log.Printf("UDP 发现端口 %d 占用失败: %v（不影响 HTTP 服务）", listenPort, err)
	} else {
		a.conn = conn
		go a.serveUDP()
		go a.broadcastLoop()
	}

	if mdns {
		a.startMDNS()
	}

	// 睡眠唤醒/网络变化自愈：常驻检测，触发即整体重建（见 watch.go 注释）
	go a.watchLoop()
	return a, nil
}

func (a *Announcer) payload() []byte {
	raw, _ := json.Marshal(a.node)
	return raw
}

func (a *Announcer) serveUDP() {
	conn := a.conn // 捕获：stopAnnounce 会把 a.conn 置 nil 并 Close，本 goroutine 用快照退出
	if conn == nil {
		return
	}
	buf := make([]byte, 1024)
	for {
		n, addr, err := conn.ReadFromUDP(buf)
		if err != nil {
			select {
			case <-a.announceStop:
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
			// 应答时顺带把对方就近的本机地址填上
			var n Node
			if err := json.Unmarshal(reply, &n); err == nil {
				n.IP = ip
				reply, _ = json.Marshal(n)
			}
		}
		_, _ = conn.WriteToUDP(reply, addr)
	}
}

func (a *Announcer) broadcastLoop() {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	// 先广播一次，客户端一开就能收到
	a.broadcastOnce()
	for {
		select {
		case <-a.announceStop:
			return
		case <-ticker.C:
			a.broadcastOnce()
		}
	}
}

func (a *Announcer) broadcastOnce() {
	// 局部快照：stopAnnounce 会把 a.conn 置 nil 并 Close——
	// 只判空不快照的话，判空与写入之间 conn 可能被置 nil（实测 panic）
	conn := a.conn
	if conn == nil {
		return
	}
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
		_, _ = conn.WriteToUDP(raw, t)
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
		log.Printf("mDNS 注册失败（不影响 HTTP 服务）: %v", err)
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

// localIPFor 选择与目标同网段的本机 IP（UDP connect 让路由表挑路）。
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

// stopAnnounce 停当前这代的广播/mDNS（watch 不受影响——它挂在 watchStop 上）。
func (a *Announcer) stopAnnounce() {
	a.closed = true
	close(a.announceStop)
	if a.conn != nil {
		_ = a.conn.Close()
		a.conn = nil
	}
	if a.zc != nil {
		a.zc.Shutdown()
		a.zc = nil
	}
}

// rebuild 整体重建：先停旧的（zeroconf Shutdown、UDP 关闭），再按原 node/mdns
// 重新注册与广播。外部持有的是同一个 *Announcer 指针，字段原地替换，调用方无感。
//
// Start 内部会 spawn 一个新的 watchLoop——直接 close 掉它的 watchStop
//（外层已有一个常驻 watch，绝不随 rebuild 重启，否则第一次唤醒后自愈就死了）。
func (a *Announcer) rebuild() error {
	a.stopAnnounce()
	na, err := Start(a.node, a.mdns)
	if na != nil {
		close(na.watchStop) // na 的 watch 是多余的，外层已有一个常驻 watch
	}
	if err != nil {
		return err
	}
	// 关键：字段原地搬进外层 a。漏了这一步的话 a.announceStop 仍指着
	// 已关闭的旧通道，第二次 rebuild 就是 close of closed channel（实测 panic）
	a.conn = na.conn
	a.zc = na.zc
	a.announceStop = na.announceStop
	a.closed = false
	return nil
}

// watchLoop 每 15s 检查：时间跳跃（睡眠唤醒）或 IP 集合变化（网络重排）→ rebuild。
// 日志写明触发原因与当前 IP 列表——Owner 自然休眠唤醒后看 agent.log 即可确认自愈。
func (a *Announcer) watchLoop() {
	const (
		interval = 15 * time.Second
		slack    = 45 * time.Second
	)
	prevIPs := localIPv4s()
	prev := time.Now()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-a.watchStop:
			return
		case <-t.C:
			now := time.Now()
			curIPs := localIPv4s()

			slept := sleptSince(prev, now, interval, slack)
			changed := ipSetChanged(prevIPs, curIPs)
			if !slept && !changed {
				prevIPs, prev = curIPs, now
				continue
			}

			reason := "网络变化"
			if slept {
				reason = "疑似睡眠唤醒"
			}
			log.Printf("[discovery] %s（slept=%v ipChanged=%v），重建发现服务；当前 IP: %v",
				reason, slept, changed, ipStrings(curIPs))

			if err := a.rebuild(); err != nil {
				log.Printf("[discovery] 重建失败: %v（下个周期重试）", err)
			}
			// 基线更新：无论成败都重取，避免每 15s 疯狂重建；网络再变仍会触发
			prevIPs, prev = localIPv4s(), time.Now()
		}
	}
}

func ipStrings(ips []net.IP) []string {
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		out = append(out, ip.String())
	}
	return out
}

// Stop 终止发现与自愈。幂等。
func (a *Announcer) Stop() {
	if !a.closed {
		a.stopAnnounce()
	}
	a.closeWatchOnce.Do(func() { close(a.watchStop) })
}
