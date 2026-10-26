//go:build windows

package icons

import (
	"debug/pe"
	"encoding/binary"
	"fmt"
	"os"
	"sort"
)

// PE 资源类型（winuser.h 里的 RT_*）
const (
	rtIcon      = 3  // 单个图标的图像数据（DIB 或内嵌 PNG）
	rtGroupIcon = 14 // 图标组：描述「这个 exe 有哪几个尺寸、分别对应哪个 RT_ICON id」

	// 资源目录项里最高位是「是否指向子目录」的标志
	dirFlag = 0x80000000

	// 资源段读取上限：正常 exe 的资源段只有几十 KB，超过就说明不对劲，不解析。
	maxRsrc = 64 << 20
	// 单个图标图像上限：256×256 的 PNG 也就几十 KB
	maxIcon = 8 << 20
)

// extractIcon 解析 PE 的 .rsrc 段，取尺寸最大的那个图标，拼成单条目 .ico。
func extractIcon(exePath string) ([]byte, string, error) {
	f, err := os.Open(exePath)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	pf, err := pe.NewFile(f)
	if err != nil {
		return nil, "", fmt.Errorf("不是 PE 可执行文件：%w", err)
	}
	defer pf.Close()

	dirRVA, err := resourceDirRVA(pf)
	if err != nil {
		return nil, "", err
	}
	res, err := readResourceSection(pf, dirRVA)
	if err != nil {
		return nil, "", err
	}

	root := res.view(dirRVA) // 所有目录偏移都以资源目录起点为基准
	if root == nil {
		return nil, "", ErrNoIcon
	}

	// RT_ICON 的图像数据按数字 ID 建表（组里就是按 ID 引用它们的）
	// RT_GROUP_ICON 则把所有项都当候选：有的 exe（例如 cmd.exe）把图标组挂在名字上。
	images := res.payloads(root, rtIcon)
	groupBlobs := res.walkType(root, rtGroupIcon)

	type candidate struct {
		area    int
		entry   grpEntry
		payload []byte
	}
	var cands []candidate

	for _, gb := range groupBlobs {
		for _, e := range parseGroup(gb.data) {
			payload, ok := images[uint32(e.id)]
			if !ok || !looksLikeImage(payload) {
				continue
			}
			w, h := int(e.width), int(e.height)
			// ICO/GRPICONDIR 里宽高 0 表示 256
			if w == 0 {
				w = 256
			}
			if h == 0 {
				h = 256
			}
			cands = append(cands, candidate{area: w * h, entry: e, payload: payload})
		}
	}
	if len(cands) == 0 {
		return nil, "", ErrNoIcon
	}

	// 取像素面积最大的那张；同尺寸时取体积更大的（色深更高/细节更多），
	// 剩下的顺序按资源表原序，保证每次结果一致。
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].area != cands[j].area {
			return cands[i].area > cands[j].area
		}
		return len(cands[i].payload) > len(cands[j].payload)
	})
	best := cands[0]
	return buildICO(best.entry, best.payload), MimeICO, nil
}

// ---------- PE 结构 ----------

func resourceDirRVA(f *pe.File) (uint32, error) {
	const resIndex = 2 // IMAGE_DIRECTORY_ENTRY_RESOURCE
	switch oh := f.OptionalHeader.(type) {
	case *pe.OptionalHeader32:
		if len(oh.DataDirectory) > resIndex && oh.DataDirectory[resIndex].VirtualAddress != 0 {
			return oh.DataDirectory[resIndex].VirtualAddress, nil
		}
	case *pe.OptionalHeader64:
		if len(oh.DataDirectory) > resIndex && oh.DataDirectory[resIndex].VirtualAddress != 0 {
			return oh.DataDirectory[resIndex].VirtualAddress, nil
		}
	}
	return 0, ErrNoIcon
}

// resSection 资源段的原始字节 + 段起始 RVA。
// 段内所有偏移都以「资源目录 RVA」为基准，靠 base 换算。
type resSection struct {
	data []byte
	base uint32
}

func readResourceSection(f *pe.File, dirRVA uint32) (resSection, error) {
	for _, s := range f.Sections {
		start := s.VirtualAddress
		end := start + s.VirtualSize
		if s.VirtualSize == 0 {
			end = start + s.Size
		}
		if dirRVA < start || dirRVA >= end {
			continue
		}
		data, err := s.Data()
		if err != nil {
			return resSection{}, fmt.Errorf("读取资源段失败：%w", err)
		}
		if len(data) > maxRsrc {
			return resSection{}, fmt.Errorf("资源段过大（%d 字节），已拒绝解析", len(data))
		}
		return resSection{data: data, base: start}, nil
	}
	return resSection{}, ErrNoIcon
}

// view 把 RVA 换成段内切片（只读，不做任何写入）。
func (r resSection) view(rva uint32) []byte {
	if rva < r.base {
		return nil
	}
	off := int(rva - r.base)
	if off < 0 || off >= len(r.data) {
		return nil
	}
	return r.data[off:]
}

type dirEntry struct {
	name   uint32 // 高位置 1 时是字符串偏移，否则就是 ID
	target uint32 // 高位置 1 时是子目录偏移，否则是数据项偏移
}

func readDirEntries(b []byte, off int) []dirEntry {
	if off < 0 || off+16 > len(b) {
		return nil
	}
	named := int(binary.LittleEndian.Uint16(b[off+12:]))
	ids := int(binary.LittleEndian.Uint16(b[off+14:]))
	n := named + ids
	if n <= 0 || n > 4096 {
		return nil
	}
	out := make([]dirEntry, 0, n)
	for i := 0; i < n; i++ {
		p := off + 16 + i*8
		if p+8 > len(b) {
			break
		}
		out = append(out, dirEntry{
			name:   binary.LittleEndian.Uint32(b[p:]),
			target: binary.LittleEndian.Uint32(b[p+4:]),
		})
	}
	return out
}

