// Package activity 记录本机前台应用的使用时段（屏幕时间统计）。
//
// 为什么是「段」而不是逐条事件：30 秒采样一次，用户在一个应用里一坐几小时，
// 逐条存会有几百条完全相同的记录。把连续的同一 (app, title) 合并成一段
// (start, end)，每小时最多 120 个采样点坍缩成 1 行 UPDATE，库体积和查询
// 成本都降一个数量级。
//
// 为什么 category 不落库：分类规则是用户可编辑的（API 可增删改）。
// 落库意味着改一条规则要迁移全部历史数据；查询时按当前规则现算，
// 规则改动立即对全部历史生效，代价只是查询时的字符串匹配（段数量级很小）。
//
// 隐私过滤在写入时执行：命中规则的采样直接丢弃，明文都不进库。
package activity

import (
	"strings"
	"sync"
	"time"
)

// PrivacyRule 一条隐私过滤规则。Kind 决定匹配对象：
//
//	app   应用名（如 chrome、Code.exe —— 匹配时去掉 .exe 并忽略大小写）
//	title 窗口标题
//
// Pattern 是子串匹配，不分大小写；命中即整段不记录。
type PrivacyRule struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"` // app | title
	Pattern string `json:"pattern"`
}

// CategoryRule 应用名/窗口标题 → 活动分类。
//
// 匹配按列表顺序，第一条命中的生效；都没命中归入「其他」。
// Parent 是大类（如 工作/娱乐），Category 是小类（如 编程/游戏）——
// 与 Hindsight 的双环饼图（外圈大类、内圈小类）对齐。
type CategoryRule struct {
	ID            string   `json:"id"`
	Category      string   `json:"category"`      // 小类，如 编程
	Parent        string   `json:"parent"`        // 大类，如 工作
	AppPatterns   []string `json:"appPatterns"`   // 应用名子串（不分大小写）
	TitlePatterns []string `json:"titlePatterns"` // 窗口标题子串（可选）
}

// Settings 活动采集的全部可调参数。落盘到 data/activity.json。
type Settings struct {
	// Enabled 总开关：false 时完全停采（前端侧栏显示「已停止」）
	Enabled bool `json:"enabled"`
	// IntervalSec 采样间隔，秒。Hindsight 默认 30。
	IntervalSec int `json:"intervalSec"`
	// IdleSec 闲置阈值：键鼠无操作超过该秒数即停止计时。Hindsight 默认 3 分钟。
	IdleSec int `json:"idleSec"`
	// WorkHoursEnabled 工作时段开关：开启后只在时段内采集
	WorkHoursEnabled bool   `json:"workHoursEnabled"`
	WorkStart        string `json:"workStart"` // "09:00"
	WorkEnd          string `json:"workEnd"`   // "18:00"
	// RetentionDays 数据保留天数，过期段在启动与每日清理时删除
	RetentionDays int `json:"retentionDays"`
	// PrivateRules 隐私过滤规则（写入时命中即丢弃）
	PrivateRules []PrivacyRule `json:"privateRules"`
	// Categories 分类规则（查询时匹配）
	Categories []CategoryRule `json:"categories"`
}

// DefaultSettings 默认参数，数值对齐 Hindsight 的默认行为。
func DefaultSettings() Settings {
	return Settings{
		Enabled:          true,
		IntervalSec:      30,
		IdleSec:          180,
		WorkHoursEnabled: false,
		WorkStart:        "09:00",
		WorkEnd:          "18:00",
		RetentionDays:    90,
		PrivateRules:     []PrivacyRule{},
		Categories:       DefaultCategories(),
	}
}

const (
	retentionMin = 7    // 最少保留 7 天，防止误设 0 把库清空
	intervalMin  = 10   // 采样间隔下限：再快 CPU 与库增长都不划算
	intervalMax  = 600  // 上限 10 分钟：再慢统计会失真
	idleMin      = 30   // 闲置阈值下限
	idleMax      = 3600 // 上限 1 小时
)

// sanitize 把明显不合理的设置拉回合法区间，避免一次坏写入让采集永远停摆。
func (s *Settings) sanitize() {
	if s.IntervalSec < intervalMin {
		s.IntervalSec = 30
	}
	if s.IntervalSec > intervalMax {
		s.IntervalSec = intervalMax
	}
	if s.IdleSec < idleMin {
		s.IdleSec = 180
	}
	if s.IdleSec > idleMax {
		s.IdleSec = idleMax
	}
	if s.RetentionDays < retentionMin {
		s.RetentionDays = 90
	}
	if s.RetentionDays > 3650 {
		s.RetentionDays = 3650
	}
	if s.PrivateRules == nil {
		s.PrivateRules = []PrivacyRule{}
	}
	if s.Categories == nil {
		s.Categories = DefaultCategories()
	}
}

