import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { IconButton } from '../ui'

/**
 * 设备详情页内的右侧抽屉。
 *
 * 为什么用抽屉而不是二级页面：文件管理和定时任务都是「针对当前这台设备」的附加操作，
 * 用抽屉可以在不离开详情页的前提下完成，关掉立刻回到设备状态；也不用新增路由、
 * 不会打断详情页的实时状态订阅与滚动位置。
 *
 * 窄屏（<640px）时占满整屏宽度，内容区自己滚动，避免横向溢出。
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  desc,
  icon,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  desc?: ReactNode
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 抽屉里可能还叠着确认弹窗（ScheduleModal / 删除确认），让上层先处理
      const dialogs = document.querySelectorAll('[aria-modal="true"]')
      if (dialogs.length > 1) return
      onClose()
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
        <div className="fixed inset-0 z-40">
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            initial={{ x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-full flex-col border-l border-white/10 bg-[rgba(9,11,18,.96)] shadow-lift backdrop-blur-xl sm:w-[min(720px,92vw)]"
          >
            <header className="flex items-start gap-3 border-b border-white/[0.07] px-4 py-3">
              {icon && (
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-accent-soft">
                  {icon}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold text-fg">{title}</h2>
                {desc && <p className="mt-0.5 truncate text-[11.5px] text-muted">{desc}</p>}
              </div>
              <IconButton label="关闭" onClick={onClose} className="shrink-0">
                <X size={17} />
              </IconButton>
            </header>

            <div className="scroll-area min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
              {children}
            </div>

            {footer && (
              <div className="border-t border-white/[0.07] px-4 py-3">{footer}</div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
