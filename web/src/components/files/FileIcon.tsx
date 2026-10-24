import clsx from 'clsx'
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { kindOf, toneOf } from './fileMeta'

/** 图标按扩展名分组，深浅主题都用令牌色 */
function glyph(ext: string, dir: boolean, open?: boolean): React.ReactNode {
  switch (kindOf(ext, dir)) {
    case 'dir':
      return open ? <FolderOpen size={16} /> : <Folder size={16} />
    case 'image':
      return <FileImage size={16} />
    case 'code':
      return <FileCode size={16} />
    case 'archive':
      return <FileArchive size={16} />
    case 'video':
      return <FileVideo size={16} />
    case 'sheet':
      return <FileSpreadsheet size={16} />
    case 'doc':
      return <FileText size={16} />
    default:
      return <File size={16} />
  }
}

export function FileGlyph({
  ext,
  dir,
  open,
  size = 'md',
}: {
  ext: string
  dir: boolean
  open?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={clsx(
        'grid shrink-0 place-items-center rounded-[10px] border',
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        toneOf(ext, dir),
      )}
      aria-hidden
    >
      {glyph(ext, dir, open)}
    </span>
  )
}