// DefaultCategories 一套开箱即用的常见分类规则。
// 顺序即优先级：更具体的（IDE）排在更宽的（浏览器）前面。
func DefaultCategories() []CategoryRule {
	return []CategoryRule{
		{ID: "cat-ide", Category: "编程", Parent: "工作",
			AppPatterns: []string{"code", "cursor", "goland", "pycharm", "webstorm", "clion", "rider", "visual studio", "devenv", "idea", "vim", "neovim", "zed"}},
		{ID: "cat-term", Category: "终端", Parent: "工作",
			AppPatterns: []string{"windowsterminal", "cmd", "powershell", "pwsh", "wt", "conhost", "iterm", "alacritty", "wezterm", "konsole", "gnome-terminal"}},
		{ID: "cat-office", Category: "办公", Parent: "工作",
			AppPatterns: []string{"winword", "excel", "powerpnt", "outlook", "onenote", "notion", "obsidian", "wps", "et", "wppdf", "acrobat", "sumatrapdf"}},
		{ID: "cat-chat", Category: "沟通", Parent: "工作",
			AppPatterns: []string{"wechat", "wechatapp", "qq", "dingtalk", "feishu", "lark", "teams", "slack", "telegram", "discord", "whatsapp"}},
		{ID: "cat-browse", Category: "浏览", Parent: "浏览",
			AppPatterns: []string{"chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "safari", "360se", "360chrome"}},
		{ID: "cat-media", Category: "影音", Parent: "娱乐",
			AppPatterns:   []string{"potplayer", "vlc", "mpv", "netease", "cloudmusic", "spotify", "qqmusic", "kugou", "bilibili", "youtube", "netflix", "wmplayer", "films", "tv"},
			TitlePatterns: []string{"bilibili", "youtube", "优酷", "爱奇艺", "腾讯视频"}},
		{ID: "cat-game", Category: "游戏", Parent: "娱乐",
			AppPatterns: []string{"steam", "epicgameslauncher", "riotclientservices", "leagueclient", "wegame", "javaw", "minecraft", " GTA", "battle.net"}},
		{ID: "cat-design", Category: "设计", Parent: "工作",
			AppPatterns: []string{"photoshop", "illustrator", "figma", "blender", "unity", "unreal", "afterfx", "premiere", "davinci", "audition", "gimp", "krita"}},
	}
}

// ---------- 纯函数：规则匹配（便于单测） ----------

// normalizeApp 统一应用名："C:\...\Code.EXE" → "code"。
func normalizeApp(app string) string {
	a := strings.TrimSpace(strings.ToLower(app))
	// 只留文件名部分（Windows 路径分隔）
	if i := strings.LastIndexAny(a, `\/`); i >= 0 {
		a = a[i+1:]
	}
	return strings.TrimSuffix(a, ".exe")
}

func containsFold(list []string, s string) bool {
	for _, p := range list {
		if p == "" {
			continue
		}
		if strings.Contains(strings.ToLower(s), strings.ToLower(p)) {
			return true
		}
	}
	return false
}

// Classify 按当前规则给 (app, title) 归类；都不命中返回「其他」。
// 纯函数，无锁无 IO —— 分类规则改了，历史统计立即跟着变。
func Classify(app, title string, rules []CategoryRule) (parent, category string) {
	a := normalizeApp(app)
	for _, r := range rules {
		if containsFold(r.AppPatterns, a) || containsFold(r.TitlePatterns, title) {
			return r.Parent, r.Category
		}
	}
	return "其他", "其他"
}

// IsPrivate 隐私过滤：命中任一规则返回 true（该采样不落库）。
func IsPrivate(app, title string, rules []PrivacyRule) bool {
	a := normalizeApp(app)
	for _, r := range rules {
		switch r.Kind {
		case "app":
			if r.Pattern != "" && strings.Contains(a, strings.ToLower(r.Pattern)) {
				return true
			}
		case "title":
			if r.Pattern != "" && strings.Contains(strings.ToLower(title), strings.ToLower(r.Pattern)) {
				return true
			}
		}
	}
	return false
}

// inWorkHours 判断 now 是否在工作时段内。
// 支持跨零点（如 22:00-06:00）；解析失败的时段视为全天开放，不阻塞采集。
func inWorkHours(now time.Time, start, end string) bool {
	sh, sm, ok1 := parseHM(start)
	eh, em, ok2 := parseHM(end)
	if !ok1 || !ok2 {
		return true
	}
	cur := now.Hour()*60 + now.Minute()
	s := sh*60 + sm
	e := eh*60 + em
	if s == e {
		return true // 零长度时段视为不限制
	}
	if s < e {
		return cur >= s && cur < e
	}
	// 跨零点：22:00-06:00 → cur>=22:00 或 cur<06:00
	return cur >= s || cur < e
}

func parseHM(s string) (int, int, bool) {
	s = strings.TrimSpace(s)
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	h, m := 0, 0
	for i, p := range parts {
		n := 0
		if len(p) == 0 || len(p) > 2 {
			return 0, 0, false
		}
		for _, ch := range p {
			if ch < '0' || ch > '9' {
				return 0, 0, false
			}
			n = n*10 + int(ch-'0')
		}
		if i == 0 {
			h = n
		} else {
			m = n
		}
	}
	if h > 23 || m > 59 {
		return 0, 0, false
	}
	return h, m, true
}

// ---------- 设置存储（对齐 config.Store 的原子替换风格） ----------

type settingsStore struct {
	mu   sync.RWMutex
	path string
	s    Settings
}

func openSettings(dir string) *settingsStore {
	st := &settingsStore{path: joinPath(dir, "activity.json"), s: DefaultSettings()}
	st.load()
	return st
}

func (st *settingsStore) load() {
	raw, err := readFile(st.path)
	if err != nil {
		return // 首次运行：用默认值，首次 Get 后会落盘
	}
	var s Settings
	if err := unmarshalJSON(raw, &s); err != nil {
		return // 文件损坏：宁可回默认也别起不来
	}
	s.sanitize()
	st.s = s
}

func (st *settingsStore) Get() Settings {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := st.s // 切片字段共享底层数组，调用方只读；写走 Update
	return out
}

// Update 原子替换设置。fn 返回错误则不落盘不生效。
func (st *settingsStore) Update(fn func(*Settings)) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	next := st.s
	fn(&next)
	next.sanitize()
	if err := writeAtomic(st.path, next); err != nil {
		return err
	}
	st.s = next
	return nil
}
