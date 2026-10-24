import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { MobileTabBar } from './MobileTabBar'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ErrorBoundary } from '../ui/ErrorBoundary'

/**
 * 应用外壳。
 * 桌面（≥900px）：左侧 248px 玻璃侧栏 + 顶栏 + 内容区（最大 1240px 居中）。
 * 移动（<900px）：隐藏侧栏，改底部毛玻璃 tab bar，顶栏保留标题与设备切换。
 * ToastHost 由 App.tsx 统一挂载，这里不重复。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()

  return (
    <div className="min-h-full">
      <Sidebar />
      <div className="flex min-h-full flex-col min-[900px]:pl-[272px]">
        <TopBar />
        <main className="px-safe mx-auto w-full max-w-[1240px] flex-1 px-3 pb-32 pt-3 sm:px-4 min-[900px]:pb-8">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: 'easeOut' }}
          >
            <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
          </motion.div>
        </main>
      </div>
      <MobileTabBar />
    </div>
  )
}
