import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { MobileTabBar } from './MobileTabBar'
import { AppSidebar } from './AppSidebar'
import { ErrorBoundary } from '../ui/ErrorBoundary'

/**
 * 应用外壳（Hindsight 风格骨架）。
 *
 * 桌面（≥1024px）：左侧 280px 侧栏 + 内容区（最大 1240px 居中）。
 * 窄屏（<1024px）：侧栏折叠为底部 tab bar（一级四项）。
 *
 * 顶栏（TopBar）在一期骨架里整个移除：Hindsight 没有顶栏，页标题与汇总
 * 由 shell/PageHeader 承担，全局控件（主题切换、采集状态）收进侧栏底部，
 * 扫描入口在设备页 PageHeader 的 actions 里 —— 空壳顶栏只占高度不加信息。
 * ToastHost 由 App.tsx 统一挂载，这里不重复。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()

  return (
    <div className="min-h-full">
      <AppSidebar />
      <div className="flex min-h-full flex-col min-[1024px]:pl-[304px]">
        <main className="px-safe mx-auto w-full max-w-[1240px] flex-1 px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-4 min-[1024px]:pb-8 min-[1024px]:pt-6">
          {/*
            切页动画：刻意【不用】framer-motion。

            实测（CDP CPU profile，385px 手机视口，连续切 6 页）：
            原来那个 motion.div 带 initial={{ y: 8 }} 的位移动画，每次切页会让
            framer-motion 走一遍 measureScroll（测量滚动容器），单项吃掉 122ms ——
            是切页开销里最大的一笔，比 React 渲染本身还多（bu 45.7 + Fu 23.6）。

            现在改成纯 CSS 的 page-enter 关键帧（见 index.css）：
            transform + opacity 都走合成层，浏览器不需要读布局，也就没有测量成本。
            视觉几乎一致（8px 上浮 + 淡入 260ms），但不再占主线程。
          */}
          <div key={pathname} className="page-enter">
            <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
          </div>
        </main>
      </div>
      <MobileTabBar />
    </div>
  )
}
