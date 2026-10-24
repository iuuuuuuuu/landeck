import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, EmptyState, Modal, Skeleton } from '../components/ui'
import { CalendarClock, Plus, RotateCw } from 'lucide-react'
import type { Schedule } from '../lib/types'
import { useApp } from '../store/app'
import { useClient } from '../lib/hooks'
import { useFetch } from '../components/device/useFetch'
import { DeviceSelect } from '../components/device/DeviceSelect'
import { ScheduleCard } from '../components/device/ScheduleCard'
import { ScheduleModal } from '../components/device/ScheduleModal'
import { AuthLost } from '../components/device/AuthLost'
import { errText, isAuthError } from '../components/device/apiHelpers'

export default function Schedules() {
  const devices = useApp((s) => s.devices)
  const activeId = useApp((s) => s.activeId)
  const toast = useApp((s) => s.toast)

  const [deviceId, setDeviceId] = useState<string | null>(activeId ?? devices[0]?.id ?? null)
  const device = useMemo(
    () => devices.find((d) => d.id === deviceId) ?? devices[0] ?? null,
    [devices, deviceId],
  )
  const client = useClient(device)

  const [authLost, setAuthLost] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<{ open: boolean; target: Schedule | null }>({
    open: false,
    target: null,
  })
  const [deleting, setDeleting] = useState<Schedule | null>(null)

  useEffect(() => {
    if (device && device.id !== deviceId) setDeviceId(device.id)
  }, [device, deviceId])

  const list = useFetch(
    client ? () => client.schedules() : null,
    [client?.target.host, client?.target.port, client?.token],
    () => setAuthLost(true),
  )
  const items = list.data?.items ?? []

  const patch = useCallback(
    async (next: Schedule) => {
      if (!client) return
      setBusyId(next.id)
      try {
        await client.updateSchedule(next)
        toast({ kind: 'ok', title: next.enabled ? '任务已启用' : '任务已暂停' })
        list.reload()
      } catch (e) {
        if (isAuthError(e)) setAuthLost(true)
        toast({ kind: 'error', title: '更新失败', desc: errText(e) })
      } finally {
        setBusyId(null)
      }
    },
    [client, list, toast],
  )

  const save = async (draft: Omit<Schedule, 'id'>) => {
    if (!client) return
    setSaving(true)
    try {
      if (editor.target) await client.updateSchedule({ ...draft, id: editor.target.id })
      else await client.createSchedule(draft)
      toast({ kind: 'ok', title: editor.target ? '任务已保存' : '任务已创建' })
      setEditor({ open: false, target: null })
      list.reload()
    } catch (e) {
      if (isAuthError(e)) setAuthLost(true)
      toast({ kind: 'error', title: '保存失败', desc: errText(e) })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (target: Schedule) => {
    if (!client) return
    setDeleting(null)
    setBusyId(target.id)
    try {
      await client.deleteSchedule(target.id)
      toast({ kind: 'ok', title: '任务已删除' })
      list.reload()
    } catch (e) {
      if (isAuthError(e)) setAuthLost(true)
      toast({ kind: 'error', title: '删除失败', desc: errText(e) })
    } finally {
      setBusyId(null)
    }
  }

  if (authLost) return <AuthLost />

  return (
    <div className="space-y-3">
      {devices.length > 0 && (
        <Card padded={false} className="flex flex-wrap items-center gap-2 p-2.5">
          <DeviceSelect
            devices={devices}
            value={device?.id ?? null}
            onChange={setDeviceId}
          />
          <span className="hidden text-[11.5px] text-faint sm:inline">
            共 <span className="num text-fg-soft">{items.length}</span> 个任务
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              className="h-10 w-10 shrink-0 p-0"
              aria-label="刷新任务列表"
              onClick={list.reload}
              disabled={list.loading}
            >
              <RotateCw size={14} className={list.loading ? 'animate-spin' : undefined} />
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={15} />}
              onClick={() => setEditor({ open: true, target: null })}
              disabled={!device}
            >
              新建
            </Button>
          </div>
        </Card>
      )}

      {devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock size={26} />}
            title="还没有已配对的设备"
            desc="定时任务挂在具体设备上，先扫描并配对一台电脑。"
          />
        </Card>
      ) : (
        <>
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
                  title="任务列表加载失败"
                  desc={errText(list.error)}
                  action={
                    <Button variant="secondary" onClick={list.reload}>
                      重试
                    </Button>
                  }
                />
              </Card>
            ) : items.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<CalendarClock size={26} />}
                  title="还没有定时任务"
                  desc="例如：每天 23:30 关机、工作日 08:00 唤醒、下班后自动静音。"
                  action={
                    <Button
                      variant="primary"
                      icon={<Plus size={15} />}
                      onClick={() => setEditor({ open: true, target: null })}
                    >
                      新建定时任务
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
        </>
      )}

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
        title="删除定时任务"
        desc={`「${deleting?.name ?? ''}」将被永久删除，已执行过的记录不受影响。`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => deleting && void remove(deleting)}>
              删除
            </Button>
          </>
        }
      />
    </div>
  )
}
