import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { Badge, Button, Card, DeviceAvatar, IconButton, Modal } from '../ui'
import { ChevronDown, ChevronLeft, Info, MoreVertical, Unplug } from 'lucide-react'
import type { PairedDevice } from '../../store/app'
import type { SystemInfo } from '../../lib/types'
import { osLabel } from '../../lib/format'
import { useNavigate } from 'react-router-dom'

type Tone = 'ok' | 'warn' | 'danger'

/** 设备横幅：名称 + OS + IP + 唯一状态点；技术细节折进「设备信息」 */
export function DeviceBanner({
  device,
  system,
  connected,
  reachable,
  onUnpair,
}: {
  device: PairedDevice
  system: SystemInfo | null
  /** WS / 轮询是否在线 */
  connected: boolean
  /** HTTP 是否可达：null = 未知 */
  reachable: boolean | null
  onUnpair: () => void
}) {
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  /** 设备信息默认展开：用户不想每次点开才能看到主机名 / 内核 / 架构 */
  const [info, setInfo] = useState(true)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menu])

  const platform = system?.platform ?? device.os
  const state: { tone: Tone; text: string } =
    reachable === false
      ? { tone: 'danger', text: '设备离线' }
      : connected
        ? { tone: 'ok', text: '已连接 · 实时数据' }
        : reachable === null
          ? { tone: 'warn', text: '连接中…' }
          : { tone: 'warn', text: '已连接 · 实时数据重连中' }

  const details: { label: string; value: string }[] = [
    { label: '主机名', value: system?.hostname || '—' },
    { label: '内核', value: system?.kernel || '—' },
    { label: '架构', value: system?.arch || device.arch || '—' },
    { label: 'Agent', value: system?.agentVersion || device.ver || '—' },
    { label: '时区', value: system?.timezone || '—' },
    { label: '平台', value: platform || '—' },
  ]

  return (
    <Card padded={false} className="relative overflow-visible" glow>
      <div className="flex items-center gap-3 px-4 py-3">
        <DeviceAvatar os={platform} size={44} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 truncate text-[16.5px] font-semibold tracking-tight text-fg">
              {system?.name ?? device.name}
            </h1>
            <Badge tone="neutral" className="hidden shrink-0 sm:inline-flex">
              {osLabel(platform)}
            </Badge>
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="num shrink-0 text-fg-soft">
              {device.host}:{device.port}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-muted">
              <span
                className={clsx(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  state.tone === 'ok' && 'bg-ok',
                  state.tone === 'warn' && 'bg-warn',
                  state.tone === 'danger' && 'bg-danger',
                )}
              />
              <span className="truncate">{state.text}</span>
            </span>
          </div>
        </div>

        <div className="relative shrink-0">
          <IconButton
            label="更多操作"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setMenu((v) => !v)
            }}
          >
            <MoreVertical size={16} />
          </IconButton>
          {menu && (
            <div
              className="panel absolute right-0 top-9 z-30 w-40 overflow-hidden p-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setMenu(false)
                  setConfirm(true)
                }}
                className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-danger transition-colors hover:bg-danger/12"
              >
                <Unplug size={14} />
                解除配对
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-line-soft">
        <div className="flex items-center justify-between px-3">
          <button
            type="button"
            aria-expanded={info}
            onClick={() => setInfo((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-1 text-[11.5px] text-faint transition-colors hover:text-fg-soft"
          >
            <Info size={12} />
            设备信息
            <ChevronDown
              size={12}
              className={clsx('transition-transform duration-200', info && 'rotate-180')}
            />
          </button>
          <button
            type="button"
            onClick={() => navigate('/devices')}
            className="inline-flex h-8 items-center gap-0.5 rounded-lg px-1 text-[11.5px] text-faint transition-colors hover:text-fg-soft"
          >
            <ChevronLeft size={12} />
            全部设备
          </button>
        </div>

        <AnimatePresence initial={false}>
          {info && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 pb-3 pt-0.5 sm:grid-cols-3">
                {details.map((d) => (
                  <div key={d.label} className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="shrink-0 text-[11px] text-faint">{d.label}</span>
                    <span className="num min-w-0 truncate text-right text-[11.5px] text-fg-soft">
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="解除配对"
        desc={`将从本机移除「${system?.name ?? device.name}」，之后需要重新输入密钥才能控制。`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirm(false)
                onUnpair()
              }}
            >
              解除配对
            </Button>
          </>
        }
      />
    </Card>
  )
}
