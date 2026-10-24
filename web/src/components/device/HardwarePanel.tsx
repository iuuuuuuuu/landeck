import { useState } from 'react'
import clsx from 'clsx'
import { Button, Card, Segmented, Skeleton } from '../ui'
import { CircuitBoard, Cpu, HardDrive, MemoryStick, MonitorCog, Network, RotateCw } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { HardwareInfo } from '../../lib/types'
import { useAsync } from '../../lib/hooks'
import { isAuthError, isAuthMessage } from './apiHelpers'
import {
  healthLabel,
  isBlankHardware,
  list,
  numOf,
  nz,
  pick,
  ratio,
  sizeOf,
  strList,
  strOf,
  vramLabel,
} from './hardwareFields'

type Tab = 'cpu' | 'mem' | 'gpu' | 'disk' | 'nic' | 'os'

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
    <Card className="flex h-full flex-col">
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
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-muted transition-colors hover:bg-elevated-2 hover:text-fg disabled:opacity-40"
        >
          <RotateCw size={14} className={hw.loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <div className="no-scrollbar mt-3.5 -mx-1 overflow-x-auto px-1 pb-1">
        <Segmented value={tab} onChange={setTab} options={TABS} size="sm" className="min-w-max" />
      </div>

      {/*
        页签内容区撑满剩余高度：与左侧「实时状态」同高，内容不足时留白在卡片内部，
        内容超出时在卡片内滚动（lg 断点给上限，避免某一页签把整行撑高）。
      */}
      <div className="scroll-area mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5 lg:max-h-[640px]">
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
          <Empty text="暂无硬件信息" />
        ) : isBlankHardware(hw.data) ? (
          <div className="rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-3">
            <p className="text-[12.5px] text-warn">
              设备返回了空的硬件数据（采集脚本可能失败或权限不足），六个页签都没有内容可显示。
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2.5 h-8"
              onClick={hw.reload}
              icon={<RotateCw size={13} />}
            >
              重新采集
            </Button>
          </div>
        ) : (
          <Body tab={tab} hw={hw.data} />
        )}
      </div>
    </Card>
  )
}

