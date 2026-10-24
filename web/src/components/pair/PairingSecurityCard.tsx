import { Info, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AgentClient } from '../../lib/api'
import { relative } from '../../lib/format'
import { useAsync, useTicker } from '../../lib/hooks'
import type { PairedClient, PairingState } from '../../lib/types'
import { useApp, type PairedDevice } from '../../store/app'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  SectionTitle,
  Skeleton,
  Toggle,
} from '../ui'
import { apiErrorMessage } from './errors'
import { formatFixedKey, isFixedKeyComplete } from './KeyFields'

function formatCode(code: string): string {
  const d = code.replace(/\s+/g, '')
  if (d.length !== 6) return d || '— — —'
  return `${d.slice(0, 3)} ${d.slice(3)}`
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const ROLE_LABEL: Record<PairedClient['role'], string> = {
  owner: '拥有者',
  controller: '控制端',
  viewer: '只读',
}

/** 设置页第 3 组：固定密钥、随机码、已配对客户端 */
export function PairingSecurityCard({ device }: { device: PairedDevice }) {
  const toast = useApp((s) => s.toast)
  const client = new AgentClient(device, device.token)
  const pairingQ = useAsync(() => client.pairing(), [device.id, device.token])
  const clientsQ = useAsync(() => client.clients(), [device.id, device.token])

  const [state, setState] = useState<PairingState | null>(null)
  const [busy, setBusy] = useState<'rotate' | 'toggle' | 'key' | null>(null)
  const [keyModal, setKeyModal] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<PairedClient | null>(null)
  const [revoking, setRevoking] = useState(false)

  useEffect(() => {
    if (pairingQ.data) setState(pairingQ.data)
  }, [pairingQ.data])

  const tick = useTicker(1000)
  const expiresAt = state?.codeExpiresAt ?? ''
  const remaining = useMemo(() => {
    const t = Date.parse(expiresAt)
    if (Number.isNaN(t)) return 0
    return Math.max(0, Math.round((t - Date.now()) / 1000))
  }, [expiresAt, tick])

  const rotate = async () => {
    setBusy('rotate')
    try {
      const res = await client.rotateCode()
      setState((s) => (s ? { ...s, code: res.code, codeExpiresAt: res.codeExpiresAt } : s))
      toast({ kind: 'ok', title: '随机码已更换', desc: '旧码立即失效' })
    } catch (e) {
      toast({ kind: 'error', title: '更换失败', desc: apiErrorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const toggleRandom = async (v: boolean) => {
    setBusy('toggle')
    const prev = state
    setState((s) => (s ? { ...s, randomEnabled: v } : s))
    try {
      const res = await client.updatePairing({ randomEnabled: v })
      setState(res)
      toast({ kind: 'ok', title: v ? '随机码已启用' : '随机码已关闭' })
    } catch (e) {
      setState(prev)
      toast({ kind: 'error', title: '操作失败', desc: apiErrorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const submitKey = async () => {
    if (!isFixedKeyComplete(newKey)) {
      setKeyError('请输入 8 位字符，例如 7K9F-2M4Q')
      return
    }
    setBusy('key')
    setKeyError(null)
    try {
      const res = await client.updatePairing({ fixedKey: formatFixedKey(newKey) })
      setState(res)
      setKeyModal(false)
      setNewKey('')
      toast({ kind: 'ok', title: '固定密钥已更新', desc: '旧密钥立即失效，记得记下新密钥' })
    } catch (e) {
      setKeyError(apiErrorMessage(e, '重设失败'))
    } finally {
      setBusy(null)
    }
  }

  const revoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await client.revokeClient(revokeTarget.id)
      toast({ kind: 'ok', title: `已吊销 ${revokeTarget.name}`, desc: '该客户端的令牌立即失效' })
      setRevokeTarget(null)
      clientsQ.reload()
    } catch (e) {
      toast({ kind: 'error', title: '吊销失败', desc: apiErrorMessage(e) })
    } finally {
      setRevoking(false)
    }
  }

  const clients = clientsQ.data?.items ?? []

  return (
    <Card>
      <SectionTitle
        icon={<ShieldCheck size={16} />}
        title="配对与安全"
        desc="固定密钥长期有效；随机码只显示在被控机屏幕上，更适合日常配对。"
      />

      {pairingQ.loading && !state ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !state ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.08] px-3 py-2.5 text-[12px] leading-relaxed text-danger">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{apiErrorMessage(pairingQ.error, '读取配对信息失败')}</span>
          <Button size="sm" variant="ghost" onClick={pairingQ.reload}>
            重试
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {/* 固定密钥 */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="min-w-0">
              <div className="text-[11.5px] text-muted">固定密钥</div>
              <div className="num mt-1 text-[15px] tracking-[0.14em] text-fg">
                {state.fixedKeySet ? state.fixedKeyMasked || '••••-••••' : '未设置'}
              </div>
            </div>
            <Button
              size="md"
              variant="secondary"
              icon={<KeyRound size={15} />}
              onClick={() => {
                setNewKey('')
                setKeyError(null)
                setKeyModal(true)
              }}
            >
              重设
            </Button>
          </div>

          {/* 随机码 */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11.5px] text-muted">
                  随机码{state.randomEnabled ? ' · 默认 300 秒轮换' : ' · 已关闭'}
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className={
                      state.randomEnabled && remaining > 0
                        ? 'num text-[28px] font-semibold leading-none tracking-[0.16em] text-fg'
                        : 'num text-[28px] font-semibold leading-none tracking-[0.16em] text-faint'
                    }
                  >
                    {state.randomEnabled ? formatCode(state.code) : '—— ——'}
                  </span>
                  {state.randomEnabled && (
                    <span className="num text-[11.5px] text-muted">
                      {remaining > 0 ? `${mmss(remaining)} 后失效` : '已失效，请更换'}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="md"
                variant="primary"
                icon={<RefreshCw size={15} />}
                loading={busy === 'rotate'}
                disabled={!state.randomEnabled}
                onClick={() => void rotate()}
              >
                立即更换
              </Button>
            </div>
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <Toggle
                checked={state.randomEnabled}
                disabled={busy === 'toggle'}
                onChange={(v) => void toggleRandom(v)}
                label="启用随机码"
                desc="关闭后只能用固定密钥配对。共享环境建议保持开启。"
              />
            </div>
          </div>

          {/* requireLocalCode 说明 */}
          <div className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[11.5px] leading-relaxed text-muted">
            <Info size={14} className="mt-0.5 shrink-0 text-cyan" />
            <p>
              {state.requireLocalCode
                ? '已开启「仅本机显示随机码」：随机码只出现在被控机的本机屏幕上，远程（含本控制端）拿不到，可防止远程连续猜码。'
                : '未开启「仅本机显示随机码」：随机码对本控制端可见，适合自己独占的设备；多人共用的机器建议在被控端打开该开关。'}
            </p>
          </div>

          {/* 客户端列表 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-fg-soft">已配对客户端</span>
              <span className="num text-[11.5px] text-faint">{clients.length} 个</span>
            </div>

            {clientsQ.loading && !clientsQ.data ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : clientsQ.error && !clientsQ.data ? (
              <p className="text-[12px] text-danger">{apiErrorMessage(clientsQ.error, '读取客户端列表失败')}</p>
            ) : clients.length === 0 ? (
              <p className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 text-[12px] text-muted">
                还没有客户端。用随机码或固定密钥配对后，这里会列出所有客户端。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {clients.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] text-fg">{c.name}</span>
                        <Badge
                          tone={c.role === 'owner' ? 'accent' : c.role === 'viewer' ? 'cyan' : 'neutral'}
                          className="shrink-0"
                        >
                          {ROLE_LABEL[c.role]}
                        </Badge>
                      </div>
                      <div className="num mt-0.5 truncate text-[11px] text-muted">
                        {c.ip} · 最后在线 {relative(c.lastSeenAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 text-danger hover:bg-danger/10"
                      disabled={c.id === device.clientId}
                      title={c.id === device.clientId ? '不能吊销当前正在使用的客户端' : undefined}
                      onClick={() => setRevokeTarget(c)}
                    >
                      吊销
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Modal
        open={keyModal}
        onClose={() => setKeyModal(false)}
        title="重设固定密钥"
        desc="8 位字母数字，建议形如 7K9F-2M4Q；保存后旧密钥立即失效。"
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => setKeyModal(false)} disabled={busy === 'key'}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy === 'key'}
              icon={<KeyRound size={15} />}
              onClick={() => void submitKey()}
            >
              保存
            </Button>
          </>
        }
      >
        <Field label="新固定密钥" error={keyError}>
          <Input
            value={formatFixedKey(newKey)}
            onChange={(e) => {
              setNewKey(formatFixedKey(e.target.value))
              if (keyError) setKeyError(null)
            }}
            mono
            maxLength={9}
            placeholder="7K9F-2M4Q"
            autoComplete="off"
            spellCheck={false}
            className="text-center"
          />
        </Field>
      </Modal>

      <Modal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="吊销客户端"
        desc={`吊销后「${revokeTarget?.name ?? ''}」的令牌立即失效，需要重新配对。`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              取消
            </Button>
            <Button variant="danger" loading={revoking} onClick={() => void revoke()}>
              吊销
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-[12px] leading-relaxed text-muted">
          只会断开这一个客户端，不影响其它设备，也不会让设备关机。
        </div>
      </Modal>
    </Card>
  )
}
