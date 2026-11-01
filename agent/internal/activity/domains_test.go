package activity

import (
	"testing"
	"time"
)

// ---- 纯函数：域名匹配（A2 验收：youtube.com/www.youtube.com/youtu.be 边界）----

func TestMatchDomain(t *testing.T) {
	rules := []string{"youtube.com"}
	cases := []struct {
		domain string
		want   bool
	}{
		{"youtube.com", true},          // 精确
		{"www.youtube.com", true},      // 子域后缀
		{"music.youtube.com", true},    // 多级子域
		{"youtu.be", false},            // 短链是独立域名，须单独配规则
		{"notyoutube.com", false},      // 误报防线：子串不匹配
		{"youtube.com.evil.cn", false}, // 误报防线：后缀不在允许方向
		{"", false},
	}
	for _, c := range cases {
		if got := matchDomain(rules, c.domain); got != c.want {
			t.Fatalf("matchDomain(%q) = %v, want %v", c.domain, got, c.want)
		}
	}
	// 短链单独配规则
	if !matchDomain([]string{"youtu.be"}, "youtu.be") {
		t.Fatal("youtu.be 应命中自己的规则")
	}
	// 大小写归一
	if !matchDomain([]string{"YouTube.COM"}, "WWW.youtube.com") {
		t.Fatal("大小写应归一后匹配")
	}
	// 空 pattern 跳过
	if matchDomain([]string{""}, "youtube.com") {
		t.Fatal("空 pattern 不应命中")
	}
}

func TestNormalizeDomain(t *testing.T) {
	cases := []struct{ in, want string }{
		{"https://www.youtube.com/watch?v=1", "www.youtube.com"},
		{"youtube.com", "youtube.com"},
		{"https://music.163.com:443/", "music.163.com"},
		{"  YouTube.COM.  ", "youtube.com"},
		{"localhost", ""}, // 非网站域名
		{"intranet", ""},  // 无点主机名
		{"", ""},
	}
	for _, c := range cases {
		if got := normalizeDomain(c.in); got != c.want {
			t.Fatalf("normalizeDomain(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ---- 纯函数：域名分类优先于标题规则（契约八期 5）----

func TestClassifyDomainPriority(t *testing.T) {
	rules := []CategoryRule{
		{ID: "1", Category: "编程", Parent: "工作", AppPatterns: []string{"chrome"}},
		{ID: "2", Category: "影音", Parent: "娱乐", DomainPatterns: []string{"youtube.com"}},
	}
	// 浏览器前台 + 域名命中 → 域名规则优先（即使 app 规则在前面）
	if p, c := Classify("chrome", "随便什么标题", "www.youtube.com", rules); c != "影音" || p != "娱乐" {
		t.Fatalf("域名应优先: got %s/%s", p, c)
	}
	// 无域名 → 回退标题/app 规则
	if _, c := Classify("chrome", "标题", "", rules); c != "编程" {
		t.Fatalf("无域名应回退 app 规则: got %s", c)
	}
	// 域名不在任何规则 → 回退
	if _, c := Classify("chrome", "标题", "github.com", rules); c != "编程" {
		t.Fatalf("未命中域名应回退 app 规则: got %s", c)
	}
	// 非浏览器 + 无域名 → 默认
	if p, c := Classify("code", "main.go", "", rules); c != "其他" {
		t.Fatalf("未命中任何规则应默认: got %s/%s", p, c)
	}
}

// ---- 内存域名表：写入/读取/过期/净化/联动（A2 验收）----

func TestDomainTable(t *testing.T) {
	m := Start(testDir(t))
	t.Cleanup(func() { Stop() })
	_ = m

	// 写入 → 读取联动
	SetDomain("chrome", "https://www.youtube.com/watch?v=1", "示例标题")
	if d, ok := m.DomainFor("chrome"); !ok || d != "www.youtube.com" {
		t.Fatalf("chrome 应有 www.youtube.com，得到 %q ok=%v", d, ok)
	}
	// 契约白名单外浏览器：忽略
	SetDomain("safari", "apple.com", "")
	if _, ok := m.DomainFor("safari"); ok {
		t.Fatal("safari 不在白名单，不应有记录")
	}
	// 未上报的浏览器：无记录
	if _, ok := m.DomainFor("firefox"); ok {
		t.Fatal("firefox 未上报，不应有记录")
	}
	// 过期：At 改旧（包内直改内存表）
	SetDomain("edge", "github.com", "")
	m.domMu.Lock()
	e := m.domTable["edge"]
	e.At = time.Now().Add(-time.Hour)
	m.domTable["edge"] = e
	m.domMu.Unlock()
	if _, ok := m.DomainFor("edge"); ok {
		t.Fatal("过期域名不应返回")
	}
	// 空 domain：忽略
	SetDomain("chrome", "", "")
	if d, _ := m.DomainFor("chrome"); d != "www.youtube.com" {
		t.Fatalf("空上报不应覆盖: %q", d)
	}
}
