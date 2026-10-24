import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Radar } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { DeviceAvatar } from '../ui'

/** 顶栏设备切换器：列出 store 里所有已配对设备，选中即跳详情 */
export function DeviceSwitcher() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const setActive = useApp((s) => s.setActive)
  const active = devices.find((d) => d.id === activeId) ?? devices[0] ?? null
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 0 台或 1 台设备时不做下拉，只显示名称，减少顶栏噪音
  if (devices.length <= 1) {
    return (
      <div className="flex h-10 max-w-[46vw] items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 min-[900px]:max-w-[240px]">
        {active ? (
          <DeviceAvatar os={active.os} size={22} />
        ) : (
          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-lg border border-white/10 text-[11px] text-faint">
            ?
          </span>
        )}
        <span className="min-w-0 truncate text-[12.5px] text-fg-soft">
          {active ? active.name : '未配对设备'}
        </span>
      </div>
    )
  }

  const pick = (id: string) => {
    setActive(id)
    setOpen(false)
    navigate(`/devices/${id}`)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="切换当前设备"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 max-w-[46vw] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 transition-colors hover:bg-white/[0.07] min-[900px]:max-w-[240px]"
      >
        {active ? (
          <DeviceAvatar os={active.os} size={22} />
        ) : (
          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-lg border border-white/10 text-[11px] text-faint">
            ?
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left text-[12.5px] text-fg-soft">
          {active ? active.name : '选择设备'}
        </span>
        <ChevronDown
          size={14}
          className={clsx('shrink-0 text-faint transition-transform', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="panel panel-edge absolute right-0 top-[calc(100%+8px)] z-40 w-[280px] max-w-[calc(100vw-32px)] overflow-hidden p-1.5"
          >
            <div className="px-2 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-faint">
              已配对设备
            </div>
            <div className="scroll-area max-h-[280px] space-y-0.5 overflow-y-auto">
              {devices.length === 0 && (
                <p className="px-2 py-3 text-[12.5px] leading-relaxed text-muted">
                  还没有配对设备，先扫描局域网。
                </p>
              )}
              {devices.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => pick(d.id)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                    d.id === active?.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.05]',
                  )}
                >
                  <DeviceAvatar os={d.os} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{d.name}</span>
                    <span className="num block truncate text-[11px] text-muted">
                      {d.host}:{d.port}
                    </span>
                  </span>
                  {d.id === active?.id && <Check size={14} className="shrink-0 text-accent-soft" />}
                </button>
              ))}
            </div>
            <div className="my-1 h-px bg-white/8" />
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/scan')
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] text-fg-soft transition-colors hover:bg-white/[0.05]"
            >
              <Radar size={14} className="text-accent-soft" />
              扫描局域网
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
