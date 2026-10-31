import clsx from 'clsx'
import { Monitor } from 'lucide-react'
import { Select } from '../ui'
import type { PairedDevice } from '../../store/app'

/**
 * 卡内工具条的设备选择器（DeviceSelect 的升格形态）。
 *
 * 与 Hindsight 的 "My workstation" 下拉同构：左侧设备图标 + 大号圆角容器。
 * 仍基于 ui/Select（自绘下拉，键盘/滚动定位都已处理），只是包了图标外壳——
 * 原生 option children 的约定保持不变，调用方从 DeviceSelect 迁过来零成本。
 */
export function DevicePicker({
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
    <div className={clsx('relative inline-flex min-w-0', className)}>
      <Monitor
        size={16}
        strokeWidth={1.75}
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-accent"
      />
      <Select
        aria-label="选择设备"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 pl-10 sm:w-64"
      >
        {devices.length === 0 && <option value="">暂无已配对设备</option>}
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {d.host}
          </option>
        ))}
      </Select>
    </div>
  )
}
