import { useCallback, useState, type ReactNode } from 'react'
import { Button, Card, EmptyState, Modal, Skeleton } from '../components/ui'
import { CalendarClock, Plus, RotateCw } from 'lucide-react'
import type { AgentClient } from '../lib/api'
import type { Schedule } from '../lib/types'
import type { PairedDevice } from '../store/app'
import { useApp } from '../store/app'
import { LOCAL_DOWN_HINT, useActiveTarget } from '../lib/useActiveTarget'
import { useFetch } from '../components/device/useFetch'
import { schedulesKey } from '../lib/keys'
import { DevicePicker } from '../components/shell'
import { ScheduleCard } from '../components/device/ScheduleCard'
import { ScheduleModal } from '../components/device/ScheduleModal'
import { AuthLost } from '../components/device/AuthLost'
import { errText, isAuthError } from '../components/device/apiHelpers'
import { PageHeader } from '../components/shell'
import { useT } from '../i18n'

/**
 * 定时任务面板：任务列表 + 新建 / 编辑 / 启停 / 删除。
 * 只针对传入的这台设备，不再让用户在弹层里选设备。
 */
export function SchedulesPanel({
  device,
  client,
  isLocal = false,
  onAuthError,
  /** 页头附加控件（独立页放设备选择器；详情页抽屉不传） */
  headerExtra,
}: {
  device: PairedDevice
  client: AgentClient
  isLocal?: boolean
  onAuthError?: () => void
  headerExtra?: ReactNode
}) {
  const t = useT('schedules')
  const toast = useApp((s) => s.toast)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<{ open: boolean; target: Schedule | null }>({
    open: false,
    target: null,
  })
  const [deleting, setDeleting] = useState<Schedule | null>(null)

  const list = useFetch(
    () => client.schedules(),
    [device.id, client.target.host, client.target.port, client.token],
    onAuthError,
    // 与设备详情页的「定时任务」卡共用缓存；增删改后会 reload()
    { key: schedulesKey(client), ttlMs: 60_000 },
  )
  const items = list.data?.items ?? []

  const patch = useCallback(
    async (next: Schedule) => {
      setBusyId(next.id)
      try {
        await client.updateSchedule(next)
        toast({ kind: 'ok', title: next.enabled ? t('toast.enabled') : t('toast.paused') })
        list.reload()
      } catch (e) {
        if (isAuthError(e)) onAuthError?.()
        toast({ kind: 'error', title: t('toast.updateFailed'), desc: errText(e) })
      } finally {
        setBusyId(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, list, toast, onAuthError],
  )

  const save = async (draft: Omit<Schedule, 'id'>) => {
    setSaving(true)
    try {
      if (editor.target) await client.updateSchedule({ ...draft, id: editor.target.id })
      else await client.createSchedule(draft)
      toast({ kind: 'ok', title: editor.target ? t('toast.saved') : t('toast.created') })
      setEditor({ open: false, target: null })
      list.reload()
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      toast({ kind: 'error', title: t('toast.saveFailed'), desc: errText(e) })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (target: Schedule) => {
    setDeleting(null)
    setBusyId(target.id)
    try {
      await client.deleteSchedule(target.id)
      toast({ kind: 'ok', title: t('toast.deleted') })
      list.reload()
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      toast({ kind: 'error', title: t('toast.deleteFailed'), desc: errText(e) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title={t('title')}
        sub={
          <>
            {t('subtitle')}
            <span className="text-faint"> · </span>
            {t('count', { count: items.length })}
          </>
        }
        actions={
          <>
            {headerExtra}
            <Button
              variant="secondary"
              size="md"
              aria-label={t("actions.refresh")}
              icon={<RotateCw size={14} className={list.loading ? 'animate-spin' : undefined} />}
              onClick={list.reload}
              disabled={list.loading}
            >
              {t("actions.refresh")}
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={15} />}
              onClick={() => setEditor({ open: true, target: null })}
            >
              {t("actions.create")}
            </Button>
          </>
        }
      />

      <div>
        {list.loading && !list.data ? (
          <ul className="space-y-3">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-[104px] w-full rounded-[22px]" />
              </li>
            ))}
          </ul>
        ) : list.error ? (
          <Card>
            <EmptyState
              icon={<RotateCw size={24} />}
              title={isLocal ? t('error.local') : t('error.load')}
              desc={isLocal ? `${errText(list.error)} · ${LOCAL_DOWN_HINT}` : errText(list.error)}
              action={
                <Button variant="secondary" onClick={list.reload}>
                  {t("actions.retry")}
                </Button>
              }
            />
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarClock size={26} />}
              title={t("empty.title")}
              desc={t("empty.desc")}
              action={
                <Button
                  variant="primary"
                  icon={<Plus size={15} />}
                  onClick={() => setEditor({ open: true, target: null })}
                >
                  {t("actions.createFirst")}
                </Button>
              }
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                busy={busyId === s.id}
                onToggle={(target, enabled) => void patch({ ...target, enabled })}
                onEdit={(target) => setEditor({ open: true, target })}
                onDelete={setDeleting}
              />
            ))}
          </ul>
        )}
      </div>

      <ScheduleModal
        open={editor.open}
        initial={editor.target}
        saving={saving}
        onClose={() => setEditor({ open: false, target: null })}
        onSubmit={(draft) => void save(draft)}
      />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("delete.title")}
        desc={t("delete.desc", { name: deleting?.name ?? '' })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t("actions.cancel")}
            </Button>
            <Button variant="danger" onClick={() => deleting && void remove(deleting)}>
              {t("actions.delete")}
            </Button>
          </>
        }
      />
    </div>
  )
}

/**
 * 历史独立页：路由已重定向到 /devices，保留页面外壳（设备下拉 + 本机目标），
 * 方便以后再次挂载，也保证本文件自洽。
 */
export default function Schedules() {
  const t = useT('schedules')
  const { devices, device, deviceId, setDeviceId, isLocal, pairedCount, client } = useActiveTarget()
  const [authLostFor, setAuthLostFor] = useState<string | null>(null)
  const authLost = authLostFor === deviceId

  /** 本机的 401 不是「配对失效」，没有重新配对这回事 */
  const onAuthError = useCallback(() => {
    if (!isLocal) setAuthLostFor(deviceId)
  }, [isLocal, deviceId])

  if (authLost) return <AuthLost />

  return (
    <div className="space-y-3">
      {/* 设备选择并入 PageHeader actions（旧版是页顶孤立卡片条，QA 走查判为必修） */}
      <SchedulesPanel
        device={device}
        client={client}
        isLocal={isLocal}
        onAuthError={onAuthError}
        headerExtra={
          <>
            <DevicePicker devices={devices} value={deviceId} onChange={setDeviceId} />
            {pairedCount === 0 && (
              <span className="text-[11.5px] text-faint">{t("noPairedHint")}</span>
            )}
          </>
        }
      />
    </div>
  )
}
