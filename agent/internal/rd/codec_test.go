package rd

import (
	"bytes"
	"image/jpeg"
	"testing"
)

// makeFrame 构造一帧合成像素（w×h 的 BGRA，随 fill 值变化）。
func makeFrame(w, h int, fill byte) Frame {
	f := Frame{RGBA: make([]byte, w*h*4), W: w, H: h, Stride: w * 4}
	for i := 0; i < len(f.RGBA); i += 4 {
		f.RGBA[i] = fill
		f.RGBA[i+1] = fill
		f.RGBA[i+2] = fill
		f.RGBA[i+3] = 255
	}
	return f
}

// frameHash：同画面同哈希、变化画面不同哈希。
func TestFrameHash(t *testing.T) {
	a := makeFrame(64, 48, 10)
	b := makeFrame(64, 48, 10)
	if frameHash(a) != frameHash(b) {
		t.Fatal("相同画面哈希应一致")
	}
	// 变化打在采样网格上（y=0 行、x=3 像素 = 字节偏移 12）；
	// 采样哈希对网格外的稀疏变化确实会漏检（设计接受，代价是 1fps 延迟）。
	b.RGBA[12] = 99
	if frameHash(a) == frameHash(b) {
		t.Fatal("采样点上的画面变化哈希应不同")
	}
	// 尺寸不同（内容相同）也必须不同哈希
	c := makeFrame(64, 47, 10)
	if frameHash(a) == frameHash(c) {
		t.Fatal("尺寸不同哈希应不同")
	}
}

// shouldSkip：尺寸+哈希双条件。
func TestShouldSkip(t *testing.T) {
	if !shouldSkip(123, 123, 100, 100) {
		t.Fatal("同哈希同长度应跳帧")
	}
	if shouldSkip(123, 124, 100, 100) {
		t.Fatal("哈希不同不应跳帧")
	}
	if shouldSkip(123, 123, 100, 200) {
		t.Fatal("长度不同不应跳帧（防御：哈希碰撞兜底）")
	}
}

// encodeJPEG：BGRA → JPEG 往返，尺寸保持、内容非平凡。
func TestEncodeJPEGRoundtrip(t *testing.T) {
	w, h := 320, 240
	f := Frame{RGBA: make([]byte, w*h*4), W: w, H: h, Stride: w * 4}
	for i := 0; i < len(f.RGBA); i += 4 {
		v := byte((i / 4) % 251)
		f.RGBA[i] = v
		f.RGBA[i+1] = v / 2
		f.RGBA[i+2] = 255 - v
		f.RGBA[i+3] = 255
	}
	j, err := encodeJPEG(f, 60)
	if err != nil {
		t.Fatalf("编码失败: %v", err)
	}
	if len(j) < 500 {
		t.Fatalf("JPEG 太小（%dB），内容可能非预期", len(j))
	}
	img, err := jpeg.Decode(bytes.NewReader(j))
	if err != nil {
		t.Fatalf("JPEG 解码失败: %v", err)
	}
	if img.Bounds().Dx() != w || img.Bounds().Dy() != h {
		t.Fatalf("尺寸不符: %v", img.Bounds())
	}
	// BGRA→RGBA 换位抽查：jpeg 解码回 YCbCr（有损），用容差断言色相方向。
	// 原 BGRA 帧 (0,0) 像素 B=f[0], G=f[1], R=f[2]；解码后 R 应接近 f[2]。
	// At().RGBA() 返回 16-bit（0..65535），先折回 8-bit 再与源像素比（容差内）。
	r8, _, _, _ := img.At(0, 0).RGBA()
	got := [3]byte{byte(r8 >> 8), byte(r8 >> 16 >> 8), byte(r8 >> 24 >> 8)}
	tr, tg, tb := f.RGBA[2], f.RGBA[1], f.RGBA[0]
	tol := func(a, b byte) bool { d := int16(a) - int16(b); if d < 0 { d = -d }; return d < 48 }
	if !tol(got[0], tr) || !tol(got[1], tg) || !tol(got[2], tb) {
		t.Fatalf("BGRA→RGBA 换位疑似错误: got RGB(%d,%d,%d) want≈(%d,%d,%d)",
			got[0], got[1], got[2], tr, tg, tb)
	}
}

// 质量参数：低质量帧显著小于高质量帧（带宽自适应的物质基础）。
func TestEncodeJPEGQualitySizes(t *testing.T) {
	f := makeFrame(1280, 720, 77)
	small, _ := encodeJPEG(f, 30)
	big, _ := encodeJPEG(f, 90)
	if len(small) >= len(big) {
		t.Fatalf("q30 (%dB) 应明显小于 q90 (%dB)", len(small), len(big))
	}
}
