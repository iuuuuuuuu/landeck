import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '../ui'
import type { ProcessInfo } from '../../lib/types'
import { dateTime } from '../../lib/format'

function memLabel(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '0 M'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} G` : `${Math.round(mb)} M`
}

/** 单行进程：点击展开详情，右侧结束按钮冒泡拦截 */
export function ProcessRow({
  p,
  expanded,
  onToggle,
  onKill,
}: {
  p: ProcessInfo
  expanded: boolean
  onToggle: () => void
  onKill: () => void
}) {
  return (
    <li className="border-b border-white/[0.04] last:border-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
      >
        <span className="num w-12 shrink-0 text-[10.5px] text-faint">{p.pid}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-fg">{p.name}</span>
          <span className="block truncate text-[10.5px] text-faint">{p.user || '—'}</span>
        </span>
        <span
          className={clsx(
            'num w-10 shrink-0 text-right text-[11.5px]',
            p.cpu > 50 ? 'text-warn' : 'text-muted',
          )}
        >
          {p.cpu.toFixed(1)}%
        </span>
        <span className="num w-12 shrink-0 text-right text-[11px] text-muted">
          {memLabel(p.memMb)}
        </span>
        <span className="flex w-[58px] shrink-0 justify-end sm:w-[52px]">
          <Button
            size="sm"
            variant="ghost"
            className="h-10 px-3 text-[11.5px] hover:bg-danger/12 hover:text-danger sm:h-8 sm:px-2"
            onClick={(e) => {
              e.stopPropagation()
              onKill()
            }}
          >
            结束
          </Button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mb-2 ml-[62px] mr-2 space-y-1 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11.5px]">
              <Detail label="路径" value={p.exe || '—'} mono />
              <Detail label="启动于" value={dateTime(p.startedAt)} />
              <Detail label="父进程" value={String(p.parent)} mono />
              <Detail label="状态" value={p.status || '—'} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-2">
      <span className="w-14 shrink-0 text-faint">{label}</span>
      <span
        className={clsx('min-w-0 break-all text-fg-soft', mono && 'font-mono text-[11px]')}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
