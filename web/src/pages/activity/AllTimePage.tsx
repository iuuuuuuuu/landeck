import { useMemo, useState } from 'react'
import { Card, SectionTitle, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { activityRankKey, activityYearKey } from '../../lib/activityKeys'
import { fetchRank, fetchYearDays } from '../../lib/activityApi'
import { HeatMap, MonthCalendar } from '../../components/activity/HeatMap'
import { CategoryRankList, RankList } from '../../components/activity/RankList'
import { AppDetailPanel } from '../../components/activity/AppDetailPanel'
import { fmtDur } from '../../components/activity/bits'
import { ActivityPageHeader, LoadError, NoDeviceGuide, prettyDate, todayStr, useActivityTarget } from './shared'
import type { AppDetailOpen } from './DailyPage'

/**
 * 全部历史 /activity/all
 * 年热力图（格阵）+ 月历，点选任意一天 → 下方排行联动只统计这一天。
 *
 * 数据源：优先 scope=year 单请求（agent-activity 对齐中）；agent 未支持时内部
 * 回退 12×month 拼装（settings 已单飞，不再翻倍）。全年走 queryCache（3 分钟 TTL）。
 */
export default function ActivityAllTimePage() {
  const { device, pairedCount, localAvailable } = useActivityTarget()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr())
  // B2 拖选放大区间：设置后热力图/月历只显示该区间，排行按区间起点所在月联动
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [detail, setDetail] = useState<AppDetailOpen | null>(null)

  // 全年 12 个月一次拉齐（内部各自命中/写入缓存）
  // 全年数据：优先 scope=year 单请求（agent-activity 对齐中，已提需求），
  // 未上线时 fetchYearDays 内部回退 12×month（settings 已单飞，不再翻倍）
  const yearQ = useAsync(() => fetchYearDays(device, device.token, year), [year, device.host, device.port, device.token], {
    key: activityYearKey(device, year),
    ttlMs: 3 * 60_000,
  })
  // 排行联动：拖选区间且未点天 → 区间起点所在月（契约无区间排行端点，按月粒度并标注）；
  // 点选某天 → scope=day 联动该天
  const rankScope: 'day' | 'month' | null = selectedDate ? 'day' : range ? 'month' : null
  const rankDate = selectedDate ?? (range ? range.from.slice(0, 7) : '')
  const rank = useAsync(
    rankScope ? () => fetchRank(device, device.token, { scope: rankScope, date: rankDate }) : null,
    [rankScope, rankDate, device.host, device.port, device.token],
    { key: rankScope ? activityRankKey(device, rankScope, rankDate) : '', ttlMs: 3 * 60_000 },
  )

  const daysAll = useMemo(() => yearQ.data?.data.days ?? [], [yearQ.data])
  const days = useMemo(
    () => (range ? daysAll.filter((d) => d.date >= range.from && d.date <= range.to) : daysAll),
    [daysAll, range],
  )
  const rangeDays = useMemo(
    () => (range ? daysAll.filter((d) => d.date >= range.from && d.date <= range.to) : []),
    [daysAll, range],
  )
  const rangeTotal = rangeDays.reduce((a, d) => a + d.sec, 0)
  const rangeActive = rangeDays.filter((d) => d.sec > 0).length
  const rangeAvg = rangeActive > 0 ? Math.round(rangeTotal / rangeActive) : 0
  const demo = !!yearQ.data?.demo
  const monthDays = useMemo(
    () => days.filter((d) => d.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)),
    [days, year, month],
  )
  const yearTotal = days.reduce((a, d) => a + d.sec, 0)
  const activeDays = days.filter((d) => d.sec > 0).length

  if (!localAvailable && pairedCount === 0) return <NoDeviceGuide />
  if (yearQ.error)
    return (
      <div className="space-y-4">
        <ActivityPageHeader title="全部历史" subtitle="按年查看活动分布" />
        <LoadError error={yearQ.error} onRetry={yearQ.reload} />
      </div>
    )

  return (
    <div className="space-y-4">
      <ActivityPageHeader
        title="全部历史"
        subtitle={`${year} 年 · 总计 ${fmtDur(yearTotal)} · 活跃 ${activeDays} 天`}
        demo={demo}
      />

      <Card className="min-w-0 overflow-hidden">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle title="年表" desc="颜色越深当天用得越久；点选某天，下方排行只统计这一天" />
          <div className="flex items-center gap-2">
            {range && (
              <button
                type="button"
                onClick={() => {
                  setRange(null)
                  setSelectedDate(null)
                }}
                className="h-9 rounded-xl bg-accent px-3.5 text-[12.5px] font-medium text-white hover:opacity-90"
              >
                清除选择 {range.from.slice(5)}~{range.to.slice(5)}
              </button>
            )}
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              className="h-9 rounded-xl border border-line-soft bg-elevated px-3.5 text-[12.5px] text-fg-soft hover:bg-elevated/80"
            >
              {year - 1}
            </button>
            <span className="w-12 text-center text-[14px] font-semibold text-fg">{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              className="h-9 rounded-xl border border-line-soft bg-elevated px-3.5 text-[12.5px] text-fg-soft hover:bg-elevated/80"
            >
              {year + 1}
            </button>
          </div>
        </div>
        {!yearQ.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <HeatMap
              days={days}
              selectedDate={selectedDate}
              range={range}
              onRangeSelect={(f, t) => {
                setRange({ from: f, to: t })
                setSelectedDate(null)
                setMonth(Number(f.slice(5, 7)))
              }}
              onSelect={(d) => {
                setSelectedDate(d)
                setMonth(Number(d.slice(5, 7)))
              }}
            />
        )}
      </Card>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="min-w-0 overflow-hidden">
          <SectionTitle title={`${month} 月`} desc="月历 · 点选联动" />
          <MonthCalendar
            year={year}
            month={month}
            days={monthDays}
            selectedDate={selectedDate}
            onSelect={(d) => setSelectedDate(d)}
          />
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
              <button
                key={mm}
                type="button"
                onClick={() => setMonth(mm)}
                className={
                  'h-7 w-7 rounded-lg text-[11.5px] transition-colors ' +
                  (mm === month ? 'bg-accent text-white' : 'text-muted hover:bg-elevated')
                }
              >
                {mm}
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-0">
            <div className="px-4 py-3">
              <SectionTitle
                title={
                  selectedDate
                    ? `${prettyDate(selectedDate)} · 最常用应用`
                    : range
                      ? `${range.from.slice(5)} ~ ${range.to.slice(5)} · ${Number(range.from.slice(5, 7))}月排行`
                      : '选择一个日期'
                }
                desc={
                  rank.data?.data
                    ? rankScope === 'day'
                      ? `合计 ${fmtDur(rank.data.data.apps.reduce((a, x) => a + x.sec, 0))}`
                      : `区间合计 ${fmtDur(rangeTotal)} · 日均 ${fmtDur(rangeAvg)} · 活跃 ${rangeActive} 天（排行按月粒度）`
                    : undefined
                }
              />
            </div>
            {!selectedDate || !rank.data ? (
              <Skeleton className="mx-4 mb-4 h-56" />
            ) : (
              <RankList
                items={rank.data.data.apps}
                target={device}
                token={device.token}
                onSelectApp={(app, cat) => setDetail({ app, cat })}
              />
            )}
          </Card>
          <Card className="p-0">
            <div className="px-4 py-3">
              <SectionTitle title="最常用分类" />
            </div>
            {!selectedDate || !rank.data ? (
              <Skeleton className="mx-4 mb-4 h-40" />
            ) : (
              <CategoryRankList items={rank.data.data.categories} />
            )}
          </Card>
        </div>
      </div>

      {detail && selectedDate && (
        <AppDetailPanel device={device} app={detail.app} date={selectedDate} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
