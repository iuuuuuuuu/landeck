import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { Card, SectionTitle, Skeleton, Spinner } from '../ui'
import { Music2, Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { MediaInfo } from '../../lib/types'
import { useActionRunner } from './useActionRunner'

/** 发出指令后最多等这么久，超时就撤掉 loading（WS 帧 2s 一帧，留半帧余量） */
const LOCK_MAX_MS = 2500
/** 最短驻留：回帧太快时也撑住，避免「点了没反应」的错觉导致连点 */
const LOCK_MIN_MS = 500
/** 本地进度条推进步长 */
const TICK_MS = 500

interface Control {
  action: string
  label: string
  Icon: LucideIcon
  main?: boolean
}

const CONTROLS: Control[] = [
  { action: 'media.prev', label: '上一首', Icon: SkipBack },
  { action: 'media.play_pause', label: '播放 / 暂停', Icon: Play, main: true },
  { action: 'media.next', label: '下一首', Icon: SkipForward },
  { action: 'media.stop', label: '停止', Icon: Square },
]

interface Lock {
  action: string
  at: number
  /** 期望的播放态；null 表示无法预测（切歌），任何新帧都算数 */
  expect: boolean | null
}

/** 服务端 updatedAt 是 Unix 秒，这里兼容毫秒；与本机时钟差太多就当不可信 */
function reportedMs(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0
  const ms = v > 1e11 ? v : v * 1000
  return Math.abs(Date.now() - ms) > 60_000 ? 0 : ms
}

/** 播放器标识（AUMID / 进程名）→ 可读来源名 */
function appLabel(raw: string | undefined): string {
  const v = (raw ?? '').trim()
  if (!v) return ''
  const tail = v.split(/[\\/]/).pop() ?? v
  const bare = tail.split('!')[0].replace(/\.exe$/i, '')
  const known: Record<string, string> = {
    spotify: 'Spotify',
    chrome: 'Chrome',
    msedge: 'Edge',
    firefox: 'Firefox',
    vlc: 'VLC',
    foobar2000: 'foobar2000',
    musicbee: 'MusicBee',
    potplayermini64: 'PotPlayer',
    potplayermini: 'PotPlayer',
    cloudmusic: '网易云音乐',
    qqmusic: 'QQ 音乐',
    kugou: '酷狗音乐',
    kuwo: '酷我音乐',
    zunemusic: '媒体播放器',
    'microsoft.zunemusic': '媒体播放器',
    'microsoft.media.player': '媒体播放器',
    applicationframehost: '系统应用',
  }
  const key = bare.toLowerCase()
  if (known[key]) return known[key]
  const hit = Object.keys(known).find((k) => key.includes(k))
  return hit ? known[hit] : bare
}

function mmss(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

export function MediaCard({
  client,
  media,
  onAuthError,
}: {
  client: AgentClient | null
  media: MediaInfo | null
  onAuthError?: () => void
}) {
  const { pending, run } = useActionRunner(client, onAuthError)
  const [lock, setLock] = useState<Lock | null>(null)
  const mediaRef = useRef(media)

  const playing = media?.playing === true
  const active = media?.active === true
  /** known=false 时状态位不可信；但不拦控制指令 */
  const known = media?.known !== false
  const controllable = client !== null && media !== null && (active || !known)
  const duration = media?.durationSec && media.durationSec > 0 ? media.durationSec : 0
  const hasProgress = duration > 0

  // 锁定期间每 200ms 复核：真实 playing 到位 / 会话消失 / 2.5s 兜底，任一命中即撤 loading
  useEffect(() => {
    mediaRef.current = media
    if (!lock) return
    const id = window.setInterval(() => {
      const elapsed = Date.now() - lock.at
      if (elapsed >= LOCK_MAX_MS) {
        setLock(null)
        return
      }
      if (elapsed < LOCK_MIN_MS) return
      const m = mediaRef.current
      if (!m) {
        setLock(null)
        return
      }
      if (lock.expect === null || m.playing === lock.expect || !m.active) setLock(null)
    }, 200)
    return () => window.clearInterval(id)
  }, [media, lock])

  // 帧锚点：优先设备时间轴（与本机时钟差太大则退回本地接收时刻），副作用里取时间以保持渲染纯净
  const [anchor, setAnchor] = useState({ pos: 0, at: 0 })
  useEffect(() => {
    setAnchor(
      media
        ? { pos: media.positionSec ?? 0, at: reportedMs(media.updatedAt) || Date.now() }
        : { pos: 0, at: 0 },
    )
  }, [media])

  // 本地进度钟：播放中且有总时长才 500ms 推进一次，暂停即冻结
  const [nowMs, setNowMs] = useState(0)
  useEffect(() => {
    setNowMs(Date.now())
    if (!playing || !hasProgress) return
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [playing, hasProgress, anchor])

  const advance = playing && hasProgress && nowMs > anchor.at ? (nowMs - anchor.at) / 1000 : 0
  const raw = anchor.pos + advance
  const position = hasProgress ? Math.min(Math.max(0, raw), duration) : Math.max(0, raw)
  const pct = hasProgress ? (position / duration) * 100 : 0

  if (!media) {
    return (
      <Card className="flex h-full min-w-0 flex-col">
        <SectionTitle
          title="媒体"
          desc="正在读取系统媒体会话…"
          icon={<Music2 size={16} />}
          action={<Spinner size={14} className="text-muted" />}
        />
        <div className="mt-3.5 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
        <Skeleton className="mt-3.5 h-1.5 w-full rounded-full" />
        <div className="mt-4 flex items-center justify-center gap-2.5">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-full" />
        </div>
      </Card>
    )
  }

  const title = media.title?.trim() || '未在播放'
  const subtitle =
    [media.artist, media.album]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(' · ') || (active ? '未知曲目信息' : '—')
  const app = appLabel(media.app)
  const busy = pending !== null || lock !== null
  const statusText = !known ? '状态未知' : !active ? '无媒体会话' : playing ? '播放中' : '已暂停'
  const hint = !known
    ? '无法读取播放状态（该平台需安装 nowplaying-cli），控制指令仍可发送。'
    : !active
      ? '当前没有媒体在播放，打开播放器后这里会自动同步。'
      : lock
        ? '已发送指令，等待设备回传最新状态…'
        : '状态来自系统媒体会话（SMTC / MPRIS），约 2 秒刷新一次。'

  const exec = async (action: string) => {
    if (!controllable || busy) return
    const expect: boolean | null =
      action === 'media.play_pause' ? !playing : action === 'media.stop' ? false : null
    setLock({ action, at: Date.now(), expect })
    const res = await run(action)
    if (!res) setLock(null)
  }

  return (
    <Card className="flex h-full min-w-0 flex-col">
      <SectionTitle
        title="媒体"
        desc={active ? `来源 ${app || '未知播放器'}` : '系统媒体会话'}
        icon={<Music2 size={16} />}
        action={
          <span
            className={clsx(
              'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium',
              playing
                ? 'border-ok/30 bg-ok/12 text-ok'
                : !known
                  ? 'border-warn/30 bg-warn/12 text-warn'
                  : 'border-line bg-elevated text-fg-soft',
            )}
          >
            <span
              className={clsx(
                'h-1.5 w-1.5 rounded-full bg-current',
                playing && 'animate-pulse',
              )}
            />
            {statusText}
          </span>
        }
      />

      <div className="mt-3.5 min-w-0">
        <p className="truncate text-[14px] font-medium leading-snug text-fg" title={title}>
          {title}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-muted" title={subtitle}>
          {subtitle}
        </p>
        {app && (
          <span className="chip mt-1.5 h-[22px] px-2 text-[10.5px]">
            <Music2 size={10} />
            {app}
          </span>
        )}
      </div>

      {hasProgress ? (
        <div className="mt-3.5">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, pct))}%`,
                background: 'linear-gradient(90deg, var(--tone-accent-a), var(--tone-accent-b))',
                transition: `width ${TICK_MS}ms linear`,
              }}
            />
          </div>
          <div className="num mt-1.5 text-right text-[11px] leading-none text-faint">
            {mmss(position)} / {mmss(duration)}
          </div>
        </div>
      ) : (
        <div className="mt-3.5 flex h-[26px] items-center text-[11px] text-faint">
          {active ? '无时长信息（直播或网页播放）' : '\u00a0'}
        </div>
      )}

      <div className="mt-3.5 flex items-center justify-center gap-2.5 sm:gap-3.5">
        {CONTROLS.map((item) => {
          const spinning = lock?.action === item.action || pending === item.action
          const Icon = item.main ? (playing ? Pause : Play) : item.Icon
          return (
            <button
              key={item.action}
              type="button"
              aria-label={item.label}
              title={item.label}
              aria-pressed={item.main ? playing : undefined}
              disabled={!controllable || busy}
              onClick={() => void exec(item.action)}
              className={clsx(
                'grid shrink-0 place-items-center rounded-full border transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-40',
                item.main
                  ? 'grad-primary h-14 w-14 border-line-strong text-white shadow-glow hover:brightness-110'
                  : 'h-11 w-11 border-line bg-elevated text-fg-soft hover:bg-elevated-2 hover:text-fg',
              )}
            >
              {spinning ? (
                <Spinner size={item.main ? 20 : 16} />
              ) : (
                <Icon size={item.main ? 22 : 17} className={item.main ? 'ml-0.5' : undefined} />
              )}
            </button>
          )
        })}
      </div>

      <p className="mt-auto min-h-[2.6em] pt-3 text-[11px] leading-snug text-faint">{hint}</p>
    </Card>
  )
}
