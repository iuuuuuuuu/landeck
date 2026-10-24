import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, EmptyState, IconButton, Input, Modal, Segmented, Skeleton, Toggle } from '../ui'
import { ChevronRight, ListTree, RotateCw, TriangleAlert } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { ProcessInfo, SystemInfo } from '../../lib/types'
import { useApp } from '../../store/app'
import { errText, isAuthError } from './apiHelpers'
import { ProcessRow } from './ProcessRow'

const PAGE = 60
const REFRESH_MS = 15_000

type Sort = 'cpu' | 'mem' | 'name'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'cpu', label: 'CPU' },
  { value: 'mem', label: '内存' },
  { value: 'name', label: '名称' },
]

export function ProcessPanel({
  client,
  system,
  onAuthError,
}: {
  client: AgentClient | null
  system: SystemInfo | null
  onAuthError?: () => void
}) {
  const toast = useApp((s) => s.toast)
  const enabled = system?.features?.processes !== false

  const [sort, setSort] = useState<Sort>('cpu')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<ProcessInfo[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [target, setTarget] = useState<ProcessInfo | null>(null)
  const [force, setForce] = useState(true)
  const [killing, setKilling] = useState(false)

  const wrap = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(true)
  /** 同参数请求在飞时跳过本轮轮询，避免慢请求叠加 */
  const inFlight = useRef<string | null>(null)
  /** 只有最后一次发起的请求能写回状态，防止乱序覆盖 */
  const seq = useRef(0)

  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 400)
    return () => window.clearTimeout(t)
  }, [query])

  const load = useCallback(
    async (quiet = false) => {
      if (!client || !enabled) return
      const key = `${sort}|${q}|${PAGE}`
      if (inFlight.current === key) return
      inFlight.current = key
      const my = ++seq.current
      if (!quiet) setLoading(true)
      try {
        const res = await client.processes({ sort, limit: PAGE, q: q || undefined })
        if (my !== seq.current) return
        setItems(res.items ?? [])
        setTotal(res.total ?? 0)
        setError(null)
      } catch (e) {
        if (my !== seq.current) return
        if (isAuthError(e)) onAuthError?.()
        setError(e)
      } finally {
        if (inFlight.current === key) inFlight.current = null
        if (my === seq.current) setLoading(false)
      }
    },
    [client, enabled, sort, q, onAuthError],
  )

  useEffect(() => {
    if (enabled) void load(false)
  }, [enabled, load])

  // 只在面板可见时轮询，切到后台标签页也停
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting !== false),
      { threshold: 0.06 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!enabled || !visible) return
    const id = window.setInterval(() => {
      if (!document.hidden) void load(true)
    }, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [enabled, visible, load])

  const kill = async () => {
    if (!client || !target) return
    setKilling(true)
    try {
      await client.killProcess({ pid: target.pid, force })
      toast({ kind: 'ok', title: `已结束 ${target.name}`, desc: `PID ${target.pid}` })
      setTarget(null)
      void load(true)
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      toast({ kind: 'error', title: '结束进程失败', desc: errText(e) })
    } finally {
      setKilling(false)
    }
  }

  // 首屏还没结果时不显示假 0
  const showTotal = items.length > 0 || (!loading && error === null)

  if (!enabled) {
    return (
      <Card>
        <div className="flex items-center gap-2.5 opacity-60">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-muted">
            <ListTree size={16} />
          </span>
          <div>
            <h3 className="text-[14.5px] font-semibold text-fg-soft">进程控制已被关闭</h3>
            <p className="mt-0.5 text-[12px] text-muted">在 Agent 设置中开启后即可查看与结束进程。</p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-fg">进程</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            共 <span className="num">{showTotal ? total : '—'}</span> 个 · 每 15 秒刷新
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Segmented value={sort} onChange={setSort} options={SORTS} size="sm" />
          <div className="w-[128px] sm:w-[168px]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索进程"
              className="h-9 text-[12.5px]"
            />
          </div>
          <IconButton
            label="刷新进程列表"
            onClick={() => void load(false)}
            disabled={loading}
          >
            <RotateCw size={14} className={loading ? 'animate-spin' : undefined} />
          </IconButton>
        </div>
      </div>

      <div ref={wrap} className="mt-3.5">
        {loading && items.length === 0 ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
            <p className="pt-1 text-center text-[11px] text-faint">正在采样 CPU 占用，请稍候</p>
          </div>
        ) : error && items.length === 0 ? (
          <EmptyState
            icon={<TriangleAlert size={22} />}
            title="进程列表加载失败"
            desc={errText(error)}
            action={
              <Button variant="secondary" size="sm" onClick={() => void load(false)}>
                重试
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState title="没有匹配的进程" desc="换个关键词，或清空搜索条件再试。" />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-white/6 px-2 pb-1.5 text-[10.5px] text-faint">
              <span className="w-12 shrink-0">PID</span>
              <span className="min-w-0 flex-1">进程 / 用户</span>
              <span className="w-10 shrink-0 text-right">CPU</span>
              <span className="w-12 shrink-0 text-right">内存</span>
              <span className="w-[52px] shrink-0" />
            </div>
            <ul className="scroll-area max-h-[400px] pt-1">
              {items.map((p) => (
                <ProcessRow
                  key={`${p.pid}-${p.name}`}
                  p={p}
                  expanded={open === p.pid}
                  onToggle={() => setOpen(open === p.pid ? null : p.pid)}
                  onKill={() => {
                    setForce(true)
                    setTarget(p)
                  }}
                />
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
              <span className="inline-flex items-center gap-1">
                <ChevronRight size={11} />
                点击行查看详细信息
              </span>
              <span className="num">
                显示 {items.length} / {total}
              </span>
            </div>
          </>
        )}
      </div>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="结束进程"
        desc={
          target
            ? `将结束 ${target.name}（PID ${target.pid}）。这是强制结束，未保存的数据会丢失。`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={killing}>
              取消
            </Button>
            <Button variant="danger" loading={killing} onClick={() => void kill()}>
              结束进程
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-white/8 bg-white/[0.028] px-3.5 py-3">
          <Toggle
            checked={force}
            onChange={setForce}
            label="强制结束"
            desc="对应 force: true，进程无法拒绝；关闭后改为普通请求"
          />
        </div>
      </Modal>
    </Card>
  )
}
