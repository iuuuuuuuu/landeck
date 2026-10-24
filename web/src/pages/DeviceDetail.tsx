import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, EmptyState } from '../components/ui'
import { MonitorSmartphone } from 'lucide-react'
import { DeviceBanner } from '../components/device/DeviceBanner'
import { CountdownBar } from '../components/device/CountdownBar'
import { PowerCard } from '../components/device/PowerCard'
import { VolumeCard } from '../components/device/VolumeCard'
import { MediaCard } from '../components/device/MediaCard'
import { LiveStats } from '../components/device/LiveStats'
import { HardwarePanel } from '../components/device/HardwarePanel'
import { UptimePanel } from '../components/device/UptimePanel'
import { ProcessPanel } from '../components/device/ProcessPanel'
import { AuthLost } from '../components/device/AuthLost'
import { useFetch } from '../components/device/useFetch'
import { useActionRunner } from '../components/device/useActionRunner'
import { useClient, useLive } from '../lib/hooks'
import { useApp, useDevice } from '../store/app'

interface Countdown {
  label: string
  until: number
}

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const device = useDevice(id)
  const removeDevice = useApp((s) => s.removeDevice)
  const toast = useApp((s) => s.toast)

  const client = useClient(device)
  const live = useLive(device)
  const [authLost, setAuthLost] = useState(false)
  const [countdown, setCountdown] = useState<Countdown | null>(null)

  const markAuthLost = useCallback(() => setAuthLost(true), [])

  const sys = useFetch(
    client ? () => client.system() : null,
    [client?.target.host, client?.target.port, client?.token],
    markAuthLost,
  )
  const { pending: canceling, run } = useActionRunner(client, markAuthLost)

  const onScheduled = useCallback((label: string, seconds: number) => {
    setCountdown({ label, until: Date.now() + seconds * 1000 })
  }, [])

  const cancelCountdown = async () => {
    const res = await run('power.cancel', {}, '已取消待执行的关机')
    if (res) setCountdown(null)
  }

  const unpair = () => {
    if (!device) return
    removeDevice(device.id)
    toast({ kind: 'info', title: '已解除配对', desc: `${device.name} 已从本机移除` })
    navigate('/devices')
  }

  if (!device) {
    return (
      <Card className="mx-auto max-w-md">
        <EmptyState
          icon={<MonitorSmartphone size={26} />}
          title="设备不存在或已被移除"
          desc="它可能已在另一台控制端被解除配对。回到设备列表重新选择，或扫描局域网重新发现。"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => navigate('/devices')}>
                返回设备列表
              </Button>
              <Button variant="primary" onClick={() => navigate('/scan')}>
                扫描设备
              </Button>
            </div>
          }
        />
      </Card>
    )
  }

  if (authLost) return <AuthLost />

  // 可达性：system 成功即算可达，失败视为离线；实时连接状态单独由 live.connected 表达
  const reachable = sys.data ? true : sys.error ? false : null

  return (
    <div className="space-y-3">
      <DeviceBanner
        device={device}
        system={sys.data}
        connected={live.connected}
        reachable={reachable}
        onUnpair={unpair}
      />

      {countdown && (
        <CountdownBar
          label={countdown.label}
          until={countdown.until}
          pending={canceling === 'power.cancel'}
          onCancel={() => void cancelCountdown()}
          onDone={() => setCountdown(null)}
        />
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <PowerCard
          client={client}
          system={sys.data}
          onScheduled={onScheduled}
          onAuthError={markAuthLost}
        />
        <VolumeCard client={client} onAuthError={markAuthLost} />
        <MediaCard client={client} media={live.media} onAuthError={markAuthLost} />
      </div>

      <div key={device.id} className="grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <LiveStats live={live} />
        </div>
        <div className="lg:col-span-5">
          <HardwarePanel client={client} onAuthError={markAuthLost} />
        </div>
        <div className="lg:col-span-12">
          <UptimePanel client={client} onAuthError={markAuthLost} />
        </div>
        <div className="lg:col-span-12">
          <ProcessPanel client={client} system={sys.data} onAuthError={markAuthLost} />
        </div>
      </div>
    </div>
  )
}
