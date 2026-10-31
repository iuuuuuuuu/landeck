import { useMemo, useState } from 'react'
import { Card, SectionTitle, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { activityRankKey } from '../../lib/activityKeys'
import { cacheKey } from '../../lib/queryCache'
import { fetchRank, fetchSummary } from '../../lib/activityApi'
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
 * 数据源：契约里没有专门的"全年"接口，用 12 个月的 scope=month 汇总拼出全年日总时长
 * —— 每个月走 queryCache（3 分钟 TTL），翻年才重拉；mock 模式零成本。
 */
export default function ActivityAllTimePage() {
  const { device, pairedCount, localAvailable } = useActivityTarget()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr())
  const [detail, setDetail] = useState<AppDetailOpen | null>(null)

  // 全年 12 个月一次拉齐（内部各自命中/写入缓存）
  const yearQ = useAsync(
    () =>
      Promise.all(
        Array.from({ length: 12 }, (_, i) => fetchSummary(device, device.token, { scope: 'month', date: `${year}-${String(i + 1).padStart(2, '0')}` })),
      ),
    [year, device.host, device.port, device.token],
    { key: cacheKey(['activity-year', year, device.host, device.port, device.token]), ttlMs: 3 * 60_000 },
  )
  const rank = useAsync(
    selectedDate ? () => fetchRank(device, device.token, { scope: 'day', date: selectedDate }) : null,
    [selectedDate, device.host, device.port, device.token],
    { key: selectedDate ? activityRankKey(device, 'day', selectedDate) : '', ttlMs: 3 * 60_000 },
  )

  const days = useMemo(() => {
    const res = yearQ.data?.flatMap((r) => r.data.slots.map((s) => ({ date: s.key, sec: s.total }))) ?? []
    return res
  }, [yearQ.data])
  const demo = !!yearQ.data?.some((r) => r.demo)
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

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle title="年表" desc="颜色越深当天用得越久；点选某天，下方排行只统计这一天" />
          <div className="flex items-center gap-2">
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
          <HeatMap days={days} selectedDate={selectedDate} onSelect={(d) => { setSelectedDate(d); setMonth(Number(d.slice(5, 7))) }} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <SectionTitle title={`${month} 月`} desc="月历 · 点选联动" />
          <MonthCalendar
            year={year}
            month={month}
            days={monthDays}
            selectedDate={selectedDate}
            onSelect={(d) => setSelectedDate(d)}
          />
          <div className="mt-3 flex justify-center gap-1.5">
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
                title={selectedDate ? `${prettyDate(selectedDate)} · 最常用应用` : '选择一个日期'}
                desc={rank.data?.data ? `合计 ${fmtDur(rank.data.data.apps.reduce((a, x) => a + x.sec, 0))}` : undefined}
              />
            </div>
            {!selectedDate || !rank.data ? (
              <Skeleton className="mx-4 mb-4 h-56" />
            ) : (
              <RankList
                items={rank.data.data.apps}
                target={device}
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
