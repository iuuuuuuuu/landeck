package activity

// 浏览器域名记录（八期 A2，proposed 笔记 3b03f3b 的 agent 侧落地）。
//
// 架构（契约）：
//   - MV3 扩展把激活标签 URL 的域名 POST 到 /activity/domain（localhost 推送）；
//   - 本文件维护「每浏览器最近域名」内存表（不持久化——重启丢失无妨，
//     扩展的事件推送会在下次标签切换时立刻补上）；
//   - 采样 tick 时若前台是浏览器且内存表有该浏览器的近期域名，
//     把域名快照写进段（segments.domain 列）；
//   - 分类是读取时的（规则编辑可追溯历史），因此 BuildSummary/BuildRank 的
//     Classify 传段上的 domain——与 title 分类完全同构。
//
// 隐私边界：domainCapture 默认关闭；关闭时 /activity/domain 直接 501。

import (
	"net/url"
	"strings"
	"time"
)

// domainEntry 内存表条目。
type domainEntry struct {
	Domain string
	Title  string
	At     time.Time
}

const (
	// domainMaxAgeFloor 域名快照的最低有效期。扩展是事件推送（标签切换即推），
	// 采样 tick 读到的是「最近 30s-2min 内活跃的域名」；过期即视为不可信
	//（用户可能已切走），回退标题分类。
	domainMaxAgeFloor = 60 * time.Second
	// domainBrowserMax 浏览器种类的白名单（契约：chrome|edge|firefox）。
	domainBrowserMax = 3
)

var domainBrowsers = map[string]bool{"chrome": true, "edge": true, "firefox": true}

// ValidBrowser 契约白名单：chrome|edge|firefox。
func ValidBrowser(b string) bool { return domainBrowsers[b] }

// SetDomain 扩展上报：记录某浏览器的最近域名。browser 必须在白名单内，
// domain 会净化成裸主机名（去 scheme/路径/端口，小写）。
// 包级入口供 httpapi 调用；agent 未启动时静默丢弃（501 已在上游拦截）。
func SetDomain(browser, domain, title string) {
	startMu.Lock()
	m := mgr
	startMu.Unlock()
	if m == nil {
		return
	}
	m.putDomain(browser, domain, title)
}

func (m *Manager) putDomain(browser, domain, title string) {
	if !domainBrowsers[browser] {
		return
	}
	d := normalizeDomain(domain)
	if d == "" {
		return
	}
	m.domMu.Lock()
	m.domTable[browser] = domainEntry{Domain: d, Title: clipTitle(title), At: time.Now()}
	m.domMu.Unlock()
}

// DomainFor 采样读取：返回该浏览器在有效期内的最近域名。
func (m *Manager) DomainFor(browser string) (string, bool) {
	m.domMu.Lock()
	e, ok := m.domTable[browser]
	m.domMu.Unlock()
	if !ok {
		return "", false
	}
	maxAge := domainMaxAgeFloor
	if iv := time.Duration(m.settings.Get().IntervalSec) * 2 * time.Second; iv > maxAge {
		maxAge = iv
	}
	if time.Since(e.At) > maxAge {
		return "", false
	}
	return e.Domain, true
}

// normalizeDomain 把任意 URL/主机名净化成裸主机名（小写、去端口）。
// "https://www.youtube.com/watch?v=1" -> "www.youtube.com"；裸域名原样通过。
func normalizeDomain(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if strings.Contains(s, "://") {
		u, err := url.Parse(s)
		if err != nil || u.Hostname() == "" {
			return ""
		}
		s = u.Hostname()
	}
	// 去路径/端口残留
	if i := strings.IndexAny(s, "/:?#"); i >= 0 {
		s = s[:i]
	}
	s = strings.ToLower(strings.TrimSuffix(s, "."))
	if s == "localhost" || !strings.Contains(s, ".") {
		return "" // 无点主机名/localhost 不是"网站域名"
	}
	return s
}

// matchDomain 域名规则匹配：pattern 精确等于 domain，或 domain 是
// *.pattern 后缀（youtube.com 命中 youtube.com 与 www.youtube.com）。
// 刻意不用子串匹配（containsFold）——"notyoutube.com.evil" 这类误报
// 对域名是真实风险，标题匹配器同款太宽松。
func matchDomain(patterns []string, domain string) bool {
	if domain == "" {
		return false
	}
	for _, p := range patterns {
		p = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(p, ".")))
		if p == "" {
			continue
		}
		if domain == p || strings.HasSuffix(domain, "."+p) {
			return true
		}
	}
	return false
}
