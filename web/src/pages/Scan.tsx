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
import { nativeLocalIP, resolveHint, scanLan } from '../lib/discovery'
import type { NodeInfo } from '../lib/types'
import { useApp } from '../store/app'

type ScanStatus = 'idle' | 'scanning' | 'done'

/**
 * 提交节奏：扫到的设备与进度先攒在 ref 里，每 200ms 才提交一次。
 * 之前是「每台设备一次 setState + 每 100ms 一次耗时 setState」，
 * 一页里几十次重渲染（雷达还在跑 framer-motion），切页时直接卡住。
 */
const FLUSH_MS = 200

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
  pairedIds,
  onPair,
  onEnter,
}: {
  nodes: NodeInfo[]
  pairedIds: Set<string>
  onPair: (node: NodeInfo) => void
  onEnter: (node: NodeInfo) => void
}) {
  return (
    <>
      {nodes.map((node) => (
        <ScanResultCard
          key={node.id}
          node={node}
          paired={pairedIds.has(node.id) || !!node.self}
          onPair={() => onPair(node)}
          onEnter={() => onEnter(node)}
        />
      ))}
    </>
  )
})

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
  const [hasHint, setHasHint] = useState(() => !!resolveHint())

  // —— 扫描的生命周期由页面自己攥住 ——
  // 之前这套状态放在 useLanScan 里，页面卸载时手上没有能 abort 的把手：
  // 切到别的页面后浏览器还挂着上千个 /hello 探测，切页动画自然卡死。
  const abortRef = useRef<AbortController | null>(null)
  const tickerRef = useRef<number | null>(null)
  const queueRef = useRef<NodeInfo[]>([]) // 已扫到、还没提交进列表的设备
  const progressRef = useRef({ done: 0, total: 0 })
  const seenRef = useRef<Set<string>>(new Set())
  const startedAtRef = useRef(0)
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
      setNodes((prev) => [...prev, ...queued])
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

    setNodes([])
    setDone(0)
    setTotal(0)
    setElapsedMs(0)
    setError(null)
    setStatus('scanning')

    // 全页唯一的定时器：每 FLUSH_MS 提交一次缓冲，顺带刷新耗时
    tickerRef.current = window.setInterval(() => {
      if (!aliveRef.current) return
      flush()
      setElapsedMs(performance.now() - startedAtRef.current)
    }, FLUSH_MS)

    // 先问原生层要本机地址（Tauri 安卓上页面 hostname 是 tauri.localhost，推不出网段）
    void nativeLocalIP().then((ip) => {
      if (aliveRef.current && !ctrl.signal.aborted) setHasHint(!!resolveHint(ip))
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
        setElapsedMs(performance.now() - startedAtRef.current)
        if (!ctrl.signal.aborted) setStatus('done')
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

  useEffect(() => {
    aliveRef.current = true
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

  const pairedIds = useMemo(() => new Set(devices.map((d) => d.id)), [devices])
  const radarNodes = useMemo(
    () => all.map((n) => ({ id: n.id, paired: pairedIds.has(n.id) })),
    [all, pairedIds],
  )

  const onPair = useCallback((node: NodeInfo) => setPairTarget(node), [])

  const onEnter = useCallback(
    (node: NodeInfo) => {
      // 本机自己：不需要配对，直接落进 store 并进入详情
      if (node.self && !pairedIds.has(node.id)) {
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
      setActive(node.id)
      navigate(`/devices/${node.id}`)
    },
    [addDevice, navigate, pairedIds, setActive, toast],
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
                  {scanning ? '正在扫描局域网…' : status === 'done' ? '扫描完成' : '准备扫描'}
                </span>
                <span className="num text-muted">{pct}%</span>
              </div>
              <ProgressBar value={pct} tone={scanning ? 'accent' : 'ok'} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11.5px] leading-relaxed text-faint">
              <span>TCP 8420 / 8443 · 并发 64 · 单地址 0.6s</span>
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

          <ResultList nodes={all} pairedIds={pairedIds} onPair={onPair} onEnter={onEnter} />

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
          <ScanHints noHint={!hasHint} />
        </aside>
      </div>

      <PairDialog open={!!pairTarget} node={pairTarget} onClose={() => setPairTarget(null)} />
    </div>
  )
}
