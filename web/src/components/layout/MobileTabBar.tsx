import clsx from 'clsx'
import { NavLink } from 'react-router-dom'
import { NAV_ICON_PROPS, NAV_ITEMS } from './nav'

/** 移动端（<900px）底部毛玻璃 tab bar，触控目标 56px */
export function MobileTabBar() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 min-[900px]:hidden">
      <div className="pb-safe pointer-events-auto mx-3 mb-1">
        {/* 列数跟随导航项数量：写死 5 会在加了「文件」后挤到第二行并遮住内容 */}
        <div
          className="panel panel-edge grid gap-0.5 p-1.5"
          style={{ gridTemplateColumns: `repeat(${NAV_ITEMS.length}, minmax(0, 1fr))` }}
        >
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className="relative block">
              {({ isActive }) => (
                <span className="relative flex h-14 flex-col items-center justify-center gap-1 rounded-xl">
                  {/* 选中态：半透明底 + accent 描边 + 顶部一小段渐变条，与侧栏左侧发光竖条同一套语言 */}
                  {isActive && (
                    <span className="absolute inset-0 rounded-xl bg-selected ring-1 ring-accent/35" />
                  )}
                  {isActive && (
                    <span className="grad-nav absolute left-1/2 top-1 h-[3px] w-6 -translate-x-1/2 rounded-full" />
                  )}
                  <item.icon
                    {...NAV_ICON_PROPS}
                    className={clsx(
                      'relative transition-colors duration-150',
                      isActive ? 'text-accent' : 'text-faint',
                    )}
                  />
                  <span
                    className={clsx(
                      'relative whitespace-nowrap text-[10.5px] leading-none transition-colors duration-150',
                      isActive ? 'font-medium text-fg' : 'text-muted',
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
