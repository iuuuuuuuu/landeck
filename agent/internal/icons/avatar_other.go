//go:build !windows

package icons

// AccountAvatar 在非 Windows 平台没有「系统账户头像」这个概念。
//
// 为什么不硬造一个：macOS 的头像在 DS_Store / AddressBook 私有库里，
// Linux 各发行版差异极大。与其给出一个语义不明的东西，不如返回空，
// 让 /self/icon 继续回退到 exe 图标 / 内嵌 logo。
func AccountAvatar() ([]byte, string, bool) {
	return nil, "", false
}
