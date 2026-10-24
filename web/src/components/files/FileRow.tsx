import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconButton } from '../ui'
import { Download, Eye, MoreVertical, Pencil, Trash } from 'lucide-react'
import type { FileEntry } from '../../lib/types'
import { bytes, dateTime } from '../../lib/format'
import { FileGlyph } from './FileIcon'
import { extOf, isImageExt, isTextExt } from './paths'

export type FileAction = 'preview' | 'download' | 'rename' | 'delete'

/** 单行文件：单击选中，双击进入目录；行尾菜单放低频操作 */
export function FileRow({
  entry,
  selected,
  allowWrite,
  busy,
  onSelect,
  onOpen,
  onAction,
}: {
  entry: FileEntry
  selected: boolean
  allowWrite: boolean
  busy?: boolean
  onSelect: () => void
  onOpen: () => void
  onAction: (action: FileAction) => void
}) {
  const ext = entry.ext || extOf(entry.name)
  const canPreview = entry.dir || isTextExt(ext) || isImageExt(ext)

  return (
    <li
      className={clsx(
        'group flex items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors',
        selected
          ? 'border-accent/45 bg-accent/10'
          : 'border-transparent hover:border-line-soft hover:bg-hover',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        title={entry.path}
      >
        <FileGlyph ext={ext} dir={entry.dir} open={selected && entry.dir} />
        <span className="min-w-0 flex-1">
          <span
            className={clsx(
              'block truncate text-[13px]',
              entry.hidden ? 'text-faint' : 'text-fg',
            )}
          >
            {entry.name}
          </span>
          <span className="flex items-center gap-2 text-[10.5px] text-faint sm:hidden">
            <span className="num">{entry.dir ? '目录' : bytes(entry.size)}</span>
            <span className="num">{dateTime(entry.modTime)}</span>
          </span>
        </span>
        <span className="num hidden w-20 shrink-0 text-right text-[11.5px] text-muted sm:block">
          {entry.dir ? '—' : bytes(entry.size)}
        </span>
        <span className="num hidden w-[104px] shrink-0 text-right text-[11px] text-faint md:block">
          {dateTime(entry.modTime)}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {!entry.dir && (
          <IconButton
            label="下载"
            size="sm"
            className="hidden h-8 w-8 border-transparent bg-transparent text-muted hover:text-fg sm:inline-flex"
            onClick={() => onAction('download')}
          >
            <Download size={14} />
          </IconButton>
        )}
        {!entry.dir && canPreview && (
          <IconButton
            label="预览"
            size="sm"
            className="hidden h-8 w-8 border-transparent bg-transparent text-muted hover:text-fg sm:inline-flex"
            onClick={() => onAction('preview')}
          >
            <Eye size={14} />
          </IconButton>
        )}
        <RowMenu
          entry={entry}
          allowWrite={allowWrite}
          busy={busy}
          canPreview={canPreview}
          onAction={onAction}
        />
      </div>
    </li>
  )
}

function RowMenu({
  entry,
  allowWrite,
  busy,
  canPreview,
  onAction,
}: {
  entry: FileEntry
  allowWrite: boolean
  busy?: boolean
  canPreview: boolean
  onAction: (action: FileAction) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const pick = (action: FileAction) => {
    setOpen(false)
    onAction(action)
  }

  // 目录 + 只读模式：没有任何可执行操作，不渲染一个空菜单
  const hasItems = !entry.dir || allowWrite
  if (!hasItems) return null

  return (
    <div ref={box} className="relative">
      <IconButton
        label="更多操作"
        size="sm"
        disabled={busy}
        className="h-10 w-10 border-transparent bg-transparent text-muted hover:text-fg sm:h-8 sm:w-8"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={14} />
      </IconButton>
      {open && (
        <div className="panel absolute right-0 top-10 z-30 w-36 overflow-hidden p-1.5">
          {!entry.dir && (
            <MenuItem icon={<Download size={13} />} onClick={() => pick('download')}>
              下载
            </MenuItem>
          )}
          {!entry.dir && canPreview && (
            <MenuItem icon={<Eye size={13} />} onClick={() => pick('preview')}>
              预览
            </MenuItem>
          )}
          {allowWrite && (
            <MenuItem icon={<Pencil size={13} />} onClick={() => pick('rename')}>
              重命名
            </MenuItem>
          )}
          {allowWrite && (
            <MenuItem icon={<Trash size={13} />} danger onClick={() => pick('delete')}>
              删除
            </MenuItem>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: React.ReactNode
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-[12.5px] transition-colors sm:h-9',
        danger ? 'text-danger hover:bg-danger/12' : 'text-fg-soft hover:bg-hover hover:text-fg',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/** 空态与表头也用得上的一行占位 */
export function FileListHead({ allowWrite }: { allowWrite: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5 text-[10.5px] text-faint">
      <span className="w-9 shrink-0" />
      <span className="min-w-0 flex-1">名称</span>
      <span className="hidden w-20 shrink-0 text-right sm:block">大小</span>
      <span className="hidden w-[104px] shrink-0 text-right md:block">修改时间</span>
      <span className={clsx('hidden shrink-0 sm:block', allowWrite ? 'w-[92px]' : 'w-[60px]')} />
    </div>
  )
}

/** 目录卡片（根目录视图用） */
export function RootCard({
  label,
  path,
  kind,
  onClick,
}: {
  label: string
  path: string
  kind: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-elevated px-3.5 py-3 text-left transition-colors hover:bg-elevated-2"
    >
      <FileGlyph ext="" dir />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-fg">{label}</span>
        <span className="num block truncate text-[11px] text-faint" title={path}>
          {path}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-faint">
        {kind === 'home' ? '主目录' : kind === 'drive' ? '盘符' : '自定义'}
      </span>
    </button>
  )
}
