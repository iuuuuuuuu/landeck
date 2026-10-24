import { Radar } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../store/app'
import { Button } from '../ui'
import { DeviceSwitcher } from './DeviceSwitcher'
import { findNav } from './nav'
import { StatusDot } from './StatusDot'
import { ThemeToggle } from './ThemeToggle'
import { useDeviceProbe } from './useDeviceProbe'

/** 顶栏：当前页标题 + 在线状态点 + 设备切换器 + 扫描入口（玻璃面板） */
export function TopBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const active = devices.find((d) => d.id === activeId) ?? devices[0] ?? null
  const probe = useDeviceProbe(active ? [active] : [], 15000)
  const online = active ? (probe[active.id]?.online ?? null) : null
  const nav = findNav(pathname)
  const detail = /^\/devices\/[^/]+/.test(pathname)

  const stateText = !active
    ? '未配对设备'
    : online === true
      ? '在线'
      : online === false
        ? '离线'
        : '检测中'

  return (
    <header className="pt-safe sticky top-0 z-20 bg-topbar px-3 pb-2 backdrop-blur-xl sm:px-4">
      <div className="panel panel-edge mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold tracking-tight text-fg sm:text-[17px]">
            {detail ? '设备' : nav.label}
          </h1>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted sm:text-[11.5px]">
            <StatusDot online={online} />
            <span className="shrink-0">{stateText}</span>
            <span className="hidden shrink-0 text-faint sm:inline">·</span>
            <span className="hidden truncate text-faint sm:inline">{nav.desc}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <DeviceSwitcher />
          {!pathname.startsWith('/scan') && (
            <Button
              variant="secondary"
              size="md"
              icon={<Radar size={15} />}
              onClick={() => navigate('/scan')}
              className="hidden sm:inline-flex"
            >
              扫描
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
