import {
  BarChart3,
  Boxes,
  CalendarClock,
  HardDrive,
  ListTree,
  Users,
} from 'lucide-react'
import { Badge, Card, EmptyState, MeterRow, MiniBars, ProgressBar, SectionTitle, Skeleton } from '../ui'
import type { StatsOverview } from '../../lib/types'
import { relative } from '../../lib/format'
import { StatsHero } from './StatsHero'

/**
 * 统计页主体，三层信息层级：
 *   1. 主视觉（StatsHero）：大数字 + 迷你趋势 + CPU/内存双环
 *   2. 规模与活动：应用/进程、客户端、定时、操作总数 —— 紧凑指标网格
 *   3. 明细：磁盘、操作趋势、操作分类、操作来源 —— 两列、items-start 不强拉齐
 */
export function StatsPanel({
  data,
  loading,
  isSelf = false,
}: {
  data: StatsOverview | null
  loading: boolean
  /** 当前统计目标是否为本机；决定主视觉卡片挂「本机画像」还是「远程设备」 */
  isSelf?: boolean
}) {
  const days = data?.activity?.days ?? []
  // data 只会在重新拉取时整体替换，这里不必再 memo
  const bars = days.map((d) => ({
    label: d.date.slice(5),
    value: d.total,
    hint: `${d.date} · ${d.total} 次${d.failed > 0 ? `（失败 ${d.failed}）` : ''}`,
  }))

  if (loading && !data) return <StatsSkeleton />
  if (!data) {
    return (
      <Card>
        <EmptyState
          icon={<BarChart3 size={24} />}
          title="暂无统计数据"
          desc="被控端还没有攒出运行记录，或者此刻联系不上。启动被控端后点右上角「刷新」。"
        />
      </Card>
    )
  }

  const { counts, activity: acts, realtime } = data
  const disks = realtime?.disks ?? []
  const totalDisk = disks.reduce((s, d) => s + d.total, 0)
  const usedDisk = disks.reduce((s, d) => s + d.used, 0)

  return (
    <div className="space-y-3">
      {/* 第一层：主视觉 */}
      <StatsHero data={data} isSelf={isSelf} />

      {/* 第二层：规模与活动 */}
      <Card>
        <SectionTitle
          title="规模与活动"
          desc="这台机器上有多少东西在被管着"
          icon={<Boxes size={16} />}
        />
        <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            label="应用 / 进程"
            value={`${counts.apps} / ${counts.processes}`}
            hint="按应用聚合"
          />
          <Metric label="已配对客户端" value={String(counts.clients)} unit="台" hint="能远程操作它" />
          <Metric label="定时任务" value={String(counts.schedules)} unit="条" hint="到点自动执行" />
          <Metric
            label="操作总数"
            value={String(acts.total)}
            unit="次"
            hint={acts.failed > 0 ? `其中失败 ${acts.failed} 次` : '全部成功'}
            tone={acts.failed > 0 ? 'warn' : 'ok'}
          />
        </div>
      </Card>

      {/* 第三层：明细（两列，卡片各自按内容高度，不互相拉伸） */}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <DetailCard
          title="磁盘占用"
          desc={
            disks.length > 0
              // 注意：API 返回的 used/total 单位是 **GB**（LiveStats 也是按 GB 显示的），
              // 之前这里错用 bytes() 当字节格式化，1.9 GB 被显示成「1.9 KB」。
              ? `共 ${disks.length} 个分区 · 合计 ${usedDisk.toFixed(0)} / ${totalDisk.toFixed(0)} GB`
              : '未读到磁盘信息'
          }
          icon={<HardDrive size={16} />}
        >
          {disks.length === 0 ? (
            <Empty text="暂无数据" />
          ) : (
            <div className="space-y-3">
              {disks.map((d) => (
                <MeterRow
                  key={d.mount}
                  label={
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className="num truncate text-fg">{d.mount}</span>
                      <span className="shrink-0 text-[11px] text-faint">{d.fs}</span>
                    </span>
                  }
                  sub={`${d.used} / ${d.total} GB · ${d.percent}%`}
                  percent={Math.max(0, Math.min(100, d.percent))}
                  tone={d.percent >= 90 ? 'danger' : d.percent >= 75 ? 'warn' : 'accent'}
                />
              ))}
            </div>
          )}
        </DetailCard>

        <DetailCard
          title="操作趋势"
          desc={`近 ${days.length} 天 · 最忙的一天 ${acts.busiestDay || '—'}`}
          icon={<CalendarClock size={16} />}
          action={
            <Badge tone={acts.failed > 0 ? 'warn' : 'ok'} dot className="shrink-0">
              失败 {acts.failed}
            </Badge>
          }
        >
          {bars.length > 0 ? (
            <MiniBars data={bars} height={110} tone="accent" />
          ) : (
            <Empty text="暂无操作记录" />
          )}
        </DetailCard>

        <DetailCard title="操作分类" desc="按动作类型汇总" icon={<ListTree size={16} />}>
          {acts.actions.length === 0 ? (
            <Empty text="暂无数据" />
          ) : (
            <div className="space-y-2.5">
              {acts.actions.map((a) => {
                const pct = acts.total > 0 ? Math.round((a.total / acts.total) * 100) : 0
                return (
                  <div key={a.action} className="min-w-0">
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[12.5px] text-fg-soft">
                        {a.label || a.action}
                      </span>
                      <span className="num shrink-0 text-[11.5px] text-muted">
                        {a.total} 次 · {pct}%
                      </span>
                    </div>
                    {/* 与磁盘条同样的圆角与 6px 高度，视觉上是同一种「条」 */}
                    <ProgressBar value={pct} height={6} tone={a.failed > 0 ? 'warn' : 'accent'} />
                  </div>
                )
              })}
            </div>
          )}
        </DetailCard>

        <DetailCard title="操作来源" desc="哪个客户端用得最多" icon={<Users size={16} />}>
          {acts.clients.length === 0 ? (
            <Empty text="暂无数据" />
          ) : (
            <ul className="divide-y divide-line-soft">
              {acts.clients.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-[12.5px] text-fg-soft">{c.name}</span>
                  <span className="shrink-0 text-[11.5px] text-faint">
                    <span className="num text-muted">{c.total}</span> 次 · {relative(c.lastSeen)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DetailCard>
      </div>
    </div>
  )
}

/** 第二层的紧凑指标：数字 14px，和主视觉的 34px 拉开主次 */
function Metric({
  label,
  value,
  unit,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  unit?: string
  hint?: string
  tone?: 'default' | 'warn' | 'ok'
}) {
  const valueClass = tone === 'warn' ? 'text-warn' : 'text-fg'
  return (
    <div className="min-w-0 rounded-xl border border-line-soft bg-elevated px-3 py-2.5">
      <div className="truncate text-[11px] tracking-[0.04em] text-faint">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`num truncate text-[14px] font-semibold leading-none ${valueClass}`}>
          {value}
        </span>
        {unit && <span className="shrink-0 text-[11px] text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 truncate text-[11px] text-faint">{hint}</div>}
    </div>
  )
}

/** 第三层的统一卡片壳：标题 + 内容，高度由内容决定 */
function DetailCard({
  title,
  desc,
  icon,
  action,
  children,
}: {
  title: string
  desc?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="min-w-0">
      <SectionTitle title={title} desc={desc} icon={icon} action={action} />
      <div className="mt-3.5">{children}</div>
    </Card>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-2 text-[12px] text-muted">{text}</p>
}

/** 首屏骨架：形状照着三层来，数据到了不会跳版 */
function StatsSkeleton() {
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap gap-5">
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-[52px] w-full" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-[112px] w-[112px] rounded-full" />
            <Skeleton className="h-[112px] w-[112px] rounded-full" />
          </div>
        </div>
      </Card>
      <Card>
        <Skeleton className="h-4 w-24" />
        <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[68px] w-full" />
          ))}
        </div>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[180px] w-full rounded-[22px]" />
        ))}
      </div>
    </div>
  )
}
