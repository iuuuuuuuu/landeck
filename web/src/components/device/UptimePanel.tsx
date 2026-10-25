import { Badge, Button, Card, Skeleton, Stat } from '../ui'
import { lazy, Suspense } from 'react'

// echarts 体积不小（按需引入后仍 ~170KB gzip），单独切成异步 chunk：
// 首屏不含它，只有打开详情页的「开机统计」时才拉。
const UptimeBarChart = lazy(() =>
  import('./UptimeBarChart').then((m) => ({ default: m.UptimeBarChart })),
)
import { useThemeStore } from '../../store/theme'
import { CalendarClock, Clock, RotateCw } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { BootEvent } from '../../lib/types'
import { useAsync } from '../../lib/hooks'
import { isAuthError } from './apiHelpers'
import { dateTime, duration, hours } from '../../lib/format'


type Tone = 'ok' | 'neutral' | 'accent' | 'danger' | 'cyan'

const KIND: Record<BootEvent['kind'], { label: string; tone: Tone }> = {
  boot: { label: '开机', tone: 'ok' },
  shutdown: { label: '关机', tone: 'neutral' },
  sleep: { label: '睡眠', tone: 'cyan' },
  wake: { label: '唤醒', tone: 'accent' },
  crash: { label: '异常', tone: 'danger' },
}

export function UptimePanel({
  client,
  onAuthError,
}: {
  client: AgentClient | null
  onAuthError?: () => void
}) {
  const hist = useAsync(
    client
      ? () =>
          client.uptime(90).catch((e: unknown) => {
            if (isAuthError(e)) onAuthError?.()
            throw e
          })
      : null,
    [client?.target.host, client?.target.port, client?.token],
  )

  const theme = useThemeStore((st) => st.theme)
  const days = hist.data?.days ?? []
  const months = hist.data?.months ?? []
  // 主视图按月：用户要求「开机统计按照月统计，不要只统计一周的」。
  // 柱子高度按当月累计开机时长，标签用 10月 这种短格式。
  const bars = months.map((m) => ({
    date: m.month,
    label: `${Number(m.month.slice(5))}月`,
    onSec: m.onSec,
    boots: m.boots,
  }))
  const events = [...(hist.data?.boots ?? [])]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8)
  const totals = hist.data?.totals

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-fg">开机统计</h3>
          <p className="mt-0.5 text-[12px] text-muted">近 12 个月，按系统事件日志聚合</p>
        </div>
        <button
          type="button"
          aria-label="刷新开机统计"
          onClick={hist.reload}
          disabled={hist.loading}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          <RotateCw size={14} className={hist.loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      {hist.error ? (
        <div className="mt-4 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3">
          <p className="text-[12.5px] text-danger">{hist.error}</p>
          <Button size="sm" variant="secondary" className="mt-2.5 h-8" onClick={hist.reload}>
            重试
          </Button>
        </div>
      ) : hist.loading && !hist.data ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-[92px] w-full" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !hist.data || (months.length === 0 && days.length === 0) ? (
        <p className="py-8 text-center text-[12.5px] text-muted">暂无开机记录</p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="rounded-xl border border-line bg-elevated px-3 pb-2.5 pt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-faint">
                <span>每日在线时长</span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  按 24 小时刻度
                </span>
              </div>
              {bars.length > 0 ? (
                <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
                  <UptimeBarChart data={bars} height={200} theme={theme} monthly />
                </Suspense>
              ) : (
                <Skeleton className="h-[200px] w-full" />
              )}
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-1 lg:gap-2.5">
              <Stat label="7 天开机" value={totals ? hours(totals.onSec7d) : '—'} unit="小时" />
              <Stat label="启动次数" value={totals ? String(totals.boots7d) : '—'} unit="次" />
              <Stat
                label="平均单次"
                value={totals ? duration(totals.avgUptimeSec, 'short') : '—'}
              />
            </div>
          </div>

          <div className="lg:col-span-12">
            <div className="mb-2 flex items-center gap-1.5 text-[11.5px] uppercase tracking-[0.08em] text-faint">
              <CalendarClock size={12} />
              最近启停记录
            </div>
            {events.length === 0 ? (
              <p className="pb-1 text-[12.5px] text-muted">暂无事件</p>
            ) : (
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {events.map((e, i) => {
                  const meta = KIND[e.kind] ?? KIND.boot
                  return (
                    <li
                      key={`${e.at}-${i}`}
                      className="flex items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-hover"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <span className="num truncate text-[12px] text-fg-soft">
                          {dateTime(e.at)}
                        </span>
                      </div>
                      <span className="num shrink-0 text-[11.5px] text-muted">
                        {e.uptimeSec > 0 ? duration(e.uptimeSec) : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
