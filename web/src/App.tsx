import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ToastHost } from './components/ui'
import Scan from './pages/Scan'
import Devices from './pages/Devices'
import LocalDevice from './pages/LocalDevice'
import DeviceDetail from './pages/DeviceDetail'
import Settings from './pages/Settings'
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
          {/* 文件 / 定时已收进设备详情页：旧链接重定向，避免书签 404 */}
          <Route path="/files" element={<Navigate to="/devices" replace />} />
          <Route path="/schedules" element={<Navigate to="/devices" replace />} />
          {/* 统计 / 活动页已下线（用户反馈没用到）：旧链接同样重定向，不留 404 */}
          <Route path="/stats" element={<Navigate to="/devices" replace />} />
          <Route path="/activity" element={<Navigate to="/devices" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </AppShell>
      <ToastHost />
    </>
  )
}