// typedBlob 一类资源里的某一项。name 高位为 1 表示这一项是「按名字」登记的。
// cmd.exe 的 RT_GROUP_ICON 就挂在名字上而不是数字 ID 上 —— 这种也必须认：
// 图标组的内容本身会写明它引用哪些 RT_ICON，不需要靠 ID 对上。
type typedBlob struct {
	name uint32
	data []byte
}

// walkType 遍历某一类资源的全部项（数字 ID 与命名项都收），每种语言取第一条。
func (r resSection) walkType(root []byte, typ uint32) []typedBlob {
	var out []typedBlob
	for _, te := range readDirEntries(root, 0) {
		if te.name&dirFlag != 0 || te.name != typ || te.target&dirFlag == 0 {
			continue
		}
		for _, ie := range readDirEntries(root, int(te.target&^dirFlag)) {
			if ie.target&dirFlag == 0 {
				if b := r.dataBlob(root, ie.target); b != nil {
					out = append(out, typedBlob{name: ie.name, data: b})
				}
				continue
			}
			for _, le := range readDirEntries(root, int(ie.target&^dirFlag)) {
				if le.target&dirFlag != 0 {
					continue
				}
				if b := r.dataBlob(root, le.target); b != nil {
					out = append(out, typedBlob{name: ie.name, data: b})
					break // 一门语言就够了
				}
			}
		}
	}
	return out
}

// payloads 取「数字 ID → 数据」的映射（RT_ICON 需要按 ID 找到组里引用的那一张）。
func (r resSection) payloads(root []byte, typ uint32) map[uint32][]byte {
	out := map[uint32][]byte{}
	for _, b := range r.walkType(root, typ) {
		if b.name&dirFlag != 0 {
			continue
		}
		out[b.name] = b.data
	}
	return out
}

// dataBlob 读 IMAGE_RESOURCE_DATA_ENTRY →（数据 RVA, 大小）→ 段内字节。
func (r resSection) dataBlob(root []byte, off uint32) []byte {
	p := int(off)
	if p < 0 || p+16 > len(root) {
		return nil
	}
	rva := binary.LittleEndian.Uint32(root[p:])
	size := binary.LittleEndian.Uint32(root[p+4:])
	if size == 0 || size > maxIcon {
		return nil
	}
	b := r.view(rva)
	if b == nil || int(size) > len(b) {
		return nil
	}
	return b[:size]
}

// ---------- GRPICONDIR ----------

type grpEntry struct {
	width, height, colorCount, reserved uint8
	planes, bitCount                    uint16
	bytesInRes                          uint32
	id                                  uint16
}

// parseGroup 解析 RT_GROUP_ICON 的内容（GRPICONDIR + N 个 14 字节的条目）。
func parseGroup(b []byte) []grpEntry {
	if len(b) < 6 {
		return nil
	}
	if binary.LittleEndian.Uint16(b[0:]) != 0 || binary.LittleEndian.Uint16(b[2:]) != 1 {
		return nil // reserved 必须 0、type 必须 1（图标）
	}
	n := int(binary.LittleEndian.Uint16(b[4:]))
	if n <= 0 || n > 64 || len(b) < 6+n*14 {
		return nil
	}
	out := make([]grpEntry, 0, n)
	for i := 0; i < n; i++ {
		p := 6 + i*14
		out = append(out, grpEntry{
			width:      b[p],
			height:     b[p+1],
			colorCount: b[p+2],
			reserved:   b[p+3],
			planes:     binary.LittleEndian.Uint16(b[p+4:]),
			bitCount:   binary.LittleEndian.Uint16(b[p+6:]),
			bytesInRes: binary.LittleEndian.Uint32(b[p+8:]),
			id:         binary.LittleEndian.Uint16(b[p+12:]),
		})
	}
	return out
}

// looksLikeImage 判断 RT_ICON 的数据是不是真图像：
// 要么是 PNG（Vista 之后 256×256 图标就用它），要么是 BITMAPINFOHEADER 开头的 DIB。
func looksLikeImage(b []byte) bool {
	if len(b) >= 8 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' {
		return true
	}
	if len(b) >= 40 {
		switch binary.LittleEndian.Uint32(b[0:]) {
		case 40, 108, 124: // BITMAPINFOHEADER / V4 / V5
			return true
		}
	}
	return false
}

// buildICO 拼一份合法的单条目 .ico：
// ICONDIR(6) + ICONDIRENTRY(16) + 图像数据。
func buildICO(e grpEntry, payload []byte) []byte {
	const headerLen = 6 + 16
	out := make([]byte, headerLen, headerLen+len(payload))
	// ICONDIR：reserved=0, type=1(icon), count=1
	out[0], out[1], out[2], out[3] = 0, 0, 1, 0
	binary.LittleEndian.PutUint16(out[4:], 1)
	// ICONDIRENTRY
	out[6], out[7], out[8], out[9] = e.width, e.height, e.colorCount, e.reserved
	binary.LittleEndian.PutUint16(out[10:], e.planes)
	binary.LittleEndian.PutUint16(out[12:], e.bitCount)
	binary.LittleEndian.PutUint32(out[14:], uint32(len(payload)))
	binary.LittleEndian.PutUint32(out[18:], headerLen) // 图像数据紧随其后
	return append(out, payload...)
}
