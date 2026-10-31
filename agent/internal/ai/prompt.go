package ai

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// prompt.go：prompt 组装与上下文裁剪，全部纯函数（输入→输出无 IO），单测重点。
//
// 为什么 json round-trip 而不是直接断言 activity 的结构体：
// GetSummary/GetRank 返回 any（内部类型不导出），按 json tag 松散反序列化
// 让本包与 activity 的类型演化解耦——它加字段我不动。

// ---------- activity 返回的松散形状（对齐其 json tag） ----------

type rawSummary struct {
	Scope    string             `json:"scope"`
	Date     string             `json:"date"`
	From     string             `json:"from"`
	To       string             `json:"to"`
	TotalSec int64              `json:"totalSec"`
	Buckets  []rawBucket        `json:"buckets"`
	Cats     []rawCategoryTotal `json:"categories"`
}

type rawBucket struct {
	Key  string           `json:"key"`
	Secs map[string]int64 `json:"secs"`
}

type rawCategoryTotal struct {
	Category string `json:"category"`
	Parent   string `json:"parent"`
	Secs     int64  `json:"secs"`
}

type rawRank struct {
	Scope      string             `json:"scope"`
	From       string             `json:"from"`
	To         string             `json:"to"`
	TotalSec   int64              `json:"totalSec"`
	Apps       []rawAppRank       `json:"apps"`
	Categories []rawCategoryTotal `json:"categories"`
}

type rawAppRank struct {
	App      string `json:"app"`
	Category string `json:"category"`
	Parent   string `json:"parent"`
	Secs     int64  `json:"secs"`
}

func decode[T any](v any) (T, error) {
	var out T
	b, err := json.Marshal(v)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return out, err
	}
	return out, nil
}

// ---------- 展示辅助 ----------

/** 秒 → 「X 小时 Y 分钟」人话。 */
func fmtDur(sec int64) string {
	if sec <= 0 {
		return "0 分钟"
	}
	h := sec / 3600
	m := (sec % 3600) / 60
	switch {
	case h > 0 && m > 0:
		return fmt.Sprintf("%d 小时 %d 分钟", h, m)
	case h > 0:
		return fmt.Sprintf("%d 小时", h)
	default:
		return fmt.Sprintf("%d 分钟", m)
	}
}

// maxContextChars 系统提示的上下文预算（字符）。
// 7 天汇总 + top10 应用是结构化短文本，正常 ~2KB；上限是防御用户装了一堆
// 长标题应用/自建超长类别名，把 context 顶爆。超出按行截断。
const maxContextChars = 6000

// truncateRunes 按字符（非字节）截断，中文不切半个。
func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "\n…(已截断)"
}

// ---------- 日报 / 周报 / 月报 ----------

// BuildReportPrompt 组装报告的完整消息序列。
//
// 对 AI 的输出要求固定四段：总量、主要活动、时间分布特点、一条可执行建议——
// 结构稳定前端才好排版，用户读起来也有预期。
func BuildReportPrompt(scope string, summary, rank any) ([]ChatMessage, error) {
	sum, err := decode[rawSummary](summary)
	if err != nil {
		return nil, fmt.Errorf("解析统计失败: %w", err)
	}
	rk, err := decode[rawRank](rank)
	if err != nil {
		return nil, fmt.Errorf("解析排行失败: %w", err)
	}

	var sb strings.Builder
	sb.WriteString("以下是本机活动统计的原始数据，请据此写")
	switch scope {
	case "week":
		sb.WriteString("周报")
	case "month":
		sb.WriteString("月报")
	default:
		sb.WriteString("日报")
	}
	sb.WriteString("，用简体中文 markdown 输出，固定包含四个小节：" +
		"「总量」「主要活动」「时间分布特点」「一条可执行建议」。" +
		"建议要具体可执行，不要泛泛而谈；数字直接引用给定数据，不要编造。\n\n")

	sb.WriteString(fmt.Sprintf("统计范围: %s ~ %s\n总活动时长: %s\n\n",
		sum.From, sum.To, fmtDur(sum.TotalSec)))

	// 类别分布（按秒降序，最多 8 条）
	cats := append([]rawCategoryTotal(nil), sum.Cats...)
	sort.Slice(cats, func(i, j int) bool { return cats[i].Secs > cats[j].Secs })
	if len(cats) > 8 {
		cats = cats[:8]
	}
	sb.WriteString("类别分布:\n")
	if len(cats) == 0 {
		sb.WriteString("(无记录)\n")
	}
	for _, c := range cats {
		sb.WriteString(fmt.Sprintf("- %s(%s): %s\n", c.Category, c.Parent, fmtDur(c.Secs)))
	}

	// 应用排行（按秒降序，最多 10 条）
	apps := append([]rawAppRank(nil), rk.Apps...)
	sort.Slice(apps, func(i, j int) bool { return apps[i].Secs > apps[j].Secs })
	if len(apps) > 10 {
		apps = apps[:10]
	}
	sb.WriteString("\n应用排行:\n")
	if len(apps) == 0 {
		sb.WriteString("(无记录)\n")
	}
	for _, a := range apps {
		sb.WriteString(fmt.Sprintf("- %s [%s]: %s\n", a.App, a.Category, fmtDur(a.Secs)))
	}

	// 峰值时段：找活动最多的 3 个小时桶，给「时间分布特点」提供抓手
	type peak struct {
		key, cat string
		sec      int64
	}
	var peaks []peak
	for _, b := range sum.Buckets {
		bestCat, bestSec := "", int64(0)
		for cat, sec := range b.Secs {
			if sec > bestSec {
				bestCat, bestSec = cat, sec
			}
		}
		if bestSec > 0 {
			peaks = append(peaks, peak{b.Key, bestCat, bestSec})
		}
	}
	sort.Slice(peaks, func(i, j int) bool { return peaks[i].sec > peaks[j].sec })
	if len(peaks) > 3 {
		peaks = peaks[:3]
	}
	if len(peaks) > 0 {
		sb.WriteString("\n最活跃时段:\n")
		for _, p := range peaks {
			sb.WriteString(fmt.Sprintf("- %s 点前后: %s %s\n", p.key, p.cat, fmtDur(p.sec)))
		}
	}

	sys := "你是个人效率助手，基于用户本机的真实活动统计写作。语气平实，不用感叹号堆砌，" +
		"输出必须是 markdown。"
	return []ChatMessage{
		{Role: "system", Content: sys},
		{Role: "user", Content: truncateRunes(sb.String(), maxContextChars)},
	}, nil
}

