import { MapPin, Radar, Search, Square } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { DEFAULT_PORT, expandHostSpec, probeRange, probeTarget, resolveHint } from '../../lib/discovery'
import { osLabel } from '../../lib/format'
import type { NodeInfo } from '../../lib/types'
import { useApp } from '../../store/app'
import { Badge, Button, Card, Field, Input, ProgressBar, SectionTitle } from '../ui'

/** 解析 `192.168.1.20` / `192.168.1.20:8420` / `http://host:port/` */
export function parseAddress(raw: string): { host: string; port: number; explicit: boolean } | null {
  let v = raw.trim()
  if (!v) return null
  v = v.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '')
  const m = /^([a-zA-Z0-9._-]+)(?::(\d{1,5}))?$/.exec(v)
  if (!m) return null
  const port = m[2] ? Number(m[2]) : DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: m[1], port, explicit: Boolean(m[2]) }
}

/**
 * 手动添加：支持三种写法，避免「只能一个个填」。
 *
 *   · 单台机器：`192.168.1.115`（端口用下面的输入框，默认 8420）
 *   · 整个网段：`192.168.1` 或 `192.168.1.`（等价于扫 192.168.1.1–254）
 *   · 自定义区间：`192.168.1.1-80`
 *
 * 为什么要有网段模式：用户的网络是「有线 PC + 手机同时连 2.4G/5G 双频」，
 * 自动扫描在某些网络下拿不到结果时，手动指定网段 + 端口是最可靠的兜底 ——
 * 只要 IP 段和端口对，就一定能扫到，不依赖广播/组播。
 */
export function ManualAddCard({ onFound }: { onFound: (node: NodeInfo) => void }) {
  const toast = useApp((s) => s.toast)
  const [addr, setAddr] = useState('')
  const [portText, setPortText] = useState(String(DEFAULT_PORT))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [hits, setHits] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  // 当前设备所在网段，一键填入（用户不用自己记 IP 段）
  const localSubnet = useMemo(() => {
    const hint = resolveHint()
    if (!hint) return null
    const p = hint.split('.')
    return p.length >= 3 ? `${p[0]}.${p[1]}.${p[2]}` : null
  }, [])

  const port = (() => {
    const n = Number(portText)
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_PORT
  })()

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setProg(null)
  }

  const submit = async () => {
    if (busy) return
    const raw = addr.trim()
    if (!raw) {
      setError('请输入地址，例如 192.168.1.115、192.168.1 或 192.168.1.1-80')
      return
    }
    setError(null)
    setBusy(true)
    setProg(null)
    setHits(0)

    // ① 网段 / 区间：批量探测
    const spec = expandHostSpec(raw)
    if (spec) {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const found = await probeRange(spec.hosts, port, {
          signal: ctrl.signal,
          onNode: (n) => {
            setHits((h) => h + 1)
            onFound(n)
          },
          onProgress: (done, total) => setProg({ done, total }),
        })
        if (ctrl.signal.aborted) return
        if (found.length === 0) {
          const top = (found as unknown as { topError?: { message: string; count: number } }).topError
          // 把真实失败原因带出来：只显示「没找到」会让用户和排查者都无从下手
          setError(
            top
              ? `${spec.subnet} 端口 ${port}：${spec.hosts.length} 个地址全部失败（最常见：${top.message}，${top.count} 次）`
              : `${spec.subnet} 的 ${spec.hosts.length} 个地址、端口 ${port} 上都没有找到 Agent`,
          )
        } else {
          toast({ kind: 'ok', title: `发现 ${found.length} 台设备`, desc: `${spec.subnet} · 端口 ${port}` })
          setAddr('')
        }
      } finally {
        abortRef.current = null
        setBusy(false)
        setProg(null)
      }
      return
    }

    // ② 单台主机
    const parsed = parseAddress(raw)
    if (!parsed) {
      setError('格式不对：请输入 192.168.1.115、192.168.1:8420、192.168.1 或 192.168.1.1-80')
      setBusy(false)
      return
    }
    const targetPort = parsed.explicit ? parsed.port : port
    try {
      let node = await probeTarget(parsed.host, targetPort, false)
      if (!node && !parsed.explicit) node = await probeTarget(parsed.host, 8443, true)
      if (!node) {
        setError(`在 ${parsed.host}:${targetPort} 上没有找到 LanDeck Agent`)
        return
      }
      const host = node.ip || parsed.host
      const p = node.port || targetPort
      onFound({ ...node, ip: host, port: p })
      toast({ kind: 'ok', title: `已添加 ${node.name}`, desc: `${host}:${p} · ${osLabel(node.os)}` })
      setAddr('')
    } finally {
      setBusy(false)
    }
  }

  const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0

  return (
    <Card>
      <SectionTitle
        icon={<MapPin size={16} />}
        title="手动添加"
        desc="填单台机器，或直接填网段批量扫描"
        action={hits > 0 ? <Badge tone="ok" dot>{`已找到 ${hits} 台`}</Badge> : undefined}
      />

      <form
        className="mt-4 space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field
          label="地址或网段"
          hint="单个：192.168.1.115 · 整段：192.168.1 · 区间：192.168.1.1-80"
          error={error}
        >
          <Input
            value={addr}
            onChange={(e) => {
              setAddr(e.target.value)
              if (error) setError(null)
            }}
            placeholder="192.168.1.115 或 192.168.1"
            mono
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-label="设备地址或网段"
          />
        </Field>

        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
          <div className="flex flex-wrap gap-1.5">
            {localSubnet && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setAddr(localSubnet)}
                title={`填入本机所在网段 ${localSubnet}.0/24`}
              >
                本机网段 {localSubnet}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAddr('192.168.1')}
              title="填入常用网段示例"
            >
              192.168.1
            </Button>
          </div>
          <Field label="端口">
            <Input
              value={portText}
              onChange={(e) => setPortText(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="8420"
              mono
              inputMode="numeric"
              aria-label="端口"
            />
          </Field>
        </div>

        {busy && prog ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11.5px] text-muted">
              <span className="num">
                已探测 {prog.done} / {prog.total}
              </span>
              <span className="num">{pct}%</span>
            </div>
            <ProgressBar value={pct} tone="accent" />
            <Button type="button" size="sm" variant="ghost" fullWidth onClick={stop} icon={<Square size={13} />}>
              停止
            </Button>
          </div>
        ) : (
          <Button
            type="submit"
            variant="secondary"
            size="md"
            fullWidth
            loading={busy}
            icon={expandHostSpec(addr) ? <Radar size={15} /> : <Search size={15} />}
          >
            {expandHostSpec(addr) ? '扫描这个网段' : '探测并添加'}
          </Button>
        )}
      </form>
    </Card>
  )
}
