import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * 开机统计的大数字块，视觉语言与「实时状态」的 Stat 系列保持一致：
 * 小标签 → 大号 num 数字 + 单位 → 一行环比徽章 / 说明。
 *
 * 为什么不直接用 ui 里的 Stat：Stat 的值为 24px 且没有徽章槽位，
 * 这里需要"环比徽章 + 副标题"两行信息，单独抽一个组件更清楚。
 */

/** 环比结果；text 里已经带好正负号，为 null 表示不显示（上月无数据，避免除零） */
export interface UptimeDelta {
  text: string
  trend: 'up' | 'down' | 'flat'
}

const TREND_STYLE: Record<UptimeDelta['trend'], string> = {
  up: 'border-ok/30 bg-ok/12 text-ok',
  down: 'border-line bg-elevated text-fg-soft',
  flat: 'border-line bg-elevated text-muted',
}

const TREND_GLYPH: Record<UptimeDelta['trend'], string> = {
  up: '↑',
  down: '↓',
  flat: '→',
}

export function UptimeStat({
  label,
  icon,
  value,
  unit,
  hint,
  delta,
}: {
  label: ReactNode
  icon?: ReactNode
  value: ReactNode
  unit?: string
  /** 环比徽章之外的一句补充；没有徽章时它就是唯一副标题 */
  hint?: ReactNode
  delta?: UptimeDelta | null
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-elevated px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.06em] text-faint">
        {icon}
        <span className="truncate">{label}</span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="num text-[22px] font-semibold leading-none text-fg">{value}</span>
        {unit && <span className="text-[11.5px] text-muted">{unit}</span>}
      </div>

      <div className="mt-1.5 flex min-h-[18px] min-w-0 items-center gap-1.5">
        {delta && (
          <span
            className={clsx(
              'inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-[10.5px] font-medium',
              TREND_STYLE[delta.trend],
            )}
          >
            <span aria-hidden>{TREND_GLYPH[delta.trend]}</span>
            {delta.text}
          </span>
        )}
        {hint && (
          <span className="truncate text-[11px] text-faint" title={typeof hint === 'string' ? hint : undefined}>
            {hint}
          </span>
        )}
      </div>
    </div>
  )
}
