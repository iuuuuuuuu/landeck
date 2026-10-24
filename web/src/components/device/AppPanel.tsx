import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, EmptyState, IconButton, Input, Modal, Segmented, Skeleton } from '../ui'
import { ListTree, RotateCw, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { AppGroup, SystemInfo } from '../../lib/types'
import { useApp } from '../../store/app'
import { errText, isAuthError } from './apiHelpers'
import { AppRow } from './AppRow'
import { PanelFrame } from './PanelFrame'

const PAGE = 80
const REFRESH_MS = 15_000

type Sort = 'cpu' | 'mem' | 'count' | 'name'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'cpu', label: 'CPU' },
  { value: 'mem', label: '内存' },
  { value: 'count', label: '进程数' },
  { value: 'name', label: '名称' },
]

/** 应用视图：用户只认「哪个应用」，不认 PID */
export function AppPanel({
  client,
  system,
  onAuthError,
  embedded,
}: {
  client: AgentClient | null
  system: SystemInfo | null
  onAuthError?: () => void
  /** 作为 Tab 内容嵌入时不再自带卡片描边 */
  embedded?: boolean
}) {
  const toast = useApp((s) => s.toast)
  const enabled = system?.features?.processes !== false

  const [sort, setSort] = useState<Sort>('cpu')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<AppGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [target, setTarget] = useState<AppGroup | null>(null)
  const [killing, setKilling] = useState(false)
  const [killingKey, setKillingKey] = useState<string | null>(null)

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
        const res = await client.apps({ sort, limit: PAGE, q: q || undefined })
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
    const io = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting !== false), {
      threshold: 0.06,
    })
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
    const app = target
    setKilling(true)
    setKillingKey(app.key)
    try {
      const res = await client.killApp(app.key, true)
      toast({
        kind: 'ok',
        title: `已结束 ${res?.killed ?? app.count} 个进程`,
        desc: app.name,
      })
      setTarget(null)
      setOpen(null)
      void load(true)
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      toast({ kind: 'error', title: '结束应用失败', desc: errText(e) })
    } finally {
      setKilling(false)
      setKillingKey(null)
    }
  }

  // 首屏还没结果时不显示假 0
  const showTotal = items.length > 0 || (!loading && error === null)

  if (!enabled) {
    return (
      <PanelFrame embedded={embedded}>
        <div className="flex items-center gap-2.5 opacity-60">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-elevated text-muted">
            <ListTree size={16} />
          </span>
          <div>
            <h3 className="text-[14.5px] font-semibold text-fg-soft">进程控制已被关闭</h3>
            <p className="mt-0.5 text-[12px] text-muted">在 Agent 设置中开启后即可查看与结束应用。</p>
          </div>
        </div>
      </PanelFrame>
    )
  }

  return (
    <PanelFrame embedded={embedded}>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          {!embedded && <h3 className="text-[15px] font-semibold text-fg">应用</h3>}
          <p className="mt-0.5 text-[12px] text-muted">
            共 <span className="num">{showTotal ? total : '—'}</span> 个应用 · 每 15 秒刷新
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Segmented value={sort} onChange={setSort} options={SORTS} size="sm" />
          <div className="w-[128px] sm:w-[168px]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索应用"
              className="h-9 text-[12.5px]"
            />
          </div>
          <IconButton label="刷新应用列表" onClick={() => void load(false)} disabled={loading}>
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
            <p className="pt-1 text-center text-[11px] text-faint">正在汇总进程，请稍候</p>
          </div>
        ) : error && items.length === 0 ? (
          <EmptyState
            icon={<TriangleAlert size={22} />}
            title="应用列表加载失败"
            desc={errText(error)}
            action={
              <Button variant="secondary" size="sm" onClick={() => void load(false)}>
                重试
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={q ? '没有匹配的应用' : '没有可展示的应用'}
            desc={q ? '换个关键词，或清空搜索条件再试。' : '设备暂时没有返回应用分组。'}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line-soft px-2 pb-1.5 text-[10.5px] text-faint">
              <span className="w-8 shrink-0" />
              <span className="min-w-0 flex-1">应用 / 进程数</span>
              <span className="hidden w-11 shrink-0 text-right sm:block">CPU</span>
              <span className="hidden w-12 shrink-0 text-right sm:block">内存</span>
              <span className="w-[64px] shrink-0 sm:w-[72px]" />
            </div>
            <ul className="scroll-area max-h-[420px] pt-1">
              {items.map((app) => (
                <AppRow
                  key={app.key}
                  app={app}
                  expanded={open === app.key}
                  killing={killingKey === app.key}
                  onToggle={() => setOpen(open === app.key ? null : app.key)}
                  onKill={() => setTarget(app)}
                  onKillAll={() => setTarget(app)}
                />
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
              <span>点击行查看进程明细</span>
              <span className="num">
                显示 {items.length} / {total}
              </span>
            </div>
          </>
        )}
      </div>

      <Modal
        open={target !== null}
        onClose={() => {
          if (!killing) setTarget(null)
        }}
        title={target ? `结束 ${target.name}？` : '结束应用'}
        desc={
          target
            ? `将结束该应用的全部 ${target.count} 个进程（含子进程）。这是强制结束，未保存的内容会丢失。`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={killing}>
              取消
            </Button>
            <Button variant="danger" loading={killing} onClick={() => void kill()}>
              结束 {target?.count ?? 0} 个进程
            </Button>
          </>
        }
      >
        <div className="space-y-1.5 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3 text-[12px] text-danger">
          <div className="flex items-center gap-1.5 font-medium">
            <ShieldAlert size={13} />
            会丢失未保存内容
          </div>
          <p className="text-[11.5px] leading-relaxed text-fg-soft">
            {target ? (
              <>
                <span className="num">x {target.count}</span> 个进程、主 PID{' '}
                <span className="num">{target.mainPid}</span>
                {target.exe ? (
                  <>
                    ，可执行文件 <span className="font-mono text-[11px] break-all">{target.exe}</span>
                  </>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
      </Modal>
    </PanelFrame>
  )
}
