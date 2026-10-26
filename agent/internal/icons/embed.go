package icons

import _ "embed"

// SelfIcon 是被控端自身图标的兜底来源。
//
// 为什么要有它：设备列表的 logo 走 /self/icon，原本只从 exe 的 RT_GROUP_ICON 读。
// 但 Go 编译出的 exe 默认**没有**图标资源，端点只能 404，前端永远退回首字母块 ——
// 用户要的「用头像当设备 logo」就落不了地。
//
// 所以改成两级：先试 exe 里的资源（安装版/带资源的构建），拿不到就用这份内嵌图标。
// 这样任何构建方式下，每台设备都有一枚真实、统一的标识。
//
//go:embed assets/landeck.ico
var SelfIcon []byte
