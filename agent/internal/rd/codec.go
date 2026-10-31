package rd

import (
	"bytes"
	"hash/fnv"
	"image"
	"image/jpeg"
)

// encodeJPEG 把原始像素帧编成 JPEG（质量由调用方钳制，见 clampQuality）。
//
// DIB 抓出来的是 BGRA 顶向下像素（见 backend_windows.go 的抓帧），这里统一
// 换成 RGBA 再编码——image/jpeg 需要 RGBA/ YCbCr。
func encodeJPEG(f Frame, quality int) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, f.W, f.H))
	for y := 0; y < f.H; y++ {
		src := f.RGBA[y*f.Stride : y*f.Stride+f.W*4]
		dst := img.Pix[y*img.Stride : y*img.Stride+f.W*4]
		for x := 0; x < f.W*4; x += 4 {
			dst[x+0] = src[x+2] // B -> R 位置（DIB 是 BGRA）
			dst[x+1] = src[x+1]
			dst[x+2] = src[x+0]
			dst[x+3] = src[x+3]
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// frameHash 尺寸 + 采样哈希：跳帧判定的依据。
//
// 全帧哈希 1080p 每帧 ~2MB 字节遍历，CPU 占用不可忽略；采样按行跳读
//（每 7 行取 1 行、行内每 3 像素取 1 个）足以检测到绝大多数画面变化，
// 文字/滚动场景漏检的代价只是一帧 1fps 的延迟，可接受。
func frameHash(f Frame) uint64 {
	h := fnv.New64a()
	var scratch [8]byte
	writeWord := func(v uint32) {
		scratch[0] = byte(v)
		scratch[1] = byte(v >> 8)
		scratch[2] = byte(v >> 16)
		scratch[3] = byte(v >> 24)
		h.Write(scratch[:4])
	}
	writeWord(uint32(f.W))
	writeWord(uint32(f.H))
	rowStep, pxStep := 7, 3
	for y := 0; y < f.H; y += rowStep {
		row := f.RGBA[y*f.Stride : y*f.Stride+f.W*4]
		for x := 0; x < f.W; x += pxStep {
			o := x * 4
			if o+3 < len(row) {
				writeWord(uint32(row[o]) | uint32(row[o+1])<<8 | uint32(row[o+2])<<16 | uint32(row[o+3])<<24)
			}
		}
	}
	return h.Sum64()
}

// shouldSkip 跳帧判定：尺寸与采样哈希都相同 → 画面没变，不发。
func shouldSkip(prevHash, curHash uint64, prevLen, curLen int) bool {
	return prevHash == curHash && prevLen == curLen
}
