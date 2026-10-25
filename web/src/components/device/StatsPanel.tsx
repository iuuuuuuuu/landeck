import { useMemo } from 'react'
import { Activity, CalendarClock, Cpu, HardDrive, ListTree, Users } from 'lucide-react'
import { Badge, Card, Gauge, MiniBars, SectionTitle, Skeleton, Stat } from '../ui'
import type { StatsOverview } from '../../lib/types'
import { bytes, dateTime, duration, hours, relative } from '../../lib/format'

/** 统计页：一台设备的整体画像（运行时长 / 资源 / 操作 / 规模） */
export function StatsPanel({ data, loading }: { data: StatsOverview | null; loading: boolean }) {
  const disks = data?.realtime?.disks ?? []
  const days = data?.activity.days ?? []
  const bars = useMemo(
    () =>
      days.map((d) => ({
        label: d.date.slice(5),
        value: d.total,
        hint: `${d.date} · ${d.total} 次${d.failed > 0 ? `（失败 ${d.failed}）` : ''}`,
      })),
    [days],
  )

  if (loading && !data) {
    return (
      <div className="grid gap-3 lg:grid-cols-12">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 lg:col-span-6" />
        ))}
      </div>
    )
  }
  if (!data) return null

  const up = data.uptime
  const acts = data.activity
  const totalDisk = disks.reduce((s, d) => s + d.total, 0)
  const usedDisk = disks.reduce((s, d) => s + d.used, 0)

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      {/* 概览：运行时长 + 规模 */}
      <Card className="lg:col-span-12">
        <SectionTitle
          title="总览"
          desc={`${data.device.name} · Agent ${data.device.agentVersion} · 生成于 ${dateTime(data.generatedAt)}`}
          icon={<Activity size={16} />}
        />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="已运行" value={duration(data.device.uptimeSec, 'short')} hint={`启动于 ${dateTime(data.device.bootTime)}`} tone="accent" />
          <Stat label="7 天开机" value={hours(up.totals.onSec7d)} unit="小时" hint={`启动 ${up.totals.boots7d} 次`} />
          <Stat label="平均单次" value={duration(up.totals.avgUptimeSec, 'short')} hint="近 7 天" />
          <Stat label="应用 / 进程" value={`${data.counts.apps} / ${data.counts.processes}`} hint="按应用聚合" />
          <Stat label="已配对客户端" value={data.counts.clients} unit="台" hint={`定时任务 ${data.counts.schedules} 条`} />
          <Stat label="操作总数" value={acts.total} unit="次" hint={acts.failed > 0 ? `失败 ${acts.failed}` : '全部成功'} />
        </div>
      </Card>

      {/* 实时资源 */}
      <Card className="flex h-full flex-col lg:col-span-5">
        <SectionTitle title="实时资源" desc="采样自最近一次状态帧" icon={<Cpu size={16} />} />
        <div className="mt-3 flex items-center justify-around">
          <Gauge value={data.realtime.cpu} size={124} label="CPU" tone={toneOf(data.realtime.cpu)} />
          <Gauge value={data.realtime.mem} size={124} label="内存" tone={toneOf(data.realtime.mem)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-xl border border-line-soft bg-elevated px-3 py-2">
            <div className="text-[11px] text-faint">内存用量</div>
            <div className="num mt-0.5 text-fg">
              {bytes(data.realtime.memUsed)} / {bytes(data.realtime.memTotal)}
            </div>
          </div>
          <div className="rounded-xl border border-line-soft bg-elevated px-3 py-2">
            <div className="text-[11px] text-faint">网络</div>
            <div className="num mt-0.5 text-fg">
              ↓{bytes(data.realtime.rxBps)}/s ↑{bytes(data.realtime.txBps)}/s
            </div>
          </div>
        </div>
        {data.realtime?.battery && (
          <div className="mt-2 flex items-center justify-between rounded-xl border border-line-soft bg-elevated px-3 py-2 text-[12px]">
            <span className="text-faint">电池</span>
            <span className="num text-fg">
              {data.realtime.battery.percent}%{data.realtime.battery.charging ? ' · 充电中' : ''}
            </span>
          </div>
        )}
      </Card>

      {/* 磁盘 */}
      <Card className="flex h-full flex-col lg:col-span-7">
        <SectionTitle
          title="磁盘占用"
          desc={`共 ${disks.length} 个分区 · 合计 ${bytes(usedDisk)} / ${bytes(totalDisk)}`}
          icon={<HardDrive size={16} />}
        />
        <div className="mt-3 space-y-3">
          {disks.length === 0 && <p className="text-[12px] text-faint">未读到磁盘信息</p>}
          {disks.map((d) => (
            <div key={d.mount}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                <span className="truncate text-fg-soft">
                  {d.mount} <span className="text-faint">{d.fs}</span>
                </span>
                <span className="num shrink-0 text-muted">
                  {d.used} / {d.total} GB · {d.percent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.max(1, Math.min(100, d.percent))}%`,
                    background:
                      d.percent >= 90
                        ? 'linear-gradient(90deg,#fb7185,#e11d48)'
                        : d.percent >= 70
                          ? 'linear-gradient(90deg,#fbbf24,#fb7185)'
                          : 'linear-gradient(90deg,#7c5cff,#22d3ee)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 操作趋势 */}
      <Card className="lg:col-span-12">
        <SectionTitle
          title="操作趋势"
          desc={`近 ${days.length} 天 · 最忙的一天 ${acts.busiestDay || '—'}`}
          icon={<CalendarClock size={16} />}
          action={
            <Badge tone={acts.failed > 0 ? 'warn' : 'ok'} dot>
              失败 {acts.failed}
            </Badge>
          }
        />
        <div className="mt-4">
          {bars.length > 0 ? (
            <MiniBars data={bars} height={110} tone="accent" />
          ) : (
            <p className="text-[12px] text-faint">还没有操作记录</p>
          )}
        </div>
      </Card>

      {/* 操作分类 */}
      <Card className="lg:col-span-6">
        <SectionTitle title="操作分类" desc="按动作类型汇总" icon={<ListTree size={16} />} />
        <div className="mt-3 divide-y divide-line-soft">
          {acts.actions.length === 0 && <p className="py-3 text-[12px] text-faint">暂无数据</p>}
          {acts.actions.map((a) => {
            const pct = acts.total > 0 ? Math.round((a.total / acts.total) * 100) : 0
            return (
              <div key={a.action} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">{a.action}</span>
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-track">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </span>
                <span className="num w-10 shrink-0 text-right text-[12px] text-muted">{a.total}</span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* 客户端 */}
      <Card className="lg:col-span-6">
        <SectionTitle title="操作来源" desc="哪个客户端用得最多" icon={<Users size={16} />} />
        <div className="mt-3 divide-y divide-line-soft">
          {acts.clients.length === 0 && <p className="py-3 text-[12px] text-faint">暂无数据</p>}
          {acts.clients.map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-[12.5px] text-fg-soft">{c.name}</span>
              <span className="shrink-0 text-[11.5px] text-faint">
                <span className="num text-muted">{c.total}</span> 次 · {relative(c.lastSeen)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function toneOf(v: number): 'accent' | 'warn' | 'danger' {
  if (v >= 90) return 'danger'
  if (v >= 70) return 'warn'
  return 'accent'
}
