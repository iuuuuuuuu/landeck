import { Radar as RadarIcon, RefreshCw, StopCircle } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PairDialog } from '../components/pair/PairDialog'
import { ManualAddCard } from '../components/scan/ManualAddCard'
import { Radar, type RadarNode } from '../components/scan/Radar'
import { ScanHints } from '../components/scan/ScanHints'
import { ScanResultCard } from '../components/scan/ScanResultCard'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  SectionTitle,
  Skeleton,
  Stat,
} from '../components/ui'
import { nativeLocalIP, resolveHint, scanLan, scanProfile } from '../lib/discovery'
import type { NodeInfo } from '../lib/types'
import { useApp } from '../store/app'

type ScanStatus = 'idle' | 'scanning' | 'done'

/**
 * 提交节奏：扫到的设备与进度先攒在 ref 里，每 200ms 才提交一次。
 * 之前是「每台设备一次 setState + 每 100ms 一次耗时 setState」，
 * 一页里几十次重渲染（雷达还在跑 framer-motion），切页时直接卡住。
 */
// 手机上每 200ms 重渲染整页很浪费；400ms 肉眼一样顺滑，主线程压力减半
const FLUSH_MS = 400

/** 雷达只吃 id 和配对状态，单独 memo：耗时/进度跳动时不必重画 SVG */
const RadarPane = memo(function RadarPane({
  nodes,
  scanning,
}: {
  nodes: RadarNode[]
  scanning: boolean
}) {
  return <Radar nodes={nodes} scanning={scanning} className="w-[228px] shrink-0 sm:w-[268px]" />
})

/** 结果列表同样单独 memo：只有节点集合变化才重建 */
const ResultList = memo(function ResultList({
  nodes,
  isPaired,
  onPair,
  onEnter,
}: {
  nodes: NodeInfo[]
  /** 判定函数由外层统一提供，保证雷达与列表用的是同一套「是否已配对」规则 */
  isPaired: (node: NodeInfo) => boolean
  onPair: (node: NodeInfo) => void
  onEnter: (node: NodeInfo) => void
}) {
  return (
    <>
      {nodes.map((node) => (
        <ScanResultCard
          key={node.id}
          node={node}
          paired={isPaired(node) || !!node.self}
          onPair={() => onPair(node)}
          onEnter={() => onEnter(node)}
        />
      ))}
    </>
  )
})

const RECENT_SCAN_MS = 60_000

type ScanCache = { at: number; nodes: NodeInfo[]; done: number; total: number; elapsedMs: number }
let recentScan: ScanCache | null = null

function readRecentScan(): ScanCache | null {
  if (!recentScan) return null
  if (Date.now() - recentScan.at > RECENT_SCAN_MS) return null
  return recentScan
}

function writeRecentScan(v: Omit<ScanCache, 'at'>) {
  recentScan = { ...v, at: Date.now() }
}

