/**
 * 页面级查询缓存：内存 L1 + localStorage 持久层。
 *
 * 解决的问题：以前每次切页都会把「硬件信息 / 开机统计 / 配对信息 / 客户端列表」
 * 这些一次性接口重新拉一遍，于是：
 *   - 先闪一下骨架屏，再出内容（看着像"每次都在重新加载"）
 *   - 远程设备还要多等一个网络往返
 * 这些都是几百字节到几十 KB 的文本，留在内存里几乎不占地方。
 *
 * 为什么要落盘（不只是内存）：
 *   只放内存时，App 一重启（桌面关掉重开、手机进程被系统回收、浏览器刷新）
 *   缓存全清空，用户又要等一遍全部重新加载。所以内存作为 L1，localStorage
 *   作为 L2：启动时把未过期的条目灌回内存，读写都先走内存，落盘做防抖。
 *
 * 设计取向：
 *   - **按 key 共享**：同一台设备的 `client.system()` 在设备详情、文件页、
 *     设置页用的是同一个 key，一处拉过后其它页面直接命中。
 *   - **过期后台刷新**：命中过期条目时先返回旧数据（界面不闪），同时发请求更新。
 *   - **手动刷新一定走网络**：`reload()` 会绕过新鲜度判断，否则用户点刷新没反应。
 *   - **有上限**：内存最多 `MAX_ENTRIES` 条（LRU 淘汰）；落盘另有字节预算，
 *     超出时按写入时间从新到旧保留，避免把 localStorage 配额撑爆。
 *   - **落盘失败就退化**：隐私模式 / 配额满 / 存储损坏时静默降级为仅内存，
 *     绝不让缓存问题把页面搞挂。
 *
 * 隐私说明：落盘内容是本机设备名、系统信息、开机统计、文件根目录这类数据，
 * 与 App 本来就在本地保存的设备列表同级；不含令牌（key 里令牌只留尾部 8 位特征）。
 */

interface Entry {
  data: unknown
  /** 写入/刷新时间戳（ms） */
  at: number
  /** 该条目的有效期（ms） */
  ttlMs: number
  /** 命中顺序，用于 LRU 淘汰 */
  used: number
}

const MAX_ENTRIES = 240

/** 默认有效期：5 分钟。文本数据变化不频繁，用户切页时基本都能命中。 */
export const DEFAULT_TTL_MS = 5 * 60_000

/** 持久层键名。带版本号，将来结构变了直接换名字，老数据自然废弃。 */
const STORAGE_KEY = 'landeck.querycache.v1'
/** 整份持久数据的上限（字节估算，按字符串长度算） */
const PERSIST_MAX_CHARS = 1_200_000
/** 单条超过这个大小就不落盘（只留内存），避免一个大响应挤掉别人 */
const PERSIST_MAX_ENTRY_CHARS = 200_000

const store = new Map<string, Entry>()
let useSeq = 0

let hydrated = false
let persistBroken = false
let persistTimer: ReturnType<typeof setTimeout> | null = null
let listenersBound = false

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage
    const probe = '__ldk_cache_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return
  // 按最近使用时间淘汰最旧的一批（一次清到上限的 80%，避免每次都做全排序）
  const sorted = [...store.entries()].sort((a, b) => a[1].used - b[1].used)
  const target = Math.floor(MAX_ENTRIES * 0.8)
  const removeCount = sorted.length - target
  for (let i = 0; i < removeCount; i++) {
    store.delete(sorted[i][0])
  }
}

