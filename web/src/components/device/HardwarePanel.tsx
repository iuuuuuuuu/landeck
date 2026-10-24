import { useState } from 'react'
import clsx from 'clsx'
import { Button, Card, Segmented, Skeleton } from '../ui'
import { CircuitBoard, Cpu, HardDrive, MemoryStick, MonitorCog, Network, RotateCw } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { HardwareInfo } from '../../lib/types'
import { useAsync } from '../../lib/hooks'
import { isAuthError, isAuthMessage } from './apiHelpers'
import { bytes } from '../../lib/format'

type Tab = 'cpu' | 'mem' | 'gpu' | 'disk' | 'nic' | 'os'

/** 未拿到（或为 0 的未填充字段）一律显示破折号，不渲染假 0 */
function nz(v: number | undefined | null, unit = ''): string {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? `${v}${unit}` : '—'
}

function sizeOf(v: number | undefined | null): string {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? bytes(v) : '—'
}

/** 命中「0 核 / 0 线程」这类组合时整条降级为破折号 */
function ratio(a: number | undefined | null, b: number | undefined | null): string {
  const left = nz(a)
  const right = nz(b)
  if (left === '—' && right === '—') return '—'
  return `${left} / ${right}`
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'cpu', label: 'CPU' },
  { value: 'mem', label: '内存' },
  { value: 'gpu', label: '显卡' },
  { value: 'disk', label: '磁盘' },
  { value: 'nic', label: '网卡' },
  { value: 'os', label: '系统' },
]

export function HardwarePanel({
  client,
  onAuthError,
}: {
  client: AgentClient | null
  onAuthError?: () => void
}) {
  const [tab, setTab] = useState<Tab>('cpu')
  const hw = useAsync(
    client
      ? () =>
          client.hardware().catch((e: unknown) => {
            if (isAuthError(e)) onAuthError?.()
            throw e
          })
      : null,
    [client?.target.host, client?.target.port, client?.token],
  )

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-fg">硬件信息</h3>
          <p className="mt-0.5 text-[12px] text-muted">来自 Agent 的静态枚举，首次加载稍慢</p>
        </div>
        <button
          type="button"
          aria-label="刷新硬件信息"
          onClick={hw.reload}
          disabled={hw.loading}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          <RotateCw size={14} className={hw.loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <div className="no-scrollbar mt-3.5 -mx-1 overflow-x-auto px-1 pb-1">
        <Segmented value={tab} onChange={setTab} options={TABS} size="sm" className="min-w-max" />
      </div>

      <div className="mt-4">
        {hw.loading && !hw.data ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : hw.error ? (
          <div className="rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3">
            <p className="text-[12.5px] text-danger">
              {isAuthMessage(hw.error) ? '配对失效，请重新配对' : hw.error}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2.5 h-8"
              onClick={hw.reload}
              icon={<RotateCw size={13} />}
            >
              重试
            </Button>
          </div>
        ) : !hw.data ? (
          <p className="py-6 text-center text-[12.5px] text-muted">暂无硬件信息</p>
        ) : (
          <Body tab={tab} hw={hw.data} />
        )}
      </div>
    </Card>
  )
}

