import {
  Activity,
  BarChart3,
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

/**
 * 顶级入口：本机 / 设备 / 发现 / 统计 / 活动 / 设置。
 *
 * 「文件」与「定时」不再是顶级入口 —— 它们都是针对某一台被控机的操作，
 * 已收进设备详情页（右上角抽屉入口），避免用户在全局页面里先选一次设备。
 * 旧地址 /files、/schedules 仍保留重定向到 /devices。
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/local', label: '本机', icon: Laptop, desc: '当前这台机器的硬件与运行状态' },
  { to: '/devices', label: '设备', icon: Monitor, desc: '已配对主机的状态与快捷入口' },
  { to: '/scan', label: '发现', icon: Radar, desc: '扫描局域网并配对新的 Agent' },
  { to: '/stats', label: '统计', icon: BarChart3, desc: '运行时长、资源水位与操作统计' },
  { to: '/activity', label: '活动', icon: Activity, desc: '谁在什么时候做了什么' },
  { to: '/settings', label: '设置', icon: Settings, desc: '身份、被控端参数与安全策略' },
]

/** 路由 → 导航项（/devices/:id 归到「设备」） */
export function findNav(pathname: string): NavItem {
  const hit = NAV_ITEMS.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))
  return hit ?? NAV_ITEMS[0]
}
