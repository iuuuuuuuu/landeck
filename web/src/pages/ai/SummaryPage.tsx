import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, Copy, Download, FileText, History, Loader2, Sparkles } from 'lucide-react'
import { Badge, Button, Card, SectionTitle, Segmented, Skeleton } from '../../components/ui'
import { DateNav, PageHeader } from '../../components/shell'
import { aiReportContentKey, aiReportsKey, aiSummaryKey } from '../../lib/aiKeys'
import { useAsync } from '../../lib/hooks'
import { fetchAiReports, fetchReportContent, generateSummary, type ReportMeta, type SummaryScope } from '../../lib/aiApi'
import { invalidateCache, readCache, writeCache } from '../../lib/queryCache'
import { relative } from '../../lib/format'
import { useApp } from '../../store/app'
import { useActiveTarget } from '../../lib/useActiveTarget'
import { useT } from '../../i18n'
import { AiErrorCard, AiNoDeviceGuide, DemoBadge, MiniMarkdown } from './shared'

/**
 * AI 总结 /ai/summary。
 *
 * 范围（日/周/月）+ 日期翻页 →「生成总结」。生成是 POST 动作不进请求缓存，
 * 但结果按 (设备, scope, date) 落 queryCache（12h）——重进页面直接回显上次的
 * 总结，「重新生成」永远可用。404 → mock 演示文案 + 徽标；
 * ai_not_configured → 引导卡（唯一修复入口在 AI 设置页）。
 */

const SCOPES: { value: SummaryScope; labelKey: string }[] = [
  { value: 'day', labelKey: 'summary.day' },
  { value: 'week', labelKey: 'summary.week' },
  { value: 'month', labelKey: 'summary.month' },
]

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 周锚点归一到周一（agent 侧「周内任一天返回整周」，归一让翻页与标签稳定） */
function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(scope: SummaryScope, date: string, n: number): string {
  if (scope === 'month') return addMonths(date, n)
  if (scope === 'week') return addDays(mondayOf(date), n * 7)
  return addDays(date, n)
}

function labelFor(scope: SummaryScope, date: string): string {
  const d = new Date(`${date}T12:00:00`)
  if (Number.isNaN(d.getTime())) return date
  if (scope === 'month') return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
  if (scope === 'week') {
    const end = new Date(d)
    end.setDate(end.getDate() + 6)
    const fmt = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}`
    return `${fmt(d)} ~ ${fmt(end)}`
  }
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${wd}`
}

interface SummaryResult {
  content: string
  demo: boolean
}

