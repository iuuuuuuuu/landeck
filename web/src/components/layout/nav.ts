import {
  Bot,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  Camera,
  FolderOpen,
  History,
  MessageSquare,
  Monitor,
  MonitorSmartphone,
  Radar,
  Settings,
  Shapes,
  Sparkles,
  ChartColumn,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  desc: string
  /** 二期/未开放：侧栏可见但不可点（title 说明），不注册路由避免死链 */
  disabled?: boolean
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
  { to: '/settings', label: '设置', icon: Settings, desc: '身份、被控端参数与安全策略' },
]

/* ------------------------------------------------------------------ *
 * Hindsight 风格分组导航（一期骨架，docs/design/hindsight-revamp-phase1.md 第 2 节）
 *
 * 与 NAV_ITEMS 的关系：NAV_ITEMS 仍供 TopBar 的 findNav / 页标题逻辑使用；
 * 侧栏（AppSidebar）与移动底栏（MobileTabBar）改用下面的分组结构。
 *
 * 「文件 / 定时任务」在一期骨架里回到顶级（数据组）：统计与批量操作
 * 需要脱离设备详情独立成页，Hindsight 的信息架构也是这种平铺式。
 * /devices/:id 详情页里的工具抽屉入口保持不变，两处入口并存。
 *
 * AI 组与「屏幕记忆」是二期范围：侧栏先占位（disabled + title 说明），
 * 不注册路由、不进移动底栏，避免给出会 404 的入口。
 * ------------------------------------------------------------------ */
export interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'device',
    label: '设备',
    items: [
      { to: '/devices', label: '设备', icon: Monitor, desc: '已配对主机的状态与快捷入口' },
      { to: '/local', label: '本机', icon: MonitorSmartphone, desc: '当前这台机器的硬件与运行状态' },
      { to: '/scan', label: '发现', icon: Radar, desc: '扫描局域网并配对新的 Agent' },
    ],
  },
  {
    key: 'activity',
    label: '活动',
    items: [
      { to: '/activity/daily', label: '日统计', icon: CalendarDays, desc: '24 小时活动分布与应用排行' },
      { to: '/activity/weekly', label: '周统计', icon: ChartColumn, desc: '一周活动概览' },
      { to: '/activity/monthly', label: '月统计', icon: CalendarRange, desc: '月度时长与类别占比' },
      { to: '/activity/all', label: '全部历史', icon: History, desc: '年热力图与长期回顾' },
      { to: '/activity/categories', label: '分类管理', icon: Shapes, desc: '应用与网站的活动分类' },
    ],
  },
  {
    key: 'ai',
    label: 'AI',
    items: [
      { to: '/ai/chat', label: 'AI 对话', icon: MessageSquare, desc: '基于活动记录问答', disabled: true },
      { to: '/ai/summary', label: 'AI 总结', icon: Sparkles, desc: '日报与周报生成', disabled: true },
      { to: '/ai/settings', label: 'AI 设置', icon: Bot, desc: '本地模型与云端 API', disabled: true },
    ],
  },
  {
    key: 'data',
    label: '数据',
    items: [
      { to: '/files', label: '文件', icon: FolderOpen, desc: '被控端文件浏览与传输' },
      { to: '/schedules', label: '定时任务', icon: CalendarClock, desc: '定时关机、重启与提醒' },
      { to: '/activity/memory', label: '屏幕记忆', icon: Camera, desc: '截图 OCR 文字检索（二期）', disabled: true },
    ],
  },
  {
    key: 'system',
    label: '系统',
    items: [
      { to: '/settings', label: '设置', icon: Settings, desc: '身份、被控端参数与安全策略' },
    ],
  },
]

/** 移动底栏（<1024px）：一级四项；AI 组与统计子页不进底栏，从活动页二级进入 */
export const MOBILE_TABS: NavItem[] = [
  { to: '/devices', label: '设备', icon: Monitor, desc: '' },
  { to: '/activity/daily', label: '活动', icon: ChartColumn, desc: '' },
  { to: '/files', label: '文件', icon: FolderOpen, desc: '' },
  { to: '/settings', label: '设置', icon: Settings, desc: '' },
]

/** 路由 → 导航项（/devices/:id 归到「设备」；/activity/*、/ai/* 归到各自组首项） */
export function findNav(pathname: string): NavItem {
  const hit = NAV_ITEMS.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))
  if (hit) return hit
  for (const g of NAV_GROUPS) {
    for (const item of g.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item
    }
  }
  if (pathname.startsWith('/ai/')) return NAV_GROUPS[2].items[0]
  return NAV_ITEMS[0]
}
