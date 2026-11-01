import { Monitor, Radar, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DeviceGridCard } from '../components/layout/DeviceGridCard'
import { useDeviceProbe } from '../components/layout/useDeviceProbe'
import { PageHeader } from '../components/shell'
import {
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
} from '../components/ui'
import { useApp, type PairedDevice } from '../store/app'
import { useT } from '../i18n'

/** 设备页：网格卡片 + 搜索 + 手动刷新；在线状态 10s 轮询，不开 WS */
export default function Devices() {
  const t = useT('devices')
  const tc = useT('common')
  const devices = useApp((s) => s.devices)
  const patchDevice = useApp((s) => s.patchDevice)
  const removeDevice = useApp((s) => s.removeDevice)
  const setActive = useApp((s) => s.setActive)
  const toast = useApp((s) => s.toast)
  const navigate = useNavigate()

  const [q, setQ] = useState('')
  const [nonce, setNonce] = useState(0)
  const probe = useDeviceProbe(devices, 10000, nonce)

  const [renameTarget, setRenameTarget] = useState<PairedDevice | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [removeTarget, setRemoveTarget] = useState<PairedDevice | null>(null)

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase()
    if (!key) return devices
    return devices.filter(
      (d) =>
        d.name.toLowerCase().includes(key) ||
        d.host.includes(key) ||
        `${d.host}:${d.port}`.includes(key),
    )
  }, [devices, q])

  const onlineCount = devices.filter((d) => probe[d.id]?.online === true).length
  const resolved = devices.filter(
    (d) => probe[d.id]?.online !== undefined && probe[d.id]?.online !== null,
  ).length

  const open = (d: PairedDevice) => {
    setActive(d.id)
    navigate(`/devices/${d.id}`)
  }

  const confirmRename = () => {
    if (!renameTarget) return
    const name = renameValue.trim()
    if (!name) return
    patchDevice(renameTarget.id, { name })
    toast({ kind: 'ok', title: '已重命名', desc: `${renameTarget.name} → ${name}` })
    setRenameTarget(null)
  }

  const confirmRemove = () => {
    if (!removeTarget) return
    removeDevice(removeTarget.id)
    toast({
      kind: 'info',
      title: `已解除配对 ${removeTarget.name}`,
      desc: '本机令牌已删除；被控端的客户端记录可在它的「设置」里吊销',
    })
    setRemoveTarget(null)
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-3">
      {/* 扫描入口只有卡内一处（与搜索/刷新同组）；PageHeader 不再放第二个「扫描」 */}
      <PageHeader
        title={t('title')}
        sub={
          <>
            {t('paired', { count: devices.length })}
            {devices.length > 0 && (
              <>
                <span className="text-faint"> · </span>
                {resolved === devices.length ? (
                  <span className={onlineCount > 0 ? 'text-ok' : 'text-faint'}>
                    {t('online', { count: onlineCount })}
                  </span>
                ) : (
                  <span>{tc('status.checking')}</span>
                )}
              </>
            )}
            <span className="hidden text-faint min-[1024px]:inline">
              {' '}
              · {t('refreshHint')}
            </span>
          </>
        }
      />

      {devices.length > 0 && (
        <Card padded={false} className="flex flex-wrap items-center gap-2 p-2.5">
          <div className="relative w-full min-w-0 sm:w-[340px]">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label="搜索设备"
              className="h-10 w-full rounded-xl border border-line bg-elevated pl-9 pr-3 text-[13px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/55 focus:bg-elevated-2"
            />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="secondary" icon={<Radar size={15} />} onClick={() => navigate('/scan')}>
              {tc('actions.scan')}
            </Button>
            <IconButton label={tc('status.checking')} onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw size={16} />
            </IconButton>
          </div>
        </Card>
      )}

      {devices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Monitor size={26} />}
            title={t('empty.title')}
            desc={t('empty.desc')}
            action={
              <Button
                variant="primary"
                icon={<Radar size={16} />}
                onClick={() => navigate('/scan')}
              >
                {t('empty.action')}
              </Button>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search size={24} />}
            title={t('noMatch.title')}
            desc={t('noMatch.desc', { q: q.trim() })}
            action={<Button onClick={() => setQ('')}>{t('noMatch.clear')}</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
          {filtered.map((d) => (
            <DeviceGridCard
              key={d.id}
              device={d}
              token={d.token}
              probe={probe[d.id]}
              onOpen={() => open(d)}
              onRename={() => {
                setRenameValue(d.name)
                setRenameTarget(d)
              }}
              onRemove={() => setRemoveTarget(d)}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title={t('rename.title')}
        desc={t('rename.desc')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              {tc('actions.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!renameValue.trim()}
              onClick={confirmRename}
            >
              {tc('actions.save')}
            </Button>
          </>
        }
      >
        <Field label={t('rename.label')}>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={32}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename()
            }}
          />
        </Field>
      </Modal>

      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="解除配对"
        desc={`将从本机删除「${removeTarget?.name ?? ''}」的访问令牌，之后需要重新配对才能控制它。`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={confirmRemove}>
              解除配对
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-line-soft bg-elevated px-3 py-2.5 text-[12px] leading-relaxed text-muted">
          设备本身不会关机或重启；如需一并吊销服务端令牌，请配对后到被控端「设置 → 配对与安全」里删除该客户端。
        </div>
      </Modal>
    </div>
  )
}
