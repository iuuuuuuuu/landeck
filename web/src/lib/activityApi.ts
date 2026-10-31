/**
 * 活动统计 API 客户端 + mock 降级。
 *
 * 契约见 docs/design/hindsight-revamp-phase1.md 第 5 节；对应 agent-activity 批的实现。
 * 在 agent 侧接口上线前（404/501），这里返回**确定性** mock 数据并带 demo 标记，
 * 页面据此显示「演示数据」徽标 —— 好处是统计页不依赖 agent 批的进度就能实机自审，
 * agent 上线后同一份代码自动切真数据。
 *
 * mock 为什么必须确定性：按日期字符串做种子，同一天刷新看到的数字一致，
 * 否则自审截图前后对不上，也没法向 Owner 汇报"这个数字是构造出来的哪部分"。
 */
import { ApiError, baseUrl } from './api'
import type { Target } from './api'

/** 活动类别。顺序即展示顺序，也是堆叠柱的自下而上顺序。 */
export type CatKey =
  | 'coding'
  | 'office'
  | 'chat'
  | 'browsing'
  | 'social'
  | 'media'
  | 'games'
  | 'other'
export const CATEGORIES: { key: CatKey; label: string }[] = [
  { key: 'coding', label: '编程' },
  { key: 'office', label: '办公' },
  { key: 'chat', label: '沟通' },
  { key: 'browsing', label: '浏览' },
  { key: 'social', label: '社交' },
  { key: 'media', label: '影音' },
  { key: 'games', label: '游戏' },
  { key: 'other', label: '其他' },
]

export const CAT_LABEL: Record<CatKey, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.label]),
) as Record<CatKey, string>

/**
 * 类别色板。spec 第 3 节定义的浅色值；web-shell 会在 index.css 里定义
 * --ldk-cat-* 八色（深浅主题各一套），这里运行时读取，读不到（token 未就绪/测试环境）
 * 就用下面的常量兜底 —— 常量值与 spec 完全一致，两侧不会漂移。待 web-shell 落 token 后
 * 这里不需要改代码。
 */
const CAT_COLOR_FALLBACK: Record<CatKey, string> = {
  coding: '#A78BFA',
  office: '#38BDF8',
  chat: '#2DD4BF',
  browsing: '#60A5FA',
  social: '#34D399',
  media: '#8B5CF6',
  games: '#FB7185',
  other: '#94A3B8',
}

let catColorCache: Map<string, string> | null = null

/** 自建类别的备用色池（内置 8 色之外的扩展色，按 key 稳定取色）。 */
const CUSTOM_POOL = ['#F59E0B', '#10B981', '#6366F1', '#EC4899', '#14B8A6', '#F97316', '#0EA5E9', '#A3E635']

export function catColor(key: string): string {
  const builtin = CAT_COLOR_FALLBACK[key as CatKey]
  if (builtin) return builtin
  if (typeof document === 'undefined') return CUSTOM_POOL[hashIdx(key, CUSTOM_POOL.length)]
  if (!catColorCache) catColorCache = new Map()
  const hit = catColorCache.get(key)
  if (hit) return hit
  const fromCss = getComputedStyle(document.documentElement).getPropertyValue(`--ldk-cat-${key}`).trim()
  // CSS token 只为内置 8 类定义；自建类别走色池
  const color = fromCss || CUSTOM_POOL[hashIdx(key, CUSTOM_POOL.length)]
  catColorCache.set(key, color)
  return color
}

function hashIdx(s: string, n: number): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % n
}

/** 类别显示文案：内置走固定表，自建类别由调用方传 cats 列表解析。 */
export function catLabel(key: string, cats?: { key: string; label: string }[]): string {
  if (key in CAT_LABEL) return CAT_LABEL[key as CatKey]
  return cats?.find((c) => c.key === key)?.label ?? key
}

/** 主题切换后 CSS 变量会换值，清一下缓存（页面在 theme 变化时重渲染会再读一遍） */
export function resetCatColorCache(): void {
  catColorCache = null
}

