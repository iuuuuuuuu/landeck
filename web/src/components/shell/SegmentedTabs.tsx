import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'

/**
 * 下划线式分段切换（卡内工具条左侧）。
 *
 * 与 ui/Form 的 Segmented（胶囊底）是两个形态：卡片头部里 Hindsight 用的是
 * 「文字 + 激活下划线」，更轻，不跟卡片的圆角边框抢视觉。
 * 受控组件；role=tablist 只做展示态（不承担真实 tabpanel 语义——
 * 这里的"页签"切换的是同一张图的数据视图，不是页面区域）。
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: Array<{ key: T; label: string; icon?: LucideIcon }>
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={clsx('flex items-center gap-1', className)}>
      {items.map((it) => {
        const active = it.key === value
        const Icon = it.icon
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={clsx(
              'relative inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
              active ? 'text-accent' : 'text-muted hover:bg-hover hover:text-fg-soft',
            )}
          >
            {Icon && <Icon size={15} strokeWidth={1.75} aria-hidden className="shrink-0" />}
            {it.label}
            {/* 激活下划线：贴在工具条底边（父容器有 border-b 时正好压线） */}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-2.5 -bottom-px h-[2px] rounded-full bg-accent"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
