import clsx from 'clsx'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV_GROUPS, NAV_ICON_PROPS } from './nav'
import { ActivityStatusPill } from '../shell/ActivityStatusPill'
import { ThemeToggle } from './ThemeToggle'
import { useApp } from '../../store/app'

/**
 * 桌面侧栏（≥1024px）—— Hindsight 风格骨架。
 *
 * 与旧 Sidebar 的区别（为什么重写而不是改）：
 *  - 导航从平铺改为【分组】：组名小号灰字（nav-group-label），Hindsight 的
 *    Stats/AI-beta/Data/System 同款节奏；一期五组见 nav.ts 的 NAV_GROUPS。
 *  - 激活态从「左发光竖条 + 半透明底」改为【胶囊卡】：白卡投影（浅色）/
 *    亮玻璃底（深色），见 index.css 的 .nav-pill / nav-pill-active。
 *  - 底部固定区：主题切换、活动采集状态位（Hindsight 的 Resting 同位）、
 *    已配对摘要 —— 不随导航滚动，窗口矮时也始终可见。
 *
 * 交互细节：
 *  - disabled 项（AI 组/屏幕记忆，二期）渲染成不可点行 + title 说明，
 *    不给 href —— 宁可灰着也不给一个会 404 的入口。
 *  - /devices/:id 详情页高亮「设备」组首项：NavLink 的 end 属性让
 *    /devices 精确匹配，详情页用 parentActive 兜底点亮父级。
 */
export function AppSidebar() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const active = devices.find((d) => d.id === activeId) ?? devices[0] ?? null
  const { pathname } = useLocation()
  const inDeviceDetail = /^\/devices\/[^/]+/.test(pathname)

  return (
    <aside
      className="fixed bottom-3 left-3 top-3 z-30 hidden w-[var(--ldk-sidebar-w)] min-[1024px]:block"
      aria-label="主导航"
    >
      <div className="panel panel-edge flex h-full flex-col p-4">
        {/* 品牌区（固定） */}
        <div className="flex shrink-0 items-center gap-2.5 px-1 pb-4">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line-strong"
            style={{
              backgroundImage:
                'linear-gradient(135deg, var(--tone-accent-glow), var(--tone-cyan-glow))',
            }}
          >
            <span className="grad-text num text-[16px] font-semibold leading-none">L</span>
          </span>
          <div className="min-w-0">
            <div className="grad-text text-[17px] font-semibold tracking-tight">LanDeck</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-faint">局域网控制台</div>
          </div>
        </div>

        {/* 分组导航（可滚动）：导航长时底部固定区不被顶出视野 */}
        <nav className="scroll-area -mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          {NAV_GROUPS.map((group) => (
            <div key={group.key}>
              <div className="nav-group-label px-2.5 pb-1.5">{group.label}</div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const parentActive =
                    inDeviceDetail && group.key === 'device' && item.to === '/devices'
                  if (item.disabled) {
                    return (
                      <span
                        key={item.to}
                        title="该功能在后续版本开放"
                        className="nav-pill cursor-not-allowed text-faint opacity-55"
                        aria-disabled
                      >
                        <item.icon {...NAV_ICON_PROPS} className="shrink-0" />
                        <span className="text-[13.5px] font-medium">{item.label}</span>
                      </span>
                    )
                  }
                  return (
                    <NavLink key={item.to} to={item.to} end={item.to === '/devices'} className="block">
                      {({ isActive }) => (
                        <span
                          className={clsx(
                            'nav-pill',
                            isActive || parentActive
                              ? 'nav-pill-active text-fg'
                              : 'text-muted hover:bg-hover hover:text-fg-soft',
                          )}
                        >
                          <item.icon
                            {...NAV_ICON_PROPS}
                            className={clsx(
                              'shrink-0 transition-colors duration-150',
                              isActive || parentActive ? 'text-accent' : 'text-faint',
                            )}
                          />
                          <span className="text-[13.5px] font-medium">{item.label}</span>
                        </span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* 底部固定区：主题切换 + 采集状态 + 已配对摘要 */}
        <div className="mt-3 shrink-0 space-y-2.5 border-t border-line-soft pt-3">
          <div className="flex items-center justify-between px-1">
            <ActivityStatusPill />
            <ThemeToggle />
          </div>
          <div className="rounded-xl border border-line-soft bg-elevated p-3">
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
          <div className="px-1 text-[10px] tracking-wide text-faint">GPL-3.0 · API v1 · 局域网点对点</div>
        </div>
      </div>
    </aside>
  )
}
