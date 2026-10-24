import clsx from 'clsx'

/** 在线状态点：true 绿 / false 红 / null 未知（呼吸态） */
export function StatusDot({
  online,
  size = 7,
  className,
}: {
  online: boolean | null
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-block shrink-0 rounded-full',
        online === true
          ? 'bg-ok'
          : online === false
            ? 'bg-danger'
            : 'animate-pulse bg-faint',
        className,
      )}
      style={{
        width: size,
        height: size,
        boxShadow:
          online === true
            ? '0 0 8px rgba(52,211,153,.9)'
            : online === false
              ? '0 0 8px rgba(251,113,133,.65)'
              : undefined,
      }}
    />
  )
}
