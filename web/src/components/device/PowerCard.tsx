import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, Card, Modal, SectionTitle, Spinner } from '../ui'
import { Lock, MonitorOff, Moon, MoonStar, Power, RotateCcw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { SystemInfo } from '../../lib/types'
import { useActionRunner } from './useActionRunner'

type CapKey = 'sleep' | 'hibernate' | 'wake' | 'screenOff'

interface PowerItem {
  action: string
  label: string
  Icon: LucideIcon
  cap?: CapKey
}

/** 高频安全操作排在前，关机/重启降到第二排并弱化 */
const SAFE: PowerItem[] = [
  { action: 'power.lock', label: '锁屏', Icon: Lock },
  { action: 'power.screen_off', label: '关屏', Icon: MonitorOff, cap: 'screenOff' },
  { action: 'power.sleep', label: '睡眠', Icon: Moon, cap: 'sleep' },
  { action: 'power.hibernate', label: '休眠', Icon: MoonStar, cap: 'hibernate' },
]

const RISKY: PowerItem[] = [
  { action: 'power.shutdown', label: '关机', Icon: Power },
  { action: 'power.restart', label: '重启', Icon: RotateCcw },
]

const DELAY_SEC = 5

/**
 * 按钮排布：**每个按钮固定占 1 格**，所有按钮宽度完全相等。
 *
 * 之前的做法是「每行铺满整行」（3 个各占 1/3、2 个各占 1/2），
 * 结果首排按钮 103px、第二排 158px —— 行内对齐了，但两排之间不等宽，
 * 看上去依然乱。现在统一成等宽网格：左边缘对齐、宽度一致，
 * 行末留空也不拉伸按钮。
 *
 * 列数：容器够宽用 3 列（4 个安全操作 = 3+1 行，6 个按钮 = 3+3 行）；
 * 窄容器（<300px，约 320px 视口下的卡片内容区）退化为 2 列。
 */
const WIDE_COLS = 3
const NARROW_COLS = 2
const MIN_WIDE = 300

interface Slot {
  item: PowerItem
  quiet?: boolean
}

/** 按容器实际宽度决定列数：卡片在 3 列栅格里只有 ~350px，不能按视口算 */
function useCols(ref: React.RefObject<HTMLDivElement | null>): number {
  const [cols, setCols] = useState(WIDE_COLS)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (w: number) => setCols(w >= MIN_WIDE ? WIDE_COLS : NARROW_COLS)
    apply(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) apply(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return cols
}

export function PowerCard({
  client,
  system,
  onScheduled,
  onAuthError,
}: {
  client: AgentClient | null
  system: SystemInfo | null
  onScheduled: (label: string, seconds: number) => void
  onAuthError?: () => void
}) {
  const { pending, run } = useActionRunner(client, onAuthError)
  const [confirm, setConfirm] = useState<PowerItem | null>(null)

  const caps = system?.capabilities
  const powerOff = system?.features?.power === false
  const supported = (i: PowerItem) => !i.cap || !caps || caps[i.cap] !== false
  const safe = SAFE.filter(supported)
  const risky = RISKY.filter(supported)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const cols = useCols(gridRef)
  // 所有按钮同尺寸；安全操作在前，关机/重启在后（颜色弱化）
  const slots: Slot[] = [
    ...safe.map((item) => ({ item })),
    ...risky.map((item) => ({ item, quiet: true })),
  ]

  const exec = async (item: PowerItem) => {
    if (item.action === 'power.shutdown' || item.action === 'power.restart') {
      setConfirm(item)
      return
    }
    await send(item)
  }

  const send = async (item: PowerItem) => {
    const isRisky = item.action === 'power.shutdown' || item.action === 'power.restart'
    const params = isRisky ? { delay: DELAY_SEC, force: false } : {}
    const res = await run(item.action, params, `已发送${item.label}指令`)
    if (res && isRisky) onScheduled(item.label, DELAY_SEC)
  }

  return (
    <Card className="flex h-full flex-col">
      <SectionTitle
        title="电源"
        desc={powerOff ? '当前设备已禁用电源控制' : '危险操作会在 5 秒后执行，期间可取消'}
        icon={<Power size={16} />}
      />

      <div
        ref={gridRef}
        className="mt-4 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {slots.map((slot) => (
          <PowerButton
            key={slot.item.action}
            item={slot.item}
            quiet={slot.quiet}
            busy={pending === slot.item.action}
            disabled={powerOff || pending !== null}
            onClick={() => void exec(slot.item)}
          />
        ))}
      </div>

      <p className="mt-auto pt-3 text-[11px] leading-relaxed text-faint">
        关机、重启需二次确认，倒计时内可随时取消。
      </p>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={`确认${confirm?.label ?? ''}？`}
        desc={`电脑将在 ${DELAY_SEC} 秒后${confirm?.label ?? '执行'}，倒计时内可随时取消。未保存的工作可能丢失。`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              再想想
            </Button>
            <Button
              variant="danger"
              loading={pending === confirm?.action}
              onClick={() => {
                const target = confirm
                setConfirm(null)
                if (target) void send(target)
              }}
            >
              确认{confirm?.label ?? ''}
            </Button>
          </>
        }
      />
    </Card>
  )
}

function PowerButton({
  item,
  busy,
  quiet,
  disabled,
  onClick,
}: {
  item: PowerItem
  busy: boolean
  quiet?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'group flex h-[68px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        quiet
          ? 'border-line-soft bg-transparent text-muted hover:border-line-strong hover:bg-hover hover:text-fg-soft'
          : 'border-line bg-elevated text-fg-soft hover:bg-elevated-2 hover:text-fg',
      )}
    >
      {busy ? (
        <Spinner size={17} />
      ) : (
        <item.Icon
          size={18}
          className={
            quiet ? 'text-muted group-hover:text-fg-soft' : 'text-accent-soft group-hover:text-fg'
          }
        />
      )}
      <span className="max-w-full truncate px-1 text-[12.5px] font-medium leading-none">
        {item.label}
      </span>
    </button>
  )
}
