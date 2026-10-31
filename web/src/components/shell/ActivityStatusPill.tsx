import { useEffect, useRef, useState } from 'react'
import { baseUrl } from '../../lib/api'
import { useApp } from '../../store/app'
import type { PairedDevice } from '../../store/app'

/**
 * 侧栏底部的「采集状态位」（Hindsight 的 Resting 同位）。
 *
 * 读当前活跃设备 agent 的 GET /activity/status：
 *   { enabled: boolean, collecting?: boolean, idle?: boolean }
 * 映射：未启用（404/出错）/ 已停止 / 休息中（闲置或不在工作时段）/ 采集中。
 *
 * 统计后端（activity 批）尚未上线，所有请求都会失败 —— 那就显示「未启用」，
 * 组件存在的意义是占住侧栏位置并把协议先定下来：API 上线后这里无需改版。
 * 每 60s 轮询一次；设备切换立即重查。所有失败都静默，不 toast。
 *
 * 为什么直接 fetch 而不走 AgentClient：AgentClient.req 是 private
 * （lib/api.ts 的封装约定：外部调用点走类上的公开方法），而状态位这种
 * 「可能 404 的探测接口」不值得为它加公开方法 —— 就地 fetch 最小。
 */
type PillState = 'collecting' | 'resting' | 'stopped' | 'unsupported'

const LABEL: Record<PillState, string> = {
  collecting: '采集中',
  resting: '休息中',
  stopped: '已停止',
  unsupported: '未启用',
}

const DOT: Record<PillState, string> = {
  collecting: 'bg-ok',
  resting: 'bg-warn',
  stopped: 'bg-faint',
  unsupported: 'bg-faint',
}

/** 请求失败/解析不出来时一律按「未启用」处理，别让侧栏抖出错误态 */
async function probe(device: PairedDevice): Promise<PillState> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(`${baseUrl(device)}/activity/status`, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: device.token ? { Authorization: `Bearer ${device.token}` } : {},
    })
    if (!res.ok) return 'unsupported'
    const j = (await res.json()) as { enabled?: boolean; collecting?: boolean; idle?: boolean }
    if (j.enabled === false) return 'stopped'
    if (j.idle === true) return 'resting'
    if (j.enabled === true) return 'collecting'
    return 'unsupported'
  } catch {
    return 'unsupported'
  } finally {
    clearTimeout(timer)
  }
}

export function ActivityStatusPill() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const active = devices.find((d) => d.id === activeId) ?? devices[0] ?? null
  const [state, setState] = useState<PillState>('unsupported')
  const nonceRef = useRef(0)

  useEffect(() => {
    if (!active) return
    let alive = true
    const tick = async () => {
      const n = ++nonceRef.current
      const next = await probe(active)
      if (alive && n === nonceRef.current) setState(next)
    }
    void tick()
    const t = window.setInterval(tick, 60_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [active?.id, active?.host, active?.port, active?.tls, active?.local, active?.token])

  return (
    <div className="flex items-center gap-2 px-1 text-[11px] text-muted" title="被控端活动采集状态">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state]}`} />
      <span className="truncate">活动采集 · {LABEL[state]}</span>
    </div>
  )
}
