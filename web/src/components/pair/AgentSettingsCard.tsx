import { Save, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AgentClient } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { agentSettingsKey } from '../../lib/keys'
import type { AgentSettings } from '../../lib/types'
import { useApp, type PairedDevice } from '../../store/app'
import { Badge, Button, Card, Field, Input, SectionTitle, Skeleton, Toggle } from '../ui'
import { apiErrorMessage } from './errors'
import { normalizeSettings } from './normalizeSettings'

/** 设置页第 2 组：被控端（Agent）参数 */
export function AgentSettingsCard({ device }: { device: PairedDevice }) {
  const toast = useApp((s) => s.toast)
  const client = new AgentClient(device, device.token)
  const { data, loading, error, reload } = useAsync(
    () => client.settings(),
    [device.id, device.host, device.port, device.token],
    // 被控端参数是静态配置，缓存 5 分钟；保存后会 reload() 强制刷新
    { key: agentSettingsKey(client), ttlMs: 5 * 60_000 },
  )

  const [draft, setDraft] = useState<AgentSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 归一化：后端少给字段时用默认值补齐，避免深层字段读取直接白屏
  useEffect(() => {
    if (data) setDraft(normalizeSettings(data, device.name))
  }, [data, device.name])

  const patch = (p: Partial<AgentSettings>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const patchFeatures = (p: Partial<AgentSettings['features']>) =>
    setDraft((d) => (d ? { ...d, features: { ...d.features, ...p } } : d))

  const dirty = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data)

  const save = async () => {
    if (!draft || saving) return
    if (!Number.isFinite(draft.port) || draft.port < 1024 || draft.port > 65535) {
      setSaveError('端口需在 1024 - 65535 之间')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const next = await client.updateSettings({
        deviceName: draft.deviceName.trim() || data?.deviceName || '',
        port: draft.port,
        tls: draft.tls,
        features: draft.features,
        locale: draft.locale,
        theme: draft.theme,
      })
      setDraft(normalizeSettings(next, device.name))
      reload()
      toast({
        kind: 'ok',
        title: '被控端设置已保存',
        desc: '端口与 TLS 改动需重启 Agent 后生效',
      })
    } catch (e) {
      setSaveError(apiErrorMessage(e, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <SectionTitle
        icon={<SlidersHorizontal size={16} />}
        title="被控端设置"
        desc={`修改 ${device.name} 上 Agent 的行为，写入它的配置文件。`}
        action={dirty ? <Badge tone="warn">未保存</Badge> : undefined}
      />

      {loading && !draft ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error && !draft ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.08] px-3 py-2.5 text-[12px] leading-relaxed text-danger">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{apiErrorMessage(error, '读取被控端设置失败')}</span>
          <Button size="sm" variant="ghost" onClick={reload}>
            重试
          </Button>
        </div>
      ) : draft ? (
        <div className="mt-4 space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="设备名" hint="Agent 在局域网里广播的名字，配对时会显示。">
              <Input
                value={draft.deviceName}
                onChange={(e) => patch({ deviceName: e.target.value })}
                maxLength={32}
              />
            </Field>
            <Field label="HTTP 端口" hint="默认 8420；改动后需重启 Agent。">
              <Input
                type="number"
                min={1024}
                max={65535}
                value={draft.port || ''}
                onChange={(e) => patch({ port: e.target.value === '' ? 0 : Number(e.target.value) })}
                mono
              />
            </Field>
          </div>

          <div className="divide-y divide-line-soft rounded-xl border border-line-soft bg-elevated px-3">
            <div className="py-3">
              <Toggle
                checked={draft.tls.enabled}
                onChange={(v) => patch({ tls: { ...draft.tls, enabled: v } })}
                label="启用 TLS"
                desc="用自签证书监听 8443，流量加密；首次访问浏览器会提示证书不受信任。"
              />
            </div>
            <div className="py-3">
              <Toggle
                checked={draft.features.allowWol}
                onChange={(v) => patchFeatures({ allowWol: v })}
                label="允许网络唤醒"
                desc="允许发送 Wake-on-LAN 魔术包，唤醒局域网内其它机器。"
              />
            </div>
            <div className="py-3">
              <Toggle
                checked={draft.features.allowSchedules}
                onChange={(v) => patchFeatures({ allowSchedules: v })}
                label="允许定时任务"
                desc="允许创建定时关机 / 重启 / 睡眠，以及 RTC 预热唤醒。"
              />
            </div>
          </div>

          <div className="rounded-xl border border-danger/25 bg-danger/[0.06] p-3">
            <Toggle
              checked={draft.features.allowShell}
              onChange={(v) => patchFeatures({ allowShell: v })}
              label={<span className="text-danger">允许执行命令（危险）</span>}
              desc="开启后控制端能在这台机器上运行任意程序。只在完全信任的网络里临时打开，用完即关。"
            />
          </div>

          {saveError && <p className="text-[12px] text-danger">{saveError}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              loading={saving}
              disabled={!dirty}
              onClick={() => void save()}
            >
              保存设置
            </Button>
            <Button variant="ghost" disabled={!dirty || saving} onClick={() => data && setDraft(data)}>
              撤销改动
            </Button>
            <span className="text-[11.5px] text-faint">端口与 TLS 需重启 Agent 生效。</span>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
