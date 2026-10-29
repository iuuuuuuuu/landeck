import { CalendarClock, ChevronRight, Plus } from 'lucide-react'
import { Badge, Button, Card, SectionTitle, Skeleton } from '../ui'
import type { AgentClient } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { schedulesKey } from '../../lib/keys'
import type { Schedule } from '../../lib/types'
import { actionLabel } from '../../lib/format'

/**
 * 定时任务速览卡：把任务**直接列在页面上**，不用先点开抽屉。
 *
 * 用户反馈「定时任务直接罗列出来」—— 之前任务藏在「管理工具」抽屉的第二个 tab 里，
 * 想知道自己有没有设定时、定了什么，得点两下才看得到。
 * 现在页面上一眼能看到列表与开关，要增删改再进抽屉。
 */
export function ScheduleListCard({
  client,
  onManage,
}: {
  client: AgentClient | null
  /** 点「管理」或「新建」时打开工具抽屉的定时 tab */
  onManage: () => void
}) {
  const list = useAsync(
    client ? () => client.schedules() : null,
    [client?.target.host, client?.target.port],
    // 定时任务是文本配置，切页回来直接命中；增删改后调用方会 reload()
    { key: schedulesKey(client), ttlMs: 60_000 },
  )
  const items: Schedule[] = list.data?.items ?? []
  const enabled = items.filter((s) => s.enabled).length

  return (
    <Card>
      <SectionTitle
        title="定时任务"
        desc={
          items.length > 0
            ? `共 ${items.length} 条，${enabled} 条已启用`
            : '定时开关机与 RTC 唤醒'
        }
        icon={<CalendarClock size={16} />}
        action={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="primary" onClick={onManage}>
              <Plus size={13} className="mr-1" />
              新建
            </Button>
            <Button size="sm" variant="ghost" onClick={onManage} aria-label="管理定时任务">
              <ChevronRight size={15} />
            </Button>
          </div>
        }
      />

      {list.loading && !list.data ? (
        <div className="mt-3 space-y-1.5">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : list.error ? (
        <p className="mt-3 text-[12px] text-danger">{list.error}</p>
      ) : items.length === 0 ? (
        <button
          type="button"
          onClick={onManage}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-3 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-fg-soft"
        >
          <Plus size={13} />
          还没有定时任务，点这里创建一个
        </button>
      ) : (
        <ul className="mt-2.5 divide-y divide-line-soft">
          {items.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={onManage}
                className="flex w-full items-center gap-2.5 rounded-lg px-1 py-2 text-left transition-colors hover:bg-hover"
              >
                <span className="num w-[64px] shrink-0 text-[13px] font-medium text-fg">
                  {s.when?.kind === 'once'
                    ? (s.when.at || '—').slice(11, 16)
                    : s.when?.time || '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">
                  {s.name || actionLabel(s.action)}
                  <span className="ml-1.5 text-[11px] text-faint">
                    {s.when?.kind === 'once'
                      ? '一次性'
                      : s.when?.weekdays?.length
                        ? s.when.weekdays.map((d) => `周${'一二三四五六日'[d - 1] ?? d}`).join(' ')
                        : '每天'}
                  </span>
                </span>
                <Badge tone={s.enabled ? 'ok' : 'neutral'} dot>
                  {s.enabled ? '已启用' : '已暂停'}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
