/**
 * AI 功能 API 客户端 + mock 降级（注释纪律对齐 activityApi.ts）。
 *
 * 契约（agent-ai 批实现，随 1.0.19 上线）：
 *   GET  /ai/settings → {provider, baseURL, model, hasKey, keyTail, enabled}
 *   PUT  /ai/settings 部分更新 {provider?, baseURL?, model?, apiKey?, clearKey?, enabled?}
 *                     → 更新后的完整 settings（同 GET 形状）
 *   POST /ai/chat     {messages: [{role, content}]} → {content}（非流式，整段返回）
 *   POST /ai/summary  {scope: 'day'|'week'|'month', date} → {content}（markdown 文本）
 *
 * 错误语义（两层，页面必须分流）：
 *   - 404/501：agent 版本过老，没有这组路由（< 1.0.19）。设置页显示「需要 1.0.19+」
 *     横幅；chat/summary 切 mock 演示数据（isNotImplemented，与 activityApi 同策略）。
 *   - code=ai_not_configured：路由在但该设备没配 AI（settings 页是唯一修复入口）。
 *     **不 mock** —— 那是真状态，mock 会把「去配置」的引导骗没。聊天/总结页把它
 *     渲染成带跳转链接的引导卡。
 *
 * 为什么不用 AgentClient：与 activityApi 同因——它的 req() 是 private，
 * 不为 AI 页改公共客户端可见性；这里复用导出的 baseUrl/ApiError 保住错误语义。
 */
import { ApiError, baseUrl } from './api'
import type { Target } from './api'

export type AiProvider = 'openai' | 'ollama'
export type SummaryScope = 'day' | 'week' | 'month'

export interface AiSettings {
  /** openai 兼容端点（含各类聚合 API）或本地 ollama */
  provider: AiProvider
  /** openai 形如 https://api.openai.com/v1；ollama 形如 http://127.0.0.1:11434 */
  baseURL: string
  model: string
  /** 是否已存密钥（响应永不回传明文） */
  hasKey: boolean
  /** 已存密钥的尾 4 位，用于表单回显「已保存（尾号 …）」 */
  keyTail: string
  enabled: boolean
}

/** 保存用的部分更新体；apiKey 只在用户本轮输入了新值时带，clearKey 单独发 */
export interface AiSettingsPatch {
  provider?: AiProvider
  baseURL?: string
  model?: string
  apiKey?: string
  clearKey?: boolean
  enabled?: boolean
}

export interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface WithDemo<T> {
  demo: boolean
  data: T
}

function isNotImplemented(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 501)
}

/** 路由在但 AI 未配置（settings 页是唯一修复入口）。 */
export function isAiNotConfigured(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'ai_not_configured'
}

async function req<T>(
  t: Target,
  token: string | undefined,
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const ctrl = new AbortController()
  // LLM 调用天然慢（本地模型小机器上几十秒很常见），超时给足 90s——
  // 比 agent 侧代理上游的超时更长，让错误先来自上游而不是前端瞎猜。
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000)
  try {
    const res = await fetch(`${baseUrl(t)}${path}`, {
      method: opts.method ?? 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    if (!res.ok) {
      const p = parsed as { error?: string; message?: string } | null
      throw new ApiError(p?.error ?? `HTTP ${res.status}`, p?.message ?? p?.error ?? `HTTP ${res.status}`, res.status)
    }
    return parsed as T
  } finally {
    clearTimeout(timer)
  }
}

// ---------- mock（确定性，自审与演示用）----------

function seedOf(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const MOCK_CHAT_REPLIES = [
  `## 今天的时间去哪了\n\n根据本机活动记录：\n\n- **编程** 占了大头，集中在上午 9 点到 12 点\n- 下午的 **浏览** 时段里，最常打开的是文档类网站\n- 晚间有一段 **影音** 时间\n\n想要更细的分时段说明，可以在「AI 总结」里生成日报。`,
  `## 本周概况\n\n- 活跃天数 5 天，日均约 6 小时\n- 最常用的三个应用：Code、chrome、Windows Terminal\n- 分类占比：编程 52%、浏览 21%、沟通 14%、其余 13%\n\n这只是演示回答——在设置页配置模型后，回答会基于你的**真实**活动记录生成。`,
  `这个问题我需要更多上下文。你可以这样问：\n\n1. 「这周我在哪个项目上花的时间最多？」\n2. 「今天比昨天多用了多久？」\n3. 「帮我总结一下昨天的工作」\n\n（演示模式：配置模型后即可基于真实记录回答。）`,
]

function mockChatReply(messages: ChatMsg[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const seed = seedOf(lastUser?.content ?? 'ping')
  return MOCK_CHAT_REPLIES[seed % MOCK_CHAT_REPLIES.length]
}

function mockSummary(p: { scope: SummaryScope; date: string }): string {
  const scopeLabel = p.scope === 'day' ? '日报' : p.scope === 'week' ? '周报' : '月报'
  return `# ${scopeLabel}（${p.date}）\n\n## 概览\n\n今天总计 **5 小时 12 分**，比前一天多 23 分钟。\n\n## 分时段\n\n- **上午**：编程为主（Code 2h 10m），期间穿插了 3 次文档检索\n- **午后**：浏览与沟通穿插，微信和 Telegram 合计 41 分钟\n- **晚间**：影音 1 小时（PotPlayer + 网易云音乐）\n\n## 值得注意\n\n- 连续专注最长的一段是 10:00–11:47，没有切出开发工具\n- 「其他」类占比偏高（explorer 18 分钟），多为文件整理\n\n---\n\n*演示数据：在「AI 设置」里配置模型后，将基于你的真实活动记录生成。*`
}

// ---------- 真实请求 ----------

/** 读 AI 设置。404 由调用方分流（设置页显示版本横幅）。 */
export async function fetchAiSettings(t: Target, token: string | undefined): Promise<AiSettings> {
  return req<AiSettings>(t, token, '/ai/settings', { timeoutMs: 15000 })
}

/** 部分更新 AI 设置，返回更新后的完整形状。 */
export async function putAiSettings(t: Target, token: string | undefined, patch: AiSettingsPatch): Promise<AiSettings> {
  return req<AiSettings>(t, token, '/ai/settings', { method: 'PUT', body: patch, timeoutMs: 15000 })
}

/** 发起对话。404 → mock；ai_not_configured → 原样抛给页面渲染引导卡。 */
export async function sendChat(t: Target, token: string | undefined, messages: ChatMsg[]): Promise<WithDemo<string>> {
  try {
    const r = await req<{ content: string }>(t, token, '/ai/chat', { method: 'POST', body: { messages }, timeoutMs: 120_000 })
    return { demo: false, data: r.content }
  } catch (e) {
    if (isNotImplemented(e)) return { demo: true, data: mockChatReply(messages) }
    throw e
  }
}

/** 生成总结（markdown）。404 → mock；ai_not_configured → 原样抛。 */
export async function generateSummary(
  t: Target,
  token: string | undefined,
  p: { scope: SummaryScope; date: string },
): Promise<WithDemo<string>> {
  try {
    // agent-ai 实现返回 {markdown}；契约文本写的是 {content}。两边都容，防再漂移。
    const r = await req<{ content?: string; markdown?: string }>(t, token, '/ai/summary', {
      method: 'POST',
      body: { scope: p.scope, date: p.date },
      timeoutMs: 180_000,
    })
    return { demo: false, data: r.content ?? r.markdown ?? '' }
  } catch (e) {
    if (isNotImplemented(e)) return { demo: true, data: mockSummary(p) }
    throw e
  }
}
