package rd

import (
	"encoding/json"
	"fmt"
	"math"
	"time"
)

// 输入帧（viewer → agent 的 JSON 文本帧，B 节契约字段一字不改）。
//
//	{t:"m", x:0.5, y:0.3, b:"l"|"r"|"m", a:"move"|"down"|"up"|"dbl"}  鼠标（x/y 为相对主屏 0..1）
//	{t:"w", dy:1}                                                     滚轮（dy 正=向上）
//	{t:"k", code:65, mods:["ctrl","shift"], down:true}                键盘（code 为 Windows VK）
//	{t:"txt", text:"字"}                                              文本输入（KEYEVENTF_UNICODE）
//	{t:"q", quality:70} / {t:"fps", fps:10}                           画质 / 帧率
//	{t:"hello", name:"…", os:"…"} / {t:"bye"} / {t:"ping"}            控制帧
type InputEvent struct {
	Kind   string // mouse | scroll | key | text
	X, Y   float64
	Button string // l | r | m
	Action string // move | down | up | dbl
	Dy     int
	Code   int
	Mods   []string
	Down   bool
	Text   string
}

// controlFrame viewer 发来的控制/参数帧（非输入注入）。
type controlFrame struct {
	T       string `json:"t"`
	Name    string `json:"name,omitempty"`
	OS      string `json:"os,omitempty"`
	Quality int    `json:"quality,omitempty"`
	FPS     int    `json:"fps,omitempty"`
}

// busyFrame 第二连接收到的占位响应。
type busyFrame struct {
	Type string `json:"type"` // "busy"
}

// helloFrame agent 在会话建立后回给 viewer 的确认帧（指示条来源 + 主屏尺寸，
// viewer 可据此做坐标换算的自检；字段超出契约部分为附加信息，B 节允许）。
type helloFrame struct {
	T    string `json:"t"` // "hello"
	Name string `json:"name,omitempty"`
	OS   string `json:"os,omitempty"`
	W    int    `json:"w,omitempty"`
	H    int    `json:"h,omitempty"`
}

// parseInputFrame 把 viewer 的 JSON 文本帧解析成输入事件。
// 输入帧（m/w/k/txt）与控制帧（q/fps/bye/ping/hello）都在这里识别；
// 返回 (event, control, isInput, error)。
func parseInputFrame(data []byte) (InputEvent, controlFrame, bool, error) {
	var raw struct {
		T      string   `json:"t"`
		X      *float64 `json:"x"`
		Y      *float64 `json:"y"`
		B      string   `json:"b"`
		A      string   `json:"a"`
		Dy     *int     `json:"dy"`
		Code   *int     `json:"code"`
		Mods   []string `json:"mods"`
		Down   *bool    `json:"down"`
		Text   string   `json:"text"`
		Quality int     `json:"quality"`
		FPS    int      `json:"fps"`
		Name   string   `json:"name"`
		OS     string   `json:"os"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return InputEvent{}, controlFrame{}, false, fmt.Errorf("bad json: %w", err)
	}
	switch raw.T {
	case "m":
		ev := InputEvent{Kind: "mouse", Button: raw.B, Action: raw.A}
		if raw.X == nil || raw.Y == nil {
			return ev, controlFrame{}, false, fmt.Errorf("m 帧缺 x/y")
		}
		ev.X, ev.Y = *raw.X, *raw.Y
		switch ev.Button {
		case "l", "r", "m":
		default:
			return ev, controlFrame{}, false, fmt.Errorf("非法按键 %q", ev.Button)
		}
		switch ev.Action {
		case "move", "down", "up", "dbl":
		default:
			return ev, controlFrame{}, false, fmt.Errorf("非法动作 %q", ev.Action)
		}
		return ev, controlFrame{}, true, nil
	case "w":
		if raw.Dy == nil {
			return InputEvent{}, controlFrame{}, false, fmt.Errorf("w 帧缺 dy")
		}
		return InputEvent{Kind: "scroll", Dy: *raw.Dy}, controlFrame{}, true, nil
	case "k":
		if raw.Code == nil || raw.Down == nil {
			return InputEvent{}, controlFrame{}, false, fmt.Errorf("k 帧缺 code/down")
		}
		for _, m := range raw.Mods {
			switch m {
			case "ctrl", "shift", "alt", "win":
			default:
				return InputEvent{}, controlFrame{}, false, fmt.Errorf("非法修饰键 %q", m)
			}
		}
		return InputEvent{Kind: "key", Code: *raw.Code, Mods: raw.Mods, Down: *raw.Down}, controlFrame{}, true, nil
	case "txt":
		if raw.Text == "" {
			return InputEvent{}, controlFrame{}, false, fmt.Errorf("txt 帧为空")
		}
		return InputEvent{Kind: "text", Text: raw.Text}, controlFrame{}, true, nil
	case "q", "fps", "hello", "bye", "ping":
		return InputEvent{}, controlFrame{T: raw.T, Name: raw.Name, OS: raw.OS, Quality: raw.Quality, FPS: raw.FPS}, false, nil
	}
	return InputEvent{}, controlFrame{}, false, fmt.Errorf("未知帧类型 %q", raw.T)
}

// mapPoint 归一化坐标 (0..1) → 主屏像素坐标。
//
// viewer 端只做展示层映射（它看到的是完整画面，帧即屏幕原始分辨率），
// agent 拿归一化值乘真实分辨率——帧率/窗口大小变化都不需要 agent 感知。
// 越界值钳到屏幕内（viewer 端四舍五入可能给出 1.0000001）。
func mapPoint(x, y float64, w, h int) (int, int) {
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	px := int(math.Round(clamp01(x) * float64(w)))
	py := int(math.Round(clamp01(y) * float64(h)))
	if px >= w {
		px = w - 1
	}
	if py >= h {
		py = h - 1
	}
	if px < 0 {
		px = 0
	}
	if py < 0 {
		py = 0
	}
	return px, py
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// clampQuality 画质钳制：契约 30–90，默认 60。
func clampQuality(q int) int {
	if q == 0 {
		return 60
	}
	if q < 30 {
		return 30
	}
	if q > 90 {
		return 90
	}
	return q
}

// frameInterval 自适应帧间隔。
//
// 有输入（2s 内）→ 10fps；静止 → 1fps；viewer 显式设了 fps → 以 viewer 为准
//（上限 30fps，下限 1fps——viewer 想省流量可以设 1）。
func frameInterval(lastInputAt, now time.Time, viewerFPS int) time.Duration {
	interval := time.Second
	if now.Sub(lastInputAt) < 2*time.Second {
		interval = 100 * time.Millisecond
	}
	if viewerFPS > 0 {
		fps := viewerFPS
		if fps > 30 {
			fps = 30
		}
		if fps < 1 {
			fps = 1
		}
		interval = time.Duration(float64(time.Second) / float64(fps))
	}
	return interval
}
