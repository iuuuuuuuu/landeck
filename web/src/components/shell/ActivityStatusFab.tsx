import { useEffect, useRef, useState } from 'react'
import { baseUrl } from '../../lib/api'
import { useApp } from '../../store/app'
import { useT } from '../../i18n'
import type { PairedDevice } from '../../store/app'

/**
 * 移动端浮动「采集状态位」（B5：与侧栏同逻辑的可点击停/恢复）。
 *
 * 为什么放 tab bar 上方右侧：底栏四个一级位已满，采集状态是全局状态不是页面，
 * 做成小浮动圆钮（状态点为主、不占导航位），点击语义与侧栏一致。
 * 乐观更新 + 失败回滚；60s 轮询校准。失败静默（移动端没有 toast 宿主上下文差异，
 * 与侧栏同口径）。
 */
type PillState = 'collecting' | 'resting' | 'stopped' | 'unsupported'

const DOT: Record<PillState, string> = {
  collecting: 'bg-ok',
  resting: 'bg-warn',
  stopped: 'bg-danger',
  unsupported: 'bg-faint',
}

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

export function ActivityStatusFab() {
  const t = useT('nav')
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
    // 语义对齐侧栏：采集中/休息中 点击 = 停止；已停止 点击 = 恢复
    if (state === 'unsupported') return
    const prev = state
    const next = prev === 'stopped' ? 'collecting' : 'stopped'
    setBusy(true)
    setState(next)
    const ok = await setEnabled(active, next === 'collecting')
    setBusy(false)
    if (!ok) setState(prev)
  }

  const clickable = !!active && state !== 'unsupported' && !busy

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!clickable}
      title={clickable ? t('collection.toggleHint') : t('collection.label')}
      aria-label={t('collection.label') + ' · ' + t('collection.' + state)}
      className="pointer-events-auto fixed right-3 z-30 flex h-9 items-center gap-1.5 rounded-full border border-line bg-glass px-3 text-[11px] text-fg-soft shadow-lift backdrop-blur-xl transition-colors enabled:hover:bg-elevated-2 disabled:cursor-default min-[1024px]:hidden"
      style={{ bottom: 'calc(5.25rem + max(env(safe-area-inset-bottom), var(--ldk-safe-bottom, 0px)))' }}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state]}`} />
      <span className="truncate">{t('collection.' + state)}</span>
    </button>
  )
}
