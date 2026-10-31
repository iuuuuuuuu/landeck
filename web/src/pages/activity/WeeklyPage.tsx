import { lazy, Suspense, useState } from 'react'
import { Card, SectionTitle, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { activityRankKey, activitySummaryKey } from '../../lib/activityKeys'
import { fetchRank, fetchSummary } from '../../lib/activityApi'
// lazy 模式说明同 DailyPage：echarts 不进主包
const StackedBarChart = lazy(() =>
  import('../../components/activity/StackedBarChart').then((m) => ({ default: m.StackedBarChart })),
)
import { CategoryRankList, RankList } from '../../components/activity/RankList'
import { AppDetailPanel } from '../../components/activity/AppDetailPanel'
import { fmtDur } from '../../components/activity/bits'
import { useTheme } from '../../store/theme'
import { ActivityPageHeader, DateNav, LoadError, NoDeviceGuide, StatCard, addDays, todayStr, useActivityTarget } from './shared'
import { DevicePicker, SegmentedTabs } from '../../components/shell'
import type { AppDetailOpen } from './DailyPage'

/**
 * 周统计 /activity/weekly
 * 一周 7 天 × 类别堆叠。date 取周内任一天，agent 侧以它所在周为界（mock 同口径）。
 */
export default function ActivityWeeklyPage() {
  const { device, devices, setDeviceId, pairedCount, localAvailable } = useActivityTarget()
  const { theme } = useTheme()
  const [date, setDate] = useState(todayStr())
  const [mode, setMode] = useState<'hours' | 'share'>('hours')
  const [detail, setDetail] = useState<AppDetailOpen | null>(null)

  const summary = useAsync(() => fetchSummary(device, device.token, { scope: 'week', date }), [date, device.host, device.port, device.token], {
    key: activitySummaryKey(device, 'week', date),
    ttlMs: 3 * 60_000,
  })
  const rank = useAsync(() => fetchRank(device, device.token, { scope: 'week', date }), [date, device.host, device.port, device.token], {
    key: activityRankKey(device, 'week', date),
    ttlMs: 3 * 60_000,
  })

  if (!localAvailable && pairedCount === 0) return <NoDeviceGuide />
  if (summary.error)
    return (
      <div className="space-y-4">
        <ActivityPageHeader title="周统计" subtitle={date} />
        <LoadError error={summary.error} onRetry={summary.reload} />
      </div>
    )

  const s = summary.data?.data
  const r = rank.data?.data
  const demo = !!summary.data?.demo || !!rank.data?.demo
  const range = s && s.slots.length > 0 ? `${s.slots[0].key.slice(5)} ~ ${s.slots[6].key.slice(5)}` : date

  return (
    <div className="space-y-4">
      <ActivityPageHeader
        title="周统计"
        subtitle={s ? `${range} · 总计 ${fmtDur(s.totalSec)}` : date}
        demo={demo}
      />

      <StatCard
        toolbar={
          <>
            <SegmentedTabs
              items={[
                { key: 'hours', label: '时段' },
                { key: 'share', label: '占比' },
              ]}
              value={mode}
              onChange={setMode}
            />
            <div className="flex items-center gap-2">
              <DevicePicker devices={devices} value={device.id} onChange={setDeviceId} className="w-56" />
              <DateNav
                label={range}
                todayLabel="本周"
                onPrev={() => setDate((d) => addDays(d, -7))}
                onNext={() => setDate((d) => addDays(d, 7))}
                onToday={() => setDate(todayStr())}
              />
            </div>
          </>
        }
      >
        {!s ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          // 周视图只有 7 根柱，显示全部标签
          <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <StackedBarChart slots={s.slots} theme={theme} mode={mode} showEveryLabel />
          </Suspense>
        )}
      </StatCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="px-4 py-3">
            <SectionTitle title="最常用应用" desc={r ? `本周合计 ${fmtDur(r.apps.reduce((a, x) => a + x.sec, 0))}` : undefined} />
          </div>
          {!r ? <Skeleton className="mx-4 mb-4 h-56" /> : <RankList items={r.apps} target={device} onSelectApp={(app, cat) => setDetail({ app, cat })} />}
        </Card>
        <Card className="p-0">
          <div className="px-4 py-3">
            <SectionTitle title="最常用分类" desc={r ? `本周合计 ${fmtDur(r.categories.reduce((a, x) => a + x.sec, 0))}` : undefined} />
          </div>
          {!r ? <Skeleton className="mx-4 mb-4 h-56" /> : <CategoryRankList items={r.categories} />}
        </Card>
      </div>

      {detail && (
        // 周视图点应用：详情以「该应用本周合计」为准 —— date 传锚点日，agent 侧按周解析
        <AppDetailPanel device={device} app={detail.app} date={date} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
