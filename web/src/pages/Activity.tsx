import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Card, EmptyState, Skeleton } from '../components/ui'
import { History, RotateCw, TriangleAlert } from 'lucide-react'
import type { ActivityItem } from '../lib/types'
import { useApp } from '../store/app'
import { useClient } from '../lib/hooks'
import { DeviceSelect } from '../components/device/DeviceSelect'
import { AuthLost } from '../components/device/AuthLost'
import { errText, isAuthError } from '../components/device/apiHelpers'
import { actionLabel, dateTime } from '../lib/format'

const PAGE = 50

export default function Activity() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const [deviceId, setDeviceId] = useState<string | null>(activeId ?? devices[0]?.id ?? null)
  const device = useMemo(
    () => devices.find((d) => d.id === deviceId) ?? devices[0] ?? null,
    [devices, deviceId],
  )
  const client = useClient(device)

  const [items, setItems] = useState<ActivityItem[]>([])
  const itemsRef = useRef<ActivityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [more, setMore] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [authLost, setAuthLost] = useState(false)

  useEffect(() => {
    if (device && device.id !== deviceId) setDeviceId(device.id)
  }, [device, deviceId])

  const load = useCallback(
    async (mode: 'reset' | 'more') => {
      if (!client) return
      if (mode === 'reset') {
        setLoading(true)
        setError(null)
      } else setMore(true)
      try {
        const before =
          mode === 'more' ? itemsRef.current[itemsRef.current.length - 1]?.at : undefined
        const res = await client.activity(PAGE, before)
        const batch = res.items ?? []
        if (mode === 'reset') {
          itemsRef.current = batch
          setItems(batch)
        } else {
          const seen = new Set(itemsRef.current.map((i) => i.id))
          const merged = [...itemsRef.current, ...batch.filter((i) => !seen.has(i.id))]
          itemsRef.current = merged
          setItems(merged)
        }
        setDone(batch.length < PAGE)
      } catch (e) {
        if (isAuthError(e)) setAuthLost(true)
        setError(e)
      } finally {
        setLoading(false)
        setMore(false)
      }
    },
    [client],
  )

  useEffect(() => {
    itemsRef.current = []
    setItems([])
    setDone(false)
    setError(null)
    if (client) void load('reset')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.target.host, client?.target.port, client?.token])

  const groups = useMemo(() => {
    const out: { key: string; items: ActivityItem[] }[] = []
    for (const it of items) {
      const key = dayKey(it.at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(it)
      else out.push({ key, items: [it] })
    }
    return out
  }, [items])

  if (authLost) return <AuthLost />

  return (
    <div className="space-y-3">
      {devices.length > 0 && (
        <Card padded={false} className="flex flex-wrap items-center gap-2 p-2.5">
          <DeviceSelect
            devices={devices}
            value={device?.id ?? null}
            onChange={setDeviceId}
          />
          <span className="hidden text-[11.5px] text-faint sm:inline">
            共 <span className="num text-fg-soft">{items.length}</span> 条记录
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              className="h-10 w-10 shrink-0 p-0"
              aria-label="刷新日志"
              onClick={() => void load('reset')}
              disabled={loading || !client}
            >
              <RotateCw size={14} className={loading ? 'animate-spin' : undefined} />
            </Button>
          </div>
        </Card>
      )}

      {devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<History size={26} />}
            title="还没有已配对的设备"
            desc="日志来自具体设备，先扫描并配对一台电脑。"
          />
        </Card>
      ) : loading && items.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TriangleAlert size={24} />}
            title="日志加载失败"
            desc={errText(error)}
            action={
              <Button variant="secondary" onClick={() => void load('reset')}>
                重试
              </Button>
            }
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<History size={26} />}
            title="还没有操作记录"
            desc="在设备详情页执行关机、调音量等动作后，会在这里留下记录。"
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.1em] text-faint">
                {dayTitle(g.key)}
                <span className="num ml-2 normal-case tracking-normal text-faint">
                  {g.items.length} 条
                </span>
              </h2>
              <div className="relative">
                <span className="absolute bottom-1 left-[5px] top-2 w-px bg-white/10" />
                <ul>
                  {g.items.map((it) => (
                    <li key={it.id} className="relative py-1.5 pl-6">
                      <span
                        className={
                          it.ok
                            ? 'absolute left-[1.5px] top-[15px] h-[9px] w-[9px] rounded-full bg-ok shadow-[0_0_8px_rgba(52,211,153,.7)]'
                            : 'absolute left-[1.5px] top-[15px] h-[9px] w-[9px] rounded-full bg-danger shadow-[0_0_8px_rgba(251,113,133,.7)]'
                        }
                      />
                      <div className="rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.035]">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[13.5px] font-medium text-fg">
                            {actionLabel(it.action)}
                          </span>
                          <Badge tone={it.ok ? 'ok' : 'danger'}>{it.ok ? '成功' : '失败'}</Badge>
                          <span className="num ml-auto shrink-0 text-[11.5px] text-faint">
                            {dateTime(it.at)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
                          <span className="truncate">{it.clientName || '未知客户端'}</span>
                          {it.params && Object.keys(it.params).length > 0 && (
                            <span className="num truncate text-faint">
                              {JSON.stringify(it.params)}
                            </span>
                          )}
                        </div>
                        {!it.ok && it.detail && (
                          <p className="mt-1 break-words text-[11.5px] leading-relaxed text-danger">
                            {it.detail}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}

          <div className="flex flex-col items-center gap-2 pt-1">
            {done ? (
              <p className="text-[11.5px] text-faint">已经到底了</p>
            ) : (
              <Button variant="secondary" loading={more} onClick={() => void load('more')}>
                加载更多
              </Button>
            )}
            {error !== null && items.length > 0 && (
              <p className="text-[11.5px] text-danger">{errText(error)}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function dayTitle(key: string): string {
  const today = new Date()
  const tKey = dayKey(today.toISOString())
  if (key === tKey) return '今天'
  const y = new Date(today.getTime() - 86_400_000)
  if (key === dayKey(y.toISOString())) return '昨天'
  const [yy, mm, dd] = key.split('-')
  const sameYear = yy === String(today.getFullYear())
  return sameYear ? `${mm} / ${dd}` : `${yy} / ${mm} / ${dd}`
}
