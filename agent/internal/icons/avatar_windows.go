//go:build windows

package icons

import (
	"os"
	"path/filepath"
)

// AccountAvatar 尝试读取当前 Windows 用户的账户头像。
//
// 为什么要这个：设备列表/详情页原本用被控端 exe 的图标当 logo，
// 但那只是「软件长什么样」，不是「这台机器/这个人是谁」。
// 用户明确要求用系统账户头像当设备头像。
//
// Windows 的账户头像有两个来源，按优先级：
//  1. %ProgramData%\Microsoft\User Account Pictures\<用户名>.dat
//     —— 用户自己设置过头像时才会存在，内容可能是 PNG/JPEG/BMP 原始字节，
//     也可能带 .dat 容器头（Windows 8+ 常见）。
//  2. 同目录下的 user-192.png / user-32.png
//     —— 系统默认头像（未设置头像时的占位图）。
//
// 返回 (数据, MIME, 是否真实账户头像)。读不到就返回 nil。
func AccountAvatar() ([]byte, string, bool) {
	user := os.Getenv("USERNAME")
	if user == "" {
		return nil, "", false
	}

	dir := filepath.Join(os.Getenv("ProgramData"), "Microsoft", "User Account Pictures")

	// 1) 真实账户头像：<用户名>.dat
	//    大小 > 0 才算数 —— 实测未设置头像时这个文件是 0 字节。
	datPath := filepath.Join(dir, user+".dat")
	if st, err := os.Stat(datPath); err == nil && st.Size() > 0 {
		if raw, err := os.ReadFile(datPath); err == nil {
			if data, mime := normalizeImage(raw); len(data) > 0 {
				return data, mime, true
			}
		}
	}

	// 2) 系统默认头像（user-192 优先，尺寸更大更清晰）
	for _, name := range []string{"user-192.png", "user.png", "user-40.png", "user-32.png"} {
		p := filepath.Join(dir, name)
		if st, err := os.Stat(p); err == nil && st.Size() > 0 {
			if raw, err := os.ReadFile(p); err == nil {
				if data, mime := normalizeImage(raw); len(data) > 0 {
					// 默认头像：第三个返回值 false，调用方可据此决定是否再兜底到 exe 图标
					return data, mime, false
				}
			}
		}
	}

	return nil, "", false
}

// normalizeImage 判断字节流的图片格式；.dat 容器会先剥掉非图片前缀。
//
// 为什么需要剥前缀：Windows 有时在 .dat 前面写一小段头（非标准容器），
// 直接当图片返回浏览器会解码失败。这里按魔数找真正的起始位置。
func normalizeImage(raw []byte) ([]byte, string) {
	if len(raw) < 8 {
		return nil, ""
	}
	// 直接就是图片
	if data, mime := sniff(raw); len(data) > 0 {
		return data, mime
	}
	// 在前 512 字节里找 PNG / JPEG 的魔数起点
	limit := 512
	if len(raw) < limit {
		limit = len(raw)
	}
	for i := 0; i < limit; i++ {
		if data, mime := sniff(raw[i:]); len(data) > 0 {
			return data, mime
		}
	}
	return nil, ""
}

// sniff 按魔数识别 PNG / JPEG / BMP，返回完整数据与 MIME。
func sniff(b []byte) ([]byte, string) {
	if len(b) < 8 {
		return nil, ""
	}
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 {
		return b, "image/png"
	}
	// JPEG: FF D8 FF
	if b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF {
		return b, "image/jpeg"
	}
	// BMP: 42 4D
	if b[0] == 0x42 && b[1] == 0x4D {
		return b, "image/bmp"
	}
	return nil, ""
}
