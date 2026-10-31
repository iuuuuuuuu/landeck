import { useCallback, useEffect, useRef, useState } from 'react'
import { nativeLocalIP, resolveHint, scanLan } from '../../lib/discovery'
import type { NodeInfo } from '../../lib/types'

export type ScanStatus = 'idle' | 'scanning' | 'done'

export interface LanScanResult {
  nodes: NodeInfo[]
  status: ScanStatus
  done: number
  total: number
  elapsedMs: number
  error: string | null
  /** 当前页面地址是否能推导出局域网网段 */
  hasHint: boolean
  start: () => void
  stop: () => void
}

/** 扫段状态机：进度、耗时、中止都在这里，页面只管渲染 */
export function useLanScan(): LanScanResult {
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [status, setStatus] = useState<ScanStatus>('idle')
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [hasHint, setHasHint] = useState(() => !!resolveHint())

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedAt = useRef(0)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const stop = useCallback(() => {
    abortRef.current?.abort()
    clearTimer()
    if (startedAt.current) setElapsedMs(performance.now() - startedAt.current)
    setStatus('done')
  }, [])

  const start = useCallback(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setNodes([])
    setDone(0)
    setTotal(0)
    setElapsedMs(0)
    setError(null)
    setStatus('scanning')
    startedAt.current = performance.now()

    clearTimer()
    timerRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAt.current)
    }, 100)

    // 先问原生层要本机地址（Tauri 下 URL 推不出网段），拿不到就用 URL 推导
    void nativeLocalIP().then((ip) => setHasHint(!!resolveHint(ip)))

    const seen = new Set<string>()
    void scanLan({
      onNode: (node) => {
        if (seen.has(node.id)) return
        seen.add(node.id)
        setNodes((prev) => [...prev, node])
      },
      onProgress: (d, t) => {
        setDone(d)
        setTotal(t)
      },
      signal: ctrl.signal,
    })
      .catch(() => {
        if (!ctrl.signal.aborted) setError('扫描过程中出现异常，请重试')
      })
      .finally(() => {
        clearTimer()
        setElapsedMs(performance.now() - startedAt.current)
        if (!ctrl.signal.aborted) setStatus('done')
      })
  }, [])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    },
    [],
  )

  return { nodes, status, done, total, elapsedMs, error, hasHint, start, stop }
}
