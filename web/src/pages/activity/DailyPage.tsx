import { lazy, Suspense, useState } from 'react'
import { Card, SectionTitle, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { activityRankKey, activitySummaryKey } from '../../lib/activityKeys'
import { CAT_LABEL, fetchRank, fetchSummary } from '../../lib/activityApi'
// echarts 体积大：图表全部按 UptimePanel/UptimeBarChart 的 lazy 模式切成异步 chunk，
// 不让主包背着 echarts（Lead 实测主包 664→1231KB 就是它挤进来的）
const StackedBarChart = lazy(() =>
  import('../../components/activity/StackedBarChart').then((m) => ({ default: m.StackedBarChart })),
)
import { CategoryRankList, RankList } from '../../components/activity/RankList'
import { AppDetailPanel } from '../../components/activity/AppDetailPanel'
import { CategoryIcon, fmtDur } from '../../components/activity/bits'
import { useTheme } from '../../store/theme'
import { useT } from '../../i18n'
import { AGG_DEVICE_ID, ActivityPageHeader, DateNav, LoadError, NoDeviceGuide, StatCard, addDays, makeAggDevice, prettyDate, todayStr, useActivityTarget, useSyncAgg } from './shared'
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
  const t = useT('activity')
  const { device, devices, setDeviceId, pairedCount, localAvailable } = useActivityTarget()
  // 十期 A1：多设备汇总——/sync/status 的 devices 非空时选择器出现「全部设备（汇总）」
  const [agg, setAgg] = useState(false)
  const syncQ = useSyncAgg(device)
  const aggAvailable = (syncQ.data?.data?.devices?.length ?? 0) > 0
  const isAgg = agg && aggAvailable
  const { theme } = useTheme()
  const [date, setDate] = useState(todayStr())
  const [mode, setMode] = useState<'hours' | 'share'>('hours')
  const [detail, setDetail] = useState<AppDetailOpen | null>(null)

  const summary = useAsync(() => fetchSummary(device, device.token, { scope: 'day', date, scopeAgg: isAgg ? 'all' : undefined }), [date, device.host, device.port, device.token, isAgg], {
    key: activitySummaryKey(device, 'day', date, isAgg),
    ttlMs: 3 * 60_000,
  })
  const rank = useAsync(() => fetchRank(device, device.token, { scope: 'day', date, scopeAgg: isAgg ? 'all' : undefined }), [date, device.host, device.port, device.token, isAgg], {
    key: activityRankKey(device, 'day', date, isAgg),
    ttlMs: 3 * 60_000,
  })

  if (!localAvailable && pairedCount === 0) return <NoDeviceGuide />
  if (summary.error)
    return (
      <div className="space-y-4">
        <ActivityPageHeader title={isAgg ? '日统计 · 全部设备' : '日统计'} subtitle={date} />
        <LoadError error={summary.error} onRetry={summary.reload} />
      </div>
    )

  const s = summary.data?.data
  const r = rank.data?.data
  const demo = !!summary.data?.demo || !!rank.data?.demo

  return (
    <div className="space-y-4">
      <ActivityPageHeader
        title={isAgg ? t('daily.title') + ' · 全部设备' : t('daily.title')}
        subtitle={s ? `${prettyDate(s.date)} · ${t('daily.total', { duration: fmtDur(s.totalSec) })}` : date}
        demo={demo}
      />

      <StatCard
        toolbar={
          <>
            <SegmentedTabs
              items={[
                { key: 'hours', label: t('daily.viewHours') },
                { key: 'share', label: t('daily.viewShare') },
              ]}
              value={mode}
              onChange={setMode}
            />
            {/* 390px 下 DevicePicker(w-56)+DateNav 同行放不下：右组允许换行，下拉占满本行 */}
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <DevicePicker
                devices={aggAvailable ? [makeAggDevice(device), ...devices] : devices}
                value={isAgg ? AGG_DEVICE_ID : device.id}
                onChange={(id) => {
                  if (id === AGG_DEVICE_ID) setAgg(true)
                  else {
                    setAgg(false)
                    setDeviceId(id)
                  }
                }}
                className="w-full min-w-0 sm:w-56"
              />
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
                  <CategoryIcon cat={c.cat} size={13} />
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
            <SectionTitle title={t('daily.topApps')} desc={r ? `合计 ${fmtDur(r.apps.reduce((a, x) => a + x.sec, 0))}` : undefined} />
          </div>
          {!r ? <Skeleton className="mx-4 mb-4 h-56" /> : <RankList items={r.apps} target={device} token={device.token} onSelectApp={(app, cat) => setDetail({ app, cat })} />}
        </Card>
        <Card className="p-0">
          <div className="px-4 py-3">
            <SectionTitle title={t('daily.topCats')} desc={r ? `合计 ${fmtDur(r.categories.reduce((a, x) => a + x.sec, 0))}` : undefined} />
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
