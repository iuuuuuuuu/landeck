import clsx from 'clsx'
import type { ReactNode } from 'react'

export function Card({
  children,
  className,
  padded = true,
  glow,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  padded?: boolean
  glow?: boolean
  as?: 'div' | 'section' | 'li' | 'article'
}) {
  return (
    <Tag
      className={clsx(
        'panel panel-edge',
        padded && 'p-5',
        glow && 'shadow-[0_0_0_1px_rgba(124,92,255,.28),0_24px_60px_-30px_rgba(124,92,255,.55)]',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export function SectionTitle({
  title,
  desc,
  icon,
  action,
  className,
}: {
  title: ReactNode
  desc?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex items-start justify-between gap-3', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-accent-soft">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h3>
          {desc && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{desc}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'default',
  className,
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  hint?: ReactNode
  tone?: 'default' | 'accent' | 'ok' | 'warn' | 'danger'
  className?: string
}) {
  const toneClass =
    tone === 'accent'
      ? 'grad-text'
      : tone === 'ok'
        ? 'text-ok'
        : tone === 'warn'
          ? 'text-warn'
          : tone === 'danger'
            ? 'text-danger'
            : 'text-fg'
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="text-[11.5px] uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={clsx('num text-2xl font-semibold leading-none', toneClass)}>{value}</span>
        {unit && <span className="text-[12px] text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 truncate text-[11.5px] text-faint">{hint}</div>}
    </div>
  )
}

/** 设备图标底座：系统色 + 首字母，列表与详情共用，避免各家画一遍 */
export function DeviceAvatar({
  os,
  size = 44,
  online,
}: {
  os?: string
  size?: number
  online?: boolean
}) {
  const glyph = os === 'darwin' ? '⌘' : os === 'linux' ? '❯' : '⊞'
  const ring =
    os === 'darwin'
      ? 'from-[#8e8e93]/30 to-white/5 text-white'
      : os === 'linux'
        ? 'from-[#fbbf24]/25 to-white/5 text-warn'
        : 'from-[#22d3ee]/25 to-white/5 text-cyan'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={clsx(
          'grid h-full w-full place-items-center rounded-[14px] border border-white/10 bg-gradient-to-br',
          ring,
        )}
        style={{ fontSize: size * 0.42 }}
      >
        <span className="num leading-none">{glyph}</span>
      </div>
      {online !== undefined && (
        <span
          className={clsx(
            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink',
            online ? 'bg-ok' : 'bg-faint',
          )}
          style={{ boxShadow: online ? '0 0 10px rgba(52,211,153,.8)' : undefined }}
        />
      )}
    </div>
  )
}
