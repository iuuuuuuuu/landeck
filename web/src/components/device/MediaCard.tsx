import clsx from 'clsx'
import { Card, SectionTitle, Spinner } from '../ui'
import { Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { AgentClient } from '../../lib/api'
import { useActionRunner } from './useActionRunner'

interface MediaItem {
  action: string
  label: string
  Icon: LucideIcon
  main?: boolean
}

const ITEMS: MediaItem[] = [
  { action: 'media.prev', label: '上一首', Icon: SkipBack },
  { action: 'media.play_pause', label: '播放/暂停', Icon: Play, main: true },
  { action: 'media.next', label: '下一首', Icon: SkipForward },
  { action: 'media.stop', label: '停止', Icon: Square },
]

export function MediaCard({
  client,
  onAuthError,
}: {
  client: AgentClient | null
  onAuthError?: () => void
}) {
  const { pending, run } = useActionRunner(client, onAuthError)
  const [playing, setPlaying] = useState<boolean | null>(null)

  const exec = async (item: MediaItem) => {
    const res = await run(item.action)
    if (!res) return
    if (item.action === 'media.play_pause') setPlaying((p) => (p === null ? false : !p))
    if (item.action === 'media.stop') setPlaying(false)
  }

  return (
    <Card className="flex h-full flex-col">
      <SectionTitle
        title="媒体"
        desc="作用于当前活动播放器"
        icon={<Play size={16} />}
        action={
          <span className="text-[11.5px] text-faint">
            {playing === null ? '未知状态' : playing ? '播放中' : '已暂停'}
          </span>
        }
      />

      <div className="mt-4 flex flex-1 items-center justify-center gap-2.5 sm:gap-4">
        {ITEMS.map((item) => {
          const busy = pending === item.action
          const ActiveIcon =
            item.action === 'media.play_pause'
              ? playing === true
                ? Pause
                : Play
              : item.Icon
          return (
            <button
              key={item.action}
              type="button"
              aria-label={item.label}
              title={item.label}
              disabled={pending !== null}
              onClick={() => void exec(item)}
              className={clsx(
                'grid shrink-0 place-items-center rounded-full border transition-all disabled:opacity-40',
                item.main
                  ? 'h-16 w-16 border-white/20 bg-[linear-gradient(135deg,#8b6bff_0%,#7c5cff_45%,#22d3ee_140%)] text-white shadow-[0_14px_38px_-14px_rgba(124,92,255,.85)] hover:brightness-110'
                  : 'h-12 w-12 border-white/10 bg-white/[0.055] text-fg-soft hover:bg-white/[0.1] hover:text-fg',
              )}
            >
              {busy ? (
                <Spinner size={item.main ? 22 : 18} />
              ) : (
                <ActiveIcon size={item.main ? 24 : 18} className={item.main ? 'ml-0.5' : undefined} />
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11.5px] text-faint">
        {ITEMS.map((item) => (
          <span key={item.action} className="chip h-[22px] px-2 text-[10.5px]">
            {item.label}
          </span>
        ))}
      </div>
    </Card>
  )
}