// ---------- 数据形状 ----------

export type Scope = 'day' | 'week' | 'month'

/** 一个时间槽（日视图=1 小时，周/月视图=1 天）里各类别的秒数 */
export interface SummarySlot {
  /** 展示标签：日视图 '09'，周视图 '一'，月视图 '1' / '15' */
  label: string
  /** 稳定标识：日视图 '09'，周/月视图 'YYYY-MM-DD' */
  key: string
  sec: Partial<Record<CatKey, number>>
  total: number
}

export interface SummaryData {
  scope: Scope
  /** 查询锚点：day='YYYY-MM-DD'，week=周内任一天，month='YYYY-MM' */
  date: string
  slots: SummarySlot[]
  totalSec: number
  /** 工作时段（日视图才返回），from/to 为小时（0-23），用于淡紫色带 */
  workband?: { from: number; to: number }
}

export interface RankItem {
  app: string
  cat: CatKey
  sec: number
}

export interface RankData {
  scope: Scope
  date: string
  apps: RankItem[]
  categories: { cat: CatKey; sec: number }[]
}

export interface AppDetailData {
  app: string
  cat: CatKey
  sec: number
  /** 当天 24 小时的分布（秒） */
  hours: { hour: number; sec: number }[]
  /** 按窗口标题/网站域名分组（降序） */
  groups: { title: string; sec: number }[]
}

export interface CategoriesData {
  /** 全量类别（内置 8 个 + 用户自建的） */
  cats: { key: CatKey | string; label: string; builtin: boolean }[]
  /** 应用名（小写）→ 类别 key */
  rules: Record<string, CatKey | string>
}

export interface ActivitySettings {
  enabled: boolean
  intervalSec: number
  idleMinutes: number
  workband: { enabled: boolean; from: number; to: number }
  domainCapture: boolean
  /** 隐私过滤：这些应用/标题关键词不记录 */
  privacy: string[]
}

export interface WithDemo<T> {
  demo: boolean
  data: T
}

// ---------- mock：确定性伪数据 ----------

/** 字符串 → 32 位种子（FNV-1a，足够散且稳定） */
function seedOf(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 可复现的伪随机数流 */
function rng(seed: number): () => number {
  let s = seed || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0xffffffff
  }
}

/** mock 里的应用目录：名字要像真被控机上会出现的 */
const MOCK_APPS: { name: string; cat: CatKey; weight: number }[] = [
  { name: 'Code', cat: 'coding', weight: 30 },
  { name: 'cursor', cat: 'coding', weight: 14 },
  { name: 'Windows Terminal', cat: 'coding', weight: 6 },
  { name: 'chrome', cat: 'browsing', weight: 20 },
  { name: 'msedge', cat: 'browsing', weight: 6 },
  { name: 'Telegram', cat: 'social', weight: 8 },
  { name: 'WeChat', cat: 'chat', weight: 7 },
  { name: 'Steam', cat: 'games', weight: 12 },
  { name: '网易云音乐', cat: 'media', weight: 5 },
  { name: 'potplayer', cat: 'media', weight: 4 },
  { name: 'Excel', cat: 'office', weight: 5 },
  { name: 'explorer', cat: 'other', weight: 3 },
]

/** 周末权重衰减：非工作日编程/办公时间大幅下降 */
function isWeekend(dateStr: string): boolean {
  const d = new Date(`${dateStr}T12:00:00`)
  const w = d.getDay()
  return w === 0 || w === 6
}

