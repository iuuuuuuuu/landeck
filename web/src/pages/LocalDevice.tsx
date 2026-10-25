import { useEffect, useMemo, useState } from 'react'
import { Cpu, HardDrive, Info, MonitorSmartphone, RefreshCw, Wifi } from 'lucide-react'
import { Badge, Button, Card, DeviceAvatar, Gauge, SectionTitle, Skeleton, Stat } from '../components/ui'
import { HardwarePanel } from '../components/device/HardwarePanel'
import { LocalPairingCard } from '../components/device/LocalPairingCard'
import { UptimePanel } from '../components/device/UptimePanel'
import { AgentClient, ApiError } from '../lib/api'
import { bytes, dateTime, duration, osLabel } from '../lib/format'
import { useAsync, useLive } from '../lib/hooks'
import { agentStart, agentStatus } from '../lib/discovery'
import { DEFAULT_PORT } from '../lib/discovery'
import type { SystemInfo } from '../lib/types'
import { useApp } from '../store/app'

/**
 * 「本机」页：展示**当前这台机器**的信息，不需要配对。
 *
 * 为什么单独做一页：控制端和被控 Agent 可能跑在同一台机器上，
 * 这时「扫描局域网」不该把自己列成待配对设备（用户会被自己搞糊涂），
 * 但用户又确实想看看这台机器的情况 —— 所以给它一个独立入口。
 *
 * 免令牌依据：Agent 对 loopback 请求放行（本机 = 已经掌握这台机器）。
 */
