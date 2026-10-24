import { MapPin, Search } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_PORT, probeTarget } from '../../lib/discovery'
import { osLabel } from '../../lib/format'
import type { NodeInfo } from '../../lib/types'
import { useApp } from '../../store/app'
import { Button, Card, Field, Input, SectionTitle } from '../ui'

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

/** 手动添加：知道 IP 就不用等扫段 */
export function ManualAddCard({ onFound }: { onFound: (node: NodeInfo) => void }) {
  const toast = useApp((s) => s.toast)
  const [addr, setAddr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    const parsed = parseAddress(addr)
    if (!parsed) {
      setError('格式不对：请输入 192.168.1.20 或 192.168.1.20:8420')
      return
    }
    setBusy(true)
    setError(null)
    try {
      let node = await probeTarget(parsed.host, parsed.port, false)
      if (!node && !parsed.explicit) node = await probeTarget(parsed.host, 8443, true)
      if (!node) {
        setError(`在 ${parsed.host}:${parsed.port} 上没有找到 LanDeck Agent`)
        return
      }
      const host = node.ip || parsed.host
      const port = node.port || parsed.port
      onFound({ ...node, ip: host, port })
      toast({
        kind: 'ok',
        title: `已添加 ${node.name}`,
        desc: `${host}:${port} · ${osLabel(node.os)}`,
      })
      setAddr('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <SectionTitle
        icon={<MapPin size={16} />}
        title="手动添加"
        desc="知道地址时直接填，比扫整个网段快。"
      />
      <form
        className="mt-4 space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field error={error}>
          <Input
            value={addr}
            onChange={(e) => {
              setAddr(e.target.value)
              if (error) setError(null)
            }}
            placeholder="192.168.1.20:8420"
            mono
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            aria-label="设备地址"
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          size="md"
          fullWidth
          loading={busy}
          icon={<Search size={15} />}
        >
          探测并添加
        </Button>
      </form>
    </Card>
  )
}