export default function AiSummaryPage() {
  const t = useT('ai')
  const toast = useApp((s) => s.toast)
  const { device, pairedCount, localAvailable } = useActiveTarget()
  const dev = device ?? null

  const [scope, setScope] = useState<SummaryScope>('day')
  const [date, setDate] = useState(todayStr())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [copied, setCopied] = useState(false)
  const [content, setContent] = useState<SummaryResult | null>(null)

  // 切范围/日期：先铺缓存里的上次结果（12h 内有效），没有就回到引导态
  useEffect(() => {
    setError(null)
    // readCache 返回 { data, fresh } 包装，取 .data
    // 落盘缓存是持久数据，读回来不信任其形状：旧版本写入过 {content:undefined}
      // （aiApi 契约漂移期间），直接渲染会在 MiniMarkdown 里炸。非法形状当没有缓存。
      const cached = dev ? (readCache<SummaryResult>(aiSummaryKey(dev, scope, date))?.data ?? null) : null
      setContent(cached && typeof cached.content === 'string' ? cached : null)
  }, [dev, scope, date])

  const generate = useCallback(async () => {
    if (!dev) return
    setPending(true)
    setError(null)
    try {
      const r = await generateSummary(dev, dev.token, { scope, date })
      setContent({ content: r.data, demo: r.demo })
      // 结果落缓存：重进页面直接回显，不重复烧 token
      writeCache(aiSummaryKey(dev, scope, date), { content: r.data, demo: r.demo }, 12 * 60 * 60_000)
      // 生成成功（agent 会把它存进报告库）→ 失效历史列表，让新报告出现在顶部。
      // mock 模式（demo=true）没有真报告库，不刷。
      if (!r.demo) {
        invalidateCache(aiReportsKey(dev))
        reports.reload()
      }
    } catch (e) {
      setError(e)
    } finally {
      setPending(false)
    }
  }, [dev, scope, date])

  // 报告历史（七期）：生成的日报/周报会进 agent 的报告库，这里列出来供回看。
  // 60s TTL——生成成功后会主动失效重拉，让新报告出现在顶部。
  const reports = useAsync<{ list: ReportMeta[]; demo: boolean }>(
    dev ? () => fetchAiReports(dev, dev.token, 30).then((r) => ({ list: r.data, demo: r.demo })) : null,
    [dev?.host, dev?.port, dev?.token],
    { key: dev ? aiReportsKey(dev) : undefined, ttlMs: 60_000 },
  )
  const [openingId, setOpeningId] = useState<string | null>(null)

  const openReport = useCallback(
    async (m: ReportMeta) => {
      if (!dev) return
      setOpeningId(m.id)
      setError(null)
      try {
        // 内容缓存：重复点击同一份报告不发请求
        const cached = readCache<{ content: string; demo: boolean }>(aiReportContentKey(dev, m.id))
        const fetched = await fetchReportContent(dev, dev.token, m.id)
        const r = cached ?? { content: fetched.data.content, demo: fetched.demo }
        writeCache(aiReportContentKey(dev, m.id), r, 12 * 60 * 60_000)
        // 内容写进 summary 缓存再切 scope/date：让「切范围/日期」的 effect 正常
        // 接管视图（复制/下载的工具条也自动带上正确的 scope/date 语境）。
        writeCache(aiSummaryKey(dev, m.type, m.date), r, 12 * 60 * 60_000)
        setScope(m.type)
        setDate(m.date)
      } catch (e) {
        setError(e)
      } finally {
        setOpeningId(null)
      }
    },
    [dev],
  )

  const copy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast({ kind: 'error', title: t('summary.copyFailed'), desc: t('summary.clipboardDenied') })
    }
  }, [content, toast])

  const download = useCallback(() => {
    if (!content) return
    const blob = new Blob([content.content], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `landeck-ai-${scope}-${date}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [content, scope, date])

  if (!localAvailable && pairedCount === 0) return <AiNoDeviceGuide />

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("summary.title")}
        sub={t("summary.subtitle")}
        actions={content?.demo ? <DemoBadge /> : undefined}
      />

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Segmented
              value={scope}
              onChange={(v) => setScope(v as SummaryScope)}
              options={SCOPES.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            />
          <DateNav
            label={labelFor(scope, date)}
            onPrev={() => setDate((d) => shiftDate(scope, d, -1))}
            onNext={() => setDate((d) => shiftDate(scope, d, 1))}
            onCurrent={() => setDate(todayStr())}
          />
        </div>

        {pending ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 size={26} className="animate-spin text-accent" />
            <p className="text-[12.5px] text-muted">
              正在生成，本地模型可能需要几十秒
              <span className="text-faint">{t("summary.cached")}</span>
            </p>
          </div>
        ) : error ? (
          <AiErrorCard error={error} onRetry={() => void generate()} />
        ) : content ? (
          <>
            <div className="min-w-0 rounded-2xl border border-line-soft bg-surface px-4 py-3">
              <MiniMarkdown text={content.content} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()}>
                  {copied ? t('summary.copied') : t('summary.copyAll')}
                </Button>
                <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={download}>
                  {t("summary.downloadMd")}
                </Button>
              </div>
              <Button size="sm" variant="primary" icon={<Sparkles size={14} />} onClick={() => void generate()}>
                {t("summary.regenerate")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16">
            <FileText size={26} className="text-faint" />
            <p className="text-[12.5px] text-muted">
              {t('summary.emptyCta', { scope: scope === 'day' ? t('summary.scopeDay') : scope === 'week' ? t('summary.scopeWeek') : t('summary.scopeMonth') })}
            </p>
            <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => void generate()}>
              生成总结
            </Button>
          </div>
        )}
      </Card>

      {/* 报告历史（七期）：点击加载进上方查看器，复制/导出复用同一工具条 */}
      <Card className="p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionTitle icon={<History size={16} />} title={t("summary.history")} desc={t("summary.historyDesc")} />
          {reports.data?.demo ? <Badge tone="cyan">{t("summary.demoBadge")}</Badge> : undefined}
        </div>
        {reports.loading && !reports.data ? (
          <div className="space-y-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-2/3" />
          </div>
        ) : reports.error && !reports.data ? (
          <p className="text-[12px] text-danger">{t("summary.historyError")}{String(reports.error)}</p>
        ) : (reports.data?.list ?? []).length === 0 ? (
          <p className="rounded-xl border border-line-soft bg-elevated px-3 py-3 text-[12px] text-muted">
            {t("summary.historyEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {(reports.data?.list ?? []).map((m: ReportMeta) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={openingId === m.id}
                  onClick={() => void openReport(m)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-elevated disabled:opacity-60"
                >
                  <Badge tone={m.type === 'day' ? 'accent' : 'cyan'} className="shrink-0">
                    {m.type === 'day' ? t('summary.day') : t('summary.week')}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="num block truncate text-[13px] text-fg">{m.date}</span>
                    <span className="num block text-[11px] text-faint">{t("summary.generatedAt", { when: relative(m.generatedAt) })}</span>
                  </span>
                  {openingId === m.id ? (
                    <Loader2 size={14} className="shrink-0 animate-spin text-muted" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-faint" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
