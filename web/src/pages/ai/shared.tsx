import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { Badge, Button, Card, EmptyState } from '../../components/ui'
import { LOCAL_DOWN_HINT } from '../../lib/useActiveTarget'
import { isAiNotConfigured } from '../../lib/aiApi'

/**
 * AI 三页的共享件。页面骨架件尽量复用别处已有的（NoDeviceGuide 的口径与
 * activity/shared 一致；PageHeader/DateNav 用 components/shell 的通用版），
 * 这里只放 AI 特有的两块：未配置引导卡和最小 markdown 渲染。
 */

/** ai_not_configured：路由在但没配模型——引导去设置页，这是唯一修复入口。 */
export function AiNotConfiguredCard({ error }: { error: unknown }) {
  return (
    <Card>
      <EmptyState
        icon={<Bot size={28} />}
        title="这台设备还没有配置 AI"
        desc={
          (error instanceof Error && error.message) ||
          '在「AI 设置」里选择本地模型（Ollama）或云端 API 后即可使用。'
        }
        action={
          <Link to="/ai/settings">
            <Button size="sm" variant="primary">
              去配置 AI
            </Button>
          </Link>
        }
      />
    </Card>
  )
}

/** 错误分流：ai_not_configured 走引导卡，其余走通用错误卡。 */
export function AiErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isAiNotConfigured(error)) return <AiNotConfiguredCard error={error} />
  return (
    <Card>
      <EmptyState
        title="请求失败"
        desc={error instanceof Error ? error.message : String(error ?? '')}
        action={
          onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              重试
            </Button>
          )
        }
      />
    </Card>
  )
}

/** 手机上一台设备都没有时的引导态（口径与 activity/shared 一致）。 */
export function AiNoDeviceGuide() {
  return (
    <Card>
      <EmptyState title="还没有可用的设备" desc={LOCAL_DOWN_HINT + ' AI 按设备工作：配对一台电脑后，由它的被控端调用模型。'} />
    </Card>
  )
}

// ---------- 最小 markdown 渲染 ----------
//
// 为什么不装 react-markdown：整个项目至今只有 runtime 依赖必需品，为 AI 页
// 引入 markdown 解析器 + 生态（remark 系列）要抬 200KB+ 依赖。AI 的输出
// 场景很收敛（日报/回答的段落、标题、列表、少量强调），一个 ~70 行的
// 块级渲染器够用；**安全性**：全部走 React 元素拼接，不用
// dangerouslySetInnerHTML，LLM 输出里的任何 HTML 都只会被当纯文本显示。
//
// 支持范围（超出范围按段落渲染，绝不丢内容）：
//   - 标题 # / ## / ###
//   - 无序列表 - / *，有序列表 1.
//   - 分割线 ---，引用 >
//   - 行内：**粗体**、`代码`
// 不支持：表格、图片、链接语法（链接会按原文显示——故意不解析，避免
// 模型输出被当成可点击入口）。

function renderInline(text: string, keyBase: string): ReactNode[] {
  // 先按 `code` 切开（代码段内不解析粗体），再对普通段做 **bold**
  const parts = text.split(/(`[^`]+`)/g)
  return parts.flatMap((part, pi) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return [
        <code key={`${keyBase}-c${pi}`} className="num rounded bg-elevated px-1 py-0.5 text-[12px] text-fg">
          {part.slice(1, -1)}
        </code>,
      ]
    }
    const bolds = part.split(/(\*\*[^*]+\*\*)/g)
    return bolds.map((b, bi) => {
      if (b.startsWith('**') && b.endsWith('**') && b.length >= 4) {
        return (
          <strong key={`${keyBase}-b${pi}-${bi}`} className="font-semibold text-fg">
            {b.slice(2, -2)}
          </strong>
        )
      }
      return b
    })
  })
}

export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushList = (key: string) => {
    if (!list) return
    const L = list
    blocks.push(
      L.ordered ? (
        <ol key={key} className="my-1.5 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-fg-soft">
          {L.items.map((it, i) => (
            <li key={i}>{renderInline(it, `${key}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="my-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-fg-soft">
          {L.items.map((it, i) => (
            <li key={i}>{renderInline(it, `${key}-${i}`)}</li>
          ))}
        </ul>
      ),
    )
    list = null
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    const key = `md-${i}`
    const ul = /^[-*]\s+(.*)$/.exec(line)
    const ol = /^(\d+)[.)]\s+(.*)$/.exec(line)
    if (ul) {
      if (!list || list.ordered) flushList(`${key}-l`)
      list = list ?? { ordered: false, items: [] }
      list.items.push(ul[1])
      return
    }
    if (ol) {
      if (!list || !list.ordered) flushList(`${key}-l`)
      list = list ?? { ordered: true, items: [] }
      list.items.push(ol[2])
      return
    }
    flushList(`${key}-l`)
    if (!line.trim()) return
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      const size = level === 1 ? 'text-[16px]' : level === 2 ? 'text-[14.5px]' : 'text-[13.5px]'
      blocks.push(
        <p key={key} className={`mt-3 mb-1 font-semibold text-fg first:mt-0 ${size}`}>
          {renderInline(h[2], key)}
        </p>,
      )
      return
    }
    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      blocks.push(<hr key={key} className="my-3 border-line-soft" />)
      return
    }
    const q = /^>\s?(.*)$/.exec(line)
    if (q) {
      blocks.push(
        <blockquote key={key} className="my-1.5 border-l-2 border-line-soft pl-3 text-[12.5px] text-muted">
          {renderInline(q[1], key)}
        </blockquote>,
      )
      return
    }
    blocks.push(
      <p key={key} className="my-1.5 text-[13px] leading-relaxed text-fg-soft">
        {renderInline(line, key)}
      </p>,
    )
  })
  flushList('md-end')

  return <div className="min-w-0">{blocks}</div>
}

export function DemoBadge() {
  return (
    <Badge tone="cyan">
      演示数据
    </Badge>
  )
}
