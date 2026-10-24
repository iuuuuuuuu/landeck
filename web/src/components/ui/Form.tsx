import clsx from 'clsx'
import { motion } from 'framer-motion'
import { useId, type ReactNode } from 'react'

export function Toggle({
  checked,
  onChange,
  label,
  desc,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  desc?: ReactNode
  disabled?: boolean
}) {
  return (
    <label
      className={clsx(
        'flex items-center justify-between gap-4 select-none',
        disabled ? 'opacity-50' : 'cursor-pointer',
      )}
    >
      {(label || desc) && (
        <span className="min-w-0">
          {label && <span className="block text-[13.5px] font-medium text-fg">{label}</span>}
          {desc && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{desc}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
          checked
            ? 'border-accent/60 bg-[linear-gradient(135deg,#8b6bff,#22d3ee)]'
            : 'border-white/12 bg-white/8',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-md"
          style={{ left: checked ? 22 : 3 }}
        />
      </button>
    </label>
  )
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  tone = 'accent',
  className,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  tone?: 'accent' | 'cyan' | 'warn'
  className?: string
}) {
  const pct = ((value - min) / (max - min)) * 100
  const pair =
    tone === 'cyan' ? ['#22d3ee', '#7c5cff'] : tone === 'warn' ? ['#fbbf24', '#fb7185'] : ['#7c5cff', '#22d3ee']
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={clsx('ldk-slider w-full', disabled && 'opacity-50', className)}
      style={
        {
          '--pct': `${pct}%`,
          '--slider-a': pair[0],
          '--slider-b': pair[1],
        } as React.CSSProperties
      }
    />
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  htmlFor?: string
  className?: string
}) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-[12px] font-medium tracking-wide text-fg-soft">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[11.5px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11.5px] leading-relaxed text-faint">{hint}</p>
      ) : null}
    </div>
  )
}

export function Input({
  className,
  mono,
  suffix,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; suffix?: ReactNode }) {
  return (
    <div className="relative">
      <input
        className={clsx(
          'h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[14px] text-fg',
          'placeholder:text-faint outline-none transition-colors',
          'focus:border-accent/55 focus:bg-white/[0.06] focus:ring-2 focus:ring-accent/20',
          mono && 'font-mono tracking-[0.14em]',
          suffix && 'pr-12',
          className,
        )}
        {...rest}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{suffix}</span>
      )}
    </div>
  )
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        'h-11 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[14px] text-fg',
        'outline-none transition-colors focus:border-accent/55 focus:ring-2 focus:ring-accent/20',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; icon?: ReactNode }[]
  size?: 'sm' | 'md'
  className?: string
}) {
  const id = useId()
  return (
    <div
      className={clsx(
        'relative inline-flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.035] p-1',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={clsx(
              'relative z-10 inline-flex items-center gap-1.5 rounded-[9px] font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3.5 text-[13px]',
              active ? 'text-fg' : 'text-muted hover:text-fg-soft',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 -z-10 rounded-[9px] border border-white/12 bg-white/10"
              />
            )}
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
