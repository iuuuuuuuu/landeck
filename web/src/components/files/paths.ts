/** 文件路径与扩展名工具：所有拼接都走这里，避免 Windows / POSIX 混用出错 */

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])

const TEXT_EXT = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonc',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'xml',
  'yml',
  'yaml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'env',
  'log',
  'sh',
  'bash',
  'zsh',
  'bat',
  'cmd',
  'ps1',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'rb',
  'swift',
  'sql',
  'csv',
  'tsv',
  'diff',
  'patch',
  'gitignore',
  'dockerfile',
])

export function isImageExt(ext?: string): boolean {
  return !!ext && IMAGE_EXT.has(ext.toLowerCase().replace(/^\./, ''))
}

export function isTextExt(ext?: string): boolean {
  return !!ext && TEXT_EXT.has(ext.toLowerCase().replace(/^\./, ''))
}

function isWinPath(p: string): boolean {
  return /^[a-zA-Z]:/.test(p) || p.includes('\\')
}

export function sepOf(p: string): string {
  return isWinPath(p) ? '\\' : '/'
}

/** 子项绝对路径：目录结尾有没有分隔符都正确 */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name
  const sep = sepOf(dir)
  return /[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}${sep}${name}`
}

/** 面包屑：从盘符/根开始逐级累加 */
export function splitPath(p: string): { label: string; path: string }[] {
  if (!p) return []
  const win = /^[a-zA-Z]:/.test(p)
  const sep = win ? '\\' : '/'
  const parts = p.split(/[\\/]+/).filter(Boolean)
  if (parts.length === 0) return []
  const out: { label: string; path: string }[] = []
  if (win) {
    out.push({ label: parts[0], path: `${parts[0]}${sep}` })
    let acc = parts[0]
    for (let i = 1; i < parts.length; i += 1) {
      acc = `${acc}${sep}${parts[i]}`
      out.push({ label: parts[i], path: acc })
    }
    return out
  }
  let acc = ''
  for (const part of parts) {
    acc = `${acc}/${part}`
    out.push({ label: part, path: acc })
  }
  return out
}

/** 上一级；已在根目录时返回 null */
export function parentOf(p: string): string | null {
  if (!p) return null
  const win = /^[a-zA-Z]:/.test(p)
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx < 0) return null
  const head = trimmed.slice(0, idx)
  if (win) {
    if (/^[a-zA-Z]:$/.test(head)) return `${head}\\`
    return head || null
  }
  return head === '' ? '/' : head
}

/** 扩展名（不含点），用于图标与预览判定 */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return ''
  return name.slice(i + 1).toLowerCase()
}
