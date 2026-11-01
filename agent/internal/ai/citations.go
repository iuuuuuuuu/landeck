package ai

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

// citations.go：对话回答的「依据链接」。
//
// 模型在引用具体日期数据的句子后插入 [cite:YYYY-MM-DD]（可多日逗号分隔），
// agent 把标记剥掉并换成结构化 citations（label + 前端路由），前端据此渲染
// 可点击的依据链接。标记由 system prompt 约定（见 BuildChatMessages）。

// Citation 一条依据链接。
type Citation struct {
	Label string `json:"label"`
	Route string `json:"route"`
}

// citeRe 匹配 [cite:日期(,日期)*]。日期格式必须完整 YYYY-MM-DD，防模型写变形。
var citeRe = regexp.MustCompile(`\[cite:\s*((?:\d{4}-\d{2}-\d{2})(?:\s*,\s*\d{4}-\d{2}-\d{2})*)\]`)

var dateRe = regexp.MustCompile(`\d{4}-\d{2}-\d{2}`)

// ParseCitations 剥出标记并组装 citations。
//
// 规则：
//   - 所有标记从正文移除（包括越界日期的标记——正文不能残留内部记号）
//   - 同日去重（模型可能在多处引用同一天）
//   - 只保留注入上下文覆盖到的日期（[from,to] 闭区间）：范围外是模型幻觉的日期，
//     链接过去是空页面，不如不给
//   - 按 date 升序（阅读顺序 = 时间顺序）
func ParseCitations(content string, from, to time.Time) (string, []Citation) {
	seen := map[string]bool{}
	var dates []time.Time
	clean := citeRe.ReplaceAllStringFunc(content, func(m string) string {
		for _, d := range dateRe.FindAllString(m, -1) {
			t, err := time.ParseInLocation("2006-01-02", d, from.Location())
			if err != nil {
				continue
			}
			if t.Before(from) || t.After(to) {
				continue // 范围外：不进 citations
			}
			key := t.Format("2006-01-02")
			if !seen[key] {
				seen[key] = true
				dates = append(dates, t)
			}
		}
		return "" // 标记一律剥除
	})

	clean = strings.TrimRight(clean, " \t\n")
	sort.Slice(dates, func(i, j int) bool { return dates[i].Before(dates[j]) })

	citations := make([]Citation, 0, len(dates))
	for _, d := range dates {
		key := d.Format("2006-01-02")
		citations = append(citations, Citation{
			Label: fmt.Sprintf("%d月%d日日报", int(d.Month()), d.Day()),
			Route: "#/activity/daily?date=" + key,
		})
	}
	if len(citations) == 0 {
		return clean, nil
	}
	return clean, citations
}

// jsonMarshal/jsonUnmarshal：json 包的薄别名，auto.go 与本文件共用。
func jsonMarshal(v any) ([]byte, error)   { return json.Marshal(v) }
func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
