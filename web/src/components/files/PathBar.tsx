import clsx from 'clsx'
import { IconButton } from '../ui'
import { ChevronRight, CornerUpLeft, HardDrive, RotateCw } from 'lucide-react'
import { splitPath } from './paths'

/** 路径条：根目录 / 上一级 / 面包屑 / 刷新，窄屏下横向滚动不换行 */
export function PathBar({
  dir,
  loading,
  onRoot,
  onUp,
  onGo,
  onRefresh,
  actions,
}: {
  /** null = 根目录视图 */
  dir: string | null
  loading: boolean
  onRoot: () => void
  onUp: () => void
  onGo: (path: string) => void
  onRefresh: () => void
  /** 右侧动作（新建目录 / 上传） */
  actions?: React.ReactNode
}) {
  const crumbs = dir ? splitPath(dir) : []

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <IconButton
          label="返回根目录"
          size="sm"
          className="h-10 w-10 shrink-0 sm:h-8 sm:w-8"
          onClick={onRoot}
        >
          <HardDrive size={14} />
        </IconButton>
        <IconButton
          label="上一级"
          size="sm"
          disabled={!dir}
          className="h-10 w-10 shrink-0 sm:h-8 sm:w-8"
          onClick={onUp}
        >
          <CornerUpLeft size={14} />
        </IconButton>

        <div className="no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {dir === null ? (
            <span className="px-1 text-[12px] text-faint">根目录</span>
          ) : (
            crumbs.map((c, i) => (
              <span key={c.path} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight size={11} className="shrink-0 text-faint" />}
                <button
                  type="button"
                  onClick={() => onGo(c.path)}
                  title={c.path}
                  className={clsx(
                    'inline-flex h-10 max-w-[140px] items-center truncate rounded-lg px-1.5 text-[12px] transition-colors sm:h-8',
                    i === crumbs.length - 1 ? 'text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  <span className="truncate">{c.label}</span>
                </button>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <IconButton label="刷新" onClick={onRefresh} disabled={loading || dir === null}>
          <RotateCw size={14} className={loading ? 'animate-spin' : undefined} />
        </IconButton>
        {actions}
      </div>
    </div>
  )
}
