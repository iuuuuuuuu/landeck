/**
 * LanDeck 域名记录——MV3 service worker（八期 A2 扩展侧）。
 *
 * 职责：激活标签变化（onActivated / onUpdated status=complete）→ 取激活标签
 * URL → 解析域名 → 防抖 5s → POST 给本机 agent，用于活动统计的域分类。
 *
 * 契约（与 agent-activity 共享，字段名不要改）：
 *   POST {agentUrl}/api/v1/activity/domain?token=<TOKEN>
 *   body {browser: "chrome"|"edge", domain: "example.com", title: "..."}
 *
 * 设计约束：
 *  - 本机通信（host_permissions 只放行 127.0.0.1:8420），不上传外部服务
 *  - 失败静默重试（指数退避，封顶 5 分钟，最多 5 次）——扩展不能刷日志
 *  - 防抖语义：5s 内连续切换合并为一次（推最后一个）；另设 10s maxWait，
 *    防止「每 4s 切一次标签」的连续浏览把上报饿死（lodash debounce 同款）
 */

const DEBOUNCE_MS = 5000
const MAX_WAIT_MS = 10000
const RETRY_MAX = 5
const RETRY_CAP_MS = 5 * 60 * 1000
/** 契约端点路径（agent 所有路由都在 /api/v1 下） */
const ENDPOINT_PATH = '/api/v1/activity/domain'

const DEFAULTS = {
  agentUrl: 'http://127.0.0.1:8420',
  token: '',
  enabled: false,
  stripWww: true,
}

/** 读设置（每次事件直读 storage.local——读多写少，缓存反而要管失效） */
async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS)
  return {
    agentUrl: String(stored.agentUrl || DEFAULTS.agentUrl).replace(/\/+$/, ''),
    token: String(stored.token || ''),
    enabled: stored.enabled === true,
    stripWww: stored.stripWww !== false,
  }
}

/** chrome | edge：MV3 service worker 里按 UA 判（Edge 的 UA 带 Edg/） */
function detectBrowser() {
  return /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome'
}

/** URL → 域名：hostname 小写，可配置剥 www. 前缀；解析不了返回 null */
function domainOf(rawUrl, stripWww) {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    let host = u.hostname.toLowerCase()
    if (stripWww && host.startsWith('www.')) host = host.slice(4)
    return host || null
  } catch {
    return null
  }
}

// ---------- 防抖（trailing + maxWait） ----------
let pending = null // { browser, domain, title }
let timer = null
let firstPendingAt = 0

function scheduleDebounce(now) {
  if (timer !== null) clearTimeout(timer)
  const sinceFirst = now - firstPendingAt
  const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - sinceFirst))
  timer = setTimeout(firePending, delay)
}

async function firePending() {
  timer = null
  firstPendingAt = 0
  const item = pending
  pending = null
  if (item) await push(item)
}

// ---------- 推送（静默重试退避） ----------
let retryAttempt = 0
let retryTimer = null

async function push(item) {
  const settings = await loadSettings()
  if (!settings.enabled || !settings.token) return
  const url = `${settings.agentUrl}${ENDPOINT_PATH}?token=${encodeURIComponent(settings.token)}`
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    retryAttempt = 0 // 成功即复位
  } catch (_e) {
    // 静默退避重试：agent 不在/网络抖动不影响浏览；不 console 刷屏
    retryAttempt += 1
    if (retryAttempt > RETRY_MAX) {
      retryAttempt = 0
      return
    }
    const delay = Math.min(RETRY_CAP_MS, 1000 * 2 ** (retryAttempt - 1))
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = null
      push(item)
    }, delay)
  }
}

// ---------- 激活标签采集 ----------
// 按事件自带的 tabId 采集（无头/多窗口下 lastFocusedWindow 查询会查空）；
// 校验 tab.active 确保只采「正在成为激活标签」的那个。
async function captureTabId(tabId) {
  try {
    const settings = await loadSettings()
    if (!settings.enabled) return
    const tab = await chrome.tabs.get(tabId)
    if (!tab || !tab.active || !tab.url) return
    const domain = domainOf(tab.url, settings.stripWww)
    if (!domain) return
    pending = { browser: detectBrowser(), domain, title: String(tab.title || '').slice(0, 300) }
    const now = Date.now()
    if (!firstPendingAt) firstPendingAt = now
    scheduleDebounce(now)
  } catch (_e) {
    // 标签可能在取用瞬间被关掉等——静默
  }
}

chrome.tabs.onActivated.addListener((info) => {
  void captureTabId(info.tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // 只在加载完成时采一次（onUpdated 会触发很多次）
  if (changeInfo.status !== 'complete') return
  void captureTabId(tabId)
})

// 设置变更后复位重试计数（用户改了 token/地址，旧失败不应拖累新配置）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.token || changes.agentUrl || changes.enabled)) {
    retryAttempt = 0
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }
})
