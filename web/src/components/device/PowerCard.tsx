import { useState } from 'react'
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

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {safe.map((item) => (
          <PowerButton
            key={item.action}
            item={item}
            busy={pending === item.action}
            disabled={powerOff || pending !== null}
            onClick={() => void exec(item)}
          />
        ))}
      </div>

      {risky.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {risky.map((item) => (
            <PowerButton
              key={item.action}
              item={item}
              quiet
              busy={pending === item.action}
              disabled={powerOff || pending !== null}
              onClick={() => void exec(item)}
            />
          ))}
        </div>
      )}

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
        'group flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl border transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        quiet
          ? 'border-white/[0.07] bg-transparent text-muted hover:border-white/12 hover:bg-white/[0.05] hover:text-fg-soft'
          : 'border-white/10 bg-white/[0.05] text-fg-soft hover:bg-white/[0.09] hover:text-fg',
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
      <span className="text-[12.5px] font-medium leading-none">{item.label}</span>
    </button>
  )
}