function daysInMonth(monthStr: string): number {
  const [y, m] = monthStr.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** 生成某天 24 小时 × 类别的秒数（总量受星期影响，夜间为 0） */
function mockDaySlots(dateStr: string): SummarySlot[] {
  const rand = rng(seedOf(dateStr))
  const weekend = isWeekend(dateStr)
  const slots: SummarySlot[] = []
  for (let h = 0; h < 24; h++) {
    const sec: Partial<Record<CatKey, number>> = {}
    let active = false
    if (h >= 8 && h < 12) active = rand() > (weekend ? 0.55 : 0.15)
    else if (h >= 12 && h < 14) active = rand() > 0.4
    else if (h >= 14 && h < 19) active = rand() > (weekend ? 0.5 : 0.12)
    else if (h >= 19 && h < 24) active = rand() > 0.35
    else if (h === 7 || h === 0) active = rand() > 0.8
    if (active) {
      // 按时段选主类别：上午偏编程/办公，午间偏浏览/沟通，晚上偏影音/游戏
      let pool: CatKey[]
      if (h >= 8 && h < 12) pool = ['coding', 'coding', 'office', 'chat', 'browsing']
      else if (h >= 12 && h < 14) pool = ['browsing', 'chat', 'social', 'media']
      else if (h >= 14 && h < 19) pool = weekend
        ? ['games', 'browsing', 'social', 'media', 'coding']
        : ['coding', 'coding', 'browsing', 'chat', 'office']
      else pool = ['media', 'games', 'browsing', 'social']
      const main = pool[Math.floor(rand() * pool.length)]
      const total = Math.round((30 + rand() * 30) * 60) // 30~60 分钟
      sec[main] = Math.round(total * (0.6 + rand() * 0.3))
      const rest = total - (sec[main] ?? 0)
      if (rest > 60) {
        const second = pool[Math.floor(rand() * pool.length)]
        sec[second] = (sec[second] ?? 0) + rest
      }
    }
    slots.push({
      label: String(h).padStart(2, '0'),
      key: dateStr,
      sec,
      total: Object.values(sec).reduce((a, b) => a + (b ?? 0), 0),
    })
  }
  return slots
}

function sumSlots(slots: SummarySlot[]): number {
  return slots.reduce((a, s) => a + s.total, 0)
}

function mockSummary(p: { scope: Scope; date: string }): SummaryData {
  if (p.scope === 'day') {
    const slots = mockDaySlots(p.date)
    return { scope: 'day', date: p.date, slots, totalSec: sumSlots(slots), workband: { from: 9, to: 18 } }
  }
  if (p.scope === 'week') {
    // 以传入日期所在周一为起点铺 7 天
    const d = new Date(`${p.date}T12:00:00`)
    const dow = (d.getDay() + 6) % 7
    const monday = new Date(d)
    monday.setDate(d.getDate() - dow)
    const slots: SummarySlot[] = []
    const wdLabels = ['一', '二', '三', '四', '五', '六', '日']
    for (let i = 0; i < 7; i++) {
      const cur = new Date(monday)
      cur.setDate(monday.getDate() + i)
      const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      // 未来日期给空槽，避免"本周还没过完就满勤"
      if (cur.getTime() > Date.now()) {
        slots.push({ label: wdLabels[i], key: ds, sec: {}, total: 0 })
        continue
      }
      const day = mockDaySlots(ds)
      const merged: Partial<Record<CatKey, number>> = {}
      for (const s of day) for (const [k, v] of Object.entries(s.sec)) merged[k as CatKey] = (merged[k as CatKey] ?? 0) + (v ?? 0)
      slots.push({ label: wdLabels[i], key: ds, sec: merged, total: Object.values(merged).reduce((a, b) => a + (b ?? 0), 0) })
    }
    return { scope: 'week', date: p.date, slots, totalSec: sumSlots(slots) }
  }
  // month：每天一个槽
  const n = daysInMonth(p.date)
  const slots: SummarySlot[] = []
  const now = new Date()
  for (let i = 1; i <= n; i++) {
    const ds = `${p.date}-${String(i).padStart(2, '0')}`
    const day = mockDaySlots(ds)
    const merged: Partial<Record<CatKey, number>> = {}
    for (const s of day) for (const [k, v] of Object.entries(s.sec)) merged[k as CatKey] = (merged[k as CatKey] ?? 0) + (v ?? 0)
    const total = Object.values(merged).reduce((a, b) => a + (b ?? 0), 0)
    // 未来日期清零
    const future = new Date(`${ds}T00:00:00`).getTime() > now.getTime()
    slots.push({ label: String(i), key: ds, sec: future ? {} : merged, total: future ? 0 : total })
  }
  return { scope: 'month', date: p.date, slots, totalSec: sumSlots(slots) }
}

function mockRank(p: { scope: Scope; date: string }): RankData {
  const summary = mockSummary(p)
  const rand = rng(seedOf(`rank:${p.scope}:${p.date}`))
  // 应用排行：从目录里按权重+种子造一份总量，与 summary 的总时长同量级
  const total = summary.totalSec || 8 * 3600
  const picked = [...MOCK_APPS]
    .map((a) => ({ ...a, r: rand() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, 8)
    .map((a) => ({ app: a.name, cat: a.cat, sec: Math.round((total * a.weight * (0.5 + a.r)) / MOCK_APPS.reduce((s, x) => s + x.weight, 0)) }))
    .sort((a, b) => b.sec - a.sec)
  const catTotals = new Map<CatKey, number>()
  for (const it of picked) catTotals.set(it.cat, (catTotals.get(it.cat) ?? 0) + it.sec)
  const categories = [...catTotals.entries()]
    .map(([cat, sec]) => ({ cat, sec }))
    .sort((a, b) => b.sec - a.sec)
  return { scope: p.scope, date: p.date, apps: picked, categories }
}

function mockAppDetail(app: string, date: string): AppDetailData {
  const rand = rng(seedOf(`detail:${app}:${date}`))
  const cat = MOCK_APPS.find((a) => a.name === app)?.cat ?? 'other'
  // mockDaySlots 返回的就是槽位数组（不是 SummaryData）
  const daySlots = mockDaySlots(date)
  const hours = daySlots.map((s) => ({ hour: Number(s.label), sec: Math.round(s.total * (0.3 + rand() * 0.5)) }))
  const sec = hours.reduce((a, h) => a + h.sec, 0)
  const titles: Record<string, string[]> = {
    coding: ['MainActivity.rs - landeck', 'activity.ts - web/src/lib', '终端 - go test ./...', 'Pull Request #42 - GitHub'],
    browsing: ['hindsight.kyosweb.com — 功能', 'GitHub — Trending', 'LINUX DO — 最新帖子', 'YouTube — 深夜歌单'],
    games: ['Steam 库', 'CS2 — 竞技模式', 'Dota 2 — 主界面'],
    social: ['Telegram — 群组', 'Discord — 语音房间'],
    chat: ['WeChat — 文件传输助手', 'WeChat — 项目群'],
    media: ['网易云音乐 — 私人FM', 'potplayer — 演示视频.mp4'],
    office: ['Q3 复盘.xlsx - Excel', '周报.docx - Word'],
    other: ['explorer — 下载'],
  }
  const base = titles[cat] ?? titles.other
  const groups = base.map((t, i) => ({ title: t, sec: Math.round((sec / base.length) * (1.6 - i * 0.25)) }))
    .sort((a, b) => b.sec - a.sec)
  return { app, cat, sec, hours, groups }
}

function mockCategories(): CategoriesData {
  const rules: Record<string, CatKey> = {}
  for (const a of MOCK_APPS) rules[a.name.toLowerCase()] = a.cat
  rules['youtube'] = 'media'
  rules['github.com'] = 'coding'
  return { cats: CATEGORIES.map((c) => ({ ...c, builtin: true })), rules }
}

function mockSettings(): ActivitySettings {
  return {
    enabled: true,
    intervalSec: 30,
    idleMinutes: 3,
    workband: { enabled: false, from: 9, to: 18 },
    domainCapture: true,
    privacy: ['密码', 'bank'],
  }
}

// ---------- 真实请求 + 降级 ----------

function isNotImplemented(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 501)
}

/**
 * 活动接口专用的最小请求器。
 *
 * 为什么不用 AgentClient：它的 req() 是 private（api.ts 不在本批文件范围里，
 * 不为统计页去改公共客户端的可见性），模块级 request() 也没导出。
 * 这里复用导出的 baseUrl/ApiError，保住同一套错误语义（isNotImplemented 靠 status 分流）；
 * token 显式传参 —— 本机目标不带令牌（agent 对 127.0.0.1 免认证），远程带设备令牌。
 * 采集接口上线后如果 api.ts 提供了公共泛型方法，可整体替换掉这段。
 */
async function req<T>(
  t: Target,
  token: string | undefined,
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12000)
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
      const code = (parsed as { error?: string } | null)?.error ?? `HTTP ${res.status}`
      throw new ApiError(code, String((parsed as { message?: string } | null)?.message ?? code), res.status)
    }
    return parsed as T
  } finally {
    clearTimeout(timer)
  }
}

