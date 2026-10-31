import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentClient } from './api'
import { normalizeStatus } from './normalizeStatus'
import { readCache, writeCache } from './queryCache'
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

/**
 * 每台设备「最后一次收到的实时状态」。
 *
 * 为什么要留一份：`useLive` 在挂载时会把状态清空，于是从设备页切到详情页
 * 会先显示一堆「—」再等第一帧推送（远程设备还要多一个往返）。
 * 把上一帧留在内存里，重进页面时直接渲染上次的数字，随后被新推送覆盖 ——
 * 视觉上就是「立刻有数据」，而不是「每次都在重新加载」。
 *
 * 只留 latest，不累加历史，所以内存占用与设备数同阶（每台几百字节）。
 */
interface LiveCacheEntry {
  status: StatusSnapshot | null
  media: MediaInfo | null
  samples: Sample[]
  lastAt: number | null
}
const liveCache = new Map<string, LiveCacheEntry>()
const MAX_LIVE_DEVICES = 16

function liveCacheKey(device?: PairedDevice | null): string {
  if (!device) return ''
  return `${device.id}|${device.host}|${device.port}`
}

/** 实时状态：优先 WS 推送，连续失败退化为 2.5s 轮询。 */
export function useLive(device?: PairedDevice | null): LiveState {
  const liveKey = liveCacheKey(device)
  const boot = liveKey ? liveCache.get(liveKey) : undefined
  const [status, setStatus] = useState<StatusSnapshot | null>(boot?.status ?? null)
  const [media, setMedia] = useState<MediaInfo | null>(boot?.media ?? null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>(boot?.samples ?? [])
  const [lastAt, setLastAt] = useState<number | null>(boot?.lastAt ?? null)
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<number | null>(null)
  const retryRef = useRef(0)
  const closedRef = useRef(false)

  // 每次状态变化都写回缓存，供下次挂载秒开
  useEffect(() => {
    if (!liveKey) return
    liveCache.set(liveKey, { status, media, samples, lastAt })
    if (liveCache.size > MAX_LIVE_DEVICES) {
      // 超出上限就丢最早插入的那台，避免长时间挂机后累积
      const first = liveCache.keys().next().value
      if (first && first !== liveKey) liveCache.delete(first)
    }
  }, [liveKey, status, media, samples, lastAt])

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
    // 换设备时不要清空重来：先铺上这台设备上次的状态（如果见过），再等新推送覆盖
    const prev = liveKey ? liveCache.get(liveKey) : undefined
    setStatus(prev?.status ?? null)
    setMedia(prev?.media ?? null)
    setSamples(prev?.samples ?? [])
    setLastAt(prev?.lastAt ?? null)
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
  }, [liveKey, device?.id, device?.token, device?.host, device?.port, device?.tls, push])

  return { status, media, connected, error, samples, lastAt }
}

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export interface AsyncOptions {
  /**
   * 内存缓存键。给了就启用缓存：命中且新鲜时不发请求、不闪骨架屏；
   * 命中但过期时先用旧数据渲染，再后台刷新。
   * 键里必须带身份维度（设备 id / host / port / token），否则换设备会命中别人的数据。
   * 用 queryCache.cacheKey([...]) 拼，别手写。
   */
  key?: string
  /** 缓存有效期，默认 5 分钟 */
  ttlMs?: number
}

/** 通用一次性拉取：硬件信息、历史统计这类慢接口用。 */
export function useAsync<T>(
  fn: (() => Promise<T>) | null,
  deps: unknown[],
  opts?: AsyncOptions,
): AsyncState<T> {
  const key = opts?.key
  const ttlMs = opts?.ttlMs
  const boot = key ? readCache<T>(key) : null
  const [data, setData] = useState<T | null>(boot ? boot.data : null)
  const [loading, setLoading] = useState(!!fn && !boot)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  // reload() 必须真的走网络：否则用户点「刷新」拿到的是缓存，等于按钮失灵。
  const forceRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const current = fnRef.current
    if (!current) {
      setLoading(false)
      return
    }
    const force = forceRef.current
    forceRef.current = false

    const cached = key ? readCache<T>(key) : null
    if (cached && !force) {
      // 先用缓存渲染（界面不闪），新鲜就不再发请求
      setData(cached.data)
      setLoading(false)
      setError(null)
      if (cached.fresh) return
    } else if (!cached) {
      setLoading(true)
      setError(null)
    } else {
      // force：保留旧数据显示，仅后台刷新
      setError(null)
    }

    current()
      .then((res) => {
        if (cancelled) return
        setData(res)
        if (key) writeCache(key, res, ttlMs)
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

  const reload = useCallback(() => {
    forceRef.current = true
    setNonce((n) => n + 1)
  }, [])
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
