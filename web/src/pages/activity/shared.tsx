import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge, Button, Card, EmptyState } from '../../components/ui'
import { useApp } from '../../store/app'
import { LOCAL_DOWN_HINT, useActiveTarget } from '../../lib/useActiveTarget'

/**
 * 活动统计五页的共享骨架件。
 * PageHeader 的副标题带本页汇总值（对齐 Hindsight "October 2026 · 6h 48m daily avg"），
 * 「演示数据」徽标放标题右侧 —— agent 活动接口上线后自动消失。
 */

export function ActivityPageHeader({ title, subtitle, demo }: { title: string; subtitle: string; demo?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-[26px] font-bold leading-tight text-fg sm:text-[30px]">{title}</h1>
        <p className="mt-1 text-[13px] text-muted">{subtitle}</p>
      </div>
      {demo && <Badge tone="cyan">演示数据</Badge>}
    </div>
  )
}

/** 卡头工具条右侧的日期翻页：前后箭头 + 「今天」胶囊（对齐参考截图）。 */
export function DateNav({ label, onPrev, onNext, onToday, todayLabel = '今天' }: {
  label: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  todayLabel?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPrev}
        aria-label="上一期"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-line-soft bg-elevated text-fg-soft transition-colors hover:bg-elevated/80"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        onClick={onToday}
        className="h-9 rounded-xl border border-line-soft bg-elevated px-3.5 text-[12.5px] text-fg-soft transition-colors hover:bg-elevated/80"
      >
        {todayLabel}
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="下一期"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-line-soft bg-elevated text-fg-soft transition-colors hover:bg-elevated/80"
      >
        <ChevronRight size={16} />
      </button>
      <span className="ml-1 hidden text-[12px] text-faint sm:inline">{label}</span>
    </div>
  )
}

/** 统计大卡：主图独占一张 rounded-3xl 卡，卡头放视图切换与工具条。 */
export function StatCard({ toolbar, children }: { toolbar?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      {toolbar && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">{toolbar}</div>}
      {children}
    </Card>
  )
}

/**
 * 页面级设备目标。活动统计的「本机」也走 agent（被控端就是采集方），
 * 所以直接复用 useActiveTarget：本机在桌面排第一位，手机上没有本机项。
 */
export function useActivityTarget() {
  return useActiveTarget()
}

/** 手机上一台设备都没有时的引导态（与设备详情页口径一致）。 */
export function NoDeviceGuide() {
  return (
    <Card>
      <EmptyState
        title="还没有可查看的设备"
        desc={LOCAL_DOWN_HINT + ' 配对一台电脑后，这里会显示它的活动统计。'}
      />
    </Card>
  )
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card>
      <EmptyState
        title="统计数据读取失败"
        desc={String(error ?? '')}
        action={
          <Button size="sm" variant="secondary" onClick={onRetry}>
            重试
          </Button>
        }
      />
    </Card>
  )
}

/** 把 useApp 的 toast 暴露给分类页（保存规则用），避免页面各自引 store。 */
export function useToast() {
  return useApp((s) => s.toast)
}

// ---------- 日期工具（页内导航用，不引第三方库） ----------

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' → 'M月D日 周X' */
export function prettyDate(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wd}`
}
