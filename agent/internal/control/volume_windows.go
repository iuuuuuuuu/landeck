//go:build windows

package control

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

// Windows 音量走 Core Audio 的 IAudioEndpointVolume。
// 只在 Go 侧用整数参数 + 指针出参，避开 amd64 上"按值传 float"无法用 SyscallN 表达的问题：
// 设置音量用 VolumeStepUp/Down 步进（每次 2%），读取用 GetMasterVolumeLevelScalar(指针)。

var (
	ole32              = syscall.NewLazyDLL("ole32.dll")
	procCoInit         = ole32.NewProc("CoInitializeEx")
	procCoUninit       = ole32.NewProc("CoUninitialize")
	procCoCreateInst   = ole32.NewProc("CoCreateInstance")
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

var (
	clsidMMDeviceEnumerator = guid{0xBCDE0395, 0xE52F, 0x467C, [8]byte{0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}}
	iidIMMDeviceEnumerator  = guid{0xA95664D2, 0x9614, 0x4F35, [8]byte{0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6}}
	iidIAudioEndpointVolume = guid{0x5CDF2C82, 0x841E, 0x4546, [8]byte{0x97, 0x22, 0x0C, 0xF7, 0x40, 0x78, 0x22, 0x9A}}
)

const (
	clsctxAll         = 0x17
	coinitApartment   = 0x2
	edataflowRender   = 0
	eroleConsole      = 0
)

type comVolume struct {
	req    chan volRequest
	closed chan struct{}
	once   sync.Once
}

type volRequest struct {
	op   string
	val  int
	resp chan volResponse
}

type volResponse struct {
	state VolumeState
	err   error
}

func vcall(p unsafe.Pointer, index int, args ...uintptr) uintptr {
	vtbl := *(*unsafe.Pointer)(p)
	fn := *(*uintptr)(unsafe.Add(vtbl, uintptr(index)*unsafe.Sizeof(uintptr(0))))
	ret, _, _ := syscall.SyscallN(fn, append([]uintptr{uintptr(p)}, args...)...)
	return ret
}

func hrFailed(hr uintptr) bool { return int32(uint32(hr)) < 0 }

// newCOMVolume 启动专用的 COM 线程（COM 要求同线程初始化，故用 LockOSThread + 通道）。
func newCOMVolume() (*comVolume, error) {
	v := &comVolume{req: make(chan volRequest), closed: make(chan struct{})}
	ready := make(chan error, 1)
	go v.loop(ready)
	if err := <-ready; err != nil {
		return nil, err
	}
	return v, nil
}

func (v *comVolume) loop(ready chan<- error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hr, _, _ := procCoInit.Call(0, coinitApartment)
	if hrFailed(hr) && uint32(hr) != 1 {
		ready <- fmt.Errorf("CoInitializeEx 失败: 0x%x", uint32(hr))
		return
	}
	defer procCoUninit.Call()

	var enumerator unsafe.Pointer
	hr, _, _ = procCoCreateInst.Call(
		uintptr(unsafe.Pointer(&clsidMMDeviceEnumerator)),
		0,
		clsctxAll,
		uintptr(unsafe.Pointer(&iidIMMDeviceEnumerator)),
		uintptr(unsafe.Pointer(&enumerator)),
	)
	if hrFailed(hr) || enumerator == nil {
		ready <- fmt.Errorf("创建 IMMDeviceEnumerator 失败: 0x%x", uint32(hr))
		return
	}

	// IMMDeviceEnumerator::GetDefaultAudioEndpoint (vtable 4)
	var device unsafe.Pointer
	hr = vcall(enumerator, 4, edataflowRender, eroleConsole, uintptr(unsafe.Pointer(&device)))
	if hrFailed(hr) || device == nil {
		ready <- errors.New("没有可用的默认音频输出设备")
		return
	}

	// IMMDevice::Activate (vtable 3)
	var endpoint unsafe.Pointer
	hr = vcall(device, 3,
		uintptr(unsafe.Pointer(&iidIAudioEndpointVolume)),
		clsctxAll, 0,
		uintptr(unsafe.Pointer(&endpoint)),
	)
	if hrFailed(hr) || endpoint == nil {
		ready <- fmt.Errorf("激活 IAudioEndpointVolume 失败: 0x%x", uint32(hr))
		return
	}
	ready <- nil

	for {
		select {
		case <-v.closed:
			vcall(endpoint, 2) // Release
			vcall(device, 2)
			vcall(enumerator, 2)
			return
		case req, ok := <-v.req:
			if !ok {
				vcall(endpoint, 2)
				vcall(device, 2)
				vcall(enumerator, 2)
				return
			}
			req.resp <- handleVolume(endpoint, req)
		}
	}
}

func readState(endpoint unsafe.Pointer) (VolumeState, error) {
	var level float32
	hr := vcall(endpoint, 9, uintptr(unsafe.Pointer(&level))) // GetMasterVolumeLevelScalar
	if hrFailed(hr) {
		return VolumeState{}, fmt.Errorf("读取音量失败: 0x%x", uint32(hr))
	}
	var muted int32
	hr = vcall(endpoint, 15, uintptr(unsafe.Pointer(&muted))) // GetMute
	if hrFailed(hr) {
		return VolumeState{}, fmt.Errorf("读取静音状态失败: 0x%x", uint32(hr))
	}
	return VolumeState{
		Level: int(level*100 + 0.5),
		Muted: muted != 0,
		Known: true,
	}, nil
}

func handleVolume(endpoint unsafe.Pointer, req volRequest) volResponse {
	switch req.op {
	case "state":
		st, err := readState(endpoint)
		return volResponse{state: st, err: err}
	case "mute":
		hr := vcall(endpoint, 14, uintptr(int32(req.val)), 0) // SetMute
		if hrFailed(hr) {
			return volResponse{err: fmt.Errorf("设置静音失败: 0x%x", uint32(hr))}
		}
	case "step":
		up := uintptr(0)
		if req.val > 0 {
			up = 1
		}
		for i := 0; i < abs(req.val); i++ {
			if up == 1 {
				vcall(endpoint, 17, 0) // VolumeStepUp
			} else {
				vcall(endpoint, 18, 0) // VolumeStepDown
			}
		}
	case "set":
		st, err := readState(endpoint)
		if err != nil {
			return volResponse{err: err}
		}
		delta := req.val - st.Level
		if delta == 0 {
			return volResponse{state: st}
		}
		// 每步 2%，换算步数；至少 1 步，避免小差值不生效
		steps := delta / 2
		if steps == 0 {
			steps = map[bool]int{true: 1, false: -1}[delta > 0]
		}
		for i := 0; i < abs(steps); i++ {
			if steps > 0 {
				vcall(endpoint, 17, 0)
			} else {
				vcall(endpoint, 18, 0)
			}
		}
	}
	st, err := readState(endpoint)
	return volResponse{state: st, err: err}
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func (v *comVolume) call(op string, val int) (VolumeState, error) {
	resp := make(chan volResponse, 1)
	select {
	case v.req <- volRequest{op: op, val: val, resp: resp}:
	case <-v.closed:
		return VolumeState{}, errors.New("音量服务已关闭")
	}
	r := <-resp
	return r.state, r.err
}

func (v *comVolume) State() (VolumeState, error) { return v.call("state", 0) }

// Mute 返回当前是否静音
func (v *comVolume) Mute() (bool, error) {
	st, err := v.State()
	return st.Muted, err
}
func (v *comVolume) SetMute(muted bool) error {
	n := 0
	if muted {
		n = 1
	}
	_, err := v.call("mute", n)
	return err
}
func (v *comVolume) Step(up bool) error {
	n := -1
	if up {
		n = 1
	}
	_, err := v.call("step", n)
	return err
}
func (v *comVolume) SetLevel(level float32) error {
	_, err := v.call("set", int(level*100+0.5))
	return err
}
func (v *comVolume) Close() {
	v.once.Do(func() { close(v.closed) })
}
