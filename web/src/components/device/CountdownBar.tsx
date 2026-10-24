import { useEffect, useRef, useState } from 'react'
import { Button, ProgressBar } from '../ui'
import { Timer } from 'lucide-react'

/**
 * 危险动作的倒计时条：5 → 0，期间可取消。
 * 到点只收起 UI，真正的关机由 Agent 执行，不做本地模拟。
 */
export function CountdownBar({
  label,
  until,
  totalSec = 5,
  pending,
  onCancel,
  onDone,
}: {
  label: string
  until: number
  totalSec?: number
  pending?: boolean
  onCancel: () => void
  onDone: () => void
}) {
  const left = useLeftSeconds(until)
  const doneRef = useRef(false)

  useEffect(() => {
    if (left > 0) {
      doneRef.current = false
      return
    }
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }, [left, onDone])

  const pct = Math.max(0, Math.min(100, (left / Math.max(1, totalSec)) * 100))

  return (
    <div className="panel mt-3 flex flex-col gap-2.5 border-warn/30 bg-warn/[0.08] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-warn/30 bg-warn/12 text-warn">
          <Timer size={15} />
        </span>
        <p className="min-w-0 flex-1 text-[13px] text-fg-soft">
          <span className="num font-semibold text-warn">{left}</span> 秒后执行
          <span className="text-fg"> {label}</span>
        </p>
        <Button size="sm" variant="secondary" loading={pending} onClick={onCancel}>
          取消
        </Button>
      </div>
      <ProgressBar value={pct} tone="warn" height={4} />
    </div>
  )
}

function useLeftSeconds(until: number): number {
  const calc = () => Math.max(0, Math.ceil((until - Date.now()) / 1000))
  const [left, setLeft] = useState(calc)
  useEffect(() => {
    setLeft(calc())
    const id = window.setInterval(() => setLeft(calc()), 200)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until])
  return left
}
