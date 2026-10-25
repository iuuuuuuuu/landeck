import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentClient } from './api'
import { normalizeStatus } from './normalizeStatus'
import type { MediaInfo, StatusSnapshot, WsFrame } from './types'
import type { PairedDevice } from '../store/app'

export interface Sample {
  t: number
  cpu: number
  mem: number
  rx: number
  tx: number
}

export interface LiveState {
  status: StatusSnapshot | null
  media: MediaInfo | null
  connected: boolean
  error: string | null
  samples: Sample[]
  lastAt: number | null
}

const MAX_SAMPLES = 240

/** 实时状态：优先 WS 推送，连续失败退化为 2.5s 轮询。 */
export function useLive(device?: PairedDevice | null): LiveState {
  const [status, setStatus] = useState<StatusSnapshot | null>(null)
  const [media, setMedia] = useState<MediaInfo | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [lastAt, setLastAt] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<number | null>(null)
  const retryRef = useRef(0)
  const closedRef = useRef(false)

  const push = useCallback((raw: StatusSnapshot) => {
    const snap = normalizeStatus(raw)
    setStatus(snap)
    setLastAt(Date.now())
    setConnected(true)
    setError(null)
    setSamples((prev) => {
      const next = [
        ...prev,
        { t: Date.now(), cpu: snap.cpu.percent, mem: snap.mem.percent, rx: snap.net.rxBps, tx: snap.net.txBps },
      ]
      return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next
    })
  }, [])

  useEffect(() => {
    setStatus(null)
    setMedia(null)
    setSamples([])
    setLastAt(null)
    setConnected(false)
    setError(null)
    if (!device) return
    closedRef.current = false
    retryRef.current = 0
    const client = AgentClient.fromDevice(device)

    const startPolling = () => {
      if (pollRef.current) return
      const tick = async () => {
        try {
          push(await client.status())
          setMedia(await client.mediaState())
        } catch (e) {
          setConnected(false)
          setError((e as Error).message)
        }
      }
      void tick()
      pollRef.current = window.setInterval(tick, 2500)
    }

    const connect = () => {
      if (closedRef.current) return
      const url = client.streamUrl()
      if (!url) {
        startPolling()
        return
      }
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        startPolling()
        return
      }
      wsRef.current = ws
      ws.onopen = () => {
        retryRef.current = 0
        setConnected(true)
      }
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data as string) as WsFrame
          if (frame.type === 'status') push(frame.data)
          if (frame.type === 'media') setMedia(frame.data)
        } catch {
          /* 忽略心跳帧 */
        }
      }
      ws.onerror = () => {
        setConnected(false)
      }
      ws.onclose = () => {
        wsRef.current = null
        if (closedRef.current) return
        setConnected(false)
        retryRef.current += 1
        if (retryRef.current >= 3) {
          startPolling()
          return
        }
        setTimeout(connect, Math.min(1200 * retryRef.current, 5000))
      }
    }

    connect()

    return () => {
      closedRef.current = true
      wsRef.current?.close()
      wsRef.current = null
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [device?.id, device?.token, device?.host, device?.port, device?.tls, push])

  return { status, media, connected, error, samples, lastAt }
}

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** 通用一次性拉取：硬件信息、历史统计这类慢接口用。 */
export function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!fn)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    if (!fnRef.current) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fnRef.current()
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
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

/** 每秒滴答一次，用于「已运行 x 秒」这类本地累加显示 */
export function useTicker(intervalMs = 1000): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setN((v) => v + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return n
}

export function useClient(device?: PairedDevice | null): AgentClient | null {
  return useMemo(() => (device ? AgentClient.fromDevice(device) : null), [device])
}
