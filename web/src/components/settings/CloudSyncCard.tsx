import { useEffect, useState } from 'react'
import { Button, Card, Field, Input, Skeleton, Toggle } from '../ui'
import { useAsync } from '../../lib/hooks'
import { useApp, type PairedDevice } from '../../store/app'
import { useT } from '../../i18n'
import {
  fetchSyncSettings,
  fetchSyncStatus,
  postSyncNow,
  putSyncSettings,
  type SyncNowResult,
  type SyncSettings,
} from '../../lib/syncApi'
import { apiErrorMessage } from '../pair/errors'

/**
 * 十期 A1 云同步卡（WebDAV）。设置页独立卡——活动记录默认只存本机，
 * 同步是可选项；内容含窗口标题（敏感），卡内明确告知；截图永不同步。
 *
 * 后端未上线（404/501）时整卡降级为「功能未上线」提示，不影响设置页其余部分。
 * password：GET 拿到的是打码值；只有用户重新输入才回传（putSyncSettings 已处理
 * 空值不回写，避免把 •••• 写回覆盖真实密码）。
 */
export function CloudSyncCard({ device }: { device: PairedDevice }) {
  const t = useT('sync')
  const settingsQ = useAsync(
    () => fetchSyncSettings(device),
    [device.host, device.port, device.token],
    { key: `sync.settings:${device.host}:${device.port}`, ttlMs: 30_000 },
  )
  const statusQ = useAsync(
    () => fetchSyncStatus(device),
    [device.host, device.port, device.token],
    { key: `sync.status:${device.host}:${device.port}`, ttlMs: 30_000 },
  )

  // 后端未上线时 fetch 抛 "HTTP 404"（useAsync 的 error 为 string）
  const notAvailable = settingsQ.error != null && String(settingsQ.error).includes('404')

  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-fg">{t('title')}</h2>
          <p className="mt-0.5 text-[12px] text-muted">{t('desc')}</p>
        </div>
      </div>

      {settingsQ.loading && settingsQ.data == null ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : notAvailable ? (
        <p className="mt-4 text-[12.5px] text-muted">{t('notAvailable')}</p>
      ) : settingsQ.data ? (
        <SyncForm
          device={device}
          initial={settingsQ.data}
          onSaved={() => {
            void settingsQ.reload()
            void statusQ.reload()
          }}
        />
      ) : (
        <p className="mt-4 text-[12.5px] text-danger">{settingsQ.error}</p>
      )}

      {statusQ.data && (statusQ.data.devices?.length ?? 0) > 0 && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <div className="text-[12.5px] font-medium text-fg-soft">{t('devicesTitle')}</div>
          <ul className="mt-2 space-y-1.5">
            {(statusQ.data.devices ?? []).map((d) => (
              <li key={d.deviceId} className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 truncate text-fg">{d.name}</span>
                <span className="num shrink-0 text-[11.5px] text-muted">
                  {t('deviceSegments', { count: d.segments })}
                  {d.lastSeenAt ? ` · ${t('lastSeen', { when: d.lastSeenAt })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {statusQ.data?.lastError ? (
        <p className="mt-3 text-[12px] text-danger">{t('lastError', { err: statusQ.data.lastError })}</p>
      ) : null}

      {/* 隐私告知（契约要求） */}
      <p className="mt-3 border-t border-line-soft pt-2 text-[11px] text-faint">{t('privacyNote')}</p>
    </Card>
  )
}

function SyncForm({
  device,
  initial,
  onSaved,
}: {
  device: PairedDevice
  initial: SyncSettings
  onSaved: () => void
}) {
  const t = useT('sync')
  const toast = useApp((s) => s.toast)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [url, setUrl] = useState(initial.url)
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState('')
  const [intervalSec, setIntervalSec] = useState(String(initial.intervalSec))
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // settings 重拉（保存后）时同步本地表单
  useEffect(() => {
    setEnabled(initial.enabled)
    setUrl(initial.url)
    setUsername(initial.username)
    setIntervalSec(String(initial.intervalSec))
  }, [initial])

  const save = async (enabledNext: boolean) => {
    setBusy(true)
    try {
      await putSyncSettings(device, {
        enabled: enabledNext,
        url: url.trim(),
        username: username.trim(),
        intervalSec: Math.max(30, Number(intervalSec) || 300),
        ...(password ? { password } : {}),
      })
      toast({ kind: 'ok', title: t('savedToast') })
      onSaved()
    } catch (e) {
      toast({ kind: 'error', title: t('saveFailed'), desc: apiErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async () => {
    setSyncing(true)
    try {
      const r: SyncNowResult = await postSyncNow(device)
      toast({
        kind: 'ok',
        title: t('syncDone'),
        desc: t('syncDoneDesc', { pushed: r.pushed, pulled: r.pulled, errors: r.errors.length }),
      })
      onSaved()
    } catch (e) {
      toast({ kind: 'error', title: t('syncFailed'), desc: apiErrorMessage(e) })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <Toggle
        checked={enabled}
        onChange={(v) => {
          setEnabled(v)
          void save(v)
        }}
        label={t('enabledLabel')}
      />
      <Field label={t('urlLabel')}>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://dav.example.com/landeck/"
          className="h-10 w-full"
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label={t('usernameLabel')} className="min-w-0 flex-1">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} className="h-10 w-full" />
        </Field>
        <Field label={t('passwordLabel')} className="min-w-0 flex-1">
          {/* password 输入框：GET 打码显示策略——只在用户重新输入时回传 */}
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={initial.password || t('passwordPlaceholder')}
            className="h-10 w-full"
          />
        </Field>
      </div>
      <Field label={t('intervalLabel')}>
        <Input
          value={intervalSec}
          onChange={(e) => setIntervalSec(e.target.value)}
          inputMode="numeric"
          className="h-10 w-40"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="secondary" onClick={() => void save(enabled)} disabled={busy}>
          {t('saveBtn')}
        </Button>
        <Button variant="primary" onClick={() => void syncNow()} disabled={syncing || busy}>
          {t('syncNowBtn')}
        </Button>
      </div>
    </div>
  )
}
