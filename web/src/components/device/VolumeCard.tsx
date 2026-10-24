import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Card, IconButton, SectionTitle, Slider, Spinner, Toggle } from '../ui'
import { Minus, Plus, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import { isAuthError } from './apiHelpers'
import { useActionRunner } from './useActionRunner'

const STEP = 5
const DEBOUNCE_MS = 300

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function VolumeCard({
  client,
  onAuthError,
}: {
  client: AgentClient | null
  onAuthError?: () => void
}) {
  const { pending, run } = useActionRunner(client, onAuthError)
  const [value, setValue] = useState(60)
  const [muted, setMuted] = useState(false)
  /** 是否从系统读到了真实音量；false 时只当作本地估计，不报具体百分比 */
  const [known, setKnown] = useState(false)
  const [probing, setProbing] = useState(true)
  const timer = useRef<number | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  /** 拉一次真值；known=false 时保留本地估计，只同步静音态 */
  const sync = useCallback(async () => {
    if (!client) {
      setProbing(false)
      return
    }
    try {
      const v = await client.volume()
      if (!alive.current) return
      setKnown(v.known)
      setMuted(v.muted)
      if (v.known) setValue(clamp(v.level))
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      // 老版本 Agent 没有 /volume：保持本地估计
    } finally {
      if (alive.current) setProbing(false)
    }
  }, [client, onAuthError])

  useEffect(() => {
    setKnown(false)
    setProbing(true)
    setValue(60)
    setMuted(false)
    void sync()
  }, [sync])

  const commit = (next: number) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      void (async () => {
        const res = await run('volume.set', { value: next })
        if (res) await sync()
      })()
    }, DEBOUNCE_MS)
  }

  const onSlide = (next: number) => {
    setValue(next)
    commit(next)
  }

  const step = async (dir: 1 | -1) => {
    const action = dir > 0 ? 'volume.up' : 'volume.down'
    const res = await run(action, { step: STEP })
    if (!res) return
    setValue((v) => clamp(v + dir * STEP))
    await sync()
  }

  const toggleMute = async () => {
    const next = !muted
    const res = await run('volume.toggle_mute')
    if (!res) return
    setMuted(next)
    await sync()
  }

  const stepping = pending === 'volume.up' || pending === 'volume.down'
  const Icon = muted ? VolumeX : value >= 55 ? Volume2 : value > 0 ? Volume1 : VolumeX

  return (
    <Card className="flex h-full flex-col">
      <SectionTitle
        title="音量"
        desc={known ? '拖动即时预览，松手后写入设备' : '未读到系统音量，以下为本地估计'}
        icon={<Volume2 size={16} />}
        action={
          <div className="flex items-center gap-1.5">
            {muted && <Badge tone="warn">已静音</Badge>}
            {probing ? (
              <Spinner size={14} className="text-muted" />
            ) : known ? (
              <>
                <span className="num text-[22px] font-semibold leading-none text-fg">{value}</span>
                <span className="text-[12px] text-muted">%</span>
              </>
            ) : (
              <span className="num text-[15px] font-medium leading-none text-muted">未校准</span>
            )}
          </div>
        }
      />

      <div className="mt-5 flex items-center gap-3">
        <IconButton label="音量减 5" onClick={() => void step(-1)} disabled={stepping}>
          {pending === 'volume.down' ? <Spinner size={15} /> : <Minus size={16} />}
        </IconButton>

        <div className="min-w-0 flex-1">
          <Slider
            value={value}
            onChange={onSlide}
            min={0}
            max={100}
            step={1}
            tone={muted ? 'warn' : 'accent'}
            className={muted ? 'opacity-60' : undefined}
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
            <span className="inline-flex items-center gap-1">
              <Icon size={11} />
              {muted ? '静音中' : value === 0 ? '无声' : '可听'}
            </span>
            <span className="num">{known ? `${value} / 100` : '本地估计'}</span>
          </div>
        </div>

        <IconButton label="音量加 5" onClick={() => void step(1)} disabled={stepping}>
          {pending === 'volume.up' ? <Spinner size={15} /> : <Plus size={16} />}
        </IconButton>
      </div>

      <div className="mt-auto border-t border-white/6 pt-3.5">
        <Toggle
          checked={muted}
          onChange={() => void toggleMute()}
          label="静音"
          desc="仅影响系统输出，不中断正在播放的媒体"
        />
      </div>
    </Card>
  )
}
