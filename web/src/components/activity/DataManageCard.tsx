import { useState } from 'react'
import { Button, Card, Input, Modal, SectionTitle } from '../ui'
import { activityInvalidateAll } from '../../lib/activityKeys'
import { clearActivityData, fetchExport } from '../../lib/activityApi'
import type { Target } from '../../lib/api'
import { Download, Trash2 } from 'lucide-react'
import { useApp } from '../../store/app'

/**
 * 「数据管理」卡（分类管理页底部）：导出 JSON/CSV + 按天数清理。
 *
 * 导出走 fetch → blob（远程设备要带令牌，不能 <a href> 直下）；
 * 清理必传天数、二次确认（不可恢复），成功后失效本设备的全部活动缓存。
 */
export function DataManageCard({ device }: { device: Target & { token?: string } }) {
  const toast = useApp((s) => s.toast)
  const [busyFmt, setBusyFmt] = useState<'json' | 'csv' | null>(null)
  const [beforeDays, setBeforeDays] = useState(30)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  async function doExport(format: 'json' | 'csv') {
    setBusyFmt(format)
    try {
      const { blob, filename } = await fetchExport(device, device.token, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast({ kind: 'ok', title: '已导出', desc: filename })
    } catch (e) {
      toast({ kind: 'error', title: '导出失败', desc: String(e) })
    } finally {
      setBusyFmt(null)
    }
  }

  async function doClear() {
    setClearing(true)
    try {
      const res = await clearActivityData(device, device.token, beforeDays)
      // 记录没了，缓存必须全清，否则统计页还显示删掉的数据
      activityInvalidateAll(device)
      toast({
        kind: 'ok',
        title: '清理完成',
        desc: res.demo ? '演示模式：agent 上线后真正删除' : res.deleted !== undefined ? `已删除 ${res.deleted} 段记录` : undefined,
      })
      setConfirmOpen(false)
    } catch (e) {
      toast({ kind: 'error', title: '清理失败', desc: String(e) })
    } finally {
      setClearing(false)
    }
  }

  return (
    <Card>
      <SectionTitle title="数据管理" desc="记录只存在被控机本地；导出或清理的都是当前设备的数据。" />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 导出 */}
        <div className="rounded-xl border border-line-soft bg-elevated p-3">
          <div className="text-[12.5px] font-medium text-fg-soft">导出</div>
          <p className="mt-0.5 text-[11.5px] text-muted">全部历史（含分类与窗口标题），JSON 供备份、CSV 供表格分析。</p>
          <div className="mt-3 flex gap-2">
            <Button size="md" variant="secondary" icon={<Download size={15} />} loading={busyFmt === 'json'} onClick={() => void doExport('json')}>
              导出 JSON
            </Button>
            <Button size="md" variant="secondary" icon={<Download size={15} />} loading={busyFmt === 'csv'} onClick={() => void doExport('csv')}>
              导出 CSV
            </Button>
          </div>
        </div>

        {/* 清理 */}
        <div className="rounded-xl border border-line-soft bg-elevated p-3">
          <div className="text-[12.5px] font-medium text-fg-soft">清理旧记录</div>
          <p className="mt-0.5 text-[11.5px] text-muted">删除指定天数之前的全部记录，释放磁盘空间。</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="shrink-0 text-[12.5px] text-muted">删除</span>
            <Input
              type="number"
              min={1}
              max={3650}
              value={beforeDays}
              onChange={(e) => setBeforeDays(Math.max(1, Number(e.target.value) || 1))}
              className="h-9 w-24"
            />
            <span className="shrink-0 text-[12.5px] text-muted">天前的记录</span>
            <Button
              size="md"
              variant="danger"
              className="ml-auto shrink-0"
              icon={<Trash2 size={15} />}
              onClick={() => setConfirmOpen(true)}
            >
              清理
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !clearing && setConfirmOpen(false)}
        title="确认清理"
        width={440}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={clearing}>
              取消
            </Button>
            <Button variant="danger" loading={clearing} onClick={() => void doClear()}>
              确认删除
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-danger/30 bg-danger/[0.08] px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
          将删除 {beforeDays} 天前的全部活动记录，不可恢复。
        </div>
        <p className="mt-2 text-[12px] text-muted">
          建议先导出 JSON 备份。要保留最近一段时间，把天数设小一些（如 7）。
        </p>
      </Modal>
    </Card>
  )
}
