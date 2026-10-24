import clsx from 'clsx'
import { ArrowRight, EllipsisVertical, Pencil, Unplug } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { osLabel, relative } from '../../lib/format'
import type { PairedDevice } from '../../store/app'
import { Badge, Card, DeviceAvatar } from '../ui'
import type { ProbeState } from './useDeviceProbe'

/** 毫秒时间戳 → 「3 分钟前」 */
function recentLabel(ms?: number): string {
  if (!ms) return '从未'
  return relative(new Date(ms).toISOString())
}

function ThinMeter({ label, value, cyan }: { label: string; value?: number; cyan?: boolean }) {
  const v = value === undefined ? null : Math.max(0, Math.min(100, value))
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-[10.5px] text-faint">{label}</span>
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{
            width: `${v ?? 0}%`,
            background: cyan
              ? 'linear-gradient(90deg,var(--tone-cyan-a),var(--tone-accent-a))'
              : 'linear-gradient(90deg,var(--tone-accent-a),var(--tone-accent-b))',
          }}
        />
      </div>
      <span className="num w-8 shrink-0 text-right text-[10.5px] text-muted">
        {v === null ? '—' : `${Math.round(v)}%`}
      </span>
    </div>
  )
}

/** 设备网格卡片：状态点 + 名称 + 地址 + 系统 + 最近在线 + CPU/内存细条 + 更多菜单 */
export function DeviceGridCard({
  device,
  probe,
  onOpen,
  onRename,
  onRemove,
}: {
  device: PairedDevice
  probe?: ProbeState
  onOpen: () => void
  onRename: () => void
  onRemove: () => void
}) {
  const online = probe?.online ?? null
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开 ${device.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group relative block text-left outline-none"
    >
      <Card
        padded={false}
        className={clsx(
          'relative p-4 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-line-strong',
          online === false && 'opacity-70 saturate-50',
        )}
      >
        <div className="flex items-start gap-3">
          <DeviceAvatar os={device.os} size={44} online={online ?? undefined} />
          <div className="min-w-0 flex-1 pr-9">
            <div className="truncate text-[14.5px] font-medium text-fg">{device.name}</div>
            <div className="num mt-0.5 truncate text-[11.5px] text-muted">
              {device.host}:{device.port}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{osLabel(device.os)}</Badge>
          <Badge tone={online === true ? 'ok' : online === false ? 'danger' : 'neutral'} dot>
            {online === true ? '在线' : online === false ? '离线' : '在线状态检测中'}
          </Badge>
          <span className="ml-auto shrink-0 text-[11px] text-faint">
            {device.lastOkAt ? `最近在线 ${recentLabel(device.lastOkAt)}` : '暂无记录'}
          </span>
        </div>

        <div className="mt-3 space-y-1.5">
          <ThinMeter label="CPU" value={probe?.online ? probe.cpu : undefined} />
          <ThinMeter label="内存" value={probe?.online ? probe.mem : undefined} cyan />
        </div>

        <div className="mt-3 flex items-center justify-end gap-1 border-t border-line-soft pt-2.5 text-[12px] font-medium text-accent-soft">
          控制设备
          <ArrowRight
            size={13}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </div>

        <div className="absolute right-1.5 top-1.5" ref={menuRef}>
          <button
            type="button"
            aria-label="更多操作"
            aria-expanded={menu}
            onClick={(e) => {
              e.stopPropagation()
              setMenu((o) => !o)
            }}
            className="grid h-10 w-10 place-items-center rounded-xl text-faint transition-colors hover:bg-hover hover:text-fg"
          >
            <EllipsisVertical size={18} />
          </button>
          {menu && (
            <div className="panel panel-edge absolute right-0 top-11 z-20 w-36 overflow-hidden p-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(false)
                  onRename()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-fg-soft transition-colors hover:bg-hover hover:text-fg"
              >
                <Pencil size={14} />
                重命名
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(false)
                  onRemove()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-danger transition-colors hover:bg-danger/10"
              >
                <Unplug size={14} />
                解除配对
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
