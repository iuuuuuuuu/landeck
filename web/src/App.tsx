import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ToastHost } from './components/ui'
import Scan from './pages/Scan'
import Devices from './pages/Devices'
import LocalDevice from './pages/LocalDevice'
import DeviceDetail from './pages/DeviceDetail'
import Activity from './pages/Activity'
import Settings from './pages/Settings'
import Stats from './pages/Stats'
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
          <Route path="/stats" element={<Stats />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </AppShell>
      <ToastHost />
    </>
  )
}
