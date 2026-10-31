import { useEffect, useState } from 'react'
import {
  Briefcase,
  Code,
  Gamepad2,
  Globe,
  MessagesSquare,
  Music,
  Package,
  Shapes,
  Users,
} from 'lucide-react'
import { catColor, catLabel } from '../../lib/activityApi'
import type { CatKey } from '../../lib/activityApi'
import { baseUrl } from '../../lib/api'

/**
 * 活动统计的共享小件。cat 一律收 string：内置 8 类（CatKey）之外还有用户自建类别，
 * 色与文案的解析都收口在 activityApi（catColor/catLabel），这里不做第二套映射。
 */

/**
 * 类别图标：lucide 按内置类别映射，**类别色着色**（色相即类别身份）。
 * 自建类别用 Shapes 兜底。Owner 反馈「应用类别没有 icon，加上」——
 * 排行的分类行/图例/分类管理列表用图标版；紧凑场景（浮层头部副文本等）保留色点。
 */
const CAT_ICON: Record<CatKey, typeof Code> = {
  coding: Code,
  office: Briefcase,
  chat: MessagesSquare,
  browsing: Globe,
  social: Users,
  media: Music,
  games: Gamepad2,
  other: Package,
}

export function CategoryIcon({ cat, size = 15 }: { cat: string; size?: number }) {
  const Icon = (CAT_ICON as Record<string, typeof Code>)[cat] ?? Shapes
  return <Icon size={size} style={{ color: catColor(cat) }} aria-hidden />
}

/** 类别色点。图表/图例/排行/详情共用，颜色永远来自同一映射。 */
export function CategoryDot({ cat, size = 8 }: { cat: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: catColor(cat) }}
    />
  )
}

/** 类别徽标：色点 + 文案。cats 传当前类别表（解析自建类别的名字）。 */
export function CategoryBadge({ cat, cats }: { cat: string; cats?: { key: string; label: string }[] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
      <CategoryDot cat={cat} />
      {catLabel(cat, cats)}
    </span>
  )
}

/**
 * 内联时长条：排行与详情列表用。宽度按 max 归一，颜色跟类别走。
 * 零值不渲染（避免一行空条）。
 */
export function InlineBar({ sec, max, cat }: { sec: number; max: number; cat: string }) {
  if (sec <= 0 || max <= 0) return <span className="w-16" />
  const pct = Math.max(4, Math.round((sec / max) * 100))
  return (
    <span className="inline-flex w-24 shrink-0 items-center sm:w-40">
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: catColor(cat) }}
        />
      </span>
    </span>
  )
}

/**
 * 应用图标：走 agent 的 /activity/appicon（按应用名取采集缓存图标，404=未知应用）。
 *
 * 五期性能改造：排行一页有 10 个不同应用，逐个 <img src> 就是逐个请求，
 * 被基线计成 10 次 API。现在：
 *  1. **localStorage 持久缓存**（key 带 host|port|name），命中零请求——
 *     同一台被控机的应用集合基本不变，二次访问全部免费；
 *  2. 未命中走**单飞队列**（同 name 并发只发一次）+ requestIdleCallback 错峰，
 *     不跟页面数据请求抢首屏；
 *  3. 404/失败 → 类别色首字母块（应用未被采集过是正常状态）。
 * 图标是几 KB 的小 PNG，50 个应用也就百来 KB，localStorage 装得下；
 * 淘汰交给整体配额失败兜底（写入失败就静默退化为每次拉取）。
 */

type TargetLike = { host: string; port: number; tls: boolean }

const ICON_INFLIGHT = new Map<string, Promise<string | null>>()
const ICON_QUEUE: (() => void)[] = []

function iconStorageKey(target: TargetLike, name: string): string {
  return 'landeck.appicon.' + target.host + '|' + target.port + '|' + name
}

function iconUrlOf(target: TargetLike, name: string): string {
  return baseUrl(target) + '/activity/appicon?name=' + encodeURIComponent(name)
}

/** 队列消费：每 150ms 放行一个，错开图标请求避免与页面数据挤在同一瞬间。 */
function enqueueIcon(run: () => void): void {
  ICON_QUEUE.push(run)
  const drain = () => {
    const next = ICON_QUEUE.shift()
    if (next) next()
    if (ICON_QUEUE.length > 0) setTimeout(drain, 150)
  }
  if (ICON_QUEUE.length === 1) {
    // rIC 在无头/后台环境可能长期不调度（实测踩过）：与 600ms 定时器竞速，保证 drain 一定发生
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 400)
    let started = false
    const start = () => {
      if (started) return
      started = true
      setTimeout(drain, 0)
    }
    idle(start)
    setTimeout(start, 600)
  }
}

function loadIconData(target: TargetLike, token: string | undefined, name: string): Promise<string | null> {
  const key = target.host + '|' + target.port + '|' + name
  const inflight = ICON_INFLIGHT.get(key)
  if (inflight) return inflight
  const p = (async () => {
    try {
      const res = await fetch(iconUrlOf(target, name), {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      })
      if (!res.ok) return null
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      try {
        localStorage.setItem(iconStorageKey(target, name), dataUrl)
      } catch {
        /* 配额满：放弃持久化，本次会话内仍有内存缓存 */
      }
      return dataUrl
    } catch {
      return null
    } finally {
      ICON_INFLIGHT.delete(key)
    }
  })()
  ICON_INFLIGHT.set(key, p)
  return p
}

export function AppIcon({ app, cat, target, token, size = 34 }: { app: string; cat: string; target?: TargetLike; token?: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(() => {
    if (!target) return null
    try {
      return localStorage.getItem(iconStorageKey(target, app))
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (src || !target) return
    let alive = true
    enqueueIcon(() => {
      loadIconData(target, token, app).then((data) => {
        if (!alive || !data) return // null=确认无图，保持字母块
        setSrc(data)
      })
    })
    return () => {
      alive = false
    }
  }, [src, target?.host, target?.port, token, app])

  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-lg object-contain"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white/95"
      style={{ width: size, height: size, backgroundColor: catColor(cat) }}
      aria-hidden
    >
      {(app[0] ?? '?').toUpperCase()}
    </span>
  )
}

/** 秒数 → 「X 小时 Y 分 / Y 分钟」；排行与浮层共用一套口径。 */
export function fmtDur(sec: number): string {
  if (sec <= 0) return '0 分'
  // 先取整分钟再拆时分：直接对秒取余再 round 会把 7199s(=1h59m59s) 进位成
  // 「1 小时 60 分」——真机截图实测出现过，小时进位必须在这里消化掉。
  const totalMin = Math.round(sec / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分`
}
