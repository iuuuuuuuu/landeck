import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ToastHost } from './components/ui'
import Scan from './pages/Scan'
import Devices from './pages/Devices'
import LocalDevice from './pages/LocalDevice'
import DeviceDetail from './pages/DeviceDetail'
import Files from './pages/Files'
import Schedules from './pages/Schedules'
import Settings from './pages/Settings'
// activity 页面入口：导出名即契约（activity 批维护 web/src/pages/activity/index.ts）
import {
  ActivityAllTimePage,
  ActivityCategoriesPage,
  ActivityDailyPage,
  ActivityMonthlyPage,
  ActivityWeeklyPage,
} from './pages/activity/index'
import { useLocalIdentity } from './lib/useLocalIdentity'
import { useLastRoute } from './lib/useLastRoute'

export default function App() {
  useLocalIdentity()
  useLastRoute()
  return (
    <>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/devices" replace />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/local" element={<LocalDevice />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          {/*
            一期骨架：文件 / 定时任务回到顶级（侧栏「数据」组），与
            docs/design/hindsight-revamp-phase1.md 第 2 节的信息架构对齐；
            设备详情页的工具抽屉入口保持不变，两处入口并存。
          */}
          <Route path="/files" element={<Files />} />
          <Route path="/schedules" element={<Schedules />} />
          {/*
            活动统计（Hindsight 风格改版核心）：页面实现归 activity 批（web/src/pages/activity/），
            这里只做路由注册。
          */}
          <Route path="/activity" element={<Navigate to="/activity/daily" replace />} />
          <Route path="/activity/daily" element={<ActivityDailyPage />} />
          <Route path="/activity/weekly" element={<ActivityWeeklyPage />} />
          <Route path="/activity/monthly" element={<ActivityMonthlyPage />} />
          <Route path="/activity/all" element={<ActivityAllTimePage />} />
          <Route path="/activity/categories" element={<ActivityCategoriesPage />} />
          {/* 统计页旧地址：重定向到新的活动组 */}
          <Route path="/stats" element={<Navigate to="/activity/daily" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </AppShell>
      <ToastHost />
    </>
  )
}
