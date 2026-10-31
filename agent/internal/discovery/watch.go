package discovery

// 睡眠唤醒 / 网络变化后的发现自愈。
//
// 背景（Owner 直报）：电脑休眠/睡眠唤醒后手机连不上电脑。根因：zeroconf 只在
// 启动时注册一次（带当时 IP），广播循环也只通告启动时状态——唤醒后 IP 变化
// （WiFi 漫游/DHCP 续租/适配器重连）时，发现层通告的是旧 IP，不重启 agent 永远不好。
//
// 自愈：常驻 goroutine 每 15s 检查一次——
//   - 时间跳跃（monotonic 差值远超 tick 间隔）= 睡过（含休眠/快速启动）；
//   - 本机 IPv4 集合 diff = 网络重排。
// 任一触发 → 整个 Announcer 重建（zeroconf 重注册 + UDP 重绑定 + 广播循环重启），
// 并把当前 IP 列表写日志（Owner 自然休眠唤醒后看日志即可确认自愈）。

import (
	"net"
	"time"
)

// sleptSince 判定「两次检查之间系统睡过」。
//
// time.Now/Sub 走单调时钟，挂钟跳变（NTP）不会误报；只有进程被挂起
// （睡眠/休眠/调试断点超长停顿）才会让实际流逝远超 tick 间隔。
// slack 给调度抖动留裕度（45s >> 任何正常 GC/负载延迟）。
//
// 纯函数：now/last 由调用方注入，可单测「睡 8 小时」。
func sleptSince(last, now time.Time, interval, slack time.Duration) bool {
	return now.Sub(last) > interval+slack
}

// ipSetChanged 集合 diff：增、删、换任一变化都算变了（顺序无关）。
// 纯函数，三态单测覆盖。
func ipSetChanged(old, cur []net.IP) bool {
	if len(old) != len(cur) {
		return true
	}
	oldSet := make(map[string]bool, len(old))
	for _, ip := range old {
		oldSet[ip.String()] = true
	}
	for _, ip := range cur {
		if !oldSet[ip.String()] {
			return true // 新增，或换成了没见过的 IP
		}
	}
	// 数量相等且全部命中 → 不变
	return false
}

// equalIPs 集合相同（watch 用它判断「没变」）。
func equalIPs(a, b []net.IP) bool { return !ipSetChanged(a, b) }
