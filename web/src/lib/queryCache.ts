/**
 * 页面级查询缓存（纯内存）。
 *
 * 解决的问题：以前每次切页都会把「硬件信息 / 开机统计 / 配对信息 / 客户端列表」
 * 这些一次性接口重新拉一遍，于是：
 *   - 先闪一下骨架屏，再出内容（看着像"每次都在重新加载"）
 *   - 远程设备还要多等一个网络往返
 * 这些都是几百字节到几十 KB 的文本，留在内存里几乎不占地方。
 *
 * 设计取向：
 *   - **按 key 共享**：同一台设备的 `client.system()` 在设备详情、文件页、
 *     设置页用的是同一个 key，一处拉过后其它页面直接命中。
 *   - **过期后台刷新**：命中过期条目时先返回旧数据（界面不闪），同时发请求更新。
 *   - **手动刷新一定走网络**：`reload()` 会绕过新鲜度判断，否则用户点刷新没反应。
 *   - **有上限**：最多 `MAX_ENTRIES` 条，超出按最久未使用淘汰，避免长时间挂机后无限增长。
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

const store = new Map<string, Entry>()
let useSeq = 0

/** 默认有效期：5 分钟。文本数据变化不频繁，用户切页时基本都能命中。 */
export const DEFAULT_TTL_MS = 5 * 60_000

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

/** 读缓存。返回是否新鲜（fresh=true 表示可以完全跳过网络）。 */
export function readCache<T>(key: string): { data: T; fresh: boolean } | null {
  const e = store.get(key)
  if (!e) return null
  e.used = ++useSeq
  const fresh = Date.now() - e.at < e.ttlMs
  return { data: e.data as T, fresh }
}

/** 写缓存。 */
export function writeCache<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { data, at: Date.now(), ttlMs, used: ++useSeq })
  evictIfNeeded()
}

/** 删单个 key（用于知道某个数据已经变了的场景，例如吊销客户端后）。 */
export function invalidateCache(key: string): void {
  store.delete(key)
}

/** 按前缀删（例如换设备后清掉这台设备的全部缓存）。 */
export function invalidateCachePrefix(prefix: string): void {
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}

/** 清空（退出/换身份时用；目前没有调用点，保留给将来）。 */
export function clearCache(): void {
  store.clear()
}

/** 调试用：当前缓存条数。 */
export function cacheSize(): number {
  return store.size
}

/**
 * 组装缓存 key。
 *
 * 一定要带上「身份」维度（设备 id / host / port / token 摘要），
 * 否则从 A 设备切到 B 设备会命中 A 的数据 —— 那是最糟的一类 bug。
 * token 只取尾部 8 位，避免把完整令牌散落在内存键里。
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
