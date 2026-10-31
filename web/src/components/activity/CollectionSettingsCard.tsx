import { useEffect, useState } from 'react'
import { Button, Card, Input, SectionTitle, Select, Skeleton, Toggle } from '../ui'
import { useAsync } from '../../lib/hooks'
import { activityInvalidateAll, activitySettingsKey } from '../../lib/activityKeys'
import { hourToWorkTime, putActivitySettings, fetchActivitySettings } from '../../lib/activityApi'
import type { ActivitySettings, ActivitySettingsPatch } from '../../lib/activityApi'
import type { Target } from '../../lib/api'
import { useApp } from '../../store/app'

/**
 * 「采集与隐私」卡（分类管理页底部）。
 *
 * 为什么放在这里而不是设置页：设置页归 web-shell（二期文件分界），且活动采集的
 * 语义配置（分类/隐私/保留期）都在活动组内，聚合在一页避免侧栏再加一项。
 *
 * 保存走部分更新：只回写本卡管的字段（enabled/intervalSec/idleSec/workband/retentionDays/privateRules），
 * 不碰 agent 的 categories（那是分类卡的事）。隐私规则回写保留原 id（按 pattern 匹配），
 * 新增条目不带 id 由 agent 生成 —— 若 agent 要求前端给 id，联调时在此补。
 */
