import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/** 解析出来的一项 */
interface Opt {
  value: string
  label: string
  disabled: boolean
}

/**
 * 从 `<option>` 子节点里读出选项。
 *
 * 为什么仍然吃 `<option>` 而不是要求调用方传 options 数组：
 * 现有调用点（设备切换、定时动作选择）都是 `<Select><option/></Select>` 的写法，
 * 保持同样的 children 约定，改造就不用动任何调用点。
 * 这样也避免了"两套 API 并存"的混乱。
 */
function parseOptions(children: ReactNode): Opt[] {
  const out: Opt[] = []
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return
      if (child.type === 'optgroup') {
        walk((child.props as { children?: ReactNode }).children)
        return
      }
      if (child.type !== 'option') return
      const p = child.props as { value?: string | number; disabled?: boolean; children?: ReactNode }
      const label = Children.toArray(p.children)
        .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
        .join('')
      out.push({
        value: p.value === undefined ? label : String(p.value),
        label: label || String(p.value ?? ''),
        disabled: Boolean(p.disabled),
      })
    })
  }
  walk(children)
  return out
}

/**
 * 下拉选择（替代原生 `<select>`）。
 *
 * 为什么不用原生的：原生 select 的弹层由操作系统绘制，样式完全跟不上界面，
 * 在深色/浅色主题下都是突兀的白底系统菜单（用户反馈「下拉框到现在还是原生的」）。
 *
 * 能力对齐原生：点击外部关闭、Esc 关闭、上下键移动、回车选中、Home/End、
 * aria 角色（combobox + listbox + option）、禁用项跳过。
 * 弹层用 portal + fixed 定位，所以放进 Drawer / Modal 里也不会被 overflow 裁掉。
 */
export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  id: idProp,
}: {
  className?: string
  children?: ReactNode
  value?: string | number
  /** 与原生 select 保持同样的调用写法：(e) => onChange(e.target.value) */
  onChange?: (e: { target: { value: string } }) => void
  disabled?: boolean
  'aria-label'?: string
  id?: string
}) {
  const autoId = useId()
  const id = idProp ?? autoId
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const options = useMemo(() => parseOptions(children), [children])
  const current = String(value ?? '')
  const currentIndex = Math.max(0, options.findIndex((o) => o.value === current))
  const currentLabel = options[currentIndex]?.label ?? ''

  /** 计算弹层位置：下方放不开就向上弹 */
  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const up = spaceBelow < 260 && r.top > spaceBelow
    setRect({ left: r.left, top: up ? r.top : r.bottom, width: r.width, up })
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    place()
    setActive(currentIndex)
    setOpen(true)
  }, [disabled, place, currentIndex])

  const close = useCallback(() => setOpen(false), [])

  const choose = useCallback(
    (opt: Opt) => {
      if (opt.disabled) return
      onChange?.({ target: { value: opt.value } })
      setOpen(false)
      btnRef.current?.focus()
    },
    [onChange],
  )

  // 点击外部 / 滚动 / 改尺寸时关闭或重定位
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return
      close()
    }
    // 只兜底 Escape（焦点可能被别处拿走）。方向键/回车统一由按钮的 onKeyDown 处理：
    // 弹层打开时焦点始终留在按钮上，两处都监听会重复触发一次选择。
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
      btnRef.current?.focus()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, close, place])

  // 键盘移动时把高亮项滚进视野
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openMenu()
            }
            return
          }
          // 打开状态：全部按键在这里处理（焦点不离开按钮，避免重复监听导致选两次）
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const dir = e.key === 'ArrowDown' ? 1 : -1
            setActive((i) => {
              let next = i
              for (let n = 0; n < options.length; n++) {
                next = (next + dir + options.length) % options.length
                if (!options[next]?.disabled) break
              }
              return next
            })
            return
          }
          if (e.key === 'Home') {
            e.preventDefault()
            setActive(0)
            return
          }
          if (e.key === 'End') {
            e.preventDefault()
            setActive(Math.max(0, options.length - 1))
            return
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            const opt = options[active]
            if (opt) choose(opt)
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
        className={clsx(
          'group flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-elevated px-3.5 text-left text-[14px] text-fg',
          'outline-none transition-colors',
          'hover:border-line-strong focus-visible:border-accent/55 focus-visible:ring-2 focus-visible:ring-accent/20',
          open && 'border-accent/55 ring-2 ring-accent/20',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{currentLabel || '请选择'}</span>
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          className={clsx(
            'shrink-0 text-muted transition-transform duration-200',
            open && 'rotate-180 text-accent-soft',
          )}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <>
              {/* 遮罩只负责吃掉滚动/点击，不做视觉变暗，避免在抽屉里显得沉重 */}
              <div className="fixed inset-0 z-[70]" />
              <motion.div
                ref={listRef}
                role="listbox"
                aria-labelledby={id}
                initial={{ opacity: 0, y: rect.up ? 6 : -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: rect.up ? 4 : -4, scale: 0.98 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                style={{
                  left: rect.left,
                  top: rect.up ? undefined : rect.top + 6,
                  bottom: rect.up ? window.innerHeight - rect.top + 6 : undefined,
                  width: rect.width,
                }}
                className={clsx(
                  'fixed z-[71] max-h-[264px] overflow-y-auto overscroll-contain rounded-xl border border-line p-1',
                  'bg-surface/95 shadow-[0_18px_48px_-12px_rgba(4,6,14,0.55)] backdrop-blur-xl',
                )}
              >
                {options.length === 0 && (
                  <div className="px-3 py-2 text-[12.5px] text-faint">没有可选项</div>
                )}
                {options.map((o, i) => {
                  const selected = o.value === current
                  return (
                    <div
                      key={`${o.value}-${i}`}
                      data-idx={i}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={o.disabled}
                      onMouseEnter={() => !o.disabled && setActive(i)}
                      onClick={() => choose(o)}
                      className={clsx(
                        'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                        o.disabled && 'cursor-not-allowed opacity-40',
                        !o.disabled && i === active && 'bg-elevated-2 text-fg',
                        !o.disabled && i !== active && 'text-fg-soft',
                        selected && 'font-medium',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {selected && <Check size={14} strokeWidth={2} className="shrink-0 text-accent" />}
                    </div>
                  )
                })}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
