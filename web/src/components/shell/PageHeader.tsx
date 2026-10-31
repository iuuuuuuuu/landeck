import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * 页面大标题（Hindsight 风格骨架）。
 *
 * 标题从顶栏挪进内容区：顶栏只留控件，标题区自己承担「本页摘要」——
 * sub 直接放汇总文案（如「已配对 3 台 · 在线 2 台」「6h 48m 日均」），
 * 与 Hindsight 的 "October 2026 · 6h 48m daily avg" 同一节奏。
 *
 * 移动端字号降级（23px），≥1024px 放大到 34px（对齐 Hindsight 的大标题量级）；
 * actions 槽放页级操作（如「扫描」），对齐右侧基线。
 */
export function PageHeader({
  title,
  sub,
  actions,
  className,
}: {
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-1', className)}>
      <div className="min-w-0">
        <h1 className="font-display truncate text-[23px] font-semibold tracking-tight text-fg min-[1024px]:text-[34px]">
          {title}
        </h1>
        {sub != null && (
          <div className="mt-0.5 min-w-0 truncate text-[12.5px] text-muted min-[1024px]:mt-1 min-[1024px]:text-[13.5px]">
            {sub}
          </div>
        )}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