/** 从 localStorage 灌回未过期条目。只做一次。 */
function hydrate(): void {
  if (hydrated) return
  hydrated = true

  bindLifecycle()

  const s = safeStorage()
  if (!s) {
    persistBroken = true
    return
  }
  try {
    const raw = s.getItem(STORAGE_KEY)
    if (!raw) return
    const arr = JSON.parse(raw) as Array<{ k: string; d: unknown; at: number; t: number }>
    if (!Array.isArray(arr)) return
    const now = Date.now()
    for (const e of arr) {
      if (!e || typeof e.k !== 'string' || typeof e.at !== 'number') continue
      const ttl = typeof e.t === 'number' && e.t > 0 ? e.t : DEFAULT_TTL_MS
      // 重启前就已经过期的，直接丢弃：宁可冷启动一次，也不要展示过期数据
      if (now - e.at >= ttl) continue
      store.set(e.k, { data: e.d, at: e.at, ttlMs: ttl, used: 0 })
    }
    // 按写入时间重排 used，保证 LRU 顺序与真实新旧一致
    const ordered = [...store.entries()].sort((a, b) => a[1].at - b[1].at)
    for (const [, v] of ordered) v.used = ++useSeq
  } catch {
    // 数据损坏（手动改过 / 版本不兼容）：当没有缓存，别让页面挂
    try {
      s.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
}

/** 立刻写盘。失败则永久退化为仅内存。 */
function persistNow(): void {
  if (persistBroken) return
  const s = safeStorage()
  if (!s) {
    persistBroken = true
    return
  }
  try {
    let items = [...store.entries()].map(([k, v]) => ({ k, d: v.data, at: v.at, t: v.ttlMs }))
    let json = JSON.stringify(items)
    if (json.length > PERSIST_MAX_CHARS) {
      // 超预算：按写入时间从新到旧保留，跳过超大条目，直到接近预算
      items = items.sort((a, b) => b.at - a.at)
      const kept: typeof items = []
      let size = 2
      for (const e of items) {
        const one = JSON.stringify(e)
        if (one.length > PERSIST_MAX_ENTRY_CHARS) continue
        if (size + one.length + 1 > PERSIST_MAX_CHARS * 0.8) break
        kept.push(e)
        size += one.length + 1
      }
      json = JSON.stringify(kept)
    }
    s.setItem(STORAGE_KEY, json)
  } catch {
    // 配额满或被禁用：清掉持久层，本次会话只走内存
    try {
      s.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    persistBroken = true
  }
}

function schedulePersist(): void {
  if (persistBroken) return
  if (persistTimer !== null) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistNow()
  }, 300)
}

/**
 * 页面隐藏 / 关闭前把还没落盘的写入刷下去。
 * 防抖 300ms 意味着「刚写完就切后台」可能丢最后一次，这里补上。
 */
function bindLifecycle(): void {
  if (listenersBound || typeof window === 'undefined') return
  listenersBound = true
  const flush = () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    persistNow()
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

/** 读缓存。返回是否新鲜（fresh=true 表示可以完全跳过网络）。 */
export function readCache<T>(key: string): { data: T; fresh: boolean } | null {
  hydrate()
  const e = store.get(key)
  if (!e) return null
  e.used = ++useSeq
  const fresh = Date.now() - e.at < e.ttlMs
  return { data: e.data as T, fresh }
}

/** 写缓存。 */
export function writeCache<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  hydrate()
  store.set(key, { data, at: Date.now(), ttlMs, used: ++useSeq })
  evictIfNeeded()
  schedulePersist()
}

/** 删单个 key（用于知道某个数据已经变了的场景，例如吊销客户端后）。 */
export function invalidateCache(key: string): void {
  hydrate()
  if (store.delete(key)) schedulePersist()
}

/** 按前缀删（例如换设备后清掉这台设备的全部缓存）。 */
export function invalidateCachePrefix(prefix: string): void {
  hydrate()
  let removed = false
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) {
      store.delete(k)
      removed = true
    }
  }
  if (removed) schedulePersist()
}

/** 清空（内存 + 持久层）。退出登录/解除全部配对时用。 */
export function clearCache(): void {
  store.clear()
  hydrated = true
  persistBroken = false
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    safeStorage()?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 调试用：当前内存缓存条数。 */
export function cacheSize(): number {
  hydrate()
  return store.size
}

/**
 * 组装缓存 key。
 *
 * 一定要带上「身份」维度（设备 id / host / port / token 摘要），
 * 否则从 A 设备切到 B 设备会命中 A 的数据 —— 那是最糟的一类 bug。
 * token 只取尾部 8 位，避免把完整令牌散落在内存键和落盘内容里。
 */
export function cacheKey(parts: Array<string | number | boolean | undefined | null>): string {
  return parts
    .map((p) => {
      if (p === undefined || p === null) return ''
      const s = String(p)
      // 长串（令牌）只留尾部特征位
      return s.length > 16 ? '…' + s.slice(-8) : s
    })
    .join('|')
}
