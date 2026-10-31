import clsx from 'clsx'
import { NavLink } from 'react-router-dom'
import { MOBILE_TABS, NAV_ICON_PROPS } from './nav'

/**
 * 移动端（<1024px）底部毛玻璃 tab bar，触控目标 56px。
 * 一级四项：设备 / 活动 / 文件 / 设置（MOBILE_TABS）。
 * AI 组与统计子页不进底栏；统计子页从活动页二级进入。
 */
export function MobileTabBar() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 min-[1024px]:hidden">
      <div className="pb-safe pointer-events-auto mx-3 mb-1">
        {/* 列数跟随导航项数量：写死 5 会在加了「文件」后挤到第二行并遮住内容 */}
        <div
          className="panel panel-edge grid gap-0.5 p-1.5"
          style={{ gridTemplateColumns: `repeat(${MOBILE_TABS.length}, minmax(0, 1fr))` }}
        >
          {MOBILE_TABS.map((item) => (
            // min-w-0 必须留在 NavLink 这一层：grid 项默认 min-width:auto，
            // 会以内部文字的 min-content（whitespace-nowrap）当硬下限，
            // 6 个 tab 在 385px 窄屏上把整条底栏撑到 492px，
            // 进而让 fixed inset-x-0 的容器把页面顶出横向滚动条。
            // 加了 min-w-0 后 1fr 才真正生效，文字走下面的 truncate。
            <NavLink key={item.to} to={item.to} end={item.to === '/devices'} className="relative block min-w-0">
              {({ isActive }) => (
                <span className="relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5">
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
                      'relative shrink-0 transition-colors duration-150',
                      isActive ? 'text-accent' : 'text-faint',
                    )}
                  />
                  <span
                    className={clsx(
                      'relative w-full truncate text-center text-[10.5px] leading-none transition-colors duration-150',
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
