import { useState } from 'react'
import { Camera, Search } from 'lucide-react'
import { Button, Card, EmptyState, Input, SectionTitle, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { memorySearchKey, memoryStatusKey } from '../../lib/activityKeys'
import { fetchMemorySearch, fetchMemoryStatus, memoryImageUrl } from '../../lib/activityApi'
import type { MemorySearchItem } from '../../lib/activityApi'
import { Highlight, MemoryThumb } from '../../components/memory/MemoryBits'
import { useTheme } from '../../store/theme'
import { ActivityPageHeader, NoDeviceGuide, useActivityTarget } from './shared'
import { MemorySettingsCard } from '../../components/memory/MemorySettingsCard'
import { relative } from '../../lib/format'

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function timeLabel(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 屏幕记忆 /activity/memory：截图 + OCR 文字检索（Hindsight 的「屏幕记忆与搜索」）。 */
export default function MemoryPage() {
  const { device, pairedCount, localAvailable } = useActivityTarget()
  const { theme } = useTheme()
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState(daysAgoStr(7))
  const [to, setTo] = useState(daysAgoStr(0))
  // 检索条件与输入分离：Enter/按钮才发请求，避免每敲一个字打一次 LIKE
  const [submitted, setSubmitted] = useState<{ q: string; from: string; to: string } | null>(null)
  const [lightbox, setLightbox] = useState<MemorySearchItem | null>(null)

  const statusQ = useAsync(() => fetchMemoryStatus(device, device.token), [device.host, device.port, device.token], {
    key: memoryStatusKey(device),
    ttlMs: 5 * 60_000,
  })
  const status = statusQ.data?.data
  const demo = !!statusQ.data?.demo
  const enabled = !!status?.enabled

  const searchQ = useAsync(
    submitted && submitted.q ? () => fetchMemorySearch(device, device.token, { q: submitted.q, from: submitted.from, to: submitted.to, limit: 50 }) : null,
    [submitted?.q, submitted?.from, submitted?.to, device.host, device.port, device.token],
    { key: submitted?.q ? memorySearchKey(device, submitted.q, submitted.from, submitted.to) : '', ttlMs: 30_000 },
  )
  const results = searchQ.data?.data
  const searchDemo = !!searchQ.data?.demo

  if (!localAvailable && pairedCount === 0) return <NoDeviceGuide />

  function runSearch() {
    if (!query.trim()) return
    setSubmitted({ q: query.trim(), from, to })
  }

  return (
    <div className="space-y-4">
      <ActivityPageHeader
        title="屏幕记忆"
        subtitle={
          status
            ? enabled
              ? `已截 ${status.shotsCount} 张 · OCR 成功 ${status.ocrOk} / 失败 ${status.ocrFail} · 保留 ${status.retentionDays} 天`
              : '功能未开启'
            : ''
        }
        demo={demo || searchDemo}
      />

      {!statusQ.data ? (
        <Skeleton className="h-40 w-full" />
      ) : !enabled ? (
        /* 未开启：引导空态（对齐 AI 页引导卡水准）——图标+说明+开关入口在下方设置卡 */
        <Card>
          <EmptyState
            icon={<Camera size={30} />}
            title="屏幕记忆未开启"
            desc={
              <>
                开启后会按固定间隔截取全屏并识别文字，之后就能搜「屏幕上出现过的内容」并跳回那一刻。
                <br />
                默认关闭；截图与文字只存被控机本地；隐私规则命中的时刻不截屏；超过保留期自动删除。
              </>
            }
            action={
              <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                <Camera size={14} /> 在下方「采集设置」里开启
              </span>
            }
          />
        </Card>
      ) : (
        /* 检索卡 */
        <Card>
          <SectionTitle icon={<Search size={16} />} title="文字检索" desc="搜屏幕上出现过的内容，跳到截图与时刻。" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="输入关键词，如 项目名、报错信息…"
              className="h-10 min-w-[220px] flex-1"
            />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-40" aria-label="开始日期" />
            <span className="text-[12px] text-faint">至</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-40" aria-label="结束日期" />
            <Button size="md" variant="primary" icon={<Search size={15} />} onClick={runSearch} disabled={!query.trim()}>
              检索
            </Button>
          </div>

          <div className="mt-4">
            {!submitted?.q ? (
              <p className="py-8 text-center text-[12.5px] text-muted">输入关键词开始检索（支持截图中出现过的任意文字）。</p>
            ) : searchQ.loading && !results ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : searchQ.error ? (
              <p className="py-6 text-center text-[12.5px] text-danger">{String(searchQ.error)}</p>
            ) : !results || results.items.length === 0 ? (
              <p className="py-8 text-center text-[12.5px] text-muted">
                这个时间段没有命中「{submitted.q}」。试试放宽日期范围。
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {results.items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => setLightbox(it)}
                      className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-elevated/60"
                    >
                      <MemoryThumb target={device} token={device.token} id={it.id} alt={`${it.app} 的屏幕截图`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-[13px] font-medium text-fg">{it.app}</span>
                          <span className="num shrink-0 text-[11px] text-faint">{timeLabel(it.ts)}</span>
                          <span className="num shrink-0 text-[11px] text-faint">{relative(new Date(it.ts).toISOString())}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                          <Highlight text={it.snippet} query={submitted.q} />
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {/* 设置卡：未开启时是「引导 + 开关」，开启后是参数与统计 */}
      <MemorySettingsCard
        device={device}
        status={status ?? null}
        demo={demo}
        onChanged={() => {
          statusQ.reload()
          // 搜索结果与开关状态相关：开关变化后旧结果作废（下次检索自然重拉）
          setSubmitted(null)
        }}
      />

      {/* 点击结果 → 大图查看（gallery 用内存 URL 即可，缩略图已验证可加载） */}
      {lightbox && (
        <MemoryLightbox item={lightbox} device={device} theme={theme} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

/** 大图查看：点击结果行打开原图（复用同一端点，浏览器缓存兜底）。 */
function MemoryLightbox({
  item,
  device,
  theme,
  onClose,
}: {
  item: MemorySearchItem
  device: { host: string; port: number; tls: boolean; token?: string }
  theme: 'dark' | 'light'
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${item.app} 的屏幕截图`}
      onClick={onClose}
      className={
        'fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 p-6 ' +
        (theme === 'dark' ? 'bg-black/80' : 'bg-black/60')
      }
    >
      <img
        src={memoryImageUrl(device, device.token, item.id)}
        alt={`${item.app} 的屏幕截图`}
        className="max-h-[78vh] max-w-[92vw] rounded-xl border border-line-soft object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className={'rounded-xl px-4 py-2 text-[13px] text-white ' + (theme === 'dark' ? 'bg-black/60' : 'bg-black/50')}>
        {item.app} · {timeLabel(item.ts)} · 命中「{item.snippet.slice(0, 24)}…」 · 点击任意处关闭
      </div>
    </div>
  )
}
