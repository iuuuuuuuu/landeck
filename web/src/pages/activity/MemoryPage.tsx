import { useState } from 'react'
import { Camera, Search } from 'lucide-react'
import { Button, Card, EmptyState, Input, SectionTitle, Skeleton } from '../../components/ui'
import { useAsync } from '../../lib/hooks'
import { memorySearchKey, memoryStatusKey } from '../../lib/activityKeys'
import { fetchMemorySearch, fetchMemoryStatus, memoryImageUrl } from '../../lib/activityApi'
import type { MemorySearchItem } from '../../lib/activityApi'
import { Highlight, MemoryThumb } from '../../components/memory/MemoryBits'
import { useTheme, type ThemeName } from '../../store/theme'
import { useT } from '../../i18n'
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
  const t = useT('memory')
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
        title={t("title")}
        subtitle={
          status
            ? enabled
              ? t('status.summary', { shots: status.shotsCount, ok: status.ocrOk, fail: status.ocrFail, days: status.retentionDays })
              : t('status.disabled')
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
            title={t("guide.title")}
            desc={
              <>
                {t("guide.desc1")}
                <br />
                {t("guide.desc2")}
              </>
            }
            action={
              <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                <Camera size={14} /> {t("guide.openInSettings")}
              </span>
            }
          />
        </Card>
      ) : (
        /* 检索卡 */
        <Card>
          <SectionTitle icon={<Search size={16} />} title={t("search.title")} desc={t("search.desc")} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder={t("search.placeholder")}
              className="h-10 min-w-[220px] flex-1"
            />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-40" aria-label={t("search.from")} />
            <span className="text-[12px] text-faint">{t("search.to")}</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 w-40" aria-label={t("search.to")} />
            <Button size="md" variant="primary" icon={<Search size={15} />} onClick={runSearch} disabled={!query.trim()}>
              {t("search.button")}
            </Button>
          </div>

          <div className="mt-4">
            {!submitted?.q ? (
              <p className="py-8 text-center text-[12.5px] text-muted">{t("search.emptyInitial")}</p>
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
                {t("search.noHit", { q: submitted.q })}
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
                      <MemoryThumb target={device} token={device.token} id={it.id} alt={t("search.screenshotAlt", { app: it.app })} />
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
  theme: ThemeName
  onClose: () => void
}) {
  const t = useT('memory')
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("search.screenshotAlt", { app: item.app })}
      onClick={onClose}
      className={
        'fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 p-6 ' +
        (theme === 'dark' ? 'bg-black/80' : 'bg-black/60')
      }
    >
      <img
        src={memoryImageUrl(device, device.token, item.id)}
        alt={t("search.screenshotAlt", { app: item.app })}
        className="max-h-[78vh] max-w-[92vw] rounded-xl border border-line-soft object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className={'rounded-xl px-4 py-2 text-[13px] text-white ' + (theme === 'dark' ? 'bg-black/60' : 'bg-black/50')}>
        {item.app} · {timeLabel(item.ts)} · {t("lightbox.meta", { app: item.app, time: timeLabel(item.ts), snippet: item.snippet.slice(0, 24) })}
      </div>
    </div>
  )
}
