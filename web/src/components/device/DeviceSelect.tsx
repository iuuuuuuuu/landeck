import clsx from 'clsx'
import { Select } from '../ui'
import type { PairedDevice } from '../../store/app'

/** 顶部设备切换：定时任务 / 活动日志共用 */
export function DeviceSelect({
  devices,
  value,
  onChange,
  className,
}: {
  devices: PairedDevice[]
  value: string | null
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <Select
      aria-label="选择设备"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        'h-10 w-full min-w-0 sm:w-64 [&>option]:bg-surface [&>option]:text-fg',
        className,
      )}
    >
      {devices.length === 0 && <option value="">暂无已配对设备</option>}
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name} · {d.host}
        </option>
      ))}
    </Select>
  )
}
