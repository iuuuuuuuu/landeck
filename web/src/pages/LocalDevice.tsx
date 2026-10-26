import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Info, Laptop, PanelsTopLeft, RefreshCw, Wifi } from 'lucide-react'
import { Badge, Button, Card, DeviceAvatar, SectionTitle, Skeleton } from '../components/ui'
import { HardwarePanel } from '../components/device/HardwarePanel'
import { LiveStats } from '../components/device/LiveStats'
import { MediaCard } from '../components/device/MediaCard'
import { PhoneSelfPanel } from '../components/device/PhoneSelfPanel'
import { PowerCard } from '../components/device/PowerCard'
import { ProcessPanel } from '../components/device/ProcessPanel'
import { UptimePanel } from '../components/device/UptimePanel'
import { VolumeCard } from '../components/device/VolumeCard'
import { CountdownBar } from '../components/device/CountdownBar'
import { DeviceToolsDrawer } from '../components/device/DeviceToolsDrawer'
import { PairingSecurityCard } from '../components/pair/PairingSecurityCard'
import { AgentClient } from '../lib/api'
import { dateTime, duration, osLabel } from '../lib/format'
import { useAsync, useLive } from '../lib/hooks'
import { agentStart, agentStatus, DEFAULT_PORT } from '../lib/discovery'
import { isPhoneOS, useRuntime } from '../lib/runtime'
import type { SystemInfo } from '../lib/types'
import { useApp, type PairedDevice } from '../store/app'

/**
 * 「本机」页：展示并控制**当前这台机器**，不需要配对。
 *
 * 这里按运行环境分成两种形态：
 *   1. 桌面端 / 浏览器 —— 读 127.0.0.1 上本机被控端的系统、硬件、实时状态，
 *      被控端没起来还能一键启动它。
 *   2. 手机（'android' | 'ios'，含手机浏览器）—— 手机跑不了被控端，
 *      请求 127.0.0.1 必然失败，所以换成 PhoneSelfPanel 显示手机自身信息。
 *
 * 免令牌依据：Agent 对 loopback 请求放行（本机 = 已经掌握这台机器）。
 *
 * 版面与「设备详情页」刻意保持同一顺序与栅格（身份卡 → 管理工具 → 电源/音量/媒体
 * → 实时状态+硬件 → 开机统计 → 应用与进程），只多一块本机独有的「配对与管理」，
 * 这样用户在两个页面之间切换不需要重新建立空间记忆。
 */
export default function LocalDevice() {
  const runtime = useRuntime()
  // 手机分支提前返回：下面的 LocalAgentView 一个 hook 都不会执行。
  // 用 isPhoneOS 而不是只看 runtime：手机浏览器打开时 runtime 是 'web'，
  // 但那台手机同样跑不了被控端，硬套桌面视图只会显示一片「连不上」。
  if (runtime === 'android' || runtime === 'ios' || isPhoneOS()) return <PhoneSelfPanel />
  return <LocalAgentView />
}

