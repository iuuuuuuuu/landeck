import { useCallback, useEffect, useRef, useState } from 'react'
import { isAuthError } from './apiHelpers'
import { readCache, writeCache, DEFAULT_TTL_MS } from '../../lib/queryCache'

export interface FetchState<T> {
  data: T | null
  loading: boolean
  /** 保留原始错误对象，页面才能分辨 401 与其他失败 */
  error: unknown
  reload: () => void
}

export interface FetchOptions {
  /**
   * 内存缓存键（可选）。给了就命中缓存时不发请求、不闪骨架屏。
   * 键里必须带身份维度，用 queryCache.cacheKey([...]) 拼。
   */
  key?: string
  ttlMs?: number
}

/**
 * 与 lib/hooks 的 useAsync 同构，但保留错误对象本体。
 * 页面要按状态码分流（401 → 重新配对）时必须用它，不能只看 message。
 */
export function useFetch<T>(
  fn: (() => Promise<T>) | null,
  deps: unknown[],
  onAuthError?: () => void,
  opts?: FetchOptions,
): FetchState<T> {
  const key = opts?.key
  const ttlMs = opts?.ttlMs
  const boot = key ? readCache<T>(key) : null
  const [data, setData] = useState<T | null>(boot ? boot.data : null)
  const [loading, setLoading] = useState(!!fn && !boot)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const authRef = useRef(onAuthError)
  authRef.current = onAuthError
  // reload 必须真走网络，否则「刷新」按钮会返回缓存
  const forceRef = useRef(false)

  useEffect(() => {
    const current = fnRef.current
    let cancelled = false
    if (!current) {
      setLoading(false)
      setError(null)
      setData(null)
      return
    }
    const force = forceRef.current
    forceRef.current = false

    const cached = key ? readCache<T>(key) : null
    if (cached && !force) {
      setData(cached.data)
      setLoading(false)
      setError(null)
      if (cached.fresh) return
    } else if (!cached) {
      setLoading(true)
      setError(null)
    }

    current()
      .then((res) => {
        if (cancelled) return
        setData(res)
        if (key) writeCache(key, res, ttlMs ?? DEFAULT_TTL_MS)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (isAuthError(e)) authRef.current?.()
        setError(e)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => {
    forceRef.current = true
    setNonce((n) => n + 1)
  }, [])
  return { data, loading, error, reload }
}