export default function LocalDevice() {
  const toast = useApp((s) => s.toast)
  const [port, setPort] = useState(DEFAULT_PORT)
  const [nonce, setNonce] = useState(0)

  // 本机设备：固定 127.0.0.1，无令牌
  const device = useMemo(
    () => ({
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
    }),
    [port],
  )

  const client = useMemo(
    () => new AgentClient({ host: '127.0.0.1', port, tls: false, local: true }, undefined),
    [port],
  )

  const live = useLive(device)
  const system = useAsync<SystemInfo>(() => client.system(), [port, nonce])
  const hardware = useAsync(() => client.hardware(), [port, nonce])
  const [starting, setStarting] = useState(false)
  // 本机有没有被控端：桌面端可以直接问原生层，浏览器只能靠请求成败推断
  const [agentUp, setAgentUp] = useState<boolean | null>(null)

  // 探测可用端口：默认 8420，若不通则说明 Agent 不在或端口改过
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await client.system()
      } catch (e) {
        if (!alive) return
        if (e instanceof ApiError && e.status === 401) {
          // 401 说明端口上有 Agent，但本机放行被关了
          toast({ kind: 'info', title: '本机访问需要令牌', desc: '被控端关闭了「本机免令牌」' })
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [client, toast])

  const status = live.status
  const disks = status?.disks ?? []
  const offline = !live.connected && !status && Boolean(system.error)

  const refresh = () => {
    setNonce((n) => n + 1)
    system.reload()
    hardware.reload()
    void agentStatus(port).then(setAgentUp)
  }

  // 一进来就问一次原生层；请求也顺便跑一次，浏览器下没有 agent_status 也能工作
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
    // 等它起来再拉数据
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (await agentStatus(port)) break
    }
    setAgentUp(true)
    setNonce((n) => n + 1)
    system.reload()
    hardware.reload()
  }

  return (
    <div className="space-y-3">
      {/* 顶部身份条 */}
      <Card className="flex flex-wrap items-center gap-3">
        <DeviceAvatar os={system.data?.platform ?? 'windows'} size={48} online={live.connected} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-fg">
              {system.data?.name || system.data?.hostname || '本机'}
            </h2>
            <Badge tone="cyan" dot>
              当前机器
            </Badge>
            {live.connected ? (
              <Badge tone="ok" dot>
                实时
              </Badge>
            ) : (
              <Badge tone="warn" dot>
                未连接
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[12px] text-muted">
            运行 LanDeck Agent 的这台电脑 · 无需配对 · {osLabel(system.data?.platform)} ·{' '}
            <span className="num">Agent {system.data?.agentVersion ?? '—'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11.5px] text-faint">
            端口
            <input
              value={port}
              onChange={(e) => setPort(Number(e.target.value.replace(/\D/g, '')) || DEFAULT_PORT)}
              className="num h-9 w-16 rounded-lg border border-line bg-elevated px-2 text-center text-fg outline-none focus:border-accent/55"
              aria-label="本机 Agent 端口"
            />
          </label>
          <Button size="sm" variant="secondary" onClick={refresh} loading={system.loading || hardware.loading}>
            <RefreshCw size={14} className="mr-1" />
            刷新
          </Button>
        </div>
      </Card>

      {offline && (
        <Card>
          <div className="flex items-start gap-3">
            <Info size={16} className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <h3 className="text-[13.5px] font-semibold text-fg">
                {agentUp === false ? '这台电脑上还没有运行被控端' : '连不上本机被控端'}
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                「本机」页读的是<strong className="text-fg-soft">当前这台电脑</strong>上的 LanDeck
                被控端（127.0.0.1:{port}）。它没在运行，所以系统、硬件、实时状态都读不到。
                {agentUp !== false && ' 如果你刚改过端口，改回上面的端口号再试。'}
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
              <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                客户端安装包里自带被控端；也可以单独运行 landeck-agent.exe（对外提供被控服务的那一端）。
                要控制<strong>别的</strong>电脑，请去「发现」页扫描它。
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* 系统概览 */}
      <Card>
        <SectionTitle title="系统" desc="这台机器的身份与运行状态" icon={<MonitorSmartphone size={16} />} />
        {system.loading && !system.data ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="主机名" value={<span className="text-[13px]">{system.data?.hostname || '—'}</span>} />
            <Stat label="系统" value={<span className="text-[13px]">{system.data?.os || '—'}</span>} />
            <Stat label="内核" value={<span className="num text-[12px]">{system.data?.kernel || '—'}</span>} />
            <Stat label="架构" value={<span className="num text-[13px]">{system.data?.arch || '—'}</span>} />
            <Stat label="时区" value={<span className="text-[13px]">{system.data?.timezone || '—'}</span>} />
            <Stat
              label="已运行"
              value={duration(system.data?.uptimeSec ?? 0, 'short')}
              hint={system.data?.bootTime ? `启动于 ${dateTime(system.data.bootTime)}` : undefined}
              tone="accent"
            />
          </div>
        )}
      </Card>

      {/* 实时资源 */}
      <div className="grid gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <SectionTitle title="实时资源" desc="每 2 秒推送" icon={<Cpu size={16} />} />
          {status ? (
            <>
              <div className="mt-3 flex items-center justify-around">
                <Gauge value={status.cpu.percent} size={124} label="CPU" />
                <Gauge value={status.mem.percent} size={124} label="内存" tone="cyan" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-xl border border-line-soft bg-elevated px-3 py-2">
                  <div className="text-[11px] text-faint">内存</div>
                  <div className="num mt-0.5 text-fg">
                    {bytes(status.mem.used)} / {bytes(status.mem.total)}
                  </div>
                </div>
                <div className="rounded-xl border border-line-soft bg-elevated px-3 py-2">
                  <div className="text-[11px] text-faint">网络</div>
                  <div className="num mt-0.5 text-fg">
                    ↓{bytes(status.net.rxBps)}/s ↑{bytes(status.net.txBps)}/s
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-faint">
                <Wifi size={12} />
                <span className="num">{status.net.ip || '—'}</span>
                <span>·</span>
                <span>{status.net.iface || '—'}</span>
              </div>
            </>
          ) : (
            <div className="mt-3 grid place-items-center py-10 text-[12px] text-faint">等待数据…</div>
          )}
        </Card>

        <Card className="lg:col-span-7">
          <SectionTitle title="磁盘" desc="各分区占用" icon={<HardDrive size={16} />} />
          <div className="mt-3 space-y-3">
            {disks.length === 0 && <p className="text-[12px] text-faint">未读到磁盘信息</p>}
            {disks.map((d) => (
              <div key={d.mount}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate text-fg-soft">
                    {d.mount} <span className="text-faint">{d.fs}</span>
                  </span>
                  <span className="num shrink-0 text-muted">
                    {d.used.toFixed(0)} / {d.total.toFixed(0)} GB · {d.percent.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-track">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(1, Math.min(100, d.percent))}%`,
                      background:
                        d.percent >= 90
                          ? 'linear-gradient(90deg,#fb7185,#e11d48)'
                          : d.percent >= 70
                            ? 'linear-gradient(90deg,#fbbf24,#fb7185)'
                            : 'linear-gradient(90deg,#7c5cff,#22d3ee)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 硬件与开机历史：连不上就不渲染，避免出现两处「设备离线」的噪声 */}
      {!offline && (
        <>
          <HardwarePanel client={client} />
          <LocalPairingCard client={client} />
          <UptimePanel client={client} />
        </>
      )}
    </div>
  )
}
