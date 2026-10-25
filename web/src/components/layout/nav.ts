import {
  Activity,
  BarChart3,
  CalendarClock,
  FolderOpen,
  Laptop,
  Monitor,
  Radar,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  desc: string
}

/** 顶级入口：设备 / 发现 / 文件 / 定时 / 活动 / 设置 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/local', label: '本机', icon: Laptop, desc: '当前这台机器的硬件与运行状态' },
  { to: '/devices', label: '设备', icon: Monitor, desc: '已配对主机的状态与快捷入口' },
  { to: '/scan', label: '发现', icon: Radar, desc: '扫描局域网并配对新的 Agent' },
  { to: '/files', label: '文件', icon: FolderOpen, desc: '浏览、下载、上传被控机上的文件' },
  { to: '/stats', label: '统计', icon: BarChart3, desc: '运行时长、资源水位与操作统计' },
  { to: '/schedules', label: '定时', icon: CalendarClock, desc: '定时开关机与 RTC 唤醒' },
  { to: '/activity', label: '活动', icon: Activity, desc: '谁在什么时候做了什么' },
  { to: '/settings', label: '设置', icon: Settings, desc: '身份、被控端参数与安全策略' },
]

/** 路由 → 导航项（/devices/:id 归到「设备」） */
export function findNav(pathname: string): NavItem {
  const hit = NAV_ITEMS.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))
  return hit ?? NAV_ITEMS[0]
}
