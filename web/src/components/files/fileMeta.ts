/** 扩展名分组：图标、色调、预览能力都按这套集合判定，组件里不再各写一份 */
import { isImageExt } from './paths'

const CODE = new Set([
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'json',
  'jsonc',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'go',
  'rs',
  'py',
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
  'sh',
  'bash',
  'ps1',
  'bat',
  'cmd',
  'sql',
  'yml',
  'yaml',
  'toml',
  'xml',
])

const ARCHIVE = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'iso', 'apk', 'jar'])
const VIDEO = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v'])
const SHEET = new Set(['csv', 'tsv', 'xls', 'xlsx', 'ods'])
const DOC = new Set(['txt', 'md', 'markdown', 'log', 'pdf', 'doc', 'docx', 'rtf', 'ppt', 'pptx'])

export type FileKind = 'dir' | 'image' | 'code' | 'archive' | 'video' | 'sheet' | 'doc' | 'other'

export function kindOf(ext: string, dir: boolean): FileKind {
  if (dir) return 'dir'
  const e = ext.toLowerCase()
  if (isImageExt(e)) return 'image'
  if (CODE.has(e)) return 'code'
  if (ARCHIVE.has(e)) return 'archive'
  if (VIDEO.has(e)) return 'video'
  if (SHEET.has(e)) return 'sheet'
  if (DOC.has(e)) return 'doc'
  return 'other'
}

/** 色调一律用令牌色，深浅两套主题都能看 */
const TONE: Record<FileKind, string> = {
  dir: 'border-accent/25 bg-accent/12 text-accent-soft',
  image: 'border-cyan/25 bg-cyan/12 text-cyan',
  code: 'border-ok/25 bg-ok/12 text-ok',
  archive: 'border-warn/25 bg-warn/12 text-warn',
  video: 'border-accent/25 bg-accent/12 text-accent-soft',
  sheet: 'border-ok/25 bg-ok/12 text-ok',
  doc: 'border-line bg-elevated text-fg-soft',
  other: 'border-line bg-elevated text-muted',
}

export function toneOf(ext: string, dir: boolean): string {
  return TONE[kindOf(ext, dir)]
}
