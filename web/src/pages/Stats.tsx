import { useMemo } from 'react'
import { BarChart3, RotateCw } from 'lucide-react'
import { Button, Card } from '../components/ui'
import { DeviceSelect } from '../components/device/DeviceSelect'
import { StatsPanel } from '../components/device/StatsPanel'
import { AgentClient } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { LOCAL_DEVICE } from '../lib/useActiveTarget'
import { useApp } from '../store/app'

/**
 * 统计页：当前设备的整体画像。数据来自 /stats 一次聚合，不用前端拼五个请求。
 * 层级交给 StatsPanel（主视觉 / 规模 / 明细），这里只负责选设备与刷新。
 */
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
        device.local ? undefined : device.token,
      ),
    [device.host, device.port, device.tls, device.token, device.local],
  )

  const stats = useAsync(() => client.stats(14), [device.id, device.host, device.port, device.token])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-accent-soft">
            <BarChart3 size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-fg">统计</h2>
            <p className="truncate text-[11.5px] text-muted">运行时长 · 资源水位 · 规模与操作</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <DeviceSelect devices={options} value={device.id} onChange={setActive} />
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            icon={<RotateCw size={13} />}
            onClick={stats.reload}
            loading={stats.loading}
          >
            刷新
          </Button>
        </div>
      </div>

      {stats.error ? (
        <Card>
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-danger/25 bg-danger/10 text-danger">
              <BarChart3 size={16} />
            </span>
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-fg">统计数据读取失败</h3>
              <p className="mt-1 break-words text-[12.5px] leading-relaxed text-danger">
                {stats.error}
              </p>
              {device.local && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  本机目标需要这台电脑上跑着被控端（默认端口 8420）。
                </p>
              )}
              <Button size="sm" variant="secondary" className="mt-3" onClick={stats.reload}>
                重试
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <StatsPanel data={stats.data} loading={stats.loading} />
      )}
    </div>
  )
}
