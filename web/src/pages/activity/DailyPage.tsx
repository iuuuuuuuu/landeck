import { lazy, Suspense, useState } from 'react'
import { Card, SectionTitle, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { activityRankKey, activitySummaryKey } from '../../lib/activityKeys'
import { CAT_LABEL, catColor, fetchRank, fetchSummary } from '../../lib/activityApi'
// echarts 体积大：图表全部按 UptimePanel/UptimeBarChart 的 lazy 模式切成异步 chunk，
// 不让主包背着 echarts（Lead 实测主包 664→1231KB 就是它挤进来的）
const StackedBarChart = lazy(() =>
  import('../../components/activity/StackedBarChart').then((m) => ({ default: m.StackedBarChart })),
)
import { CategoryRankList, RankList } from '../../components/activity/RankList'
import { AppDetailPanel } from '../../components/activity/AppDetailPanel'
import { fmtDur } from '../../components/activity/bits'
import { useTheme } from '../../store/theme'
import { ActivityPageHeader, DateNav, LoadError, NoDeviceGuide, StatCard, addDays, prettyDate, todayStr, useActivityTarget } from './shared'
import { DevicePicker, SegmentedTabs } from '../../components/shell'

/** 详情浮层的打开参数（排行行 → 浮层）。cat 收 string 以兼容自建类别。 */
export interface AppDetailOpen {
  app: string
  cat: string
}

/**
 * 日统计 /activity/daily
 * 24 小时 × 类别堆叠柱（时段/占比切换）+ 最常用应用/最常用分类双卡排行。
 * 点应用行打开详情浮层（窗口标题/域名分组）。
 */
export default function ActivityDailyPage() {
  const { device, devices, setDeviceId, pairedCount, localAvailable } = useActivityTarget()
  const { theme } = useTheme()
  const [date, setDate] = useState(todayStr())
  const [mode, setMode] = useState<'hours' | 'share'>('hours')
  const [detail, setDetail] = useState<AppDetailOpen | null>(null)

  const summary = useAsync(() => fetchSummary(device, device.token, { scope: 'day', date }), [date, device.host, device.port, device.token], {
    key: activitySummaryKey(device, 'day', date),
    ttlMs: 3 * 60_000,
  })
  const rank = useAsync(() => fetchRank(device, device.token, { scope: 'day', date }), [date, device.host, device.port, device.token], {
    key: activityRankKey(device, 'day', date),
    ttlMs: 3 * 60_000,
  })

  if (!localAvailable && pairedCount === 0) return <NoDeviceGuide />
  if (summary.error)
    return (
      <div className="space-y-4">
        <ActivityPageHeader title="日统计" subtitle={date} />
        <LoadError error={summary.error} onRetry={summary.reload} />
      </div>
    )

  const s = summary.data?.data
  const r = rank.data?.data
  const demo = !!summary.data?.demo || !!rank.data?.demo

  return (
    <div className="space-y-4">
      <ActivityPageHeader
        title="日统计"
        subtitle={s ? `${prettyDate(s.date)} · 总计 ${fmtDur(s.totalSec)}` : date}
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
                label={date}
                onPrev={() => setDate((d) => addDays(d, -1))}
                onNext={() => setDate((d) => addDays(d, 1))}
                onToday={() => setDate(todayStr())}
              />
            </div>
          </>
        }
      >
        {!s ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <StackedBarChart slots={s.slots} theme={theme} mode={mode} workband={s.workband} />
            </Suspense>
            {/* 图例：类别色点 + 文案，颜色走统一映射 */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1.5 pb-1">
              {r?.categories.map((c) => (
                <span key={c.cat} className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: catColor(c.cat) }} />
                  {CAT_LABEL[c.cat]}
                </span>
              ))}
            </div>
          </>
        )}
      </StatCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="px-4 py-3">
            <SectionTitle title="最常用应用" desc={r ? `合计 ${fmtDur(r.apps.reduce((a, x) => a + x.sec, 0))}` : undefined} />
          </div>
          {!r ? <Skeleton className="mx-4 mb-4 h-56" /> : <RankList items={r.apps} target={device} onSelectApp={(app, cat) => setDetail({ app, cat })} />}
        </Card>
        <Card className="p-0">
          <div className="px-4 py-3">
            <SectionTitle title="最常用分类" desc={r ? `合计 ${fmtDur(r.categories.reduce((a, x) => a + x.sec, 0))}` : undefined} />
          </div>
          {!r ? <Skeleton className="mx-4 mb-4 h-56" /> : <CategoryRankList items={r.categories} />}
        </Card>
      </div>

      {detail && (
        <AppDetailPanel device={device} app={detail.app} date={date} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}