/** 桌面端 / 桌面浏览器的「本机」页 */
function LocalAgentView() {
  const toast = useApp((s) => s.toast)
  const [port, setPort] = useState(DEFAULT_PORT)
  const [nonce, setNonce] = useState(0)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [countdown, setCountdown] = useState<{ label: string; until: number } | null>(null)
  const [agentUp, setAgentUp] = useState<boolean | null>(null)
  const [starting, setStarting] = useState(false)

  // 本机伪设备：固定 127.0.0.1、无令牌。形状与已配对设备一致，
  // 这样电源/媒体/文件/定时等组件都能原样复用，不必为本机再写一套。
  const device = useMemo<PairedDevice>(
    () =>
      ({
        id: '__local__',
        host: '127.0.0.1',
        port,
        tls: false,
        token: '',
        clientId: 'local',
        name: '本机',
        os: 'windows',
        arch: 'amd64',
        ver: '',
        addedAt: 0,
        local: true,
      }) as PairedDevice,
    [port],
  )

  const client = useMemo(
    () => new AgentClient({ host: '127.0.0.1', port, tls: false, local: true }, undefined),
    [port],
  )

  const live = useLive(device)
  const sys = useAsync<SystemInfo>(() => client.system(), [port, nonce])

  const refresh = () => {
    setNonce((n) => n + 1)
    sys.reload()
    void agentStatus(port).then(setAgentUp)
  }

  // 进页面先问一次原生层：这台机器上到底有没有被控端在跑
  useEffect(() => {
    let alive = true
    void agentStatus(port).then((v) => {
      if (alive) setAgentUp(v)
    })
    return () => {
      alive = false
    }
  }, [port])

  const startAgent = async () => {
    setStarting(true)
    const res = await agentStart(port)
    setStarting(false)
    if (!res.ok) {
      toast({ kind: 'error', title: '启动本机被控端失败', desc: res.error })
      return
    }
    toast({ kind: 'ok', title: '本机被控端已启动', desc: '正在读取本机信息…' })
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (await agentStatus(port)) break
    }
    setAgentUp(true)
    setNonce((n) => n + 1)
    sys.reload()
  }

  const offline = !live.connected && !live.status && Boolean(sys.error)

  return (
    <div className="space-y-3">
      {/* ① 身份卡：与详情页 DeviceBanner 同一套版式（头像 / 名称 / 徽章 / 信息网格） */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
          <DeviceAvatar os={sys.data?.platform ?? 'windows'} size={44} online={live.connected} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[16px] font-semibold text-fg">
                {sys.data?.name || sys.data?.hostname || '本机'}
              </h1>
              <Badge tone="cyan" dot>
                当前机器
              </Badge>
              <Badge tone={live.connected ? 'ok' : 'warn'} dot>
                {live.connected ? '实时' : offline ? '未运行被控端' : '重连中'}
              </Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
              <span className="num">127.0.0.1:{port}</span>
              <span className="text-faint">·</span>
              <span>无需配对</span>
              <span className="text-faint">·</span>
              <span>{osLabel(sys.data?.platform)}</span>
              <span className="text-faint">·</span>
              <span className="num">Agent {sys.data?.agentVersion ?? '—'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11.5px] text-faint">
              端口
              <input
                value={port}
                onChange={(e) => setPort(Number(e.target.value.replace(/\D/g, '')) || DEFAULT_PORT)}
                className="num h-9 w-16 rounded-lg border border-line bg-elevated px-2 text-center text-fg outline-none focus:border-accent/55"
                aria-label="本机被控端端口"
              />
            </label>
            <Button size="sm" variant="secondary" onClick={refresh} loading={sys.loading}>
              <RefreshCw size={14} className="mr-1" />
              刷新
            </Button>
          </div>
        </div>

        {/* 设备信息：与详情页一样默认展开 */}
        <div className="border-t border-line-soft px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
            <Info size={12} />
            设备信息
          </div>
          {sys.loading && !sys.data ? (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-6">
              <InfoCell label="主机名" value={sys.data?.hostname || '—'} />
              <InfoCell label="系统" value={sys.data?.os || '—'} />
              <InfoCell label="内核" value={sys.data?.kernel || '—'} mono />
              <InfoCell label="架构" value={sys.data?.arch || '—'} mono />
              <InfoCell label="时区" value={sys.data?.timezone || '—'} />
              <InfoCell
                label="已运行"
                value={sys.data ? duration(sys.data.uptimeSec, 'short') : '—'}
                hint={sys.data?.bootTime ? dateTime(sys.data.bootTime) : undefined}
              />
            </div>
          )}
        </div>
      </Card>

      {/* ② 离线诊断：只在连不上时出现，给可操作按钮而不是一句「连接失败」 */}
      {offline && (
        <Card>
          <div className="flex items-start gap-3">
            <Info size={16} className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <h3 className="text-[13.5px] font-semibold text-fg">
                {agentUp === false ? '这台电脑上还没有运行被控端' : '连不上本机被控端'}
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                「本机」页读的是当前这台电脑上的 LanDeck 被控端（127.0.0.1:{port}）。
                它没在运行，所以电源、音量、媒体、文件、定时这些能力都不可用。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {agentUp === false && (
                  <Button size="sm" variant="primary" loading={starting} onClick={() => void startAgent()}>
                    启动本机被控端
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={refresh}>
                  重新检测
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {countdown && (
        <CountdownBar
          label={countdown.label}
          until={countdown.until}
          onCancel={() => setCountdown(null)}
          onDone={() => setCountdown(null)}
        />
      )}

      {!offline && (
        <>
          {/* ③ 管理工具：与详情页完全同一个入口与抽屉（文件 + 定时） */}
          <button
            type="button"
            onClick={() => setToolsOpen(true)}
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

          {/* ④ 电源 / 音量 / 媒体：本机同样能控制（Agent 对 loopback 免令牌） */}
          <div className="grid gap-3 lg:grid-cols-3">
            <PowerCard
              client={client}
              system={sys.data}
              onScheduled={(label, seconds) =>
                setCountdown({ label, until: Date.now() + seconds * 1000 })
              }
            />
            <VolumeCard client={client} />
            <MediaCard client={client} media={live.media} />
          </div>

          {/* ⑤ 实时状态 + 硬件 + 开机统计 + 应用与进程：与详情页同一顺序与栅格 */}
          <div className="grid gap-3 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <LiveStats live={live} />
            </div>
            <div className="lg:col-span-5">
              <HardwarePanel client={client} />
            </div>
            <div className="lg:col-span-12">
              <UptimePanel client={client} />
            </div>
            <div className="lg:col-span-12">
              <ProcessPanel client={client} system={sys.data} />
            </div>
          </div>
        </>
      )}

      {/* ⑥ 本机独有：配对码与已授权客户端（设备详情页没有这块） */}
      {!offline && (
        <div className="space-y-2">
          <SectionTitle
            title="配对与管理"
            desc="让别的设备连上这台电脑"
            icon={<Laptop size={16} />}
          />
          <PairingSecurityCard device={device} />
        </div>
      )}

      {/* 抽屉：目标固定为本机 */}
      <DeviceToolsDrawer
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        device={device}
        client={client}
      />

      {!offline && (
        <p className="flex items-center justify-center gap-1.5 pb-1 text-[11px] text-faint">
          <Wifi size={11} />
          本机请求走 loopback，被控端对本机免令牌
        </p>
      )}
    </div>
  )
}

function InfoCell({
  label,
  value,
  hint,
  mono,
}: {
  label: string
  value: string
  hint?: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-faint">{label}</div>
      <div
        className={`truncate text-[12.5px] text-fg ${mono ? 'num' : ''}`}
        title={hint ? `${value}（${hint}）` : value}
      >
        {value}
      </div>
    </div>
  )
}
