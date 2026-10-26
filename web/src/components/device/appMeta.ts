/** 应用面板的展示小工具：组件文件只放组件，常量与纯函数放这里 */

/** 内存单位换算只做一次，别在 JSX 里做除法 */
export function memLabel(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '0 M'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} G` : `${Math.round(mb)} M`
}

/** 首字母色块配色：同一个应用每次颜色稳定，不随排序变化 */
const TONES = [
  'border-accent/30 bg-accent/12 text-accent-soft',
  'border-cyan/30 bg-cyan/12 text-cyan',
  'border-ok/30 bg-ok/12 text-ok',
  'border-warn/30 bg-warn/12 text-warn',
  'border-danger/30 bg-danger/12 text-danger',
]

export function toneOf(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 997
  return TONES[h % TONES.length]
}

export function initialOf(name: string): string {
  const c = name.trim().charAt(0)
  return c ? c.toUpperCase() : '?'
}

/**
 * 这个可执行文件值不值得去请求图标。
 *
 * 服务端只从 PE 资源段里取图标，所以只有 .exe / .dll 有意义
 * （Linux 的 .desktop、macOS 的 .app 走另一套，这里直接回退字母）。
 * 先筛一层，避免列表里几十行都白发一次 404。
 */
export function hasIconSource(exe: string | undefined | null): boolean {
  if (!exe) return false
  const lower = exe.toLowerCase()
  return lower.endsWith('.exe') || lower.endsWith('.dll')
}
