import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, CornerDownLeft, Loader2, User } from 'lucide-react'
import { Button, Card } from '../../components/ui'
import { PageHeader } from '../../components/shell'
import { aiChatSessionKey } from '../../lib/aiKeys'
import { isAiNotConfigured, sendChat, type ChatMsg } from '../../lib/aiApi'
import { invalidateCache, readCache, writeCache } from '../../lib/queryCache'
import { useActiveTarget } from '../../lib/useActiveTarget'
import { AiErrorCard, AiNoDeviceGuide, DemoBadge, MiniMarkdown } from './shared'

/**
 * AI 对话 /ai/chat。
 *
 * 会话历史存组件 state，每次收发后整段写 queryCache（key 带设备身份维度，
 * TTL 24h）——切页回来接上上一段对话，重启即清（prompt 上下文本来也得重给）。
 * 「回答基于本机活动记录」的说明放页头副标题，别让用户以为在跟通用模型聊天。
 *
 * ai_not_configured：输入区禁用 + 引导卡（修复入口唯一，在 AI 设置页）；
 * 404（agent 过老）：mock 回复 + 演示徽标，保住页面可自审。
 */
export default function AiChatPage() {
  const { device, pairedCount, localAvailable } = useActiveTarget()
  const dev = device ?? null

  // readCache 返回 { data, fresh } 包装，取 .data
  const [messages, setMessages] = useState<ChatMsg[]>(() => (device ? (readCache<ChatMsg[]>(aiChatSessionKey(device))?.data ?? []) : []))
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [lastDemo, setLastDemo] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 会话落缓存（24h）：key 带设备身份，换设备自然各聊各的
  useEffect(() => {
    if (!dev || messages.length === 0) return
    writeCache(aiChatSessionKey(dev), messages, 24 * 60 * 60_000)
  }, [dev, messages])

  // 消息增长/新增时滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || !dev || pending) return
      const userMsg: ChatMsg = { role: 'user', content }
      const next = [...messages, userMsg]
      setMessages(next)
      setInput('')
      setPending(true)
      setError(null)
      try {
        const r = await sendChat(dev, dev.token, next)
        setLastDemo(r.demo)
        setMessages([...next, { role: 'assistant', content: r.data }])
      } catch (e) {
        if (isAiNotConfigured(e)) {
          setError(e)
          // 把用户消息留在列表里——配置好后重发就是原话
        } else {
          setError(e)
        }
      } finally {
        setPending(false)
      }
    },
    [dev, messages, pending],
  )

  const retry = useCallback(async () => {
    setError(null)
    if (messages.length > 0) await send(messages[messages.length - 1].role === 'user' ? messages[messages.length - 1].content : '')
  }, [messages, send])

  if (!localAvailable && pairedCount === 0) return <AiNoDeviceGuide />

  const notConfigured = error !== null && isAiNotConfigured(error)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="AI 对话"
        sub="回答基于本机的活动记录——问「这周时间花在哪」「昨天在忙什么」这类问题最合适"
        actions={lastDemo && messages.length > 0 ? <DemoBadge /> : undefined}
      />

      <Card className="flex h-[calc(100vh-260px)] min-h-[380px] flex-col p-0">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !pending && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Bot size={30} className="text-faint" />
              <p className="text-[13px] text-fg-soft">问点什么吧</p>
              <div className="flex flex-wrap justify-center gap-2">
                {['这周我的时间花在哪了？', '今天和昨天比怎么样？', '我最常用的应用是什么？'].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setInput(q)}
                    className="rounded-full border border-line-soft bg-elevated px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-fg-soft"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={'flex items-start gap-2.5 ' + (m.role === 'user' ? 'flex-row-reverse' : '')}>
              <div
                className={
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ' +
                  (m.role === 'user' ? 'bg-accent/[0.14] text-accent' : 'bg-elevated text-fg-soft')
                }
              >
                {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
              </div>
              <div
                className={
                  'max-w-[82%] min-w-0 rounded-2xl px-3.5 py-2.5 ' +
                  (m.role === 'user' ? 'rounded-tr-md bg-accent/[0.10]' : 'rounded-tl-md bg-elevated')
                }
              >
                {m.role === 'assistant' ? <MiniMarkdown text={m.content} /> : <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{m.content}</p>}
              </div>
            </div>
          ))}

          {pending && (
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-elevated text-fg-soft">
                <Bot size={14} />
              </div>
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-elevated px-3.5 py-3 text-[12px] text-muted">
                <Loader2 size={14} className="animate-spin" />
                正在基于活动记录思考…
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-line-soft p-3">
          {notConfigured ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan/30 bg-cyan/[0.08] px-3 py-2.5 text-[12px] text-cyan">
              <span>这台设备还没有配置 AI 模型。</span>
              <Link to="/ai/settings">
                <Button size="sm" variant="secondary">
                  去配置
                </Button>
              </Link>
            </div>
          ) : error ? (
            <div className="mb-2">
              <AiErrorCard error={error} onRetry={() => void retry()} />
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter 发送、Shift+Enter 换行：聊天输入的最小惯例
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              rows={1}
              placeholder={notConfigured ? '先到「AI 设置」里配置模型…' : '问问你的活动记录，Enter 发送，Shift+Enter 换行'}
              disabled={pending || notConfigured}
              className="max-h-32 min-h-[42px] min-w-0 flex-1 resize-y rounded-xl border border-line-soft bg-elevated px-3.5 py-2.5 text-[13px] text-fg placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-60"
            />
            <Button variant="primary" icon={<CornerDownLeft size={14} />} loading={pending} disabled={notConfigured || !input.trim()} onClick={() => void send(input)}>
              发送
            </Button>
          </div>
        </div>
      </Card>

      {messages.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-[11px] text-faint">会话保存在本机内存（24 小时），不会上传。</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setMessages([])
              setLastDemo(false)
              if (dev) invalidateCache(aiChatSessionKey(dev))
            }}
          >
            清空会话
          </Button>
        </div>
      )}
    </div>
  )
}
