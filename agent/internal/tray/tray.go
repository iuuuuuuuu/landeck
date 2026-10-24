package tray

import _ "embed"

// Icon 是托盘图标（PNG-in-ICO，256px，Windows 会自动缩放）。
//
//go:embed icon.ico
var Icon []byte