/** 统计汇总。demo=true 表示 agent 侧尚未上线，返回的是内置演示数据。 */
export async function fetchSummary(
  t: Target,
  token: string | undefined,
  p: { scope: Scope; date: string },
): Promise<WithDemo<SummaryData>> {
  try {
    const data = await req<SummaryData>(t, token, `/activity/summary?scope=${p.scope}&date=${encodeURIComponent(p.date)}`, {
      timeoutMs: 15000,
    })
    return { demo: false, data }
  } catch (e) {
    if (isNotImplemented(e)) return { demo: true, data: mockSummary(p) }
    throw e
  }
}

/** 应用/分类排行。 */
export async function fetchRank(
  t: Target,
  token: string | undefined,
  p: { scope: Scope; date: string },
): Promise<WithDemo<RankData>> {
  try {
    const data = await req<RankData>(t, token, `/activity/rank?scope=${p.scope}&date=${encodeURIComponent(p.date)}`, {
      timeoutMs: 15000,
    })
    return { demo: false, data }
  } catch (e) {
    if (isNotImplemented(e)) return { demo: true, data: mockRank(p) }
    throw e
  }
}

/** 应用详情（窗口标题 / 域名分组）。 */
export async function fetchAppDetail(
  t: Target,
  token: string | undefined,
  p: { app: string; date: string },
): Promise<WithDemo<AppDetailData>> {
  try {
    const data = await req<AppDetailData>(
      t,
      token,
      `/activity/app/${encodeURIComponent(p.app)}?date=${encodeURIComponent(p.date)}`,
      { timeoutMs: 15000 },
    )
    return { demo: false, data }
  } catch (e) {
    if (isNotImplemented(e)) return { demo: true, data: mockAppDetail(p.app, p.date) }
    throw e
  }
}

