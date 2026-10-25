import { BarChart3 } from 'lucide-react'
import { Button, Card } from '../components/ui'
import { DeviceSelect } from '../components/device/DeviceSelect'
import { StatsPanel } from '../components/device/StatsPanel'
import { useMemo } from 'react'
import { AgentClient } from '../lib/api'
import { DEFAULT_PORT } from '../lib/discovery'
import { useAsync } from '../lib/hooks'
import { useApp } from '../store/app'

/** 统计页：当前设备的整体画像。数据来自 /stats 一次聚合，不用前端拼五个请求。 */
/** 本机伪设备：统计页也能看当前这台机器，不必先配对 */
const LOCAL_DEVICE = {
  id: '__local__',
  host: '127.0.0.1',
  port: DEFAULT_PORT,
  tls: false,
  token: '',
  clientId: 'local',
  name: '本机（这台电脑）',
  os: 'windows',
  arch: 'amd64',
  ver: '',
  addedAt: 0,
  local: true,
}

export default function Stats() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const setActive = useApp((s) => s.setActive)

  // 本机永远排在第一位；没有配对设备时也能用
  const options = useMemo(() => [LOCAL_DEVICE, ...devices], [devices])
  const selectedId = activeId && options.some((d) => d.id === activeId) ? activeId : LOCAL_DEVICE.id
  const device = options.find((d) => d.id === selectedId) ?? LOCAL_DEVICE

  const client = useMemo(
    () =>
      new AgentClient(
        { host: device.host, port: device.port, tls: device.tls, local: device.local },
        device.token,
      ),
    [device.id, device.host, device.port, device.tls, device.token],
  )

  const stats = useAsync(() => client.stats(14), [device.id, device.host, device.port])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-elevated text-accent-soft">
            <BarChart3 size={16} />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-fg">统计</h2>
            <p className="text-[11.5px] text-muted">运行时长、资源水位、操作与规模</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DeviceSelect devices={options} value={device.id} onChange={setActive} />
          <Button
            size="sm"
            variant="secondary"
            onClick={stats.reload}
            loading={stats.loading}
          >
            刷新
          </Button>
        </div>
      </div>

      {stats.error ? (
        <Card>
          <p className="text-[12.5px] text-danger">{stats.error}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={stats.reload}>
            重试
          </Button>
        </Card>
      ) : (
        <StatsPanel data={stats.data} loading={stats.loading} />
      )}
    </div>
  )
}
