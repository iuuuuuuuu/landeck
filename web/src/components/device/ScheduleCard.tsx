import clsx from 'clsx'
import { Badge, Card, IconButton, Spinner, Toggle } from '../ui'
import { Clock, Pencil, Repeat, Trash2, Zap } from 'lucide-react'
import type { Schedule } from '../../lib/types'
import { actionLabel, relative, weekdaysLabel } from '../../lib/format'

export function ScheduleCard({
  schedule,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  schedule: Schedule
  busy?: boolean
  onToggle: (s: Schedule, enabled: boolean) => void
  onEdit: (s: Schedule) => void
  onDelete: (s: Schedule) => void
}) {
  const timeText =
    schedule.when.kind === 'once'
      ? `仅一次 · ${schedule.when.time}`
      : `${schedule.when.time} · ${weekdaysLabel(schedule.when.weekdays)}`

  return (
    <Card
      as="li"
      className={clsx('list-none', !schedule.enabled && 'opacity-70')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <h3 className="truncate text-[14.5px] font-semibold text-fg">
              {schedule.name || '未命名任务'}
            </h3>
            {!schedule.enabled && <Badge tone="neutral">已暂停</Badge>}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">
              <Zap size={11} className="-ml-0.5" />
              {actionLabel(schedule.action)}
            </Badge>
            <Badge tone="neutral">
              <Clock size={11} className="-ml-0.5" />
              <span className="num">{timeText}</span>
            </Badge>
            {schedule.wake?.enabled && (
              <Badge tone="cyan">
                <Repeat size={11} className="-ml-0.5" />
                RTC 唤醒
              </Badge>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-faint">
            <span>
              下次{' '}
              <span className="num text-fg-soft">
                {schedule.enabled ? relative(schedule.nextRunAt) : '—'}
              </span>
            </span>
            <span>
              上次 <span className="num text-muted">{relative(schedule.lastRunAt)}</span>
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            {busy && <Spinner size={13} className="text-muted" />}
            <Toggle
              checked={schedule.enabled}
              disabled={busy}
              onChange={(v) => onToggle(schedule, v)}
            />
          </div>
          <div className="flex items-center gap-1">
            <IconButton label="编辑" size="md" onClick={() => onEdit(schedule)} disabled={busy}>
              <Pencil size={14} />
            </IconButton>
            <IconButton label="删除" size="md" onClick={() => onDelete(schedule)} disabled={busy}>
              <Trash2 size={14} className="text-danger" />
            </IconButton>
          </div>
        </div>
      </div>
    </Card>
  )
}
