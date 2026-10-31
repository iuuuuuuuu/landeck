import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * 大卡片头部的工具条：左视图切换、右设备/翻页控件。
 *
 * Hindsight 的每张统计卡头都是这个结构（左 Segmented / 右 DevicePicker + DateNav）。
 * 窄屏换行：左右两组各自成行，控件不挤压。
 */
export function CardToolbar({
  left,
  right,
  className,
}: {
  left?: ReactNode
  right?: ReactNode
  className?: string
}) {
  if (left == null && right == null) return null
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line-soft px-1 pb-1',
        className,
      )}
    >
      <div className="flex min-w-0 items-center">{left}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{right}</div>
    </div>
  )
}
