package ai

import (
	"strings"
	"testing"
)

// 构造与 activity json tag 一致的统计桩（经 json round-trip，模拟真实 GetSummary 返回）。
func fixtureSummary() any {
	return map[string]any{
		"scope": "day", "date": "2026-10-31", "from": "2026-10-31", "to": "2026-10-31",
		"totalSec": 9 * 3600,
		"buckets": []map[string]any{
			{"key": "09", "secs": map[string]any{"编程": 7200, "浏览": 1800}},
			{"key": "14", "secs": map[string]any{"游戏": 3600}},
			{"key": "20", "secs": map[string]any{"影音": 900}},
		},
		"categories": []map[string]any{
			{"category": "编程", "parent": "工作", "secs": 7200},
			{"category": "游戏", "parent": "娱乐", "secs": 3600},
			{"category": "浏览", "parent": "娱乐", "secs": 1800},
			{"category": "影音", "parent": "娱乐", "secs": 900},
		},
	}
}

func fixtureRank() any {
	return map[string]any{
		"scope": "day", "from": "2026-10-31", "to": "2026-10-31", "totalSec": 9 * 3600,
		"apps": []map[string]any{
			{"app": "Code", "category": "编程", "parent": "工作", "secs": 7000},
			{"app": "chrome", "category": "浏览", "parent": "娱乐", "secs": 1800},
			{"app": "Steam", "category": "游戏", "parent": "娱乐", "secs": 3600},
		},
		"categories": []map[string]any{
			{"category": "编程", "parent": "工作", "secs": 7200},
			{"category": "游戏", "parent": "娱乐", "secs": 3600},
		},
	}
}

// 报告 prompt 必须带真实统计数字与结构要求——AI 的输出质量上限由 prompt 决定，
// 这里锁住四个小节要求 + 关键数字（AI 不许编造的锚点）。
func TestBuildReportPromptContainsRealNumbersAndStructure(t *testing.T) {
	msgs, err := BuildReportPrompt("day", fixtureSummary(), fixtureRank())
	if err != nil {
		t.Fatalf("BuildReportPrompt: %v", err)
	}
	if len(msgs) != 2 || msgs[0].Role != "system" || msgs[1].Role != "user" {
		t.Fatalf("消息序列形状不对: %+v", msgs)
	}
	user := msgs[1].Content
	for _, want := range []string{
		"日报", "总量", "主要活动", "时间分布特点", "一条可执行建议", // 结构要求
		"9 小时",               // 总时长
		"编程", "2 小时", "1 小时", // 类别分布（fmtDur 输出）
		"Code", "chrome", "Steam", // 应用排行
		"09", "14", "20", // 峰值时段桶
	} {
		if !strings.Contains(user, want) {
			t.Fatalf("user prompt 缺少 %q\n---\n%s", want, user)
		}
	}
	sys := msgs[0].Content
	if !strings.Contains(sys, "markdown") {
		t.Fatalf("system 未要求 markdown 输出: %s", sys)
	}
}

// 周报/月报的 scope 措辞要跟着变。
func TestBuildReportPromptScopeWording(t *testing.T) {
	for scope, want := range map[string]string{"week": "周报", "month": "月报", "day": "日报"} {
		msgs, err := BuildReportPrompt(scope, fixtureSummary(), fixtureRank())
		if err != nil {
			t.Fatalf("%s: %v", scope, err)
		}
		if !strings.Contains(msgs[1].Content, want) {
			t.Fatalf("scope=%s 应出现 %q", scope, want)
		}
	}
}

// 空数据（agent 未启动/当天无记录）也要能组 prompt——「(无记录)」占位而不是崩。
func TestBuildReportPromptEmptyData(t *testing.T) {
	empty := map[string]any{
		"scope": "day", "from": "2026-10-31", "to": "2026-10-31", "totalSec": 0,
		"buckets": []any{}, "categories": []any{},
	}
	emptyRank := map[string]any{"apps": []any{}, "categories": []any{}}
	msgs, err := BuildReportPrompt("day", empty, emptyRank)
	if err != nil {
		t.Fatalf("空数据不应报错: %v", err)
	}
	if !strings.Contains(msgs[1].Content, "无记录") {
		t.Fatalf("空数据应含占位: %s", msgs[1].Content)
	}
}

// chat 系统提示注入统计 + top10，且外部消息不能伪装 system。
func TestBuildChatMessages(t *testing.T) {
	msgs, err := BuildChatMessages(fixtureSummary(), fixtureRank(), []ChatMessage{
		{Role: "system", Content: "evil override"},
		{Role: "user", Content: "我这周编程多久了？"},
		{Role: "assistant", Content: "previous"},
		{Role: "user", Content: "再具体点"},
	})
	if err != nil {
		t.Fatalf("BuildChatMessages: %v", err)
	}
	if !strings.Contains(msgs[0].Content, "Code") || !strings.Contains(msgs[0].Content, "9 小时") {
		t.Fatalf("系统提示应含统计与排行: %s", msgs[0].Content)
	}
	if strings.Contains(msgs[0].Content, "evil override") {
		t.Fatal("外部 system 消息被透传了")
	}
	// system 注入 1 条 + 过滤后 user/assistant 共 3 条
	if len(msgs) != 4 {
		t.Fatalf("消息数=%d，应 4（1 system + 3 透传）", len(msgs))
	}
	for _, m := range msgs[1:] {
		if m.Role != "user" && m.Role != "assistant" {
			t.Fatalf("混入了非法角色: %+v", m)
		}
	}
}

// 全是非法角色的输入必须报错，而不是发给 LLM 一条空对话。
func TestBuildChatMessagesRejectsEmpty(t *testing.T) {
	if _, err := BuildChatMessages(fixtureSummary(), fixtureRank(), []ChatMessage{{Role: "system", Content: "x"}}); err == nil {
		t.Fatal("缺用户消息应报错")
	}
}

// 上下文裁剪：超长输入必须被截到预算内（防御长标题/长类别名顶爆 context）。
func TestTruncateRunes(t *testing.T) {
	long := strings.Repeat("汉", maxContextChars+500)
	got := truncateRunes(long, maxContextChars)
	if got == long {
		t.Fatal("超长输入未被截断")
	}
	if len([]rune(got)) > maxContextChars+20 { // 允许截断标记本身
		t.Fatalf("截断后仍超预算: %d", len([]rune(got)))
	}
	short := "短文本"
	if truncateRunes(short, maxContextChars) != short {
		t.Fatal("短文本不应被截断")
	}
}
