import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Info, TriangleAlert, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../store/app'

type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral' | 'cyan'

const TONES: Record<Tone, string> = {
  ok: 'border-ok/30 bg-ok/12 text-ok',
  warn: 'border-warn/30 bg-warn/12 text-warn',
  danger: 'border-danger/30 bg-danger/12 text-danger',
  accent: 'border-accent/35 bg-accent/15 text-accent-soft',
  cyan: 'border-cyan/30 bg-cyan/12 text-cyan',
  neutral: 'border-line bg-elevated text-fg-soft',
}

export function Badge({
  tone = 'neutral',
  dot,
  children,
  className,
}: {
  tone?: Tone
  dot?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function ProgressBar({
  value,
  tone = 'accent',
  height = 6,
  className,
}: {
  value: number
  tone?: 'accent' | 'cyan' | 'ok' | 'warn' | 'danger'
  height?: number
  className?: string
}) {
  const grad: Record<string, string> = {
    accent: 'linear-gradient(90deg,var(--tone-accent-a),var(--tone-accent-b))',
    cyan: 'linear-gradient(90deg,var(--tone-cyan-a),var(--tone-accent-a))',
    ok: 'linear-gradient(90deg,var(--tone-ok-a),var(--tone-ok-b))',
    warn: 'linear-gradient(90deg,var(--tone-warn-a),var(--tone-warn-b))',
    danger: 'linear-gradient(90deg,var(--tone-danger-a),var(--tone-danger-b))',
  }
  return (
    <div
      className={clsx('w-full overflow-hidden rounded-full bg-track', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: grad[tone] }}
        initial={false}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ type: 'spring', stiffness: 180, damping: 28 }}
      />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  desc?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-[20px] border border-line bg-elevated text-accent-soft">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {desc && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx('animate-pulse rounded-xl bg-elevated', className)}
      style={{
        backgroundImage:
          'linear-gradient(90deg, var(--color-elevated) 25%, var(--color-elevated-2) 37%, var(--color-elevated) 63%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.6s linear infinite',
      }}
    />
  )
}

export function Modal({
  open,
  onClose,
  title,
  desc,
  children,
  footer,
  width = 460,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  desc?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-scrim backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="panel panel-edge relative w-full overflow-hidden p-5 shadow-lift"
            style={{ maxWidth: width }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {title && <h3 className="text-[16px] font-semibold text-fg">{title}</h3>}
                {desc && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{desc}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="关闭"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
              >
                <X size={16} />
              </button>
            </div>
            {children && <div className="mt-4">{children}</div>}
            {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

const TOAST_ICON = {
  ok: <Check size={15} />,
  error: <TriangleAlert size={15} />,
  info: <Info size={15} />,
}

export function ToastHost() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return createPortal(
    // top 用 safe-area：手机刘海/状态栏会盖住原本的 top-3，提示条被切一半
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={() => dismiss(t.id)}
            className={clsx(
              'panel pointer-events-auto flex w-full max-w-sm items-start gap-2.5 px-3.5 py-3',
              t.kind === 'error' && 'border-danger/30',
              t.kind === 'ok' && 'border-ok/25',
            )}
          >
            <span
              className={clsx(
                'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full',
                t.kind === 'error'
                  ? 'bg-danger/15 text-danger'
                  : t.kind === 'ok'
                    ? 'bg-ok/15 text-ok'
                    : 'bg-accent/15 text-accent-soft',
              )}
            >
              {TOAST_ICON[t.kind]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-fg">{t.title}</div>
              {t.desc && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{t.desc}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