export function CollectionSettingsCard({ device }: { device: Target & { token?: string } }) {
  const toast = useApp((s) => s.toast)
  const q = useAsync(() => fetchActivitySettings(device, device.token), [device.host, device.port, device.token], {
    key: activitySettingsKey(device),
    ttlMs: 3 * 60_000,
  })

  const [draft, setDraft] = useState<ActivitySettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [newPattern, setNewPattern] = useState('')

  useEffect(() => {
    if (q.data?.data) setDraft(structuredClone(q.data.data))
  }, [q.data])

  const demo = !!q.data?.demo

  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      // 隐私规则回写：pattern 相同的保留原 id（避免 agent 侧规则 id 漂移），新条目不带 id
      const rules = draft.privacy
        .map((pattern) => pattern.trim())
        .filter(Boolean)
        .map((pattern) => {
          const existing = draft.privateRules.find((r) => r.pattern === pattern && r.kind === 'app')
          return existing ? { id: existing.id, kind: 'app' as const, pattern } : { kind: 'app' as const, pattern }
        })
      const patch: ActivitySettingsPatch = {
        enabled: draft.enabled,
        intervalSec: Math.max(5, Math.round(draft.intervalSec)),
        idleSec: Math.max(30, Math.round(draft.idleMinutes * 60)),
        workHoursEnabled: draft.workband.enabled,
        workStart: hourToWorkTime(draft.workband.from),
        workEnd: hourToWorkTime(draft.workband.to),
        retentionDays: Math.max(1, Math.round(draft.retentionDays)),
        privateRules: rules,
      }
      const res = await putActivitySettings(device, device.token, patch)
      // 设置影响 summary 色带与全部数据口径：整组缓存失效
      activityInvalidateAll(device)
      toast({
        kind: 'ok',
        title: '采集设置已保存',
        desc: res.demo ? '演示模式：agent 侧接口上线后才真正生效' : undefined,
      })
    } catch (e) {
      toast({ kind: 'error', title: '保存失败', desc: String(e) })
    } finally {
      setBusy(false)
    }
  }

  const hourOptions = Array.from({ length: 24 }, (_, h) => h)

  return (
    <Card>
      <SectionTitle
        title="采集与隐私"
        desc="后台记录应用的用时；隐私规则命中的应用/标题不写入记录。"
      />
      {!draft ? (
        q.error ? (
          <p className="mt-3 text-[12.5px] text-danger">{String(q.error)}</p>
        ) : (
          <Skeleton className="mt-4 h-48 w-full" />
        )
      ) : (
        <div className="mt-4 space-y-4">
          <Toggle
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
            label="活动采集"
            desc="关闭后完全停采，已有记录保留。"
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] text-muted">采样间隔（秒）</span>
              <Select
                aria-label="采样间隔"
                value={String(draft.intervalSec)}
                onChange={(e) => setDraft({ ...draft, intervalSec: Number(e.target.value) })}
                className="h-9"
              >
                {[10, 15, 30, 60, 120, 300].map((v) => (
                  <option key={v} value={v}>
                    {v} 秒
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] text-muted">闲置阈值（分钟）</span>
              <Input
                type="number"
                min={1}
                max={60}
                value={draft.idleMinutes}
                onChange={(e) => setDraft({ ...draft, idleMinutes: Math.max(1, Number(e.target.value) || 1) })}
                className="h-9"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] text-muted">记录保留（天）</span>
              <Input
                type="number"
                min={1}
                max={3650}
                value={draft.retentionDays}
                onChange={(e) => setDraft({ ...draft, retentionDays: Math.max(1, Number(e.target.value) || 1) })}
                className="h-9"
              />
            </label>
          </div>

          <div className="rounded-xl border border-line-soft bg-elevated p-3">
            <Toggle
              checked={draft.workband.enabled}
              onChange={(v) => setDraft({ ...draft, workband: { ...draft.workband, enabled: v } })}
              label="工作时段"
              desc="开启后只在时段内采集，其余时间侧栏显示「休息中」。"
            />
            {draft.workband.enabled && (
              <div className="mt-3 flex items-center gap-2">
                <Select
                  aria-label="工作开始小时"
                  value={String(draft.workband.from)}
                  onChange={(e) => setDraft({ ...draft, workband: { ...draft.workband, from: Number(e.target.value) } })}
                  className="h-9 w-28"
                >
                  {hourOptions.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </Select>
                <span className="text-[12px] text-muted">至</span>
                <Select
                  aria-label="工作结束小时"
                  value={String(draft.workband.to)}
                  onChange={(e) => setDraft({ ...draft, workband: { ...draft.workband, to: Number(e.target.value) } })}
                  className="h-9 w-28"
                >
                  {hourOptions.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </Select>
                {/* 回写格式说明：from/to 小时数在保存时补秒成 'HH:00:00' */}
                <span className="ml-1 text-[11px] text-faint">整点起止</span>
              </div>
            )}
          </div>

          {/* 隐私过滤（本期只暴露 kind=app） */}
          <div className="rounded-xl border border-line-soft bg-elevated p-3">
            <div className="text-[12.5px] font-medium text-fg-soft">隐私过滤</div>
            <p className="mt-0.5 text-[11.5px] text-muted">命中的应用不写入记录（标题关键词过滤将在后续版本提供）。</p>
            {draft.privacy.length > 0 && (
              <ul className="mt-2 space-y-1">
                {draft.privacy.map((p, i) => (
                  <li key={p + i} className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-soft">{p}</span>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, privacy: draft.privacy.filter((_, j) => j !== i) })}
                      className="shrink-0 rounded-md px-1.5 text-[11px] text-danger hover:bg-danger/10"
                      title="删除该规则"
                    >
                      删
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <Input
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPattern.trim()) {
                    setDraft({ ...draft, privacy: [...draft.privacy, newPattern.trim()] })
                    setNewPattern('')
                  }
                }}
                placeholder="应用名或关键词，如 bank"
                className="h-9 flex-1"
              />
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={!newPattern.trim()}
                onClick={() => {
                  setDraft({ ...draft, privacy: [...draft.privacy, newPattern.trim()] })
                  setNewPattern('')
                }}
              >
                添加
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {demo && <span className="mr-auto text-[11px] text-cyan">演示数据：agent 上线后生效</span>}
            <Button size="md" variant="primary" loading={busy} onClick={() => void save()}>
              保存采集设置
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
