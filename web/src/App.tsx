import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ToastHost } from './components/ui'
import Scan from './pages/Scan'
import Devices from './pages/Devices'
import LocalDevice from './pages/LocalDevice'
import DeviceDetail from './pages/DeviceDetail'
import Schedules from './pages/Schedules'
import Activity from './pages/Activity'
import Settings from './pages/Settings'
import Files from './pages/Files'
import Stats from './pages/Stats'

export default function App() {
  return (
    <>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/devices" replace />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/local" element={<LocalDevice />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/files" element={<Files />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </AppShell>
      <ToastHost />
    </>
  )
}
