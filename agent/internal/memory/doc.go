// Package memory 屏幕记忆：定时截屏 → OCR → 关键词搜回「屏幕上出现过的字」。
//
// 契约：docs/design/phase4-memory-and-remote-desktop.md A 节。
// 默认关闭（这是隐私敏感功能，用户显式开启才采集）。
//
// 结构：
//   - settings.go  开关/间隔/保留期（dataDir/memory.json，风格对齐 activity）
//   - store.go     shots 表（复用 activity.db 的 modernc SQLite，独立表、独立连接）
//   - screen_*.go  GDI BitBlt 截屏（多显示器拼接、长边 >1920 等比降）
//   - ocr_*.go     PowerShell + Windows.Media.Ocr（按次起进程，异步）
//   - collect.go   采集循环 + 状态 + 每小时清理 + 隐私门
//   - api.go       Search/Status/GetSettings/UpdateSettings
//
// 隐私边界：截屏前查 activity 隐私规则，前台应用命中则本 tick 整个跳过
// （截图都不落盘）；DB 不存目录绝对路径，file 列只有文件名。
package memory
