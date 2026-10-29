import { lazy, Suspense } from 'react'
import { Button, Card, SectionTitle, Skeleton } from '../ui'
import { CalendarClock, Clock, Hourglass, Power, RotateCw, Timer } from 'lucide-react'
import type { BootEvent, UptimeMonth } from '../../lib/types'
import type { AgentClient } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { uptimeKey } from '../../lib/keys'
import { useThemeStore } from '../../store/theme'
import { isAuthError } from './apiHelpers'
import { dateTime, duration, hours } from '../../lib/format'
import { UptimeStat, type UptimeDelta } from './UptimeStat'

// echarts 体积不小（按需引入后仍 ~170KB gzip），单独切成异步 chunk：
// 首屏不含它，只有打开详情页的「开机统计」时才拉。
const UptimeBarChart = lazy(() =>
  import('./UptimeBarChart').then((m) => ({ default: m.UptimeBarChart })),
)

/** 启停事件的短标签与配色（比 Badge 更紧凑，明细区要放两列） */
const KIND: Record<BootEvent['kind'], { label: string; cls: string }> = {
  boot: { label: '开机', cls: 'border-ok/30 bg-ok/12 text-ok' },
  shutdown: { label: '关机', cls: 'border-line bg-elevated text-fg-soft' },
  sleep: { label: '睡眠', cls: 'border-cyan/30 bg-cyan/12 text-cyan' },
  wake: { label: '唤醒', cls: 'border-accent/35 bg-accent/15 text-accent-soft' },
  crash: { label: '异常', cls: 'border-danger/30 bg-danger/12 text-danger' },
}

/** `2026-10` → `10 月`；格式不对就原样返回，不猜 */
function monthLabel(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? `${Number(month.slice(5))} 月` : month
}

/**
 * 环比（百分比）。
 *
 * 除零保护是这里的重点：上月开机时长为 0（新机器、或那个月完全没开机）时，
 * 任何百分比都是 +∞，所以**直接返回 null 不显示**，由调用方退化成一枚文字说明。
 * 另外上月/本月缺数据、非有限数、四舍五入后为 0% 的情况也一并处理。
 */
function ratioDelta(cur: number, prev: number | null | undefined): UptimeDelta | null {
  if (typeof prev !== 'number' || !Number.isFinite(prev) || prev <= 0) return null
  if (!Number.isFinite(cur) || cur <= 0) return null
  const pct = ((cur - prev) / prev) * 100
  if (!Number.isFinite(pct)) return null
  if (Math.abs(pct) < 0.5) return { text: '较上月 持平', trend: 'flat' }
  return {
    text: `较上月 ${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`,
    trend: pct > 0 ? 'up' : 'down',
  }
}

