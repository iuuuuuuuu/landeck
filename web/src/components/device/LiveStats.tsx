import { useMemo } from 'react'
import { Activity, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react'
import { Badge, Card, Gauge, MeterRow, SectionTitle, Skeleton, Sparkline } from '../ui'
import { useTicker, type LiveState } from '../../lib/hooks'
import { bps, bytes, dateTime, duration } from '../../lib/format'

type Tone = 'accent' | 'cyan' | 'warn' | 'danger' | 'ok'

function toneOf(pct: number): Tone {
  if (pct >= 88) return 'danger'
  if (pct >= 70) return 'warn'
  return 'accent'
}

/** 只在真拿到数字时返回，否则 null —— 不把未知伪装成 0 */
function numOrNull(v: number | undefined | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function Dash() {
  return <div className="text-[22px] font-medium text-faint">—</div>
}

export function LiveStats({ live }: { live: LiveState }) {
  const { status, connected, error, samples, lastAt } = live
  const tick = useTicker(1000)

  const cpuSeries = useMemo(() => samples.map((s) => s.cpu).slice(-120), [samples])
  const memSeries = useMemo(() => samples.map((s) => s.mem).slice(-120), [samples])
  const liveUptime = useMemo(
    () => (status ? status.uptimeSec + (lastAt ? Math.max(0, (Date.now() - lastAt) / 1000) : 0) : 0),
    // tick 只用于逼出新的时间差
    [status, lastAt, tick],
  )

  if (!status) {
    return (
      <Card>
        <SectionTitle title="实时状态" desc="CPU / 内存 / 磁盘 / 网络" icon={<Activity size={16} />} />
        {error ? (
          <div className="mt-3.5 flex items-center gap-2 rounded-xl border border-warn/25 bg-warn/10 px-3 py-2 text-[12px] text-warn">
            <RefreshCw size={12} className="animate-spin" />
            尚未收到状态帧，正在自动重试
          </div>
        ) : null}
        <div className="mt-4 flex justify-center gap-4">
          <Skeleton className="h-[124px] w-[124px] rounded-full" />
          <Skeleton className="h-[124px] w-[124px] rounded-full" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-[72px] w-full" />
          <Skeleton className="h-[72px] w-full" />
        </div>
        <div className="mt-4 space-y-2.5">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </Card>
    )
  }

  const cpuPct = numOrNull(status.cpu?.percent)
  const memPct = numOrNull(status.mem?.percent)
  const disks = status.disks ?? []
  const temps = status.temps ?? []
  const net = status.net
  const cpuCores = numOrNull(status.cpu?.cores)
  const cpuThreads = numOrNull(status.cpu?.threads)
  const memUsed = numOrNull(status.mem?.used)
  const memTotal = numOrNull(status.mem?.total)

  return (
    <Card>
      {!connected && (
        <div className="mb-3.5 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/12 px-3 py-2 text-[12px] text-warn">
          <RefreshCw size={12} className="animate-spin" />
          实时数据重连中，当前显示最后一次采样
        </div>
      )}

      <SectionTitle
        title="实时状态"
        desc={status.cpu?.model || '—'}
        icon={<Activity size={16} />}
        action={connected ? <Badge tone="ok" dot>实时</Badge> : undefined}
      />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="flex flex-col items-center">
          <Gauge
            value={cpuPct ?? 0}
            size={124}
            thickness={9}
            tone={toneOf(cpuPct ?? 0)}
            label="CPU"
            center={cpuPct === null ? <Dash /> : undefined}
          />
          <div className="num -mt-1 text-[11px] text-faint">
            {cpuCores === null ? '—' : `${cpuCores} 核`} /{' '}
            {cpuThreads === null ? '—' : `${cpuThreads} 线程`}
          </div>
        </div>
        <div className="flex flex-col items-center">
          <Gauge
            value={memPct ?? 0}
            size={124}
            thickness={9}
            tone={toneOf(memPct ?? 0)}
            label="内存"
            center={memPct === null ? <Dash /> : undefined}
          />
          <div className="num -mt-1 text-[11px] text-faint">
            {memUsed === null || memTotal === null
              ? '—'
              : `${bytes(memUsed)} / ${bytes(memTotal)}`}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <MiniSeries title="CPU 趋势" tone={toneOf(cpuPct ?? 0)} data={cpuSeries} suffix="%" />
        <MiniSeries title="内存趋势" tone={toneOf(memPct ?? 0)} data={memSeries} suffix="%" />
      </div>

      <div className="mt-4 space-y-2.5 border-t border-line-soft pt-3.5">
        <div className="flex items-center justify-between text-[11.5px] uppercase tracking-[0.08em] text-faint">
          <span>磁盘</span>
          <span className="num normal-case tracking-normal">
            {disks.length > 0 ? `${disks.length} 项` : '—'}
          </span>
        </div>
        {disks.length === 0 && <p className="text-[12px] text-muted">未检测到磁盘</p>}
        {disks.map((d) => (
          <MeterRow
            key={d.mount}
            label={
              <span className="inline-flex items-center gap-1.5">
                <span className="num text-fg">{d.mount}</span>
                <span className="text-[11px] text-faint">{d.fs}</span>
              </span>
            }
            sub={`${d.used.toFixed(0)} / ${d.total.toFixed(0)} GB · ${d.percent.toFixed(0)}%`}
            percent={Math.max(0, Math.min(100, d.percent))}
            tone={d.percent >= 90 ? 'danger' : d.percent >= 75 ? 'warn' : 'accent'}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line-soft pt-3.5">
        <div className="rounded-xl border border-line bg-elevated px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-faint">
            <ArrowDown size={12} className="text-cyan" />
            下行
          </div>
          <div className="num mt-1 text-[15px] font-semibold text-fg">
            {net ? bps(net.rxBps ?? 0) : '—'}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-elevated px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-faint">
            <ArrowUp size={12} className="text-accent-soft" />
            上行
          </div>
          <div className="num mt-1 text-[15px] font-semibold text-fg">
            {net ? bps(net.txBps ?? 0) : '—'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted">
        <span>
          运行时长 <span className="num text-fg-soft">{duration(liveUptime, 'short')}</span>
        </span>
        <span>
          启动于{' '}
          <span className="num text-fg-soft">{status.bootTime ? dateTime(status.bootTime) : '—'}</span>
        </span>
        {net?.iface && <span className="truncate">{net.iface}</span>}
      </div>

      {(status.battery || temps.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {status.battery && (
            <Badge tone={status.battery.charging ? 'ok' : 'neutral'} dot>
              电池 {status.battery.percent}%{status.battery.charging ? ' · 充电中' : ''}
            </Badge>
          )}
          {temps.slice(0, 4).map((t) => (
            <Badge key={t.name} tone={t.c >= 85 ? 'danger' : t.c >= 70 ? 'warn' : 'neutral'}>
              {t.name} <span className="num">{Math.round(t.c)}°</span>
            </Badge>
          ))}
        </div>
      )}
    </Card>
  )
}

function MiniSeries({
  title,
  data,
  tone,
  suffix,
}: {
  title: string
  data: number[]
  tone: Tone
  suffix?: string
}) {
  const last = data.length > 0 ? data[data.length - 1] : null
  return (
    <div className="rounded-xl border border-line bg-elevated px-3 pb-2 pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-faint">{title}</span>
        <span className="num text-[12px] text-fg-soft">
          {last === null ? '—' : `${last.toFixed(0)}${suffix ?? ''}`}
        </span>
      </div>
      {data.length >= 2 ? (
        <Sparkline data={data} height={44} tone={tone} className="mt-1.5" strokeWidth={1.6} />
      ) : (
        <div className="mt-1.5 grid h-[44px] place-items-center rounded-lg bg-elevated text-[11px] text-faint">
          采样中
        </div>
      )}
    </div>
  )
}
