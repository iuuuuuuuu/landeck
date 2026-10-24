import { useEffect, useRef, useState } from 'react'
import { AgentClient } from '../../lib/api'
import { useApp, type PairedDevice } from '../../store/app'

export interface ProbeState {
  /** null = 还没探测出结果 */
  online: boolean | null
  cpu?: number
  mem?: number
  at?: number
  error?: string
}

export type ProbeMap = Record<string, ProbeState>

/**
 * 轻量在线探测：只关心「连不连得上 + CPU/内存」，不开 WS。
 * 挂载即探测一次，之后按 intervalMs 轮询；设备地址/令牌变化时重建。
 * 列表页与顶栏共用，避免各自写一套 setInterval。
 */
export function useDeviceProbe(
  devices: PairedDevice[],
  intervalMs = 10000,
  reloadKey = 0,
): ProbeMap {
  const [map, setMap] = useState<ProbeMap>({})
  const markOk = useApp((s) => s.markOk)
  const listRef = useRef(devices)
  listRef.current = devices

  // 只对「会改变探测结果」的字段做依赖，避免 store 里 lastOkAt 变动引发重连
  const key = devices
    .map((d) => `${d.id}|${d.host}|${d.port}|${d.tls}|${d.token}`)
    .join('&&')

  useEffect(() => {
    let cancelled = false
    const probeAll = async () => {
      const list = listRef.current
      if (list.length === 0) {
        if (!cancelled) setMap({})
        return
      }
      const results = await Promise.all(
        list.map(async (d) => {
          try {
            const snap = await new AgentClient(d, d.token).status()
            markOk(d.id)
            return {
              id: d.id,
              state: { online: true, cpu: snap.cpu.percent, mem: snap.mem.percent, at: Date.now() },
            }
          } catch (e) {
            return {
              id: d.id,
              state: { online: false, error: (e as Error).message, at: Date.now() },
            }
          }
        }),
      )
      if (cancelled) return
      setMap((prev) => {
        const next: ProbeMap = {}
        for (const d of listRef.current) next[d.id] = prev[d.id] ?? { online: null }
        for (const r of results) next[r.id] = r.state
        return next
      })
    }

    void probeAll()
    if (listRef.current.length === 0) return
    const timer = window.setInterval(() => void probeAll(), intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs, reloadKey, markOk])

  return map
}