/** 分类规则读取。 */
export async function fetchCategories(t: Target, token: string | undefined): Promise<WithDemo<CategoriesData>> {
  try {
    const data = await req<CategoriesData>(t, token, '/activity/categories', { timeoutMs: 15000 })
    return { demo: false, data }
  } catch (e) {
    if (isNotImplemented(e)) return { demo: true, data: mockCategories() }
    throw e
  }
}

/** 分类规则保存。demo 模式下不真发请求（agent 没这接口，发了也是 404）。 */
export async function putCategories(t: Target, token: string | undefined, data: CategoriesData): Promise<{ demo: boolean }> {
  try {
    await req(t, token, '/activity/categories', { method: 'PUT', body: data, timeoutMs: 15000 })
    return { demo: false }
  } catch (e) {
    if (isNotImplemented(e)) return { demo: true }
    throw e
  }
}

/** 采集设置读取（分类页与后续设置入口共用）。 */
export async function fetchActivitySettings(t: Target, token: string | undefined): Promise<WithDemo<ActivitySettings>> {
  try {
    const data = await req<ActivitySettings>(t, token, '/activity/settings', { timeoutMs: 15000 })
    return { demo: false, data }
  } catch (e) {
    if (isNotImplemented(e)) return { demo: true, data: mockSettings() }
    throw e
  }
}
