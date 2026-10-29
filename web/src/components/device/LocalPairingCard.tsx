import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, KeyRound, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { Badge, Button, Card, SectionTitle, Skeleton } from '../ui'
import type { AgentClient } from '../../lib/api'
import { useAsync, useTicker } from '../../lib/hooks'
import { clientsKey, pairingKey } from '../../lib/keys'
import { dateTime, relative } from '../../lib/format'
import { useApp } from '../../store/app'

/**
 * 本机的「配对与管理」：配对码 + 已授权客户端 + 设备改名。
 *
 * 放在本机页而不是只放设置页，是因为用户在「本机」页最常问的两件事就是
 * 「手机怎么连上来」和「谁连过我」—— 让他在同一个页面就能拿到码、踢掉陌生客户端。
 */
export function LocalPairingCard({ client }: { client: AgentClient }) {
  const toast = useApp((s) => s.toast)
  const ident: Array<string | number | undefined> = [client.target.host, client.target.port, client.token]
  const pairing = useAsync(() => client.pairing(), ident, {
    key: pairingKey(client),
    ttlMs: 10_000,
  })
  const clients = useAsync(() => client.clients(), ident, {
    key: clientsKey(client),
    ttlMs: 60_000,
  })
  const [rotating, setRotating] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  // 每秒一次：既刷新「N 分钟后过期」文案，也驱动过期后的重试
  const tick = useTicker(1000)

  /**
   * 配对码过期后自动取新码。
   *
   * 服务端是「惰性轮换」：读 /pairing 时若已过期，就在那次调用里当场换一个新码
   * （`auth.Code()` 里 `if now > codeExp` 就 rotate）。所以只需在到期后拉一次。
   *
   * 两个必须处理的坑（第一版都踩了）：
   *  1. 不能卡在到期边界上拉：倒计时按秒四舍五入会提前最多 0.5 秒显示「已过期」，
   *     这时请求过去服务端认为还没到期、原样返回旧码，界面就永远停在「已失效」。
   *     所以等过期 300ms 之后再拉。
   *  2. 必须允许重试：万一拉到的还是旧码，要能再试，最多 8 次停手。
   *
   * 原来这里是每 30 秒轮询一次：既白跑请求，又有最多 30 秒的「已过期」空窗。
   */
  const expRef = useRef('')
  const attemptsRef = useRef(0)
  const expMs = Date.parse(pairing.data?.codeExpiresAt ?? '')
  const remainingMs = Number.isFinite(expMs) ? expMs - Date.now() : NaN

  useEffect(() => {
    const exp = pairing.data?.codeExpiresAt ?? ''
    if (expRef.current !== exp) {
      expRef.current = exp
      attemptsRef.current = 0
    }
    if (!Number.isFinite(expMs)) return
    if (remainingMs > -300) return
    if (attemptsRef.current >= 8) return
    attemptsRef.current += 1
    pairing.reload()
  }, [tick, expMs, remainingMs, pairing.data?.codeExpiresAt, pairing.reload])

  const expiryText = useMemo(() => {
    void tick
    return pairing.data?.codeExpiresAt ? `${relative(pairing.data.codeExpiresAt)}过期` : ''
  }, [pairing.data?.codeExpiresAt, tick])

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ kind: 'ok', title: `已复制${label}`, desc: text })
    } catch {
      toast({ kind: 'info', title: '复制失败', desc: '浏览器拒绝了剪贴板权限，请手动选中复制' })
    }
  }

  const rotate = async () => {
    setRotating(true)
    try {
      await client.rotateCode()
      pairing.reload()
      toast({ kind: 'ok', title: '配对码已刷新' })
    } catch (e) {
      toast({ kind: 'error', title: '刷新失败', desc: (e as Error).message })
    } finally {
      setRotating(false)
    }
  }

  const remove = async (id: string, name: string) => {
    setRemoving(id)
    try {
      await client.revokeClient(id)
      clients.reload()
      toast({ kind: 'ok', title: '已移除客户端', desc: name })
    } catch (e) {
      toast({ kind: 'error', title: '移除失败', desc: (e as Error).message })
    } finally {
      setRemoving(null)
    }
  }

  const p = pairing.data

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <Card className="lg:col-span-5">
        <SectionTitle
          title="配对码"
          desc="别的设备用这个码连上本机"
          icon={<KeyRound size={16} />}
          action={
            <Button size="sm" variant="ghost" loading={rotating} onClick={() => void rotate()}>
              <RefreshCw size={13} className="mr-1" />
              换一个
            </Button>
          }
        />

        {pairing.loading && !p ? (
          <Skeleton className="mt-4 h-24 w-full" />
        ) : pairing.error ? (
          <p className="mt-4 text-[12.5px] text-danger">{pairing.error}</p>
        ) : (
          <>
            <div className="mt-4 rounded-2xl border border-accent/25 bg-accent/[0.07] px-4 py-4 text-center">
              <div className="text-[11.5px] text-muted">6 位配对码</div>
              <div className="num mt-1 text-[30px] font-semibold tracking-[0.18em] text-fg">
                {p?.code || '—'}
              </div>
              <div className="mt-1 text-[11px] text-faint">
                {expiryText || '随随机码刷新'}
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                disabled={!p?.code}
                onClick={() => void copy(p!.code, '配对码')}
              >
                <Copy size={13} className="mr-1" />
                复制
              </Button>
            </div>

            <div className="mt-3 space-y-2 text-[12px]">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line-soft bg-elevated px-3 py-2">
                <span className="truncate text-faint">固定密钥</span>
                <span className="num shrink-0 text-fg-soft">{p?.fixedKeyMasked || '未设置'}</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line-soft bg-elevated px-3 py-2">
                <span className="truncate text-faint">随机码</span>
                <Badge tone={p?.randomEnabled ? 'ok' : 'neutral'} dot>
                  {p?.randomEnabled ? '已开启' : '已关闭'}
                </Badge>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
              手机装 LanDeck 后扫描局域网，选中这台电脑，输入上面的 6 位码即可配对。
            </p>
          </>
        )}
      </Card>

      <Card className="lg:col-span-7">
        <SectionTitle
          title="已授权客户端"
          desc={`${clients.data?.items?.length ?? 0} 台设备可以控制本机`}
          icon={<UserRound size={16} />}
          action={
            <Button size="sm" variant="ghost" onClick={() => clients.reload()}>
              <RefreshCw size={13} />
            </Button>
          }
        />
        <div className="mt-3 divide-y divide-line-soft">
          {clients.loading && !clients.data ? (
            <Skeleton className="h-16 w-full" />
          ) : (clients.data?.items?.length ?? 0) === 0 ? (
            <div className="flex items-center gap-2 py-6 text-[12.5px] text-muted">
              <ShieldCheck size={15} className="text-faint" />
              还没有客户端配对过这台电脑
            </div>
          ) : (
            clients.data!.items.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-elevated text-muted">
                  <MonitorSmartphone size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-fg">{c.name || '未命名客户端'}</div>
                  <div className="num truncate text-[11px] text-faint">
                    {c.ip} · {relative(c.lastSeenAt)}
                  </div>
                </div>
                <Badge tone={c.role === 'owner' ? 'accent' : 'neutral'}>{c.role === 'owner' ? '所有者' : c.role === 'viewer' ? '只读' : '控制'}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={removing === c.id}
                  onClick={() => void remove(c.id, c.name)}
                  title="撤销该客户端"
                >
                  <Trash2 size={13} className="text-danger" />
                </Button>
              </div>
            ))
          )}
        </div>
        <p className="mt-2 text-[11px] text-faint">撤销后该设备需要重新输入配对码。首次配对时间：{clients.data?.items?.[0] ? dateTime(clients.data.items[0].createdAt) : '—'}</p>
      </Card>
    </div>
  )
}
