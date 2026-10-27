import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, EmptyState } from '../components/ui'
import { ChevronRight, MonitorSmartphone, PanelsTopLeft } from 'lucide-react'
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
import { DeviceToolsDrawer } from '../components/device/DeviceToolsDrawer'
import { ScheduleListCard } from '../components/device/ScheduleListCard'
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
  /** 管理工具抽屉：文件管理与定时任务合并在一个入口里（内部 tab 切换） */
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsTab, setToolsTab] = useState<'files' | 'schedules'>('files')

  const markAuthLost = useCallback(() => setAuthLost(true), [])

  // 抽屉里的操作都绑定当前设备，切设备时收起，避免内容与标题错位
  useEffect(() => {
    setToolsOpen(false)
  }, [device?.id])

  const sys = useFetch(
    client ? () => client.system() : null,
    [client?.target.host, client?.target.port, client?.token],
    markAuthLost,
  )
  const { pending: canceling, run } = useActionRunner(client, markAuthLost)

  /**
   * 离线时自动重试 system()。
   *
   * 用户反馈：进详情页时设备还没连上，之后设备上线了，这一页的状态永远不刷新，
   * 必须退回列表再进来才行 —— 因为 sys 是「一次性拉取」，失败后没人再触发它。
   * 这里在「有错误且未鉴权失效」时挂一个退避重试（3s→6s→12s，上限 12s），
   * 一旦成功就停；标签页不可见时不重试，避免后台耗电。
   */
  useEffect(() => {
    if (!sys.error || authLost) return
    let alive = true
    let timer: number | undefined
    let attempt = 0
    const tick = () => {
      if (!alive || document.hidden) return
      attempt += 1
      sys.reload()
      timer = window.setTimeout(tick, Math.min(3000 * attempt, 12000))
    }
    timer = window.setTimeout(tick, 3000)
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
    // sys.reload 是稳定引用；只在「从有错变无错」时重建
  }, [sys.error, sys.reload, authLost])

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
        // 与设备列表卡片用同一个图标源，避免「列表有真实 logo、详情页变默认图标」
        iconSrc={client?.selfIconUrl()}
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

      {/* 单一入口：文件管理 + 定时任务收进同一个抽屉，避免一排并列按钮 */}
      <button
        type="button"
        onClick={() => {
          setToolsTab('files')
          setToolsOpen(true)
        }}
        className="panel group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-hover"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line-soft bg-elevated text-accent-soft">
          <PanelsTopLeft size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-fg">管理工具</span>
          <span className="block truncate text-[11.5px] text-muted">
            文件管理 · 定时任务，在当前设备上直接操作
          </span>
        </span>
        <ChevronRight
          size={16}
          className="shrink-0 text-faint transition-colors group-hover:text-fg-soft"
        />
      </button>

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
        {/* 定时任务直接列在页面上，不用先进抽屉 */}
        <div className="lg:col-span-12">
          <ScheduleListCard
            client={client}
            onManage={() => {
              setToolsTab('schedules')
              setToolsOpen(true)
            }}
          />
        </div>
        <div className="lg:col-span-12">
          <UptimePanel client={client} onAuthError={markAuthLost} />
        </div>
        <div className="lg:col-span-12">
          <ProcessPanel client={client} system={sys.data} onAuthError={markAuthLost} />
        </div>
      </div>

      {/* 抽屉在详情页内打开：目标固定为当前设备，关掉即回到本页（滚动位置不变） */}
      <DeviceToolsDrawer
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        initialTab={toolsTab}
        device={device}
        client={client}
        onAuthError={markAuthLost}
      />
    </div>
  )
}