function Body({ tab, hw }: { tab: Tab; hw: HardwareInfo }) {
  const cpu = pick(hw, 'cpu')
  const mem = pick(hw, 'memory', 'mem')
  const gpus = list(pick(hw, 'gpus', 'gpu'))
  const disks = list(pick(hw, 'disks', 'disk'))
  const nics = list(pick(hw, 'nics', 'nic'))
  const board = pick(hw, 'board', 'motherboard')
  const os = pick(hw, 'os', 'systeminfo')

  if (tab === 'cpu') {
    const model = strOf(cpu, 'model', 'name', 'brand')
    const vendor = strOf(cpu, 'vendor', 'manufacturer')
    const cores = numOf(cpu, 'cores', 'physicalCores')
    const threads = numOf(cpu, 'threads', 'logicalProcessors')
    const base = numOf(cpu, 'baseMhz', 'baseMHz', 'maxClockMhz')
    const cacheKb = numOf(cpu, 'cacheKb', 'cacheKB', 'cache')
    const socket = strOf(cpu, 'socket', 'socketDesignation')
    if (!model && !vendor && !cores && !threads) return <Empty text="未读取到处理器信息" />
    return (
      <Group icon={<Cpu size={13} />} title={model || '处理器'}>
        <Row label="厂商" value={vendor || '—'} />
        <Row label="核心 / 线程" value={ratio(cores, threads)} />
        <Row label="基准频率" value={nz(base, ' MHz')} />
        <Row label="缓存" value={cacheKb > 0 ? sizeOf(cacheKb * 1024) : '—'} />
        <Row label="插槽" value={socket || '—'} />
      </Group>
    )
  }

  if (tab === 'mem') {
    const total = numOf(mem, 'totalBytes', 'total', 'sizeBytes')
    const type = strOf(mem, 'type', 'memoryType')
    const speed = numOf(mem, 'speedMhz', 'speed')
    const slots = list(pick(mem, 'slots', 'modules'))
    if (!(total > 0) && !type && slots.length === 0) return <Empty text="未读取到内存信息" />
    return (
      <div className="space-y-3">
        <Group icon={<MemoryStick size={13} />} title="内存总览">
          <Row label="总容量" value={sizeOf(total)} />
          <Row label="类型" value={type || '—'} />
          <Row label="频率" value={nz(speed, ' MHz')} />
          <Row label="插槽数" value={slots.length > 0 ? String(slots.length) : '—'} />
        </Group>
        {slots.length === 0 ? (
          <p className="px-1 text-[12.5px] text-muted">未读取到内存插槽明细</p>
        ) : (
          slots.map((s, i) => (
            <Group
              key={`${strOf(s, 'bank', 'slot')}-${i}`}
              icon={<MemoryStick size={13} />}
              title={strOf(s, 'bank', 'slot', 'locator') || `插槽 ${i + 1}`}
            >
              <Row label="容量" value={sizeOf(numOf(s, 'sizeBytes', 'size', 'capacity'))} />
              <Row label="频率" value={nz(numOf(s, 'speedMhz', 'speed'), ' MHz')} />
              <Row label="厂商" value={strOf(s, 'manufacturer', 'vendor') || '—'} />
              <Row label="型号" value={strOf(s, 'partNumber', 'model') || '—'} />
            </Group>
          ))
        )}
      </div>
    )
  }

  if (tab === 'gpu') {
    if (gpus.length === 0) return <Empty text="未检测到显卡" />
    return (
      <div className="space-y-3">
        {gpus.map((g, i) => (
          <Group
            key={`${strOf(g, 'name')}-${i}`}
            icon={<MonitorCog size={13} />}
            title={strOf(g, 'name', 'model') || `显卡 ${i + 1}`}
          >
            <Row label="显存" value={vramLabel(numOf(g, 'vramMb', 'vram', 'adapterRamMb'))} />
            <Row label="驱动" value={strOf(g, 'driver', 'driverVersion') || '—'} />
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
          <Group
            key={`${strOf(d, 'name', 'model')}-${i}`}
            icon={<HardDrive size={13} />}
            title={strOf(d, 'name', 'model', 'friendlyName') || `磁盘 ${i + 1}`}
          >
            <Row label="类型" value={strOf(d, 'type', 'mediaType', 'busType') || '—'} />
            <Row label="容量" value={sizeOf(numOf(d, 'sizeBytes', 'size'))} />
            <Row label="健康" value={healthLabel(strOf(d, 'health', 'status'))} />
            <Row label="序列号" value={strOf(d, 'serial', 'serialNumber') || '—'} mono />
          </Group>
        ))}
      </div>
    )
  }

  if (tab === 'nic') {
    if (nics.length === 0) return <Empty text="未检测到网卡" />
    return (
      <div className="space-y-3">
        {nics.map((n, i) => {
          const ips = strList(n, 'ipv4', 'addresses')
          return (
            <Group
              key={`${strOf(n, 'mac')}-${i}`}
              icon={<Network size={13} />}
              title={strOf(n, 'name', 'iface') || `网卡 ${i + 1}`}
            >
              <Row label="速率" value={nz(numOf(n, 'speedMbps', 'speed'), ' Mbps')} />
              <Row label="MAC" value={strOf(n, 'mac', 'macAddress') || '—'} mono />
              <Row label="IPv4" value={ips.length ? ips.join('、') : '—'} mono />
            </Group>
          )
        })}
      </div>
    )
  }

  const osName = strOf(os, 'name', 'caption')
  const installedAt = strOf(os, 'installedAt', 'installDate')
  const boardModel = strOf(board, 'model', 'product')
  if (!osName && !boardModel && !strOf(board, 'manufacturer')) {
    return <Empty text="未读取到系统信息" />
  }
  return (
    <div className="space-y-3">
      <Group icon={<MonitorCog size={13} />} title={osName || '系统'}>
        <Row label="版本" value={strOf(os, 'version') || '—'} />
        <Row label="安装时间" value={installedAt || '—'} />
      </Group>
      <Group icon={<CircuitBoard size={13} />} title="主板">
        <Row label="厂商" value={strOf(board, 'manufacturer') || '—'} />
        <Row label="型号" value={boardModel || '—'} />
        <Row label="BIOS" value={strOf(board, 'bios', 'biosVersion') || '—'} />
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
    <div className="rounded-xl border border-line bg-elevated px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-accent-soft">
        {icon}
        <span className="truncate font-medium text-fg-soft" title={title}>
          {title}
        </span>
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
