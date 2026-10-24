import { useNavigate } from 'react-router-dom'
import { BarChart3, Radar } from 'lucide-react'
import { Button, Card, EmptyState } from '../components/ui'
import { DeviceSelect } from '../components/device/DeviceSelect'
import { StatsPanel } from '../components/device/StatsPanel'
import { useAsync, useClient } from '../lib/hooks'
import { useApp } from '../store/app'

/** 统计页：当前设备的整体画像。数据来自 /stats 一次聚合，不用前端拼五个请求。 */
export default function Stats() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const setActive = useApp((s) => s.setActive)
  const device = devices.find((d) => d.id === activeId) ?? devices[0]
  const client = useClient(device)
  const navigate = useNavigate()

  const stats = useAsync(client ? () => client.stats(14) : null, [
    device?.id,
    device?.host,
    device?.port,
  ])

  if (!device) {
    return (
      <Card>
        <EmptyState
          icon={<Radar size={26} />}
          title="还没有可统计的设备"
          desc="先扫描并配对一台设备，这里会显示它的运行时长、资源水位与操作统计。"
          action={
            <Button variant="primary" onClick={() => navigate('/scan')}>
              去发现设备
            </Button>
          }
        />
      </Card>
    )
  }

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
          <DeviceSelect devices={devices} value={device.id} onChange={setActive} />
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
