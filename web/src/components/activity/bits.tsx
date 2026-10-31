import { useState } from 'react'
import { catColor, catLabel } from '../../lib/activityApi'
import { baseUrl } from '../../lib/api'

/**
 * 活动统计的共享小件。cat 一律收 string：内置 8 类（CatKey）之外还有用户自建类别，
 * 色与文案的解析都收口在 activityApi（catColor/catLabel），这里不做第二套映射。
 */

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
    <span className="inline-flex w-20 shrink-0 items-center sm:w-28">
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
 * 应用图标：真实环境走 agent 的 /apps/icon（exe 名换真图标）；
 * 拿不到（demo 模式 / 非当前设备）时退化为类别色首字母块 —— 视觉重量一致，
 * 排版不因图标缺失而跳动。
 */
export function AppIcon({ app, cat, target, size = 34 }: { app: string; cat: string; target?: { host: string; port: number; tls: boolean }; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (target && !broken) {
    const url = `${baseUrl(target)}/apps/icon?exe=${encodeURIComponent(app)}`
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
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
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分`
}
