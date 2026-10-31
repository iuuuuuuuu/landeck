import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, FileText, Loader2, Sparkles } from 'lucide-react'
import { Button, Card, Segmented } from '../../components/ui'
import { DateNav, PageHeader } from '../../components/shell'
import { aiSummaryKey } from '../../lib/aiKeys'
import { generateSummary, type SummaryScope } from '../../lib/aiApi'
import { readCache, writeCache } from '../../lib/queryCache'
import { useApp } from '../../store/app'
import { useActiveTarget } from '../../lib/useActiveTarget'
import { AiErrorCard, AiNoDeviceGuide, DemoBadge, MiniMarkdown } from './shared'

/**
 * AI 总结 /ai/summary。
 *
 * 范围（日/周/月）+ 日期翻页 →「生成总结」。生成是 POST 动作不进请求缓存，
 * 但结果按 (设备, scope, date) 落 queryCache（12h）——重进页面直接回显上次的
 * 总结，「重新生成」永远可用。404 → mock 演示文案 + 徽标；
 * ai_not_configured → 引导卡（唯一修复入口在 AI 设置页）。
 */

const SCOPES: { value: SummaryScope; label: string }[] = [
  { value: 'day', label: '日报' },
  { value: 'week', label: '周报' },
  { value: 'month', label: '月报' },
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
    } catch (e) {
      setError(e)
    } finally {
      setPending(false)
    }
  }, [dev, scope, date])

  const copy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast({ kind: 'error', title: '复制失败', desc: '浏览器拒绝了剪贴板权限' })
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
        title="AI 总结"
        sub="由被控端的模型基于本机活动记录生成"
        actions={content?.demo ? <DemoBadge /> : undefined}
      />

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Segmented value={scope} onChange={(v) => setScope(v as SummaryScope)} options={SCOPES} />
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
              <span className="text-faint">（结果会留在缓存里，切页再回来不用重新生成）</span>
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
                  {copied ? '已复制' : '复制全文'}
                </Button>
                <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={download}>
                  下载 .md
                </Button>
              </div>
              <Button size="sm" variant="primary" icon={<Sparkles size={14} />} onClick={() => void generate()}>
                重新生成
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16">
            <FileText size={26} className="text-faint" />
            <p className="text-[12.5px] text-muted">
              点击下方按钮，让模型把{scope === 'day' ? '今天' : scope === 'week' ? '本周' : '本月'}的活动整理成一份总结
            </p>
            <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => void generate()}>
              生成总结
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
