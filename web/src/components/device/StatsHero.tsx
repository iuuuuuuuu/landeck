import { Activity, ArrowDown, ArrowUp } from 'lucide-react'
import { Badge, Card, Gauge, SectionTitle, Sparkline } from '../ui'
import type { StatsOverview } from '../../lib/types'
import { bps, bytes, dateTime, duration, hours, osLabel } from '../../lib/format'

type Tone = 'accent' | 'cyan' | 'warn' | 'danger' | 'ok'

/** 资源水位配色：与 LiveStats 同一套阈值，两处看到的颜色含义必须一致 */
function toneOf(pct: number): Tone {
  if (pct >= 88) return 'danger'
  if (pct >= 70) return 'warn'
  return 'accent'
}

/**
 * 统计页第一层：主视觉大卡。
 *
 * 左侧「核心数字 + 迷你趋势」回答「这台机器跑了多久、最近忙不忙」；
 * 右侧 CPU / 内存双环回答「现在累不累」。其余内容都往下沉到第二、三层，
 * 避免像旧版那样六块卡片平铺、每块都在喊同样大声。
 */
export function StatsHero({
  data,
  isSelf = false,
}: {
  data: StatsOverview
  /** 当前统计目标是不是「本机」。由调用方按 store 里设备的 local 标记传入 —— 那是唯一权威来源。 */
  isSelf?: boolean
}) {
  const { device, realtime, uptime } = data
  const days = uptime?.days ?? []
  const totals = uptime?.totals
  const battery = realtime?.battery ?? null

  // 每日开机小时数：固定 max=24，形状才是真实的「一天里开机多久」，而不是自归一化后的假波动
  const onHours = days.map((d) => d.onSec / 3600)

  const cpu = realtime?.cpu ?? 0
  const mem = realtime?.mem ?? 0

  return (
    <Card glow className="overflow-hidden">
      <SectionTitle
        title={<span className="block truncate">{device.name || '这台设备'}</span>}
        desc={`${osLabel(device.platform)} · Agent ${device.agentVersion || '—'} · 生成于 ${dateTime(data.generatedAt)}`}
        icon={<Activity size={16} />}
        action={
          // 「本机画像」只在真的看本机时才成立。之前这里写死显示，
          // 选中已配对的「公司电脑-M600」时也挂着「本机画像」，语义是错的。
          isSelf ? (
            <Badge tone="accent" dot className="hidden shrink-0 sm:inline-flex">
              本机画像
            </Badge>
          ) : (
            <Badge tone="neutral" dot className="hidden shrink-0 sm:inline-flex">
              远程设备
            </Badge>
          )
        }
      />

      <div className="mt-5 grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* 左：核心数字 + 迷你趋势 */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.1em] text-faint">已运行时长</div>
              {/* 全页唯一的超大数字：26 / 30 / 34px，窄屏也不会撑破卡片 */}
              <div className="num mt-1.5 truncate text-[26px] font-semibold leading-none text-fg sm:text-[30px] lg:text-[34px]">
                {duration(device.uptimeSec, 'short')}
              </div>
              <div className="num mt-1.5 text-[11.5px] text-faint">
                启动于 {dateTime(device.bootTime)}
              </div>
            </div>

            <div className="flex shrink-0 items-end gap-6">
              <Mini
                label="7 天开机"
                value={hours(totals?.onSec7d ?? 0)}
                unit="小时"
                hint={`平均 ${duration(totals?.avgUptimeSec ?? 0, 'short')} / 次`}
              />
              <Mini
                label="启动次数"
                value={String(totals?.boots7d ?? 0)}
                unit="次"
                hint={`最长 ${duration(totals?.longestSec ?? 0, 'short')}`}
              />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-line-soft bg-elevated px-3 pb-2 pt-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] text-faint">每日开机时长</span>
              <span className="num shrink-0 text-[11.5px] text-fg-soft">
                {days.length > 0 ? `近 ${days.length} 天` : '—'}
              </span>
            </div>
            {onHours.length >= 2 ? (
              <Sparkline
                data={onHours}
                height={52}
                tone="accent"
                min={0}
                max={24}
                strokeWidth={1.8}
                className="mt-1.5"
              />
            ) : (
              <div className="mt-1.5 grid h-[52px] place-items-center text-[11.5px] text-faint">
                暂无趋势数据
              </div>
            )}
          </div>
        </div>

        {/* 右：CPU / 内存双环 */}
        <div className="min-w-0 lg:w-[250px] lg:shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col items-center">
              <Gauge value={cpu} size={112} thickness={9} tone={toneOf(cpu)} label="CPU" />
              <div className="mt-1 text-[11px] text-faint">实时占用</div>
            </div>
            <div className="flex flex-col items-center">
              <Gauge value={mem} size={112} thickness={9} tone={toneOf(mem)} label="内存" />
              <div className="num mt-1 w-full truncate text-center text-[11px] text-faint">
                {bytes(realtime?.memUsed ?? 0)} / {bytes(realtime?.memTotal ?? 0)}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="min-w-0 rounded-xl border border-line-soft bg-elevated px-2.5 py-2">
              <div className="flex items-center gap-1 text-[11px] text-faint">
                <ArrowDown size={12} className="text-cyan" />
                下行
              </div>
              <div className="num mt-0.5 truncate text-[13px] font-semibold text-fg">
                {bps(realtime?.rxBps ?? 0)}
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-line-soft bg-elevated px-2.5 py-2">
              <div className="flex items-center gap-1 text-[11px] text-faint">
                <ArrowUp size={12} className="text-accent-soft" />
                上行
              </div>
              <div className="num mt-0.5 truncate text-[13px] font-semibold text-fg">
                {bps(realtime?.txBps ?? 0)}
              </div>
            </div>
          </div>

          {battery && (
            <div className="mt-2 flex justify-center">
              <Badge tone={battery.charging ? 'ok' : 'neutral'} dot>
                电池 {battery.percent}%{battery.charging ? ' · 充电中' : ''}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

/** 主视觉旁的两个次要数字：字号压到 14px，让 34px 的主数字独占视线焦点 */
function Mini({
  label,
  value,
  unit,
  hint,
}: {
  label: string
  value: string
  unit?: string
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="num text-[14px] font-semibold leading-none text-fg">{value}</span>
        {unit && <span className="text-[11px] text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 truncate text-[11px] text-faint">{hint}</div>}
    </div>
  )
}
