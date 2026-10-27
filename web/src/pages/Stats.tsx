import { useCallback, useMemo } from 'react'
import { BarChart3, RotateCw } from 'lucide-react'
import { Button, Card } from '../components/ui'
import { DeviceSelect } from '../components/device/DeviceSelect'
import { StatsPanel } from '../components/device/StatsPanel'
import { AgentClient } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { useActiveTarget } from '../lib/useActiveTarget'
import { useApp } from '../store/app'

/**
 * 统计页：当前设备的整体画像。数据来自 /stats 一次聚合，不用前端拼五个请求。
 * 层级交给 StatsPanel（主视觉 / 规模 / 明细），这里只负责选设备与刷新。
 */
export default function Stats() {
  const setActive = useApp((s) => s.setActive)

  // 统一走 useActiveTarget：它知道「本机」在手机上不成立（那里 127.0.0.1 是手机自己），
  // 也会在没有任何可读目标时给出兜底。页面不再自己拼 [LOCAL_DEVICE, ...devices]，
  // 否则两处逻辑会分叉 —— 之前手机上默认选中「本机」导致一进统计页就「读取失败」。
  const { devices: options, device, deviceId, setDeviceId, pairedCount, localAvailable } =
    useActiveTarget()

  const onSelect = useCallback(
    (id: string) => {
      setDeviceId(id)
      setActive(id)
    },
    [setDeviceId, setActive],
  )

  const noTarget = !localAvailable && pairedCount === 0

  const client = useMemo(
    () =>
      new AgentClient(
        { host: device.host, port: device.port, tls: device.tls, local: device.local },
        device.local ? undefined : device.token,
      ),
    [device.host, device.port, device.tls, device.token, device.local],
  )

  const stats = useAsync(
    // 没有任何可读目标时不要发请求：那只会得到一条无意义的失败，
    // 而且会把「去配对」的引导盖掉。返回 null 让下面渲染引导卡片。
    () => (noTarget ? Promise.resolve(null) : client.stats(14)),
    [noTarget, device.id, device.host, device.port, device.token],
  )

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
          <DeviceSelect devices={options} value={deviceId} onChange={onSelect} />
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            icon={<RotateCw size={13} />}
            onClick={stats.reload}
            loading={stats.loading}
            disabled={noTarget}
          >
            刷新
          </Button>
        </div>
      </div>

      {noTarget ? (
        // 手机上一台都没配对：这里不该报「读取失败」，那会让人以为被控端坏了。
        // 手机上不存在「本机」目标（127.0.0.1 是手机自己），所以只能引导去配对。
        <Card>
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-elevated text-accent-soft">
              <BarChart3 size={16} />
            </span>
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-fg">还没有可统计的设备</h3>
              <p className="mt-1 break-words text-[12.5px] leading-relaxed text-muted">
                这台手机跑不了被控端，所以没有「本机」数据。先去「发现」页扫描局域网，
                配对一台正在运行的电脑，这里就会显示它的运行时长与资源水位。
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  window.location.hash = '#/scan'
                }}
              >
                去发现页扫描
              </Button>
            </div>
          </div>
        </Card>
      ) : stats.error ? (
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
        <StatsPanel data={stats.data} loading={stats.loading} isSelf={!!device.local} />
      )}
    </div>
  )
}
