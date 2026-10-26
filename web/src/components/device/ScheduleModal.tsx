import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { Button, Field, Input, Modal, Segmented, Select, Slider, Toggle } from '../ui'
import type { PowerAction, Schedule, ScheduleKind } from '../../lib/types'
import { actionLabel } from '../../lib/format'

const ACTION_VALUES: PowerAction[] = [
  'power.shutdown',
  'power.restart',
  'power.sleep',
  'power.hibernate',
  'power.lock',
  'power.screen_off',
  'volume.set',
  'volume.up',
  'volume.down',
  'media.play_pause',
  'media.next',
  'media.prev',
  'media.stop',
]

const DAY_CHIPS: { v: number; l: string }[] = [
  { v: 1, l: '一' },
  { v: 2, l: '二' },
  { v: 3, l: '三' },
  { v: 4, l: '四' },
  { v: 5, l: '五' },
  { v: 6, l: '六' },
  { v: 0, l: '日' },
]

const KINDS: { value: ScheduleKind; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'once', label: '仅一次' },
]

/** 「仅一次」用最近一次到达的时刻，避免再引入日期选择器 */
function nextOccurrence(time: string): string {
  const [h, m] = time.split(':').map((v) => Number(v))
  const d = new Date()
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

export function ScheduleModal({
  open,
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  initial: Schedule | null
  saving: boolean
  onClose: () => void
  onSubmit: (draft: Omit<Schedule, 'id'>) => void
}) {
  const [name, setName] = useState('')
  const [action, setAction] = useState<PowerAction>('power.shutdown')
  const [value, setValue] = useState(40)
  const [delay, setDelay] = useState(30)
  const [kind, setKind] = useState<ScheduleKind>('daily')
  const [time, setTime] = useState('23:30')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [wake, setWake] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setErr(null)
    if (!initial) {
      setName('')
      setAction('power.shutdown')
      setValue(40)
      setDelay(30)
      setKind('daily')
      setTime('23:30')
      setWeekdays([1, 2, 3, 4, 5])
      setWake(false)
      return
    }
    setName(initial.name)
    setAction(initial.action)
    setValue(typeof initial.params?.value === 'number' ? initial.params.value : 40)
    setDelay(typeof initial.params?.delay === 'number' ? initial.params.delay : 30)
    setKind(initial.when.kind)
    setTime(initial.when.time || '23:30')
    setWeekdays(initial.when.weekdays?.length ? initial.when.weekdays : [1, 2, 3, 4, 5])
    setWake(!!initial.wake?.enabled)
  }, [open, initial])

  const options = useMemo(() => {
    const list = ACTION_VALUES.filter((a) => a !== action)
    return [action, ...list]
  }, [action])

  const paramsPreview = useMemo(() => {
    if (action === 'volume.set') return `音量 ${value}%`
    if (action === 'power.shutdown' || action === 'power.restart') return `${delay} 秒后执行`
    return '无参数'
  }, [action, value, delay])

  const toggleDay = (v: number) =>
    setWeekdays((prev) => (prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v]))

  const submit = () => {
    if (!name.trim()) {
      setErr('请填写任务名称')
      return
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setErr('请选择执行时间')
      return
    }
    if (kind === 'weekly' && weekdays.length === 0) {
      setErr('每周模式至少选择一天')
      return
    }
    setErr(null)
    const params: Record<string, unknown> = {}
    if (action === 'volume.set') params.value = value
    if (action === 'power.shutdown' || action === 'power.restart') params.delay = delay

    const when: Schedule['when'] =
      kind === 'weekly'
        ? { kind, time, weekdays: [...weekdays].sort((a, b) => a - b) }
        : kind === 'once'
          ? { kind, time, at: nextOccurrence(time) }
          : { kind, time }

    onSubmit({
      name: name.trim(),
      enabled: initial?.enabled ?? true,
      action,
      params,
      when,
      wake: { enabled: wake, leadSec: 60 },
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑定时任务' : '新建定时任务'}
      desc="到点由 Agent 执行，关机/睡眠可挂 RTC 唤醒闹钟"
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="任务名称" error={err ?? undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 每天 23:30 关机"
            maxLength={40}
          />
        </Field>

        <Field label="动作" hint={paramsPreview}>
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value as PowerAction)}
            aria-label="定时动作"
          >
            {options.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
        </Field>

        {action === 'volume.set' && (
          <Field label="目标音量" hint={`${value}%`}>
            <Slider value={value} onChange={setValue} min={0} max={100} step={1} />
          </Field>
        )}

        {(action === 'power.shutdown' || action === 'power.restart') && (
          <Field label="延迟（秒）" hint="0 表示立即执行">
            <Input
              type="number"
              min={0}
              max={600}
              value={delay}
              onChange={(e) => setDelay(Math.max(0, Math.min(600, Number(e.target.value) || 0)))}
              className="num"
            />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="执行时间">
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="num"
            />
          </Field>
          <Field label="重复方式" hint={kind === 'once' ? '按最近一次到达该时间执行' : undefined}>
            <Segmented
              value={kind}
              onChange={setKind}
              options={KINDS}
              className="w-full justify-between"
            />
          </Field>
        </div>

        {kind === 'weekly' && (
          <Field label="星期" error={weekdays.length === 0 ? '至少选择一天' : undefined}>
            <div className="flex flex-wrap gap-1.5">
              {DAY_CHIPS.map((d) => {
                const on = weekdays.includes(d.v)
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleDay(d.v)}
                    aria-pressed={on}
                    className={clsx(
                      'h-10 w-10 rounded-full border text-[12.5px] font-medium transition-colors',
                      on
                        ? 'border-accent/60 bg-accent/15 text-fg'
                        : 'border-line bg-elevated text-muted hover:text-fg-soft',
                    )}
                  >
                    {d.l}
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        <div className="rounded-xl border border-line bg-elevated px-3.5 py-3">
          <Toggle
            checked={wake}
            onChange={setWake}
            label="允许 RTC 唤醒"
            desc="关机或睡眠状态下，由主板闹钟提前唤醒（需硬件与 BIOS 支持）"
          />
        </div>
      </div>
    </Modal>
  )
}
