import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import { Button, Card, Input, Modal, SectionTitle, Select, Toggle } from '../ui'
import { activityInvalidateAll } from '../../lib/activityKeys'
import { putMemorySettings } from '../../lib/activityApi'
import type { MemorySettingsPatch, MemoryStatus } from '../../lib/activityApi'
import type { Target } from '../../lib/api'
import { relative } from '../../lib/format'
import { useApp } from '../../store/app'

/**
 * 屏幕记忆设置卡（MemoryPage 底部，无论开关状态都可见）。
 *
 * 启用是高危动作（定期截全屏），所以开→确认弹窗写明「将定期截取全屏并保留 N 天」；
 * 关→不弹（降级无副作用）。保存后失效状态缓存 + 全部活动数据缓存
 * （启用/停采影响活动统计的展示口径）。
 */
export function MemorySettingsCard({
  device,
  status,
  demo,
  onChanged,
}: {
  device: Target & { token?: string }
  status: MemoryStatus | null
  demo: boolean
  /** 保存成功后回调（父组件刷新状态/翻页） */
  onChanged: () => void
}) {
  const toast = useApp((s) => s.toast)
  const [draft, setDraft] = useState<{ intervalSec: number; retentionDays: number } | null>(null)
  const [pendingEnable, setPendingEnable] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (status) setDraft({ intervalSec: status.intervalSec, retentionDays: status.retentionDays })
  }, [status])

  async function save(patch: MemorySettingsPatch, okTitle: string) {
    setBusy(true)
    try {
      const res = await putMemorySettings(device, device.token, patch)
      activityInvalidateAll(device)
      onChanged()
      toast({ kind: 'ok', title: okTitle, desc: res.demo ? '演示模式：agent 上线后真正生效' : undefined })
    } catch (e) {
      toast({ kind: 'error', title: '保存失败', desc: String(e) })
    } finally {
      setBusy(false)
    }
  }

  function onEnableToggle(next: boolean) {
    if (!status) return
    if (next) {
      // 开启必须过确认：写明截全屏与保留期，隐私规则命中会跳过
      setPendingEnable(true)
      return
    }
    void save({ enabled: false }, '屏幕记忆已关闭')
  }

  return (
    <Card>
      <SectionTitle
        icon={<Camera size={16} />}
        title="采集设置"
        desc={demo ? '演示数据：agent 上线后真正生效' : '定期截取全屏 → OCR → 文本入库；截图只存被控机本地。'}
      />
      {!draft ? (
        <p className="mt-3 text-[12.5px] text-muted">{status ? '读取中…' : String('')}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <Toggle
            checked={!!status?.enabled}
            onChange={onEnableToggle}
            label="启用屏幕记忆"
            desc={`每 ${draft.intervalSec} 秒截取一次全屏，保留 ${draft.retentionDays} 天；隐私规则命中的时刻不截。`}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] text-muted">截图间隔（秒）</span>
              <Select
                aria-label="截图间隔"
                value={String(draft.intervalSec)}
                onChange={(e) => setDraft({ ...draft, intervalSec: Number(e.target.value) })}
                className="h-9"
              >
                {[15, 30, 60, 120, 300, 600].map((v) => (
                  <option key={v} value={v}>
                    {v >= 60 ? `${v / 60} 分钟` : `${v} 秒`}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11.5px] text-muted">保留天数（1–90）</span>
              <Input
                type="number"
                min={1}
                max={90}
                value={draft.retentionDays}
                onChange={(e) => setDraft({ ...draft, retentionDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })}
                className="h-9"
              />
            </label>
          </div>

          {/* 采集统计：只有真截过才有意义 */}
          {status && status.shotsCount > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line-soft bg-elevated px-3 py-2.5 text-[12px] text-muted">
              <span>
                已截 <span className="num text-fg-soft">{status.shotsCount}</span> 张
              </span>
              <span>
                OCR 成功 <span className="num text-ok">{status.ocrOk}</span> / 失败{' '}
                <span className="num text-danger">{status.ocrFail}</span>
              </span>
              {status.lastShotAt ? <span>最近截图 {relative(new Date(status.lastShotAt).toISOString())}</span> : null}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              size="md"
              variant="primary"
              loading={busy}
              onClick={() => void save({ intervalSec: draft.intervalSec, retentionDays: draft.retentionDays }, '采集参数已保存')}
            >
              保存参数
            </Button>
          </div>
        </div>
      )}

      {/* 启用确认：写明「定期截取全屏 + 保留 N 天」 */}
      <Modal
        open={pendingEnable}
        onClose={() => !busy && setPendingEnable(false)}
        title="启用屏幕记忆"
        width={460}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingEnable(false)} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                setPendingEnable(false)
                void save({ enabled: true }, '屏幕记忆已开启')
              }}
            >
              确认启用
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-danger/30 bg-danger/[0.08] px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
          将定期截取全屏并保留 {draft?.retentionDays ?? 7} 天。
        </div>
        <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-muted">
          <li>· 截图与识别出的文字只保存在被控机本地，不上传。</li>
          <li>· 隐私规则命中的应用/标题，该时刻不截屏。</li>
          <li>· 超过保留期的截图每小时自动清理。</li>
        </ul>
      </Modal>
    </Card>
  )
}
