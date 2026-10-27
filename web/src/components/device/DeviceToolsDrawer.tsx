import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { CalendarClock, FolderOpen, PanelsTopLeft, X } from 'lucide-react'
import { IconButton, Segmented } from '../ui'
import type { AgentClient } from '../../lib/api'
import type { PairedDevice } from '../../store/app'
import { FilesPanel } from '../../pages/Files'
import { SchedulesPanel } from '../../pages/Schedules'

type ToolsTab = 'files' | 'schedules'

const TABS: { value: ToolsTab; label: string; icon: ReactNode }[] = [
  { value: 'files', label: '文件管理', icon: <FolderOpen size={14} /> },
  { value: 'schedules', label: '定时任务', icon: <CalendarClock size={14} /> },
]

/**
 * 设备管理工具抽屉：文件管理 + 定时任务合并成一个入口，内部用顶部 tab 切换。
 *
 * 为什么不用 DetailDrawer：那边宽度写死 720px/92vw，这里按需求要 760px/94vw，
 * 且 tab 条要固定在抽屉头部（不随内容滚动）。关闭语义与 DetailDrawer 保持一致：
 * ESC / 点遮罩 / 右上角关闭按钮，打开时锁 body 滚动。
 */
export function DeviceToolsDrawer({
  open,
  onClose,
  device,
  client,
  onAuthError,
  initialTab = 'files',
}: {
  open: boolean
  onClose: () => void
  device: PairedDevice
  client: AgentClient | null
  onAuthError?: () => void
  /** 从页面上的「定时任务」卡进来时直接落在 schedules */
  initialTab?: ToolsTab
}) {
  const [tab, setTab] = useState<ToolsTab>(initialTab)

  // 抽屉每次被重新打开时都回到调用方指定的 tab（例如从定时任务卡点进来）
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // 换设备时回到第一页 tab，避免标题是 A 设备、内容是 B 设备的旧状态
  useEffect(() => {
    setTab('files')
  }, [device.id])

  // tab 切换后从顶部开始看，否则会停在上一个 tab 的滚动位置
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [tab])

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
    // 刻意不用 AnimatePresence + motion.aside。
    //
    // 实测：抽屉用 spring 做 x 位移 + opacity，再叠 backdrop-blur-xl，
    // 打开瞬间要重建合成层并触发 framer-motion 的布局测量，手机上明显掉帧。
    // 这与之前 AppShell / Radar / Button 的问题是同一类。
    // 现在用纯 CSS 动画（drawer-scrim / drawer-panel，见 index.css）：
    // 只动 opacity 与 transform，走合成层；退场动画由 CSS 的 animation-fill-mode 完成。
    // 关闭时的「滑出」效果省掉了（只做快速淡出），换来打开瞬间不卡。
    open && (
      <div className="fixed inset-0 z-40">
        <div className="drawer-scrim absolute inset-0 bg-scrim" onClick={onClose} />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="管理工具"
          className="drawer-panel absolute inset-y-0 right-0 flex w-full max-w-full flex-col border-l border-line bg-popover shadow-lift sm:w-[min(760px,94vw)]"
        >
            {/* pt-safe：抽屉是 absolute inset-y-0 铺满全屏，手机上会顶到状态栏下面。
                原来只有 py-3，操作栏被状态栏压住 —— 加 pt-safe 让内容避让刘海/状态栏。 */}
            <header className="pt-safe flex items-start gap-3 border-b border-line-soft px-4 pb-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line-soft bg-elevated text-accent-soft">
                <PanelsTopLeft size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold text-fg">管理工具</h2>
                <p className="mt-0.5 truncate text-[11.5px] text-muted">
                  {device.name} · 文件与定时都在这里
                </p>
              </div>
              <IconButton label="关闭" onClick={onClose} className="shrink-0">
                <X size={17} />
              </IconButton>
            </header>

            <div className="border-b border-line-soft px-3 py-2.5 sm:px-4">
              <Segmented
                value={tab}
                onChange={setTab}
                options={TABS}
                size="sm"
                className="w-full [&>button]:flex-1"
              />
            </div>

            <div
              ref={bodyRef}
              className="scroll-area min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-safe sm:px-4"
            >
              {/* 两个面板都保持挂载：切 tab 再切回来不会丢失当前目录 / 列表状态 */}
              <div className={clsx(tab !== 'files' && 'hidden')}>
                {client && (
                  <FilesPanel device={device} client={client} onAuthError={onAuthError} />
                )}
              </div>
              <div className={clsx(tab !== 'schedules' && 'hidden')}>
                {client && (
                  <SchedulesPanel device={device} client={client} onAuthError={onAuthError} />
                )}
              </div>
            </div>
        </aside>
      </div>
    ),
    document.body,
  )
}
