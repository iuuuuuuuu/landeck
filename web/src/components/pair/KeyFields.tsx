import clsx from 'clsx'
import { Fragment, useRef } from 'react'
import { Input } from '../ui'

/**
 * 6 位随机码：大号等宽数字，3+3 分组。
 * 用一层透明 input 承接键盘与粘贴，视觉格子只负责显示。
 */
export function CodeInput({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  invalid?: boolean
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const digits = value.replace(/\D/g, '').slice(0, 6)
  const cursor = Math.min(digits.length, 5)

  return (
    <div className="relative select-none">
      <input
        ref={ref}
        value={digits}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={6}
        disabled={disabled}
        aria-label="6 位随机码"
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none"
      />
      <div className="flex items-center justify-center">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Fragment key={i}>
            {i === 3 && <span className="mx-1.5 h-7 w-px shrink-0 bg-line-strong" />}
            <span
              className={clsx(
                'grid h-14 w-[13%] min-w-9 max-w-11 place-items-center rounded-xl border text-[24px] transition-colors',
                invalid
                  ? 'border-danger/55 bg-danger/[0.07] text-danger'
                  : i === cursor && !disabled
                    ? 'border-accent/60 bg-accent/12 text-fg'
                    : digits[i]
                      ? 'border-line-strong bg-elevated-2 text-fg'
                      : 'border-line-soft bg-elevated text-faint',
                'num',
              )}
            >
              {digits[i] ?? ''}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/** 固定密钥规范化：大写、去掉分隔符、每 4 位补一个短横 */
export function formatFixedKey(raw: string): string {
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v
}

export function isFixedKeyComplete(raw: string): boolean {
  return raw.replace(/[^A-Z0-9]/g, '').length === 8
}

export function FixedKeyInput({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  invalid?: boolean
  disabled?: boolean
}) {
  return (
    <Input
      value={formatFixedKey(value)}
      onChange={(e) => onChange(formatFixedKey(e.target.value))}
      placeholder="7K9F-2M4Q"
      mono
      disabled={disabled}
      maxLength={9}
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      aria-label="固定密钥"
      aria-invalid={invalid || undefined}
      className={clsx('text-center', invalid && 'border-danger/60')}
    />
  )
}
