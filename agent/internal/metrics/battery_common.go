package metrics

// readBattery 由各平台实现；桌面机通常返回 nil。
// 放在独立文件里是为了避免与 gopsutil 的平台差异纠缠。
func noBattery() *BatteryStat { return nil }
