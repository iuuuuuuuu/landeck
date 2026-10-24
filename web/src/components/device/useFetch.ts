import { useCallback, useEffect, useRef, useState } from 'react'
import { isAuthError } from './apiHelpers'

export interface FetchState<T> {
  data: T | null
  loading: boolean
  /** 保留原始错误对象，页面才能分辨 401 与其他失败 */
  error: unknown
  reload: () => void
}

/**
 * 与 lib/hooks 的 useAsync 同构，但保留错误对象本体。
 * 页面要按状态码分流（401 → 重新配对）时必须用它，不能只看 message。
 */
export function useFetch<T>(
  fn: (() => Promise<T>) | null,
  deps: unknown[],
  onAuthError?: () => void,
): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!fn)
  const [error, setError] = useState<unknown>(null)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const authRef = useRef(onAuthError)
  authRef.current = onAuthError

  useEffect(() => {
    const current = fnRef.current
    let cancelled = false
    if (!current) {
      setLoading(false)
      setError(null)
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    current()
      .then((res) => {
        if (!cancelled) setData(res)
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

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}
