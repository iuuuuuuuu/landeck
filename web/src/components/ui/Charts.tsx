import clsx from 'clsx'
import { useId } from 'react'

/* 图表色来自 index.css 的 --tone-* 令牌：浅色主题自动换成压暗一档的色阶 */
const TONE_STOPS: Record<string, [string, string]> = {
  accent: ['var(--tone-accent-a)', 'var(--tone-accent-b)'],
  cyan: ['var(--tone-cyan-a)', 'var(--tone-cyan-b)'],
  warn: ['var(--tone-warn-a)', 'var(--tone-warn-b)'],
  danger: ['var(--tone-danger-a)', 'var(--tone-danger-b)'],
  ok: ['var(--tone-ok-a)', 'var(--tone-ok-b)'],
}

/** 同色系柔光，浅色下自动变淡，避免在浅底上糊成一团 */
const TONE_GLOW: Record<string, string> = {
  accent: 'var(--tone-accent-glow)',
  cyan: 'var(--tone-cyan-glow)',
  warn: 'var(--tone-warn-glow)',
  danger: 'var(--tone-danger-glow)',
  ok: 'var(--tone-ok-glow)',
}

/** 环形仪表：0-100，240° 弧，中心大字 */
export function Gauge({
  value,
  size = 148,
  thickness = 10,
  label,
  sub,
  tone = 'accent',
  center,
}: {
  value: number
  size?: number
  thickness?: number
  label?: string
  sub?: string
  tone?: 'accent' | 'cyan' | 'warn' | 'danger' | 'ok'
  center?: React.ReactNode
}) {
  const id = useId().replace(/:/g, '')
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const sweep = 0.72 // 259°
  const dash = c * sweep
  const [a, b] = TONE_STOPS[tone]

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[126deg]">
        <defs>
          <linearGradient id={`g-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={a} />
            <stop offset="100%" stopColor={b} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-track)"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#g-${id})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${(dash * v) / 100} ${c}`}
          style={{
            transition: 'stroke-dasharray .7s cubic-bezier(.22,1,.36,1)',
            filter: `drop-shadow(0 0 10px ${TONE_GLOW[tone]})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        {center ?? (
          <>
            <div className="num text-[26px] font-semibold leading-none text-fg">
              {v.toFixed(0)}
              <span className="ml-0.5 text-[13px] text-muted">%</span>
            </div>
            {label && <div className="mt-1 text-[11px] uppercase tracking-[0.1em] text-faint">{label}</div>}
            {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
          </>
        )}
      </div>
    </div>
  )
}

function toPath(data: number[], w: number, h: number, min: number, max: number, smooth = true): string {
  if (data.length === 0) return ''
  const span = max - min || 1
  const pts = data.map((d, i) => {
    const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w
    const y = h - ((d - min) / span) * h
    return [x, Math.max(0.5, Math.min(h - 0.5, y))] as const
  })
  if (!smooth || pts.length < 3) {
    return `M ${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ')}`
  }
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }
  return d
}

/** 面积折线：自适应宽度，自归一化 */
export function Sparkline({
  data,
  height = 56,
  tone = 'accent',
  min: minProp,
  max: maxProp,
  area = true,
  className,
  strokeWidth = 2,
}: {
  data: number[]
  height?: number
  tone?: 'accent' | 'cyan' | 'warn' | 'danger' | 'ok'
  min?: number
  max?: number
  area?: boolean
  className?: string
  strokeWidth?: number
}) {
  const id = useId().replace(/:/g, '')
  const [a, b] = TONE_STOPS[tone]
  const w = 300
  const h = height
  const values = data.length > 0 ? data : [0, 0]
  const min = minProp ?? Math.min(...values) * 0.98
  const max = maxProp ?? (Math.max(...values) * 1.02 || 1)
  const path = toPath(values, w, h, min, max === min ? min + 1 : max)
  const areaPath = `${path} L ${w} ${h} L 0 ${h} Z`

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={clsx('w-full', className)}
      style={{ height }}
    >
      <defs>
        <linearGradient id={`s-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
        <linearGradient id={`f-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={a} stopOpacity=".35" />
          <stop offset="100%" stopColor={a} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={areaPath} fill={`url(#f-${id})`} />}
      <path
        d={path}
        fill="none"
        stroke={`url(#s-${id})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** 每日柱状：柱高按比例，缺数据日显示为极矮底条 */
export function MiniBars({
  data,
  height = 64,
  tone = 'accent',
  format,
  max: maxProp,
  className,
}: {
  data: { label: string; value: number; hint?: string }[]
  height?: number
  tone?: 'accent' | 'cyan' | 'ok'
  format?: (v: number) => string
  /** 固定上限：给出时柱高按真实比例，不再自归一化（开机时长建议传 86400 秒） */
  max?: number
  className?: string
}) {
  const max = maxProp && maxProp > 0 ? maxProp : Math.max(1, ...data.map((d) => d.value))
  return (
    <div className={clsx('flex items-end gap-1.5', className)} style={{ height }}>
      {data.map((d) => {
        const pct = (d.value / max) * 100
        const barColor =
          tone === 'ok'
            ? 'var(--tone-ok-a)'
            : tone === 'cyan'
              ? 'var(--tone-cyan-a)'
              : 'var(--tone-accent-a)'
        return (
          <div key={d.label} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className="w-full rounded-[5px] transition-all duration-500"
              style={{
                height: `${Math.max(3, pct)}%`,
                background: d.value > 0 ? barColor : 'var(--color-track)',
                opacity: d.value > 0 ? 1 : 0.6,
              }}
            />
            <span className="mt-1.5 truncate text-center text-[9.5px] text-faint">{d.label}</span>
            {/* tooltip：不再用 left-1/2 硬居中。居中 + whitespace-nowrap 会让
                最后一根柱子的提示框伸出容器右边界（385px 视口实测到 right:495px），
                从而把整页顶出横向滚动条。改成贴右对齐 + max-w 收敛，
                任何位置都不会超出所在柱的右边缘。 */}
            <div className="pointer-events-none absolute -top-7 right-0 z-10 max-w-[9rem] truncate rounded-md border border-line bg-popover px-2 py-1 text-[10px] text-fg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {d.hint ?? (format ? format(d.value) : d.value)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 迷你横向条：网卡/磁盘列表用 */
export function MeterRow({
  label,
  sub,
  percent,
  tone = 'accent',
}: {
  label: React.ReactNode
  sub?: React.ReactNode
  percent: number
  tone?: 'accent' | 'cyan' | 'ok' | 'warn' | 'danger'
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[12.5px] text-fg-soft">{label}</span>
        <span className="num shrink-0 text-[11.5px] text-muted">{sub}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.max(1, Math.min(100, percent))}%`,
            background:
              tone === 'warn'
                ? 'linear-gradient(90deg,var(--tone-warn-a),var(--tone-warn-b))'
                : tone === 'danger'
                  ? 'linear-gradient(90deg,var(--tone-danger-a),var(--tone-danger-b))'
                  : tone === 'ok'
                    ? 'linear-gradient(90deg,var(--tone-ok-a),var(--tone-ok-b))'
                    : 'linear-gradient(90deg,var(--tone-accent-a),var(--tone-accent-b))',
          }}
        />
      </div>
    </div>
  )
}
