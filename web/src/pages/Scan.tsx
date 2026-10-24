import { Radar as RadarIcon, RefreshCw, StopCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PairDialog } from '../components/pair/PairDialog'
import { ManualAddCard } from '../components/scan/ManualAddCard'
import { Radar } from '../components/scan/Radar'
import { ScanHints } from '../components/scan/ScanHints'
import { ScanResultCard } from '../components/scan/ScanResultCard'
import { useLanScan } from '../components/scan/useLanScan'
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
import type { NodeInfo } from '../lib/types'
import { useApp } from '../store/app'

/** 发现页：进页面即自动扫段，雷达 + 进度为主角，下面给结果与手动兜底 */
export default function Scan() {
  const { nodes, status, done, total, elapsedMs, error, hasHint, start, stop } = useLanScan()
  const devices = useApp((s) => s.devices)
  const setActive = useApp((s) => s.setActive)
  const addDevice = useApp((s) => s.addDevice)
  const toast = useApp((s) => s.toast)
  const navigate = useNavigate()
  const [manual, setManual] = useState<NodeInfo[]>([])
  const [pairTarget, setPairTarget] = useState<NodeInfo | null>(null)

  useEffect(() => {
    start()
  }, [start])

  const all = useMemo(() => {
    const map = new Map<string, NodeInfo>()
    for (const n of nodes) map.set(n.id, n)
    for (const n of manual) map.set(n.id, n)
    return [...map.values()]
  }, [nodes, manual])

  const pairedIds = useMemo(() => new Set(devices.map((d) => d.id)), [devices])
  const scanning = status === 'scanning'
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const seconds = (elapsedMs / 1000).toFixed(1)

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <Radar
            nodes={all.map((n) => ({ id: n.id, paired: pairedIds.has(n.id) }))}
            scanning={scanning}
            className="w-[228px] shrink-0 sm:w-[268px]"
          />

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

          {all.map((node) => (
            <ScanResultCard
              key={node.id}
              node={node}
              paired={pairedIds.has(node.id) || !!node.self}
              onPair={() => setPairTarget(node)}
              onEnter={() => {
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
              }}
            />
          ))}

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
