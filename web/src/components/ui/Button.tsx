import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import clsx from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary:
    'text-white grad-primary shadow-[0_10px_30px_-12px_rgba(124,92,255,.75)] hover:brightness-110 border border-line-strong',
  secondary:
    'text-fg-soft bg-elevated border border-line hover:bg-elevated-2 hover:text-fg',
  ghost: 'text-muted hover:text-fg hover:bg-hover border border-transparent',
  danger:
    'text-white bg-[linear-gradient(135deg,#fb7185,#e11d48)] border border-line-strong shadow-[0_10px_30px_-14px_rgba(244,63,94,.8)] hover:brightness-110',
  success:
    'text-[#04120c] bg-[linear-gradient(135deg,#6ee7b7,#34d399)] border border-line-strong hover:brightness-105',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-[10px] gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-[15px] rounded-2xl gap-2.5',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
  fullWidth?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading,
  fullWidth,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center font-medium select-none transition-colors duration-150',
        'disabled:opacity-45 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...(rest as React.ComponentProps<typeof motion.button>)}
    >
      {loading ? <Spinner size={size === 'sm' ? 13 : 16} /> : icon}
      {children}
    </motion.button>
  )
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={clsx('animate-spin', className)}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity=".22" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  variant?: Variant
  tone?: 'default' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
}

const ICON_SIZE = { sm: 'h-8 w-8 rounded-[10px]', md: 'h-10 w-10 rounded-xl', lg: 'h-12 w-12 rounded-2xl' }

export function IconButton({
  label,
  variant = 'secondary',
  size = 'md',
  active,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex items-center justify-center transition-colors duration-150',
        'disabled:opacity-40 disabled:pointer-events-none',
        VARIANTS[variant],
        ICON_SIZE[size],
        active && 'ring-1 ring-accent/60 text-fg bg-accent/15',
        className,
      )}
      {...(rest as React.ComponentProps<typeof motion.button>)}
    >
      {children}
    </motion.button>
  )
}
