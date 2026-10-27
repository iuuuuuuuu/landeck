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
        <main className="px-safe mx-auto w-full max-w-[1240px] flex-1 px-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-4 min-[900px]:pb-8">
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
