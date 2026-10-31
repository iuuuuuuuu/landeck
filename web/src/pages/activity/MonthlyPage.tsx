import { lazy, Suspense, useState } from 'react'
import { Card, SectionTitle, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { activityRankKey, activitySummaryKey } from '../../lib/activityKeys'
import { CAT_LABEL, catColor, fetchRank, fetchSummary } from '../../lib/activityApi'
import type { CatKey } from '../../lib/activityApi'
// lazy 模式说明同 DailyPage：echarts 不进主包
const StackedBarChart = lazy(() =>
  import('../../components/activity/StackedBarChart').then((m) => ({ default: m.StackedBarChart })),
)
const DonutChart = lazy(() =>
  import('../../components/activity/DonutChart').then((m) => ({ default: m.DonutChart })),
)
import { CategoryIcon, fmtDur } from '../../components/activity/bits'
import { useTheme } from '../../store/theme'
import { ActivityPageHeader, DateNav, LoadError, NoDeviceGuide, StatCard, addMonths, currentMonth, useActivityTarget } from './shared'

/** 环比差值的展示文案：正负号 + 小时分钟。 */
function deltaLabel(cur: number, prev: number): { text: string; up: boolean } {
  const d = cur - prev
  if (Math.abs(d) < 60) return { text: '持平', up: false }
  const h = Math.floor(Math.abs(d) / 3600)
  const m = Math.round((Math.abs(d) % 3600) / 60)
  const body = h > 0 ? `${h}h ${m}m` : `${m}m`
  return { text: `${d > 0 ? '+' : '−'}${body}`, up: d > 0 }
}

/**
 * 月统计 /activity/monthly
 * 天 × 类别堆叠 + 类别占比双环（点类别看构成）+ 环比卡片（对齐 Hindsight 月统计页）。
 * 环比要上月数据：同 key 结构再发一个 scope=month（走缓存，3 分钟内不重复拉）。
 */
export default function ActivityMonthlyPage() {
  const { device, pairedCount, localAvailable } = useActivityTarget()
  const { theme } = useTheme()
  const [month, setMonth] = useState(currentMonth())
  const [selectedCat, setSelectedCat] = useState<CatKey | null>(null)

  const summary = useAsync(() => fetchSummary(device, device.token, { scope: 'month', date: month }), [month, device.host, device.port, device.token], {
    key: activitySummaryKey(device, 'month', month),
    ttlMs: 3 * 60_000,
  })
  const rank = useAsync(() => fetchRank(device, device.token, { scope: 'month', date: month }), [month, device.host, device.port, device.token], {
    key: activityRankKey(device, 'month', month),
    ttlMs: 3 * 60_000,
  })
  // 上月（环比）：懒到位 —— 本月数据加载成功后再取，避免首屏双请求
  const prevMonth = addMonths(month, -1)
  const prev = useAsync(
    summary.data ? () => fetchSummary(device, device.token, { scope: 'month', date: prevMonth }) : null,
    [summary.data, prevMonth, device.host, device.port, device.token],
    { key: activitySummaryKey(device, 'month', prevMonth), ttlMs: 3 * 60_000 },
  )

  if (!localAvailable && pairedCount === 0) return <NoDeviceGuide />
  if (summary.error)
    return (
      <div className="space-y-4">
        <ActivityPageHeader title="月统计" subtitle={month} />
        <LoadError error={summary.error} onRetry={summary.reload} />
      </div>
    )

  const s = summary.data?.data
  const r = rank.data?.data
  const p = prev.data?.data
  const demo = !!summary.data?.demo || !!rank.data?.demo

  const [y, m] = month.split('-').map(Number)
  const daysWithActivity = s ? s.slots.filter((x) => x.total > 0).length : 0
  const dailyAvg = s && daysWithActivity > 0 ? Math.round(s.totalSec / daysWithActivity) : 0
  const prevDays = p ? p.slots.filter((x) => x.total > 0).length : 0
  const prevAvg = p && prevDays > 0 ? Math.round(p.totalSec / prevDays) : 0

  const monthDelta = s && p ? deltaLabel(s.totalSec, p.totalSec) : null
  const avgDelta = s && p ? deltaLabel(dailyAvg, prevAvg) : null
  // 占比最大的类别（有选中时显示该类别下的最大应用）
  const topCat = r?.categories[0]
  const topAppInCat =
    selectedCat && r
      ? [...r.apps].filter((a) => a.cat === selectedCat).sort((a, b) => b.sec - a.sec)[0]
      : undefined

  return (
    <div className="space-y-4">
      <ActivityPageHeader
        title="月统计"
        subtitle={s ? `${y} 年 ${m} 月 · 日均 ${fmtDur(dailyAvg)}` : month}
        demo={demo}
      />

      <StatCard
        toolbar={
          <>
            <span className="text-[12.5px] text-muted">{y} 年 {m} 月</span>
            <DateNav
              label={`${y}-${String(m).padStart(2, '0')}`}
              todayLabel="本月"
              onPrev={() => setMonth((mm) => addMonths(mm, -1))}
              onNext={() => setMonth((mm) => addMonths(mm, 1))}
              onToday={() => setMonth(currentMonth())}
            />
          </>
        }
      >
        {!s ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <StackedBarChart slots={s.slots} theme={theme} mode="hours" />
          </Suspense>
        )}
      </StatCard>

      {/* 环比卡片：较上月 / 日均 / 日均变化 / 最大构成 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: '本月总时长',
            value: s ? fmtDur(s.totalSec) : '—',
            delta: monthDelta,
          },
          {
            label: '日均时长',
            value: s ? fmtDur(dailyAvg) : '—',
            delta: avgDelta,
          },
          {
            label: '活跃天数',
            value: s ? `${daysWithActivity} 天` : '—',
            delta: null,
          },
          {
            label: selectedCat ? `${CAT_LABEL[selectedCat]} 构成` : '最大类别',
            value: topCat && !selectedCat ? CAT_LABEL[topCat.cat] : topAppInCat ? topAppInCat.app : '—',
            delta: null,
            cat: selectedCat ?? topCat?.cat,
          },
        ].map((card) => (
          <Card key={card.label} className="p-4">
            <div className="text-[11.5px] text-muted">{card.label}</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-[18px] font-semibold text-fg">{card.value}</span>
              {card.delta && card.delta.text !== '持平' && (
                <span className={'text-[12px] ' + (card.delta.up ? 'text-ok' : 'text-danger')}>
                  {card.delta.text}
                </span>
              )}
              {card.delta && card.delta.text === '持平' && <span className="text-[12px] text-faint">持平</span>}
            </div>
            {card.cat !== undefined && card.cat !== null && (
              <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: catColor(card.cat) }} />
                {topAppInCat && selectedCat ? `${CAT_LABEL[selectedCat]} · ${fmtDur(topAppInCat.sec)}` : topCat ? fmtDur(topCat.sec) : ''}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* 双环占比 + 图例 */}
      <Card>
        <SectionTitle title="类别占比" desc="点内环类别查看该类别下的应用构成" />
        {!s || !r ? (
          <Skeleton className="h-[300px] w-full" />
        ) : r.categories.length === 0 ? (
          <p className="py-14 text-center text-[12.5px] text-muted">本月还没有记录。</p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-[1fr_240px] lg:items-center">
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <DonutChart
              categories={r.categories}
              apps={r.apps}
              selected={selectedCat}
              onSelect={setSelectedCat}
              theme={theme}
            />
            </Suspense>
            {/* 图例：点选与图表联动 */}
            <ul className="space-y-1.5 lg:pl-2">
              {r.categories.map((c) => {
                const pct = Math.round((c.sec / (s.totalSec || 1)) * 100)
                const isSel = selectedCat === c.cat
                return (
                  <li key={c.cat}>
                    <button
                      type="button"
                      onClick={() => setSelectedCat(isSel ? null : c.cat)}
                      className={
                        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ' +
                        (isSel ? 'bg-elevated ring-1 ring-line-soft' : 'hover:bg-elevated/60')
                      }
                    >
                      <CategoryIcon cat={c.cat} size={13} />
                      <span className="flex-1 text-[13px] text-fg-soft">{CAT_LABEL[c.cat]}</span>
                      <span className="num text-[12.5px] tabular-nums text-muted">{pct}%</span>
                      <span className="num w-[74px] text-right text-[12.5px] tabular-nums text-fg-soft">{fmtDur(c.sec)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Card>
    </div>
  )
}
