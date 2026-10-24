import { useRef, useState } from 'react'
import { Button, IconButton, Modal, ProgressBar } from '../ui'
import { RotateCw, TriangleAlert, Upload, X } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import { ApiError } from '../../lib/api'
import { useApp } from '../../store/app'
import { errText, isAuthError } from '../device/apiHelpers'

interface Task {
  name: string
  pct: number
  state: 'run' | 'ok' | 'fail' | 'conflict'
  msg?: string
}

/** 上传按钮：多选逐个上传、显示进度，同名冲突时二次确认后覆盖 */
export function UploadButton({
  client,
  dir,
  open,
  onOpenChange,
  onDone,
  onAuthError,
}: {
  client: AgentClient
  dir: string
  /** 上传队列面板是否展开，由父级控制，切换目录时能一起收起 */
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  onAuthError?: () => void
}) {
  const toast = useApp((s) => s.toast)
  const input = useRef<HTMLInputElement | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [busy, setBusy] = useState(false)
  const [conflicts, setConflicts] = useState<File[]>([])
  const [overwriting, setOverwriting] = useState(false)

  const patch = (name: string, next: Partial<Task>) =>
    setTasks((prev) => prev.map((t) => (t.name === name ? { ...t, ...next } : t)))

  const run = async (files: File[], overwrite: boolean) => {
    let ok = 0
    const conflictFiles: File[] = []
    for (const file of files) {
      try {
        await client.fileUpload(dir, file, overwrite, (pct) => patch(file.name, { pct }))
        ok += 1
        patch(file.name, { pct: 100, state: 'ok' })
      } catch (e) {
        if (isAuthError(e)) onAuthError?.()
        const exists = e instanceof ApiError && e.status === 409
        if (exists && !overwrite) {
          conflictFiles.push(file)
          patch(file.name, { state: 'conflict', msg: '同名文件已存在' })
        } else {
          patch(file.name, { state: 'fail', msg: errText(e) })
        }
      }
    }
    return { ok, conflictFiles }
  }

  const start = async (picked: File[]) => {
    if (picked.length === 0) return
    setBusy(true)
    setTasks(picked.map((f) => ({ name: f.name, pct: 0, state: 'run' as const })))
    try {
      const { ok, conflictFiles } = await run(picked, false)
      if (ok > 0) toast({ kind: 'ok', title: `已上传 ${ok} 个文件`, desc: dir })
      if (conflictFiles.length > 0) setConflicts(conflictFiles)
      else if (ok === 0) toast({ kind: 'error', title: '上传失败', desc: '所有文件都没有上传成功' })
      if (ok > 0) onDone()
    } finally {
      setBusy(false)
    }
  }

  const overwriteAll = async () => {
    const files = conflicts
    setConflicts([])
    if (files.length === 0) return
    setOverwriting(true)
    setTasks(files.map((f) => ({ name: f.name, pct: 0, state: 'run' as const })))
    try {
      let ok = 0
      for (const file of files) {
        try {
          await client.fileUpload(dir, file, true, (pct) => patch(file.name, { pct }))
          ok += 1
          patch(file.name, { pct: 100, state: 'ok' })
        } catch (e) {
          if (isAuthError(e)) onAuthError?.()
          patch(file.name, { state: 'fail', msg: errText(e) })
        }
      }
      if (ok > 0) {
        toast({ kind: 'ok', title: `已覆盖上传 ${ok} 个文件`, desc: dir })
        onDone()
      } else {
        toast({ kind: 'error', title: '覆盖上传失败' })
      }
    } finally {
      setOverwriting(false)
    }
  }

  const active = tasks.filter((t) => t.state === 'run').length
  const failed = tasks.filter((t) => t.state === 'fail').length
  const showPanel = open && tasks.length > 0

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? [])
          e.target.value = ''
          void start(picked)
        }}
      />
      <Button
        variant="primary"
        icon={<Upload size={15} />}
        disabled={busy || overwriting}
        onClick={() => {
          onOpenChange(true)
          input.current?.click()
        }}
      >
        上传
      </Button>

      {showPanel && (
        <div className="rounded-xl border border-line bg-elevated p-2.5">
          <div className="flex items-center justify-between gap-2 pb-1.5">
            <span className="text-[11.5px] text-fg-soft">
              上传队列
              {active > 0 && <span className="num"> · 进行中 {active}</span>}
              {failed > 0 && <span className="num text-danger"> · 失败 {failed}</span>}
            </span>
            <IconButton
              label="清空上传队列"
              size="sm"
              disabled={active > 0}
              className="h-8 w-8 border-transparent bg-transparent text-muted hover:text-fg"
              onClick={() => {
                setTasks([])
                onOpenChange(false)
              }}
            >
              <X size={13} />
            </IconButton>
          </div>
          <ul className="scroll-area max-h-40 space-y-1.5">
            {tasks.map((t) => (
              <li key={t.name} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate text-fg-soft" title={t.name}>
                    {t.name}
                  </span>
                  <span
                    className={
                      t.state === 'fail'
                        ? 'shrink-0 text-danger'
                        : t.state === 'conflict'
                          ? 'shrink-0 text-warn'
                          : 'num shrink-0 text-faint'
                    }
                  >
                    {t.state === 'ok'
                      ? '完成'
                      : t.state === 'fail'
                        ? '失败'
                        : t.state === 'conflict'
                          ? '待确认'
                          : `${t.pct}%`}
                  </span>
                </div>
                <ProgressBar
                  value={t.state === 'ok' ? 100 : t.pct}
                  height={4}
                  tone={t.state === 'fail' ? 'danger' : t.state === 'conflict' ? 'warn' : 'accent'}
                />
                {t.msg && <p className="text-[10.5px] text-faint">{t.msg}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={conflicts.length > 0}
        onClose={() => {
          if (!overwriting) setConflicts([])
        }}
        title="同名文件已存在"
        desc={`目标目录里已经有 ${conflicts.length} 个同名文件，覆盖后原内容会被替换且无法恢复。`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflicts([])} disabled={overwriting}>
              跳过
            </Button>
            <Button
              variant="danger"
              loading={overwriting}
              icon={<RotateCw size={14} />}
              onClick={() => void overwriteAll()}
            >
              覆盖 {conflicts.length} 个
            </Button>
          </>
        }
      >
        <div className="space-y-1.5 rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-warn">
            <TriangleAlert size={13} />
            覆盖会丢失原文件
          </div>
          <ul className="scroll-area max-h-40 space-y-0.5">
            {conflicts.map((f) => (
              <li key={f.name} className="truncate text-[11.5px] text-fg-soft" title={f.name}>
                {f.name}
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </div>
  )
}
