import clsx from 'clsx'
import { motion } from 'framer-motion'
import { NavLink } from 'react-router-dom'
import { useApp } from '../../store/app'
import { NAV_ITEMS } from './nav'

/** 桌面侧栏：248px 玻璃面板，激活项左侧发光竖条 + 半透明底 */
export function Sidebar() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const active = devices.find((d) => d.id === activeId) ?? devices[0] ?? null

  return (
    <aside className="fixed bottom-3 left-3 top-3 z-30 hidden w-[248px] min-[900px]:block">
      <div className="panel panel-edge flex h-full flex-col p-4">
        <div className="flex items-center gap-2.5 px-1 pb-5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/12 bg-[linear-gradient(135deg,rgba(124,92,255,.38),rgba(34,211,238,.16))]">
            <span className="grad-text num text-[16px] font-semibold leading-none">L</span>
          </span>
          <div className="min-w-0">
            <div className="grad-text text-[17px] font-semibold tracking-tight">LanDeck</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-faint">局域网控制台</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className="group relative block rounded-xl">
              {({ isActive }) => (
                <span
                  className={clsx(
                    'relative flex h-11 items-center gap-3 rounded-xl px-3 transition-colors duration-150',
                    isActive
                      ? 'bg-white/[0.07] text-fg'
                      : 'text-muted hover:bg-white/[0.04] hover:text-fg-soft',
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-glow"
                      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                      className="absolute -left-1.5 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-[linear-gradient(180deg,#a78bfa,#22d3ee)]"
                      style={{ boxShadow: '0 0 12px rgba(124,92,255,.85)' }}
                    />
                  )}
                  <item.icon
                    size={17}
                    className={isActive ? 'text-accent-soft' : 'text-faint group-hover:text-fg-soft'}
                  />
                  <span className="text-[13.5px] font-medium">{item.label}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em] text-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-soft" />
              已配对 <span className="num text-fg-soft">{devices.length}</span> 台
            </div>
            <div className="mt-1.5 truncate text-[13px] text-fg">{active ? active.name : '还没有设备'}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              {active ? (
                <span className="num">
                  {active.host}:{active.port}
                </span>
              ) : (
                '去「发现」扫描局域网'
              )}
            </div>
          </div>
          <div className="px-1 text-[10px] tracking-wide text-faint">v0.1.0 · API v1 · 局域网点对点</div>
        </div>
      </div>
    </aside>
  )
}
