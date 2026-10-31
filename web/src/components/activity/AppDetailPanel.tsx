import { useState } from 'react'
import { useAsync } from '../../lib/hooks'
import { activityAppKey } from '../../lib/activityKeys'
import { fetchAppDetail } from '../../lib/activityApi'
import type { Target } from '../../lib/api'
import { Badge, Modal, Skeleton } from '../ui'
import { AppIcon, CategoryBadge, InlineBar, fmtDur } from './bits'

/**
 * 应用详情浮层（Hindsight 的 app detail）：点排行行打开。
 * 内容：头（图标+名+类别+总时长）→ 24 小时分布迷你柱 → 按窗口标题/域名分组列表。
 * 用现有 Modal（rounded-3xl），不另造浮层。
 */
export function AppDetailPanel({
  device,
  app,
  date,
  onClose,
}: {
  device: Target & { token?: string }
  app: string
  date: string
  onClose: () => void
}) {
  const q = useAsync(() => fetchAppDetail(device, device.token, { app, date }), [app, date, device.host, device.port, device.token], {
    key: activityAppKey(device, app, date),
    ttlMs: 3 * 60_000,
  })
  const [openGroup, setOpenGroup] = useState(true)
  const d = q.data?.data

  return (
    <Modal open onClose={onClose} width={560} title={undefined}>
      {q.loading && !d ? (
        <div className="space-y-3 py-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !d ? (
        <p className="py-8 text-center text-[13px] text-danger">{String(q.error ?? '读取失败')}</p>
      ) : (
        <div className="space-y-4">
          {/* 头部 */}
          <div className="flex items-center gap-3">
            <AppIcon app={d.app} cat={d.cat} target={device} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold text-fg">{d.app}</div>
              <div className="mt-0.5"><CategoryBadge cat={d.cat} /></div>
            </div>
            <span className="shrink-0 text-[15px] font-semibold tabular-nums text-fg">{fmtDur(d.sec)}</span>
          </div>

          {/* 24 小时分布：纯 div 迷你柱（单系列，不值得再起一个 echarts 实例） */}
          <div className="rounded-2xl border border-line-soft bg-elevated px-4 py-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11.5px] text-muted">当日分布</span>
              {q.data?.demo && <Badge tone="cyan">演示数据</Badge>}
            </div>
            <div className="flex h-16 items-end gap-[2px]">
              {d.hours.map((h) => {
                const max = Math.max(...d.hours.map((x) => x.sec), 1)
                const pct = Math.round((h.sec / max) * 100)
                return (
                  <span
                    key={h.hour}
                    title={`${String(h.hour).padStart(2, '0')}:00 · ${h.sec > 0 ? fmtDur(h.sec) : '—'}`}
                    className="flex-1 rounded-t-[3px]"
                    style={{
                      height: `${Math.max(pct, h.sec > 0 ? 6 : 1)}%`,
                      backgroundColor: h.sec > 0 ? 'var(--accent, #8b6bff)' : 'var(--line-soft, rgba(128,128,128,0.25))',
                      opacity: h.sec > 0 ? 1 : 0.6,
                    }}
                  />
                )
              })}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-faint">
              <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
            </div>
          </div>

          {/* 按窗口标题 / 域名分组 */}
          <div className="rounded-2xl border border-line-soft bg-elevated px-4 py-3">
            <button
              type="button"
              onClick={() => setOpenGroup((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-[11.5px] font-medium uppercase tracking-wide text-muted">
                按窗口标题 / 网站
              </span>
              <span className="text-[11px] text-faint">{openGroup ? '收起' : `展开 ${d.groups.length} 项`}</span>
            </button>
            {openGroup && (
              <ul className="mt-2">
                {d.groups.map((g, i) => {
                  const max = Math.max(...d.groups.map((x) => x.sec), 1)
                  return (
                    <li
                      key={g.title}
                      className={'flex items-center gap-3 py-2' + (i > 0 ? ' border-t border-line-soft' : '')}
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">{g.title}</span>
                      <InlineBar sec={g.sec} max={max} cat={d.cat} />
                      <span className="w-[70px] shrink-0 text-right text-[12px] tabular-nums text-muted">{fmtDur(g.sec)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
