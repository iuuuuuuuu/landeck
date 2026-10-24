import clsx from 'clsx'
import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from './nav'

/** 移动端（<900px）底部毛玻璃 tab bar，触控目标 56px */
export function MobileTabBar() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 min-[900px]:hidden">
      <div className="pb-safe pointer-events-auto mx-3 mb-1">
        <div className="panel panel-edge grid grid-cols-5 gap-0.5 p-1.5">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className="relative block">
              {({ isActive }) => (
                <span className="relative flex h-14 flex-col items-center justify-center gap-1 rounded-xl">
                  {isActive && (
                    <span className="absolute inset-0 rounded-xl bg-white/[0.07] ring-1 ring-white/10" />
                  )}
                  <item.icon
                    size={19}
                    className={clsx('relative', isActive ? 'text-accent-soft' : 'text-faint')}
                  />
                  <span
                    className={clsx(
                      'relative whitespace-nowrap text-[10.5px] leading-none',
                      isActive ? 'text-fg' : 'text-muted',
                    )}
                  >
                    {item.label}
                  </span>
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  )
}