function Body({ tab, hw }: { tab: Tab; hw: HardwareInfo }) {
  const slots = hw.memory?.slots ?? []
  const gpus = hw.gpus ?? []
  const disks = hw.disks ?? []
  const nics = hw.nics ?? []
  if (tab === 'cpu') {
    return (
      <Group icon={<Cpu size={13} />} title={hw.cpu?.model || '处理器'}>
        <Row label="厂商" value={hw.cpu?.vendor || '—'} />
        <Row label="核心 / 线程" value={ratio(hw.cpu?.cores, hw.cpu?.threads)} />
        <Row label="基准频率" value={nz(hw.cpu?.baseMhz, ' MHz')} />
        <Row label="缓存" value={sizeOf(hw.cpu?.cacheKb ? hw.cpu.cacheKb * 1024 : null)} />
        <Row label="插槽" value={hw.cpu?.socket || '—'} />
      </Group>
    )
  }
  if (tab === 'mem') {
    return (
      <div className="space-y-3">
        <Group icon={<MemoryStick size={13} />} title="内存总览">
          <Row label="总容量" value={sizeOf(hw.memory?.totalBytes)} />
          <Row label="类型" value={hw.memory?.type || '—'} />
          <Row label="频率" value={nz(hw.memory?.speedMhz, ' MHz')} />
          <Row label="插槽数" value={slots.length > 0 ? String(slots.length) : '—'} />
        </Group>
        {slots.length === 0 ? (
          <p className="text-[12.5px] text-muted">未读取到内存插槽明细</p>
        ) : (
          slots.map((s) => (
            <Group key={s.bank} icon={<MemoryStick size={13} />} title={s.bank}>
              <Row label="容量" value={sizeOf(s.sizeBytes)} />
              <Row label="频率" value={nz(s.speedMhz, ' MHz')} />
              <Row label="厂商" value={s.manufacturer || '—'} />
              <Row label="型号" value={s.partNumber || '—'} />
            </Group>
          ))
        )}
      </div>
    )
  }
  if (tab === 'gpu') {
    if (gpus.length === 0) return <Empty text="未检测到独立显卡" />
    return (
      <div className="space-y-3">
        {gpus.map((g, i) => (
          <Group key={`${g.name}-${i}`} icon={<MonitorCog size={13} />} title={g.name}>
            <Row label="显存" value={g.vramMb > 0 ? `${(g.vramMb / 1024).toFixed(1)} GB` : '—'} />
            <Row label="驱动" value={g.driver || '—'} />
          </Group>
        ))}
      </div>
    )
  }
  if (tab === 'disk') {
    if (disks.length === 0) return <Empty text="未检测到磁盘" />
    return (
      <div className="space-y-3">
        {disks.map((d, i) => (
          <Group key={`${d.name}-${i}`} icon={<HardDrive size={13} />} title={d.name}>
            <Row label="类型" value={d.type || '—'} />
            <Row label="容量" value={sizeOf(d.sizeBytes)} />
            <Row label="健康" value={d.health || '—'} />
            <Row label="序列号" value={d.serial || '—'} mono />
          </Group>
        ))}
      </div>
    )
  }
  if (tab === 'nic') {
    if (nics.length === 0) return <Empty text="未检测到网卡" />
    return (
      <div className="space-y-3">
        {nics.map((n, i) => (
          <Group key={`${n.mac}-${i}`} icon={<Network size={13} />} title={n.name}>
            <Row label="速率" value={nz(n.speedMbps, ' Mbps')} />
            <Row label="MAC" value={n.mac || '—'} mono />
            <Row label="IPv4" value={n.ipv4?.length ? n.ipv4.join('、') : '—'} mono />
          </Group>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <Group icon={<MonitorCog size={13} />} title={hw.os?.name || '系统'}>
        <Row label="版本" value={hw.os?.version || '—'} />
        <Row label="安装时间" value={hw.os?.installedAt || '—'} />
      </Group>
      <Group icon={<CircuitBoard size={13} />} title="主板">
        <Row label="厂商" value={hw.board?.manufacturer || '—'} />
        <Row label="型号" value={hw.board?.model || '—'} />
        <Row label="BIOS" value={hw.board?.bios || '—'} />
      </Group>
    </div>
  )
}

function Group({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.028] px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-accent-soft">
        {icon}
        <span className="truncate font-medium text-fg-soft">{title}</span>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11.5px] text-faint">{label}</span>
      <span
        className={clsx(
          'num min-w-0 truncate text-right text-[12.5px] text-fg',
          mono && 'font-mono text-[11.5px] tracking-tight',
        )}
        title={value}
      >
        {value || '—'}
      </span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-[12.5px] text-muted">{text}</p>
}

