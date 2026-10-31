package activity

import (
	"testing"
	"time"
)

func TestNormalizeApp(t *testing.T) {
	cases := map[string]string{
		`C:\Program Files\Microsoft VS Code\Code.EXE`: "code",
		"chrome.exe":         "chrome",
		"Chrome":             "chrome",
		"/usr/bin/firefox":   "firefox",
		"  Windowsterminal ": "windowsterminal",
	}
	for in, want := range cases {
		if got := normalizeApp(in); got != want {
			t.Fatalf("normalizeApp(%q)=%q want %q", in, got, want)
		}
	}
}

func TestClassify(t *testing.T) {
	rules := DefaultCategories()

	// 应用名命中（大小写/路径/扩展名归一后子串匹配）
	if p, c := Classify(`C:\...\Code.exe`, "", rules); c != "编程" || p != "工作" {
		t.Fatalf("Code 应归 工作/编程，得到 %s/%s", p, c)
	}
	if _, c := Classify("chrome", "淘宝网 - 检索", rules); c != "浏览" {
		t.Fatalf("chrome 应归 浏览，得到 %s", c)
	}
	// 标题兜底：应用名不在规则里，但标题含影音关键词
	if _, c := Classify("unknownapp", "bilibili - 视频播放", rules); c != "影音" {
		t.Fatalf("标题应兜底归 影音，得到 %s", c)
	}
	// 都不命中 → 其他
	if p, c := Classify("foobar", "随便什么", rules); c != "其他" || p != "其他" {
		t.Fatalf("未命中应归 其他，得到 %s/%s", p, c)
	}
	// 顺序优先：更具体的规则在前（Code 同时含 code，但第一条就是它自己）
	rules2 := []CategoryRule{
		{ID: "1", Category: "工作沟通", Parent: "工作", AppPatterns: []string{"code"}},
		{ID: "2", Category: "编程", Parent: "工作", AppPatterns: []string{"code"}},
	}
	if _, c := Classify("code", "", rules2); c != "工作沟通" {
		t.Fatalf("第一条命中应生效，得到 %s", c)
	}
	// 空规则/空模式安全
	if _, c := Classify("x", "y", []CategoryRule{{AppPatterns: []string{""}}}); c != "其他" {
		t.Fatalf("空模式不应命中，得到 %s", c)
	}
}

func TestIsPrivate(t *testing.T) {
	rules := []PrivacyRule{
		{ID: "1", Kind: "app", Pattern: "keepass"},
		{ID: "2", Kind: "title", Pattern: "银行"},
	}
	if !IsPrivate("KeepAss.exe", "密码库", rules) {
		t.Fatal("应用名命中应过滤")
	}
	if !IsPrivate("notepad", "网上银行转账", rules) {
		t.Fatal("标题命中应过滤")
	}
	if IsPrivate("notepad", "购物清单", rules) {
		t.Fatal("未命中不应过滤")
	}
	if IsPrivate("", "", rules) {
		t.Fatal("空规则/空内容不应过滤")
	}
	// 空模式不命中
	if IsPrivate("anything", "anything", []PrivacyRule{{Kind: "app"}}) {
		t.Fatal("空模式不应命中")
	}
}

func TestInWorkHours(t *testing.T) {
	mk := func(h, m int) time.Time {
		return time.Date(2026, 10, 31, h, m, 0, 0, time.Local)
	}
	if !inWorkHours(mk(10, 0), "09:00", "18:00") {
		t.Fatal("10:00 应在 09:00-18:00 内")
	}
	if inWorkHours(mk(20, 0), "09:00", "18:00") {
		t.Fatal("20:00 不应在 09:00-18:00 内")
	}
	// 跨零点：22:00-06:00
	if !inWorkHours(mk(23, 30), "22:00", "06:00") {
		t.Fatal("23:30 应在 22:00-06:00 内")
	}
	if !inWorkHours(mk(5, 0), "22:00", "06:00") {
		t.Fatal("05:00 应在 22:00-06:00 内")
	}
	if inWorkHours(mk(12, 0), "22:00", "06:00") {
		t.Fatal("12:00 不应在 22:00-06:00 内")
	}
	// 解析失败 → 不限制
	if !inWorkHours(mk(3, 0), "abc", "18:00") {
		t.Fatal("非法时段应视为不限制")
	}
	// 零长度 → 不限制
	if !inWorkHours(mk(3, 0), "09:00", "09:00") {
		t.Fatal("零长度时段应视为不限制")
	}
}