/** 次数环比用绝对差：3 次变 5 次说「+200%」没意义 */
function countDelta(cur: number, prev: number | null | undefined): UptimeDelta | null {
  if (typeof prev !== 'number' || !Number.isFinite(prev)) return null
  const diff = cur - prev
  if (!Number.isFinite(diff)) return null
  if (diff === 0) return { text: '较上月 持平', trend: 'flat' }
  return {
    text: `较上月 ${diff > 0 ? '+' : '−'}${Math.abs(diff)} 次`,
    trend: diff > 0 ? 'up' : 'down',
  }
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
    // 服务端本身就把这份历史缓存 3 分钟（读事件日志很贵），前端同步用 3 分钟，
    // 切页回来直接命中，不再重新拉一遍。
    { key: uptimeKey(client, 90), ttlMs: 3 * 60_000 },
  )

  const theme = useThemeStore((st) => st.theme)
  const months: UptimeMonth[] = hist.data?.months ?? []
  const days = hist.data?.days ?? []
  const totals = hist.data?.totals

  // months 由后端按时间正序给满 12 项：末项是本月，倒数第二是上月
  const cur = months.length > 0 ? months[months.length - 1] : null
  const prev = months.length > 1 ? months[months.length - 2] : null
  const peak = months.reduce<UptimeMonth | null>(
    (best, m) => (!best || m.longestSec > best.longestSec ? m : best),
    null,
  )
  const activeMonths = months.filter((m) => m.onSec > 0).length
  const sumOnSec = months.reduce((sum, m) => sum + m.onSec, 0)

  // 老版本 Agent 没有 months：用近 7 天兜底，别让整卡空白
  const snap = cur
    ? {
        scope: '本月',
        onSec: cur.onSec,
        boots: cur.boots,
        avgUptimeSec: cur.avgUptimeSec,
        longestSec: cur.longestSec,
        monthText: monthLabel(cur.month),
      }
    : {
        scope: '近 7 天',
        onSec: totals?.onSec7d ?? 0,
        boots: totals?.boots7d ?? 0,
        avgUptimeSec: totals?.avgUptimeSec ?? 0,
        longestSec: totals?.longestSec ?? 0,
        monthText: monthLabel(''),
      }
  const prevForDelta = cur ? prev : null

  const monthlyBars = months.map((m) => ({
    date: m.month,
    label: monthLabel(m.month),
    onSec: m.onSec,
    boots: m.boots,
  }))
  const dailyBars = days.slice(-14).map((d) => ({
    date: d.date,
    label: d.date.slice(5),
    onSec: d.onSec,
    boots: d.boots,
  }))
  const bars = monthlyBars.length > 0 ? monthlyBars : dailyBars
  const isMonthly = monthlyBars.length > 0

  const events = [...(hist.data?.boots ?? [])]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8)
  const hasAny = months.some((m) => m.onSec > 0 || m.boots > 0) || (hist.data?.boots?.length ?? 0) > 0

  const noPrevNote = `${snap.monthText} · 上月无记录`

  // 环比徽章可能因为"上月为 0 / 没有上月"而不显示，此时副标题要如实交代原因，
  // 不能让用户以为涨跌是 0%（这也是防除零之后必须补的一句文案）。
  const prevOnSec = prevForDelta?.onSec ?? null
  const prevBoots = prevForDelta?.boots ?? null
  const sameMonth = prevForDelta !== null && prevOnSec !== null && prevBoots !== null
  const hintOnSec = !sameMonth
    ? `${snap.monthText || '近 7 天'} · 无上月对比`
    : prevOnSec > 0
      ? `${snap.monthText} · 上月 ${hours(prevOnSec)} 小时`
      : noPrevNote
  const hintBoots = !sameMonth
    ? `${snap.monthText || '近 7 天'} · 无上月对比`
    : prevBoots > 0
      ? `${snap.monthText} · 上月 ${prevBoots} 次`
      : noPrevNote

  return (
    <Card>
      <SectionTitle
        title="开机统计"
        desc="近 12 个月按月聚合 · 取自系统事件日志"
        icon={<CalendarClock size={16} />}
        action={
          <button
            type="button"
            aria-label="刷新开机统计"
            onClick={hist.reload}
            disabled={hist.loading}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-elevated text-muted transition-colors hover:bg-elevated-2 hover:text-fg disabled:opacity-40"
          >
            <RotateCw size={13} className={hist.loading ? 'animate-spin' : undefined} />
          </button>
        }
      />

      {hist.error ? (
        <div className="mt-3.5 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3">
          <p className="text-[12.5px] text-danger">{hist.error}</p>
          <Button size="sm" variant="secondary" className="mt-2.5 h-8" onClick={hist.reload}>
            重试
          </Button>
        </div>
      ) : hist.loading && !hist.data ? (
        <div className="mt-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[76px] w-full" />
            ))}
          </div>
          <Skeleton className="h-[196px] w-full" />
          <Skeleton className="h-[92px] w-full" />
        </div>
      ) : !hist.data || !hasAny ? (
        <p className="py-8 text-center text-[12.5px] text-muted">暂无开机记录</p>
      ) : (
        <>
          {/* ① 大数字指标：和「实时状态」同一套视觉语言 */}
          <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <UptimeStat
              label={`${snap.scope}开机`}
              icon={<Clock size={11} />}
              value={hours(snap.onSec)}
              unit="小时"
              delta={ratioDelta(snap.onSec, prevForDelta?.onSec)}
              hint={hintOnSec}
            />
            <UptimeStat
              label={`${snap.scope}启动`}
              icon={<Power size={11} />}
              value={snap.boots}
              unit="次"
              delta={countDelta(snap.boots, prevForDelta?.boots)}
              hint={hintBoots}
            />
            <UptimeStat
              label="平均单次"
              icon={<Timer size={11} />}
              value={snap.avgUptimeSec > 0 ? duration(snap.avgUptimeSec, 'short') : '—'}
              delta={ratioDelta(snap.avgUptimeSec, prevForDelta?.avgUptimeSec)}
              hint={
                prevForDelta ? `${snap.monthText} 共 ${snap.boots} 次` : `${snap.scope}共 ${snap.boots} 次`
              }
            />
            <UptimeStat
              label="最长单次"
              icon={<Hourglass size={11} />}
              value={snap.longestSec > 0 ? duration(snap.longestSec, 'short') : '—'}
              hint={
                !peak || peak.longestSec <= 0
                  ? '近 12 个月暂无记录'
                  : peak.month === cur?.month
                    ? '近 12 个月峰值就在本月'
                    : `12 个月峰值 ${duration(peak.longestSec, 'short')}（${monthLabel(peak.month)}）`
              }
            />
          </div>

          {/* 近 7 天与全年累计：一行小字带过，不再占一列 */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-faint">
            {cur && totals && (
              <>
                <span>
                  近 7 天 <span className="num text-fg-soft">{hours(totals.onSec7d)}</span> 小时
                </span>
                <span>
                  启动 <span className="num text-fg-soft">{totals.boots7d}</span> 次
                </span>
                <span>
                  平均{' '}
                  <span className="num text-fg-soft">
                    {totals.avgUptimeSec > 0 ? duration(totals.avgUptimeSec, 'short') : '—'}
                  </span>
                </span>
              </>
            )}
            <span>
              12 个月累计 <span className="num text-fg-soft">{hours(sumOnSec)}</span> 小时
            </span>
            <span>
              有记录 <span className="num text-fg-soft">{activeMonths}</span> / {months.length || 12} 个月
            </span>
          </div>

          {/* ② 趋势面板：和实时状态的迷你趋势图同款容器 */}
          <div className="mt-3.5 rounded-xl border border-line bg-elevated px-3 pb-2 pt-2.5">
            <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px] text-faint">
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                {isMonthly ? '按月开机时长' : '按日开机时长（近 14 天）'}
              </span>
              <span className="num truncate text-fg-soft">
                {isMonthly ? `${snap.monthText} ${hours(snap.onSec)} 小时` : `${bars.length} 天`}
                {isMonthly && <span className="text-faint"> · 启动 {snap.boots} 次</span>}
              </span>
            </div>
            {bars.length > 0 ? (
              <Suspense fallback={<Skeleton className="h-[172px] w-full" />}>
                <UptimeBarChart data={bars} theme={theme} monthly={isMonthly} />
              </Suspense>
            ) : (
              <Skeleton className="h-[172px] w-full" />
            )}
          </div>

          {/* ③ 启停明细：紧凑两列，不再是一条占半屏的长列表 */}
          <div className="mt-3 border-t border-line-soft pt-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-[0.08em] text-faint">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock size={12} />
                最近启停
              </span>
              <span className="num normal-case tracking-normal">
                {events.length > 0 ? `${events.length} 条` : '—'}
              </span>
            </div>
            {events.length === 0 ? (
              <p className="text-[12px] text-muted">暂无事件</p>
            ) : (
              <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {events.map((e, i) => {
                  const meta = KIND[e.kind] ?? KIND.boot
                  return (
                    <li
                      key={`${e.at}-${i}`}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-md px-1.5 py-[3px] transition-colors hover:bg-hover"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`inline-flex h-[18px] shrink-0 items-center rounded-full border px-1.5 text-[10.5px] font-medium ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                        <span className="num truncate text-[11.5px] text-fg-soft">
                          {dateTime(e.at)}
                        </span>
                      </span>
                      <span className="num shrink-0 text-[11px] text-muted">
                        {e.uptimeSec > 0 ? duration(e.uptimeSec, 'short') : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
