import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '../ui'

/**
 * 日期翻页（卡内工具条右侧）：‹ 标签 ›。
 *
 * 中间是「回到当前」按钮（今天/本周/本月），左右箭头翻上一/下一周期——
 * 与 Hindsight 的 ‹ This month › 同构。全部受控：翻页逻辑归调用方。
 */
export function DateNav({
  label,
  onPrev,
  onNext,
  onCurrent,
  prevDisabled,
  nextDisabled,
  currentDisabled,
}: {
  /** 中间标签，如「今天」「2026 年 10 月」 */
  label: string
  onPrev: () => void
  onNext: () => void
  /** 点中间标签回到当前周期；不传则渲染成纯文字 */
  onCurrent?: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
  currentDisabled?: boolean
}) {
  const inner = (
    <span className="num inline-flex items-center px-1 text-[13px] font-medium text-fg-soft">
      {label}
    </span>
  )
  return (
    <div className="flex items-center gap-1">
      <IconButton label="上一周期" variant="ghost" size="sm" onClick={onPrev} disabled={prevDisabled}>
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
      {onCurrent ? (
        <button
          type="button"
          onClick={onCurrent}
          disabled={currentDisabled}
          className="inline-flex h-8 items-center rounded-pill border border-line bg-elevated px-3 transition-colors hover:border-line-strong disabled:opacity-40"
        >
          {inner}
        </button>
      ) : (
        inner
      )}
      <IconButton label="下一周期" variant="ghost" size="sm" onClick={onNext} disabled={nextDisabled}>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
    </div>
  )
}
