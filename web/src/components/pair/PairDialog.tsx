import { motion } from 'framer-motion'
import { KeyRound, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { pairDevice } from '../../lib/api'
import { uid } from '../../lib/format'
import type { NodeInfo } from '../../lib/types'
import { useApp } from '../../store/app'
import { Badge, Button, DeviceAvatar, Field, Input, Modal, Segmented } from '../ui'
import { apiErrorMessage } from './errors'
import { CodeInput, FixedKeyInput, isFixedKeyComplete } from './KeyFields'

type Kind = 'random' | 'fixed'

/** 配对弹窗：随机码 / 固定密钥两路，成功后写入 store 并跳详情 */
export function PairDialog({
  open,
  node,
  onClose,
  onPaired,
}: {
  open: boolean
  node: NodeInfo | null
  onClose: () => void
  onPaired?: (id: string) => void
}) {
  const myName = useApp((s) => s.myName)
  const addDevice = useApp((s) => s.addDevice)
  const toast = useApp((s) => s.toast)
  const navigate = useNavigate()

  const [kind, setKind] = useState<Kind>('random')
  const [code, setCode] = useState('')
  const [fixedKey, setFixedKey] = useState('')
  const [name, setName] = useState(myName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const clientId = useMemo(() => uid(), [open, node?.id])

  useEffect(() => {
    if (!open) return
    setKind(node?.pairing && node.pairing.random === false ? 'fixed' : 'random')
    setCode('')
    setFixedKey('')
    setName(myName)
    setError(null)
    setBusy(false)
  }, [open, node?.id, node?.pairing, myName])

  const fail = (msg: string) => {
    setError(msg)
    setShake((s) => s + 1)
  }

  const submit = async () => {
    if (!node || busy) return
    if (kind === 'random' && !/^\d{6}$/.test(code)) {
      fail('请输入 6 位数字随机码')
      return
    }
    if (kind === 'fixed' && !isFixedKeyComplete(fixedKey)) {
      fail('请输入形如 7K9F-2M4Q 的 8 位固定密钥')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const res = await pairDevice({
        target: { host: node.ip, port: node.port, tls: node.tls },
        key: kind === 'random' ? code : fixedKey,
        kind,
        clientName: name.trim() || myName,
        clientId,
      })
      addDevice({
        id: node.id,
        host: node.ip,
        port: node.port,
        tls: node.tls,
        token: res.token,
        clientId: res.clientId,
        name: node.name,
        os: node.os,
        arch: node.arch,
        ver: node.ver,
        lastOkAt: Date.now(),
      })
      toast({
        kind: 'ok',
        title: `已配对 ${node.name}`,
        desc: `令牌保存在本机浏览器 · 角色 ${res.role}`,
      })
      onPaired?.(node.id)
      onClose()
      navigate(`/devices/${node.id}`)
    } catch (e) {
      fail(apiErrorMessage(e, '密钥不正确或已过期'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open && !!node}
      onClose={onClose}
      title="配对设备"
      desc="输入被控机上显示的密钥，配对成功后本机即获得访问令牌。"
      width={468}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={busy}
            icon={<KeyRound size={15} />}
            onClick={() => void submit()}
          >
            配对
          </Button>
        </>
      }
    >
      {node && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <DeviceAvatar os={node.os} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium text-fg">{node.name}</div>
              <div className="num mt-0.5 truncate text-[11.5px] text-muted">
                {node.ip}:{node.port}
                {node.tls ? ' · TLS' : ''}
              </div>
            </div>
            <Badge tone="cyan" className="shrink-0">
              Agent {node.ver}
            </Badge>
          </div>

          <div className="flex justify-center">
            <Segmented<Kind>
              value={kind}
              onChange={(v) => {
                setKind(v)
                setError(null)
              }}
              options={[
                { value: 'random', label: '随机码' },
                { value: 'fixed', label: '固定密钥' },
              ]}
            />
          </div>

          {kind === 'random' ? (
            <Field
              label="6 位随机码"
              hint="显示在被控机本机屏幕上的数字，默认 5 分钟轮换一次。"
            >
              <motion.div
                key={`code-${shake}`}
                animate={{ x: [0, -8, 8, -5, 5, 0] }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
              >
                <CodeInput
                  value={code}
                  onChange={(v) => {
                    setCode(v)
                    if (error) setError(null)
                  }}
                  invalid={!!error}
                  disabled={busy}
                />
              </motion.div>
            </Field>
          ) : (
            <Field label="固定密钥" hint="首次启动时生成的 8 位密钥，可在被控端设置里改写，长期有效。">
              <motion.div
                key={`key-${shake}`}
                animate={{ x: [0, -8, 8, -5, 5, 0] }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
              >
                <FixedKeyInput
                  value={fixedKey}
                  onChange={(v) => {
                    setFixedKey(v)
                    if (error) setError(null)
                  }}
                  invalid={!!error}
                  disabled={busy}
                />
              </motion.div>
            </Field>
          )}

          <Field label="客户端名称" hint="配对时显示在被控机的客户端列表里，之后可在这里改。">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="例如 YG 的笔记本"
              disabled={busy}
            />
          </Field>

          {error && (
            <motion.div
              key={`err-${shake}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.09] px-3 py-2.5 text-[12px] leading-relaxed text-danger"
              role="alert"
            >
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}
        </form>
      )}
    </Modal>
  )
}
