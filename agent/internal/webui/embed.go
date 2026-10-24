// Package webui 把前端构建产物嵌进二进制，Agent 一个文件就能开箱提供界面。
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS 返回前端产物根目录。未构建时返回错误，Handler 会给出提示页。
func FS() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}
