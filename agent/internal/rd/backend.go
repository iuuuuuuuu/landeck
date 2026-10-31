package rd

// newBackend 集成点：平台后端的获取函数。
// 生产 = newPlatformBackend（Windows 实现 / 其它平台 unsupported）；
// 测试 = 桩后端（合成帧 + 输入/指示条记录器），集成点集中在一处。
var newBackend = func() (Backend, error) { return newPlatformBackend() }
