package discovery

import (
	"net"
	"testing"
	"time"
)

// ---- 纯函数：时间跳跃判定 ----

func TestSleptSince(t *testing.T) {
	interval := 15 * time.Second
	slack := 45 * time.Second
	base := time.Unix(1790000000, 0)

	// 正常 tick：15s 间隔（±抖动）→ 没睡
	if sleptSince(base, base.Add(15*time.Second), interval, slack) {
		t.Fatal("正常 15s tick 不应判定为睡过")
	}
	if sleptSince(base, base.Add(55*time.Second), interval, slack) {
		t.Fatal("55s（间隔+slack 内）不应判定为睡过")
	}
	// 睡 8 小时（Owner 场景：下班合盖，早上开机）
	if !sleptSince(base, base.Add(8*time.Hour), interval, slack) {
		t.Fatal("睡 8 小时必须判定为睡过")
	}
	// 睡 2 分钟（轻度暂停，超过 slack）
	if !sleptSince(base, base.Add(2*time.Minute), interval, slack) {
		t.Fatal("超过 slack 的停顿应判定为睡过")
	}
	// 时钟回拨（挂钟跳变）：Sub 走单调时钟，但若调用方给了纯挂钟时间且回拨，
	// Sub 为负 → 不误报（宁可漏报不误报）
	if sleptSince(base, base.Add(-time.Hour), interval, slack) {
		t.Fatal("时钟回拨不应判定为睡过")
	}
}

// ---- 纯函数：IP 集合 diff 三态 ----

func ip(s string) net.IP { return net.ParseIP(s) }

func TestIPSetChanged(t *testing.T) {
	old := []net.IP{ip("192.168.1.10"), ip("192.168.56.1")}

	// 不变（顺序无关）
	if ipSetChanged(old, []net.IP{ip("192.168.56.1"), ip("192.168.1.10")}) {
		t.Fatal("同集合不同顺序不应判定变化")
	}
	// 新增（插入网线/开热点）
	if !ipSetChanged(old, append(old, ip("10.0.0.5"))) {
		t.Fatal("新增 IP 应判定变化")
	}
	// 删除（拔网线/断开 WiFi）——最关键的三态
	if !ipSetChanged(old, []net.IP{ip("192.168.56.1")}) {
		t.Fatal("删除 IP 应判定变化")
	}
	// 更换（DHCP 续租换了地址）
	if !ipSetChanged(old, []net.IP{ip("192.168.1.99"), ip("192.168.56.1")}) {
		t.Fatal("IP 更换应判定变化")
	}
	// 全空 → 有、有 → 全空
	if !ipSetChanged(nil, old) || !ipSetChanged(old, nil) {
		t.Fatal("空集与有集之间应判定变化")
	}
	// 双空 → 不变
	if ipSetChanged(nil, nil) {
		t.Fatal("双空不应判定变化")
	}
}

// ---- rebuild：重建后发现服务必须仍然应答 ----

func TestRebuildStillAnswers(t *testing.T) {
	// 独立端口：本机真实 agent 常驻 8421，测试必须避让
	listenPort = 28421
	t.Cleanup(func() { listenPort = Port })
	a, err := Start(Node{ID: "probe", Name: "probe", Port: Port}, false)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer a.Stop()

	// 重建前应答
	if !probeOnce() {
		t.Fatal("重建前 UDP 探测应得到应答")
	}
	// 重建
	if err := a.rebuild(); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	time.Sleep(300 * time.Millisecond) // 新 goroutine 起来
	// 重建后必须仍然应答（self-healing 不能把发现弄死）
	if !probeOnce() {
		t.Fatal("重建后 UDP 探测应得到应答")
	}
	// 二次重建（模拟多次唤醒）
	if err := a.rebuild(); err != nil {
		t.Fatalf("rebuild 2: %v", err)
	}
	time.Sleep(300 * time.Millisecond)
	if !probeOnce() {
		t.Fatal("二次重建后 UDP 探测应得到应答")
	}
	// 连续 Stop 幂等（对外 Stop 走 closeWatchOnce 路径）
	a.Stop()
	a.Stop()
}

// probeOnce 发一次 ProbeToken 到本机端口，等应答。
func probeOnce() bool {
	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: Port})
	if err != nil {
		return false
	}
	defer conn.Close()
	_, _ = conn.Write([]byte(ProbeToken))
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	return err == nil && n > 0
}
