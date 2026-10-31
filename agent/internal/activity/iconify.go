package activity

// 在线图标回退：本地没缓存的应用，从 iconify 的 simple-icons 集合拉单色品牌 SVG。
//
// 链路（GET /activity/appicon 的后半段）：
//   内存/磁盘缓存 → slug 匹配 → 在线拉取 → 落盘转存 → 返回
//
// 安全与边界（Owner 要求的口径）：
//   - 只对图标端点生效；SVG 原样转发，不执行任何下载内容
//   - 外网仅 api.iconify.design 一个域、仅 GET、3s 超时
//   - 失败负缓存 10 分钟，避免每个前端请求都打外网
//   - slug 没命中不发请求（纯内存匹配）

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// onlineNegativeTTL 在线拉取失败的负缓存时长。
const onlineNegativeTTL = 10 * time.Minute

const iconifyURL = "https://api.iconify.design/simple-icons/%s.svg"

// iconHTTP 在线拉取专用客户端：3s 超时，失败就走负缓存。
var iconHTTP = &http.Client{Timeout: 3 * time.Second}

// iconFetch 可注入的拉取函数：测试用桩替换，不打真外网。
var iconFetch = func(url string) ([]byte, error) {
	resp, err := iconHTTP.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("iconify 返回 %d", resp.StatusCode)
	}
	const maxSVG = 512 << 10 // SVG 都很小，512KB 上限防异常响应
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSVG))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("空响应")
	}
	return data, nil
}

// slugEntry 应用名 → simple-icons slug。
//
// Key 是 normalizeApp 后应用名的**子串**（Contains 匹配）；
// 切片顺序即优先级——更具体的键放前面（"visualstudiocode" 必须在 "code" 之前，
// 否则 vscode 会先被 "code" 吃掉）。
// slug 拼错只会让 iconify 返回 404 → 走负缓存 → 前端首字母块降级，无副作用；
// 所以这里只收录高置信度的 slug，不确定的宁可不给。
type slugEntry struct {
	Key  string
	Slug string
}

// slugTable 内置映射（顺序敏感，具体在前、宽泛在后）。
func slugTable() []slugEntry {
	return []slugEntry{
		// 浏览器（具体键在前）
		{Key: "googlechrome", Slug: "googlechrome"},
		{Key: "msedge", Slug: "microsoftedge"},
		{Key: "microsoft edge", Slug: "microsoftedge"},
		{Key: "brave", Slug: "brave"},
		{Key: "vivaldi", Slug: "vivaldi"},
		{Key: "opera", Slug: "opera"},
		{Key: "firefox", Slug: "firefoxbrowser"},
		{Key: "safari", Slug: "safari"},
		{Key: "360se", Slug: "googlechrome"},
		{Key: "360chrome", Slug: "googlechrome"},
		{Key: "chrome", Slug: "googlechrome"},
		// 开发
		{Key: "visualstudiocode", Slug: "visualstudiocode"},
		{Key: "goland", Slug: "goland"},
		{Key: "pycharm", Slug: "pycharm"},
		{Key: "webstorm", Slug: "webstorm"},
		{Key: "intellij", Slug: "intellijidea"},
		{Key: "devenv", Slug: "visualstudio"},
		{Key: "visual studio", Slug: "visualstudio"},
		{Key: "cursor", Slug: "cursor"},
		// VS Code 的进程名就是 "code"——必须放在浏览器键之后（不影响 chrome 等），
		// 且它自身比 "codeblocks" 这类应用更常见，值得占一个宽泛子串键
		{Key: "code", Slug: "visualstudiocode"},
		{Key: "windowsterminal", Slug: "windowsterminal"},
		{Key: "docker", Slug: "docker"},
		{Key: "postman", Slug: "postman"},
		// 办公 / 笔记
		{Key: "notion", Slug: "notion"},
		{Key: "obsidian", Slug: "obsidian"},
		{Key: "winword", Slug: "microsoftword"},
		{Key: "excel", Slug: "microsoftexcel"},
		{Key: "powerpnt", Slug: "microsoftpowerpoint"},
		{Key: "outlook", Slug: "microsoftoutlook"},
		{Key: "onenote", Slug: "microsoftonenote"},
		// 沟通
		{Key: "wechat", Slug: "wechat"},
		{Key: "weixin", Slug: "wechat"},
		{Key: "dingtalk", Slug: "dingtalk"},
		{Key: "feishu", Slug: "larksuite"},
		{Key: "lark", Slug: "larksuite"},
		{Key: "teams", Slug: "microsoftteams"},
		{Key: "slack", Slug: "slack"},
		{Key: "telegram", Slug: "telegram"},
		{Key: "discord", Slug: "discord"},
		{Key: "whatsapp", Slug: "whatsapp"},
		{Key: "qq", Slug: "tencentqq"},
		// 影音
		{Key: "spotify", Slug: "spotify"},
		{Key: "cloudmusic", Slug: "neteasecloudmusic"},
		{Key: "bilibili", Slug: "bilibili"},
		{Key: "youtube", Slug: "youtube"},
		{Key: "vlc", Slug: "vlc"},
		{Key: "netflix", Slug: "netflix"},
		// 设计 / 工具
		{Key: "figma", Slug: "figma"},
		{Key: "photoshop", Slug: "adobephotoshop"},
		{Key: "illustrator", Slug: "adobeillustrator"},
		{Key: "blender", Slug: "blender"},
		{Key: "unity", Slug: "unity"},
		{Key: "gimp", Slug: "gimp"},
		// 游戏
		{Key: "steam", Slug: "steam"},
		{Key: "epicgameslauncher", Slug: "epicgames"},
		{Key: "minecraft", Slug: "minecraft"},
	}
}

// matchSlug 纯函数：应用名 → slug（未命中返回空串）。
// 大小写不敏感的子串匹配，表序即优先级。
func matchSlug(app string) string {
	a := strings.ToLower(app)
	if a == "" {
		return ""
	}
	for _, e := range slugTable() {
		if e.Key == "" {
			continue
		}
		if strings.Contains(a, e.Key) {
			return e.Slug
		}
	}
	return ""
}

var (
	onlineMu      sync.Mutex
	onlineFailed  = map[string]time.Time{} // 应用 → 上次在线拉取失败时刻
	onlinePending = map[string]bool{}
)

// onlineFailedRecently 10 分钟内失败过 → 本次直接 miss，不打外网。
func onlineFailedRecently(app string) bool {
	onlineMu.Lock()
	defer onlineMu.Unlock()
	at, ok := onlineFailed[app]
	return ok && time.Since(at) < onlineNegativeTTL
}

func markOnlineFailed(app string) {
	onlineMu.Lock()
	onlineFailed[app] = time.Now()
	onlineMu.Unlock()
}

// fetchOnlineIcon 带单飞的在线拉取：并发的同名请求只发一次外网，
// 其余直接 miss（下一个 TTL 周期或缓存写入后自然命中）。
func fetchOnlineIcon(app, slug string) ([]byte, bool) {
	onlineMu.Lock()
	if onlinePending[app] {
		onlineMu.Unlock()
		return nil, false
	}
	onlinePending[app] = true
	onlineMu.Unlock()

	defer func() {
		onlineMu.Lock()
		delete(onlinePending, app)
		onlineMu.Unlock()
	}()

	data, err := iconFetch(fmt.Sprintf(iconifyURL, slug))
	if err != nil || len(data) == 0 {
		markOnlineFailed(app)
		return nil, false
	}
	persistIcon(app, data, "image/svg+xml")
	return data, true
}
