package rd

import (
	"testing"
	"time"
)

// parseInputFrame：契约字段一字不改的守卫。
func TestParseInputFrame(t *testing.T) {
	cases := []struct {
		name    string
		json    string
		wantErr bool
		isInput bool
		check   func(InputEvent, controlFrame) error
	}{
		{
			name:    "鼠标 move",
			json:    `{"t":"m","x":0.5,"y":0.3,"b":"l","a":"move"}`,
			isInput: true,
			check: func(ev InputEvent, _ controlFrame) error {
				if ev.X != 0.5 || ev.Y != 0.3 || ev.Button != "l" || ev.Action != "move" {
					t.Fatalf("move 字段不符: %+v", ev)
				}
				return nil
			},
		},
		{
			name:    "鼠标双击右键",
			json:    `{"t":"m","x":0.1,"y":0.9,"b":"r","a":"dbl"}`,
			isInput: true,
			check: func(ev InputEvent, _ controlFrame) error {
				if ev.Button != "r" || ev.Action != "dbl" {
					t.Fatalf("dbl/r 字段不符: %+v", ev)
				}
				return nil
			},
		},
		{
			name:    "滚轮（正=向上）",
			json:    `{"t":"w","dy":3}`,
			isInput: true,
			check: func(ev InputEvent, _ controlFrame) error {
				if ev.Dy != 3 || ev.Kind != "scroll" {
					t.Fatalf("w 字段不符: %+v", ev)
				}
				return nil
			},
		},
		{
			name:    "键盘 + 修饰键",
			json:    `{"t":"k","code":65,"mods":["ctrl","shift"],"down":true}`,
			isInput: true,
			check: func(ev InputEvent, _ controlFrame) error {
				if ev.Code != 65 || ev.Down != true || len(ev.Mods) != 2 {
					t.Fatalf("k 字段不符: %+v", ev)
				}
				return nil
			},
		},
		{
			name:    "文本",
			json:    `{"t":"txt","text":"你好"}`,
			isInput: true,
			check: func(ev InputEvent, _ controlFrame) error {
				if ev.Text != "你好" {
					t.Fatalf("txt 字段不符: %+v", ev)
				}
				return nil
			},
		},
		{
			name:    "画质帧",
			json:    `{"t":"q","quality":75}`,
			isInput: false,
			check: func(_ InputEvent, c controlFrame) error {
				if c.T != "q" || c.Quality != 75 {
					t.Fatalf("q 字段不符: %+v", c)
				}
				return nil
			},
		},
		{
			name:    "hello",
			json:    `{"t":"hello","name":"我的手机","os":"android"}`,
			isInput: false,
			check: func(_ InputEvent, c controlFrame) error {
				if c.Name != "我的手机" || c.OS != "android" {
					t.Fatalf("hello 字段不符: %+v", c)
				}
				return nil
			},
		},
		{name: "未知类型", json: `{"t":"zzz"}`, wantErr: true},
		{name: "鼠标缺 x", json: `{"t":"m","y":0.5}`, wantErr: true},
		{name: "非法按键", json: `{"t":"m","x":0.1,"y":0.1,"b":"x","a":"down"}`, wantErr: true},
		{name: "非法修饰键", json: `{"t":"k","code":1,"mods":["super"],"down":true}`, wantErr: true},
		{name: "坏 JSON", json: `{`, wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ev, ctrl, isInput, err := parseInputFrame([]byte(c.json))
			if (err != nil) != c.wantErr {
				t.Fatalf("err=%v wantErr=%v", err, c.wantErr)
			}
			if c.wantErr {
				return
			}
			if isInput != c.isInput {
				t.Fatalf("isInput=%v want %v", isInput, c.isInput)
			}
			if c.check != nil {
				if err := c.check(ev, ctrl); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

// mapPoint：归一化 → 像素，含钳制。越界值来自 viewer 端浮点四舍五入。
func TestMapPointClamp(t *testing.T) {
	cases := []struct {
		x, y     float64
		w, h     int
		wantX, wantY int
	}{
		{0, 0, 1920, 1080, 0, 0},
		{1, 1, 1920, 1080, 1919, 1079},   // 右下钳到屏内
		{0.5, 0.5, 1920, 1080, 960, 540}, // 中点
		{-0.2, 1.5, 1920, 1080, 0, 1079}, // 越界钳制
		{1.0000001, 0, 1920, 1080, 1919, 0},
		{0.5, 0.5, 0, 0, 0, 0}, // 非法尺寸不 panic
	}
	for _, c := range cases {
		gx, gy := mapPoint(c.x, c.y, c.w, c.h)
		if gx != c.wantX || gy != c.wantY {
			t.Fatalf("mapPoint(%v,%v,%v,%v) = (%v,%v), want (%v,%v)",
				c.x, c.y, c.w, c.h, gx, gy, c.wantX, c.wantY)
		}
	}
}

// clampQuality：契约 30–90，默认 60。
func TestClampQuality(t *testing.T) {
	cases := map[int]int{0: 60, 60: 60, 30: 30, 90: 90, 10: 30, 95: 90}
	for in, want := range cases {
		if got := clampQuality(in); got != want {
			t.Fatalf("clampQuality(%d) = %d, want %d", in, got, want)
		}
	}
}

// frameInterval：自适应三态 + viewer 覆盖 + 上限。
func TestFrameInterval(t *testing.T) {
	now := time.Now()
	if got := frameInterval(now.Add(-5*time.Second), now, 0); got != time.Second {
		t.Fatalf("静止应为 1fps，得 %v", got)
	}
	if got := frameInterval(now.Add(-500*time.Millisecond), now, 0); got != 100*time.Millisecond {
		t.Fatalf("有输入应为 10fps，得 %v", got)
	}
	if got := frameInterval(now.Add(-500*time.Millisecond), now, 5); got != 200*time.Millisecond {
		t.Fatalf("viewer fps=5 应为 200ms，得 %v", got)
	}
	if got := frameInterval(now.Add(-500*time.Millisecond), now, 60); got > 34*time.Millisecond {
		t.Fatalf("viewer fps 超 30 应被钳到 30fps，得 %v", got)
	}
	if got := frameInterval(now, now, 0); got != 100*time.Millisecond {
		t.Fatalf("刚有输入应为 10fps，得 %v", got)
	}
}
