import { useEffect, useRef, useState } from 'react'
import { baseUrl } from '../../lib/api'
import { useApp } from '../../store/app'
import type { PairedDevice } from '../../store/app'

/**
 * 侧栏底部的「采集状态位」（Hindsight 的 Resting 同位）——**可点击停/恢复**。
 *
 * 读当前活跃设备 agent 的 GET /activity/status：
 *   { enabled: boolean, collecting?: boolean, idle?: boolean }
 * 映射：未启用（404/出错）/ 已停止 / 休息中（闲置或不在工作时段）/ 采集中。
 *
 * 七期 B5：点击 → PUT /activity/settings { enabled: 取反 }（agent 的部分更新语义，
 * 只带 enabled 字段不会动其他设置）。乐观更新：状态先翻转，请求失败回滚并 toast。
 * 每 60s 轮询校准一次；设备切换立即重查。
 *
 * 直接 fetch 而不走 AgentClient：同状态探测的理由——req 是 private，
 * 且这是「可能 404 的探测 + 部分更新」，就地 fetch 最小。
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
  stopped: 'bg-danger',
  unsupported: 'bg-faint',
}

const HOVER_HINT = '点击停止 / 恢复采集'

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

/** 部分更新 enabled；返回是否成功（失败时调用方回滚）。 */
async function setEnabled(device: PairedDevice, enabled: boolean): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(`${baseUrl(device)}/activity/settings`, {
      method: 'PUT',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(device.token ? { Authorization: `Bearer ${device.token}` } : {}),
      },
      body: JSON.stringify({ enabled }),
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function ActivityStatusPill() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const active = devices.find((d) => d.id === activeId) ?? devices[0] ?? null
  const [state, setState] = useState<PillState>('unsupported')
  const [busy, setBusy] = useState(false)
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

  const toggle = async () => {
    if (!active || busy) return
    // 语义对齐 Hindsight：采集中/休息中 点击 = 停止；已停止 点击 = 恢复。
    // 「未启用」（agent 无活动接口）没有可翻的状态，保持纯展示。
    if (state === 'unsupported') return
    const prev = state
    const next = prev === 'stopped' ? 'collecting' : 'stopped'
    setBusy(true)
    setState(next) // 乐观更新
    const ok = await setEnabled(active, next === 'collecting')
    setBusy(false)
    if (!ok) setState(prev) // 失败回滚；下次 60s 轮询也会校准
  }

  const clickable = !!active && state !== 'unsupported' && !busy

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!clickable}
      title={clickable ? HOVER_HINT : `被控端活动采集状态 · ${LABEL[state]}`}
      className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-left text-[11px] text-muted transition-colors enabled:hover:bg-hover enabled:hover:text-fg-soft disabled:cursor-default"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state]}`} />
      <span className="truncate">活动采集 · {LABEL[state]}</span>
    </button>
  )
}