/** 发现页：进页面即自动扫段，雷达 + 进度为主角，下面给结果与手动兜底 */
export default function Scan() {
  const devices = useApp((s) => s.devices)
  const setActive = useApp((s) => s.setActive)
  const addDevice = useApp((s) => s.addDevice)
  const toast = useApp((s) => s.toast)
  const navigate = useNavigate()

  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [manual, setManual] = useState<NodeInfo[]>([])
  const [pairTarget, setPairTarget] = useState<NodeInfo | null>(null)
  const [status, setStatus] = useState<ScanStatus>('idle')
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [hintHost, setHintHost] = useState<string | null>(() => resolveHint() ?? null)

  // 界面上要显示真实的扫描参数与目标网段（排查「扫不到」时最关键的信息）
  const profile = scanProfile(hintHost)

  // —— 扫描的生命周期由页面自己攥住 ——
  // 之前这套状态放在 useLanScan 里，页面卸载时手上没有能 abort 的把手：
  // 切到别的页面后浏览器还挂着上千个 /hello 探测，切页动画自然卡死。
  const abortRef = useRef<AbortController | null>(null)
  const tickerRef = useRef<number | null>(null)
  const queueRef = useRef<NodeInfo[]>([]) // 已扫到、还没提交进列表的设备
  const progressRef = useRef({ done: 0, total: 0 })
  const seenRef = useRef<Set<string>>(new Set())
  const startedAtRef = useRef(0)
  const fromCacheRef = useRef(false)
  const nodesRef = useRef<NodeInfo[]>([])
  const aliveRef = useRef(true) // 卸载后一律不再 setState

  const stopTicker = useCallback(() => {
    if (tickerRef.current !== null) {
      window.clearInterval(tickerRef.current)
      tickerRef.current = null
    }
  }, [])

  /** 把攒下的设备一次性追加进列表，进度也一起提交（React 会合成一次渲染） */
  const flush = useCallback(() => {
    const queued = queueRef.current
    if (queued.length > 0) {
      queueRef.current = []
      nodesRef.current = [...nodesRef.current, ...queued]
      setNodes(nodesRef.current)
    }
    const p = progressRef.current
    setDone(p.done)
    setTotal(p.total)
  }, [])

  const start = useCallback(() => {
    if (!aliveRef.current) return
    // 重扫前把上一轮彻底收掉：abort → 清定时器 → 清缓冲
    abortRef.current?.abort()
    stopTicker()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    queueRef.current = []
    seenRef.current = new Set()
    progressRef.current = { done: 0, total: 0 }
    startedAtRef.current = performance.now()

    nodesRef.current = []
    setNodes([])
    setDone(0)
    setTotal(0)
    setElapsedMs(0)
    setError(null)
    setStatus('scanning')

    fromCacheRef.current = false

    // 全页唯一的定时器：每 FLUSH_MS 提交一次缓冲，顺带刷新耗时
    tickerRef.current = window.setInterval(() => {
      if (!aliveRef.current) return
      flush()
      setElapsedMs(performance.now() - startedAtRef.current)
    }, FLUSH_MS)

    // 先问原生层要本机地址（Tauri 安卓上页面 hostname 是 tauri.localhost，推不出网段）
    void nativeLocalIP().then((ip) => {
      if (aliveRef.current && !ctrl.signal.aborted) setHintHost(resolveHint(ip) ?? null)
    })

    void scanLan({
      onNode: (node) => {
        if (!aliveRef.current || ctrl.signal.aborted) return
        if (seenRef.current.has(node.id)) return
        seenRef.current.add(node.id)
        queueRef.current.push(node) // 只入队，等下一次 flush 一起提交
      },
      onProgress: (d, t) => {
        progressRef.current = { done: d, total: t }
      },
      signal: ctrl.signal,
    })
      .catch(() => {
        if (aliveRef.current && !ctrl.signal.aborted) setError('扫描过程中出现异常，请重试')
      })
      .finally(() => {
        if (!aliveRef.current) return
        flush()
        stopTicker()
        const elapsed = performance.now() - startedAtRef.current
        setElapsedMs(elapsed)
        if (!ctrl.signal.aborted) {
          setStatus('done')
          // 记下这一轮结果：60 秒内再进页面直接复用，避免每次切页都整轮重扫
          writeRecentScan({
            nodes: nodesRef.current,
            done: progressRef.current.done,
            total: progressRef.current.total,
            elapsedMs: elapsed,
          })
        }
      })
  }, [flush, stopTicker])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    stopTicker()
    flush()
    setElapsedMs(performance.now() - startedAtRef.current)
    setStatus('done')
  }, [flush, stopTicker])

  /**
   * 进页面自动扫描，但**短时间内重复进入不重扫**。
   *
   * 原来的行为是每次 mount 都整轮重扫。手机上一轮扫描要发几百个请求 +
   * 每 200ms 一次 setState，用户从「发现」切到别的页面时，这轮还没跑完的工作
   * 会和页面切换抢主线程，表现为"切页面特别卡"。现在 60 秒内的结果直接复用，
   * 想刷新有显式的「重新扫描」按钮。
   */
  useEffect(() => {
    aliveRef.current = true
    const cached = readRecentScan()
    if (cached) {
      fromCacheRef.current = true
      nodesRef.current = cached.nodes
      setNodes(cached.nodes)
      setDone(cached.done)
      setTotal(cached.total)
      setElapsedMs(cached.elapsedMs)
      setStatus('done')
      return () => {
        aliveRef.current = false
        abortRef.current?.abort()
        stopTicker()
        queueRef.current = []
      }
    }
    fromCacheRef.current = false
    start()
    // 离开页面：中止扫描 + 清掉那个唯一的定时器 + 丢掉未提交的缓冲，不留任何后台循环
    return () => {
      aliveRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
      if (tickerRef.current !== null) {
        window.clearInterval(tickerRef.current)
        tickerRef.current = null
      }
      queueRef.current = []
    }
  }, [start])

  const all = useMemo(() => {
    const map = new Map<string, NodeInfo>()
    for (const n of nodes) map.set(n.id, n)
    for (const n of manual) map.set(n.id, n)
    return [...map.values()]
  }, [nodes, manual])

  // 配对判定不能只看 id。
  // 实测踩过：agent 的 deviceId 会随数据目录重建而变（config.json 丢了就 GenerateID），
  // 而 store 里存的是配对那一刻的旧 id —— 于是同一台机器扫描出来仍显示「未配对」，
  // 用户看到的是一台已经配对的机器被当成新设备，还能再配一次。
  // host:port 是稳定标识（agent 换 id 也不会换地址），所以两个条件取或。
  const pairedKeys = useMemo(() => {
    const ids = new Set<string>()
    const addrs = new Set<string>()
    for (const d of devices) {
      ids.add(d.id)
      addrs.add(`${d.host}:${d.port}`)
    }
    return { ids, addrs }
  }, [devices])

  const isPaired = useCallback(
    (n: NodeInfo) => {
      if (pairedKeys.ids.has(n.id)) return true
      // 只按地址匹配时要求主机名非空，避免把「都叫 127.0.0.1」的不同机器误判成同一台
      const host = n.ip || ''
      return !!host && pairedKeys.addrs.has(`${host}:${n.port}`)
    },
    [pairedKeys],
  )

  /**
   * 按同一套规则反查 store 里的那条已配对记录。
   *
   * 用途：点扫描结果进详情页时，必须跳 store 记录的 id，而不是扫描到的 node.id。
   * agent 的 deviceId 会变（config.json 丢了就重新生成），两者可能不一致；
   * 直接用 node.id 跳转会让 DeviceDetail 找不到设备，显示「设备不存在或已被移除」。
   */
  const pairedDeviceFor = useCallback(
    (n: NodeInfo) => {
      const byId = devices.find((d) => d.id === n.id)
      if (byId) return byId
      const host = n.ip || ''
      if (!host) return undefined
      return devices.find((d) => `${d.host}:${d.port}` === `${host}:${n.port}`)
    },
    [devices],
  )

  const radarNodes = useMemo(
    () => all.map((n) => ({ id: n.id, paired: isPaired(n) })),
    [all, isPaired],
  )

  const onPair = useCallback((node: NodeInfo) => setPairTarget(node), [])

  const onEnter = useCallback(
    (node: NodeInfo) => {
      // 本机自己：不需要配对，直接落进 store 并进入详情
      if (node.self && !isPaired(node)) {
        addDevice({
          id: node.id,
          host: node.ip || location.hostname,
          port: node.port,
          tls: node.tls,
          token: '',
          clientId: 'self',
          name: node.name,
          os: node.os,
          arch: node.arch,
          ver: node.ver,
          local: true,
        })
        toast({
          kind: 'ok',
          title: '已添加本机',
          desc: '这台就是当前设备，无需配对即可管理',
        })
      }

      // 关键：跳详情页必须用【store 里那条记录的真实 id】，不能用扫描到的 node.id。
      //
      // 实测踩过：agent 的 deviceId 会变（config.json 丢了就重新生成），
      // store 里存的是配对那一刻的旧 id。扫描拿到的是新 id，
      // 直接 navigate 到新 id → DeviceDetail 的 devices.find() 找不到 →
      // 显示「设备不存在或已被移除」，而设备列表里明明有这台机器。
      // 现在按同一个 isPaired 规则反查 store 记录，用它的 id 跳转。
      const known = pairedDeviceFor(node)
      const targetId = known?.id ?? node.id
      setActive(targetId)
      navigate(`/devices/${targetId}`)
    },
    [addDevice, navigate, isPaired, pairedDeviceFor, setActive, toast],
  )

  const scanning = status === 'scanning'
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const seconds = (elapsedMs / 1000).toFixed(1)

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <RadarPane nodes={radarNodes} scanning={scanning} />

          <div className="w-full min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <Stat label="发现设备" value={all.length} unit="台" tone="accent" />
              <Stat
                label="已扫端口"
                value={total > 0 ? done : '—'}
                unit={total > 0 ? `/ ${total}` : undefined}
              />
              <Stat label="耗时" value={seconds} unit="s" />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                <span className={scanning ? 'text-accent-soft' : 'text-muted'}>
                  {scanning
                    ? total > 0
                      ? '正在扫描局域网…'
                      : '正在用系统接口探测…'
                    : status === 'done'
                      ? '扫描完成'
                      : '准备扫描'}
                </span>
                {/* 原生扫描阶段没有"端口总数"这个概念，硬显示 0% 会让人以为卡死，
                    改成滚动的不定态条纹，从第一秒就有反馈 */}
                <span className="num text-muted">{total > 0 ? `${pct}%` : scanning ? '•••' : '—'}</span>
              </div>
              {total > 0 ? (
                <ProgressBar value={pct} tone={scanning ? 'accent' : 'ok'} />
              ) : scanning ? (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div className="animate-indeterminate h-full w-1/3 rounded-full bg-accent" />
                </div>
              ) : (
                <ProgressBar value={0} tone="ok" />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11.5px] leading-relaxed text-faint">
              <span>
                TCP {profile.ports.join(' / ')} · 并发 {profile.concurrency} · 单地址{' '}
                {profile.mobile ? '0.45s' : '0.6s'}
                {profile.subnet ? ` · 网段 ${profile.subnet}` : ' · 未识别到本机网段'}
              </span>
              <span className="text-faint">·</span>
              <span>扫到设备后右侧可直接配对</span>
            </div>

            {error && <p className="text-[12px] text-danger">{error}</p>}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-2">
          <SectionTitle
            title="发现结果"
            desc="同网段内回 /hello 的 Agent 会实时出现在这里。"
            action={
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={all.length > 0 ? 'accent' : 'neutral'} dot>
                  {all.length} 台
                </Badge>
                {scanning ? (
                  <Button
                    size="md"
                    variant="secondary"
                    icon={<StopCircle size={15} />}
                    onClick={stop}
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    size="md"
                    variant="primary"
                    icon={<RefreshCw size={15} />}
                    onClick={start}
                  >
                    {status === 'idle' ? '开始扫描' : '重新扫描'}
                  </Button>
                )}
              </div>
            }
            className="px-1"
          />

          {scanning &&
            all.length === 0 &&
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] w-full" />)}

          <ResultList nodes={all} isPaired={isPaired} onPair={onPair} onEnter={onEnter} />

          {status === 'done' && all.length === 0 && (
            <Card>
              <EmptyState
                icon={<RadarIcon size={26} />}
                title="没有扫到设备"
                desc="确认被控机已启动 Agent、与控制端在同一 Wi-Fi，并放行了 8420/8421；也可以直接手动填 IP。"
              />
            </Card>
          )}
        </section>

        <aside className="min-w-0 space-y-3">
          <ManualAddCard
            onFound={(node) => {
              setManual((prev) => [node, ...prev.filter((n) => n.id !== node.id)])
              setPairTarget(node)
            }}
          />
          <ScanHints noHint={!hintHost} />
        </aside>
      </div>

      <PairDialog open={!!pairTarget} node={pairTarget} onClose={() => setPairTarget(null)} />
    </div>
  )
}
