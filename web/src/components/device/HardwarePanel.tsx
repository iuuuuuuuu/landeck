import clsx from 'clsx'
import { Button, Card, Skeleton } from '../ui'
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

export function HardwarePanel({
  client,
  onAuthError,
}: {
  client: AgentClient | null
  onAuthError?: () => void
}) {
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
          <p className="mt-0.5 text-[12px] text-muted">来自 Agent 的静态枚举，下面是全部硬件明细</p>
        </div>
        <button
          type="button"
          aria-label="刷新硬件信息"
          onClick={hw.reload}
          disabled={hw.loading}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-elevated text-muted transition-colors hover:bg-elevated-2 hover:text-fg disabled:opacity-40"
        >
          <RotateCw size={13} className={hw.loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      {/*
        滚轮失效的根因（用户反馈「鼠标在硬件信息区域上下不能滑动」）：
        1) 这里是 overflow-y:auto 的滚动容器 —— 即便内容不够高、压根没得滚，它依然是 scrollport；
        2) 之前叠加了 `overscroll-contain`，它会把滚动链掐断：内层没得滚时，滚轮既不滚内层、
           也不冒泡给页面 → 表现为"指针停在这一块，整页都不动"。
        修法：去掉 overscroll-contain（显式 overscroll-y-auto 允许冒泡），max-h 只作为
        超长明细的兜底；内容不足时既没有滚动条、也不会预留空白（没有 scrollbar-gutter）。
        另确认：祖先链上（main / AppShell / body）都没有 overflow:hidden。
      */}
      <div className="scroll-area mt-3 max-h-[min(70vh,640px)] overflow-y-auto overscroll-y-auto pr-0.5">
        {hw.loading && !hw.data ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
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
              设备返回了空的硬件数据（采集脚本可能失败或权限不足），没有可显示的内容。
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
          <Body hw={hw.data} />
        )}
      </div>
    </Card>
  )
}

