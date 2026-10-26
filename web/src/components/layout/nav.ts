import {
  ChartColumn,
  History,
  Monitor,
  MonitorSmartphone,
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

/* ------------------------------------------------------------------ *
 * 图标规格（全站统一，改尺寸只改这里）
 *
 * 之前三处导航各写一套：侧栏 17、移动底栏 19、顶栏扫描按钮 15，
 * 而且都吃 lucide 默认的 strokeWidth=2 —— 小尺寸下描边偏粗，看着发脏。
 * 约定：
 *   - 导航类（侧栏 / 顶栏页标题 / 移动底栏的同一个入口）：18px
 *   - 卡片标题类（ui/SectionTitle 的 icon 槽）：16px
 *   - 行内操作（按钮里的小图标）：14px
 *   - 描边一律 1.75：比默认 2 细一档，18px 下视觉重量正好接近 13.5px 的文字
 *   - 颜色只用现有 token：未选中 text-muted / text-faint，选中 text-accent
 *
 * 图标仍然直接 import 组件（不传字符串、不做图标注册表），
 * 这里只导出尺寸与公共属性，避免三处各写一份魔法数字。
 * ------------------------------------------------------------------ */

/** 导航类图标边长 */
export const NAV_ICON_SIZE = 18
/** 卡片标题图标边长（供 ui/SectionTitle 使用） */
export const TITLE_ICON_SIZE = 16
/** 行内操作图标边长 */
export const INLINE_ICON_SIZE = 14
/** 统一描边粗细 */
export const ICON_STROKE = 1.75

/** 导航图标的公共属性：尺寸 + 描边 + 装饰性（旁边永远有文字，读屏不必重念） */
export const NAV_ICON_PROPS = {
  size: NAV_ICON_SIZE,
  strokeWidth: ICON_STROKE,
  'aria-hidden': true,
} as const

/**
 * 顶级入口：本机 / 设备 / 发现 / 统计 / 活动 / 设置。
 *
 * 「文件」与「定时」不再是顶级入口 —— 它们都是针对某一台被控机的操作，
 * 已收进设备详情页（右上角抽屉入口），避免用户在全局页面里先选一次设备。
 * 旧地址 /files、/schedules 仍保留重定向到 /devices。
 *
 * 图标选择依据（换过的三个见括号）：
 *   - 本机：MonitorSmartphone（原 Laptop）—— 这一页桌面端读本机被控端、
 *     手机端展示手机自身（PhoneSelfPanel），图标要同时覆盖电脑和手机两种形态；
 *     Laptop 在手机底栏上看着像「要去连一台笔记本」，容易被误读。
 *   - 设备：Monitor —— 已配对主机，显示器语义稳定，也天然和「本机」区分开。
 *   - 发现：Radar —— 动作是「扫局域网找 Agent」，雷达比放大镜更贴切；
 *     顶栏的「扫描」按钮复用同一枚图标，同样的动作同样的符号。
 *   - 统计：ChartColumn（原 BarChart3）—— BarChart3 是 lucide 的旧名，
 *     1.6 起柱状图统一叫 Chart*；ChartColumn 是带坐标轴的正名，
 *     表达「资源水位 / 操作次数」这类列状数据。
 *   - 活动：History（原 Activity）—— 这一页是「谁在什么时候做了什么」的时间线日志，
 *     活动页内部（pages/Activity.tsx）自己就用 History，导航与页内图标保持一致；
 *     Activity 的脉冲线和「统计」的柱状图在 18px 下区分度太低。
 *   - 设置：Settings —— 齿轮是设置的最强约定，语义一眼可读；
 *     Settings2 / SlidersHorizontal 更像「调节/筛选」，会和设备参数混。
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/local', label: '本机', icon: MonitorSmartphone, desc: '当前这台机器的硬件与运行状态' },
  { to: '/devices', label: '设备', icon: Monitor, desc: '已配对主机的状态与快捷入口' },
  { to: '/scan', label: '发现', icon: Radar, desc: '扫描局域网并配对新的 Agent' },
  { to: '/stats', label: '统计', icon: ChartColumn, desc: '运行时长、资源水位与操作统计' },
  { to: '/activity', label: '活动', icon: History, desc: '谁在什么时候做了什么' },
  { to: '/settings', label: '设置', icon: Settings, desc: '身份、被控端参数与安全策略' },
]

/** 路由 → 导航项（/devices/:id 归到「设备」） */
export function findNav(pathname: string): NavItem {
  const hit = NAV_ITEMS.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))
  return hit ?? NAV_ITEMS[0]
}