// ---------- 对话 ----------

// BuildChatMessages 组装对话消息：系统提示注入最近 7 天活动汇总 + 应用排行 top10。
//
// 取舍：7 天用 activity 的 week scope（ISO 周一起始）而不是滚动 7 天——
// 它已带缓存，且「本周」正是问得最多的口径；滚动窗口要 7 次查询，收益不成比例。
// 排行取 top10：再多模型注意力会稀释，且大部分长尾应用都是几十秒的噪音。
// 非流式返回（SSE 留二期）：前端先按整段 markdown 渲染，流式要动 WS 协议，单独一批做。
func BuildChatMessages(summary, rank any, userMsgs []ChatMessage) ([]ChatMessage, error) {
	sum, err := decode[rawSummary](summary)
	if err != nil {
		return nil, fmt.Errorf("解析统计失败: %w", err)
	}
	rk, err := decode[rawRank](rank)
	if err != nil {
		return nil, fmt.Errorf("解析排行失败: %w", err)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("最近一段（%s ~ %s）本机活动统计：\n总活动时长 %s。\n类别：",
		sum.From, sum.To, fmtDur(sum.TotalSec)))
	cats := append([]rawCategoryTotal(nil), sum.Cats...)
	sort.Slice(cats, func(i, j int) bool { return cats[i].Secs > cats[j].Secs })
	for i, c := range cats {
		if i > 0 {
			sb.WriteString("、")
		}
		sb.WriteString(fmt.Sprintf("%s %s", c.Category, fmtDur(c.Secs)))
	}
	sb.WriteString("\n应用排行 top10：\n")
	apps := append([]rawAppRank(nil), rk.Apps...)
	sort.Slice(apps, func(i, j int) bool { return apps[i].Secs > apps[j].Secs })
	if len(apps) > 10 {
		apps = apps[:10]
	}
	for _, a := range apps {
		sb.WriteString(fmt.Sprintf("- %s [%s] %s\n", a.App, a.Category, fmtDur(a.Secs)))
	}

	sys := "你是 LanDeck 的内置助手，回答关于用户电脑使用情况的问题。\n" +
		"回答依据下面给出的真实统计；数据里没有的就说统计里查不到，不要编造。\n" +
		"数字引用保持与统计一致，时长用「X 小时 Y 分钟」格式。\n\n" +
		truncateRunes(sb.String(), maxContextChars)

	out := make([]ChatMessage, 0, len(userMsgs)+1)
	out = append(out, ChatMessage{Role: "system", Content: sys})
	for _, m := range userMsgs {
		role := m.Role
		if role != "user" && role != "assistant" {
			continue // 只透传对话轮次，外部内容不能伪装 system
		}
		out = append(out, ChatMessage{Role: role, Content: m.Content})
	}
	if len(out) < 2 {
		return nil, fmt.Errorf("缺少用户消息")
	}
	return out, nil
}