/** 硬件全量罗列：不分组页签，宽屏多列平铺，一屏看完 */
function Body({ hw }: { hw: HardwareInfo }) {
  const cpu = pick(hw, 'cpu')
  const mem = pick(hw, 'memory', 'mem')
  const gpus = list(pick(hw, 'gpus', 'gpu'))
  const disks = list(pick(hw, 'disks', 'disk'))
  const nics = list(pick(hw, 'nics', 'nic'))
  const board = pick(hw, 'board', 'motherboard')
  const os = pick(hw, 'os', 'systeminfo')

  const cpuModel = strOf(cpu, 'model', 'name', 'brand')
  const cpuVendor = strOf(cpu, 'vendor', 'manufacturer')
  const cores = numOf(cpu, 'cores', 'physicalCores')
  const threads = numOf(cpu, 'threads', 'logicalProcessors')
  const base = numOf(cpu, 'baseMhz', 'baseMHz', 'maxClockMhz')
  const cacheKb = numOf(cpu, 'cacheKb', 'cacheKB', 'cache')
  const socket = strOf(cpu, 'socket', 'socketDesignation')

  const memTotal = numOf(mem, 'totalBytes', 'total', 'sizeBytes')
  const memType = strOf(mem, 'type', 'memoryType')
  const memSpeed = numOf(mem, 'speedMhz', 'speed')
  const slots = list(pick(mem, 'slots', 'modules'))

  const osName = strOf(os, 'name', 'caption')
  const installedAt = strOf(os, 'installedAt', 'installDate')
  const boardModel = strOf(board, 'model', 'product')

  const hasCpu = Boolean(cpuModel || cpuVendor || cores || threads)
  const hasMem = memTotal > 0 || Boolean(memType) || slots.length > 0
  const hasOs = Boolean(osName || boardModel || strOf(board, 'manufacturer'))

  if (!hasCpu && !hasMem && gpus.length === 0 && disks.length === 0 && nics.length === 0 && !hasOs) {
    return <Empty text="未读取到硬件信息" />
  }

  /*
    等高但不留白：Grid 用默认 stretch（不再写 items-start），同一行的卡片自然等高；
    Group 内部 flex-col，行容器 flex-1 + justify-between，把富余高度均摊到行间距，
    而不是全堆在卡片底部。窄屏只有一列时行高仍由内容决定，不会被拉长。
  */
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
      {hasCpu && (
        <Group icon={<Cpu size={12} />} title={cpuModel || '处理器'}>
          <Row label="厂商" value={cpuVendor || '—'} />
          <Row label="核心 / 线程" value={ratio(cores, threads)} />
          <Row label="基准频率" value={nz(base, ' MHz')} />
          <Row label="缓存" value={cacheKb > 0 ? sizeOf(cacheKb * 1024) : '—'} />
          <Row label="插槽" value={socket || '—'} />
        </Group>
      )}

      {hasMem && (
        <Group icon={<MemoryStick size={12} />} title="内存">
          <Row label="总容量" value={sizeOf(memTotal)} />
          <Row label="类型" value={memType || '—'} />
          <Row label="频率" value={nz(memSpeed, ' MHz')} />
          <Row label="插槽数" value={slots.length > 0 ? String(slots.length) : '—'} />
        </Group>
      )}

      {slots.map((s, i) => (
        <Group
          key={`mem-${strOf(s, 'bank', 'slot')}-${i}`}
          icon={<MemoryStick size={12} />}
          title={strOf(s, 'bank', 'slot', 'locator') || `内存插槽 ${i + 1}`}
        >
          <Row label="容量" value={sizeOf(numOf(s, 'sizeBytes', 'size', 'capacity'))} />
          <Row label="频率" value={nz(numOf(s, 'speedMhz', 'speed'), ' MHz')} />
          <Row label="厂商" value={strOf(s, 'manufacturer', 'vendor') || '—'} />
          <Row label="型号" value={strOf(s, 'partNumber', 'model') || '—'} />
        </Group>
      ))}

      {gpus.map((g, i) => (
        <Group
          key={`gpu-${strOf(g, 'name')}-${i}`}
          icon={<MonitorCog size={12} />}
          title={strOf(g, 'name', 'model') || `显卡 ${i + 1}`}
        >
          <Row label="显存" value={vramLabel(numOf(g, 'vramMb', 'vram', 'adapterRamMb'))} />
          <Row label="驱动" value={strOf(g, 'driver', 'driverVersion') || '—'} />
        </Group>
      ))}

      {disks.map((d, i) => (
        <Group
          key={`disk-${strOf(d, 'name', 'model')}-${i}`}
          icon={<HardDrive size={12} />}
          title={strOf(d, 'name', 'model', 'friendlyName') || `磁盘 ${i + 1}`}
        >
          <Row label="类型" value={strOf(d, 'type', 'mediaType', 'busType') || '—'} />
          <Row label="容量" value={sizeOf(numOf(d, 'sizeBytes', 'size'))} />
          <Row label="健康" value={healthLabel(strOf(d, 'health', 'status'))} />
          <Row label="序列号" value={strOf(d, 'serial', 'serialNumber') || '—'} mono />
        </Group>
      ))}

      {nics.map((n, i) => {
        const ips = strList(n, 'ipv4', 'addresses')
        return (
          <Group
            key={`nic-${strOf(n, 'mac')}-${i}`}
            icon={<Network size={12} />}
            title={strOf(n, 'name', 'iface') || `网卡 ${i + 1}`}
          >
            <Row label="速率" value={nz(numOf(n, 'speedMbps', 'speed'), ' Mbps')} />
            <Row label="MAC" value={strOf(n, 'mac', 'macAddress') || '—'} mono />
            <Row label="IPv4" value={ips.length ? ips.join('、') : '—'} mono />
          </Group>
        )
      })}

      {hasOs && (
        <>
          <Group icon={<MonitorCog size={12} />} title={osName || '系统'}>
            <Row label="版本" value={strOf(os, 'version') || '—'} />
            <Row label="安装时间" value={installedAt || '—'} />
          </Group>
          <Group icon={<CircuitBoard size={12} />} title="主板">
            <Row label="厂商" value={strOf(board, 'manufacturer') || '—'} />
            <Row label="型号" value={boardModel || '—'} />
            <Row label="BIOS" value={strOf(board, 'bios', 'biosVersion') || '—'} />
          </Group>
        </>
      )}
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
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-elevated px-2.5 py-1.5">
      <div className="mb-1 flex shrink-0 items-center gap-1.5 text-[11.5px] text-accent-soft">
        {icon}
        <span className="truncate font-medium text-fg-soft" title={title}>
          {title}
        </span>
      </div>
      {/* flex-1 + justify-between：同行卡片等高时，富余空间均摊到行间距，不在底部留一块空白 */}
      <div className="flex flex-1 flex-col justify-between gap-y-[3px]">{children}</div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 leading-tight">
      <span className="shrink-0 text-[11.5px] text-faint">{label}</span>
      <span
        className={clsx(
          'num min-w-0 flex-1 truncate text-right text-[12px] text-fg',
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
  return <p className="py-4 text-center text-[12.5px] text-muted">{text}</p>
}
