import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, Field, Input, Modal } from '../ui'
import { FolderPlus, Trash } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { FileEntry } from '../../lib/types'
import { useApp } from '../../store/app'
import { errText, isAuthError } from '../device/apiHelpers'

export type EditKind = 'mkdir' | 'rename' | 'delete'

/** 新建 / 重命名 / 删除共用一个受控弹窗，避免三份重复状态 */
export function FileOpsModal({
  client,
  kind,
  entry,
  dir,
  onClose,
  onDone,
  onAuthError,
}: {
  client: AgentClient
  kind: EditKind | null
  /** rename / delete 的目标；mkdir 时为 null */
  entry: FileEntry | null
  /** 当前目录，mkdir 的 parent */
  dir: string
  onClose: () => void
  onDone: () => void
  onAuthError?: () => void
}) {
  const toast = useApp((s) => s.toast)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每次打开都按目标重置输入：重命名预填原名，新建/删除清空
  const target = entry?.path ?? null
  useEffect(() => {
    if (kind === null) return
    setError(null)
    setName(kind === 'rename' && entry ? entry.name : '')
    // 只在打开的动作或目标变化时重置，不跟着输入抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, target])

  const close = () => {
    if (busy) return
    setError(null)
    onClose()
  }

  const submit = async () => {
    const value = name.trim()
    if (kind !== 'delete' && !value) {
      setError('请输入名称')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (kind === 'mkdir') {
        await client.fileMkdir(dir, value)
        toast({ kind: 'ok', title: '已新建目录', desc: value })
      } else if (kind === 'rename' && entry) {
        await client.fileRename(entry.path, value)
        toast({ kind: 'ok', title: '已重命名', desc: `${entry.name} → ${value}` })
      } else if (kind === 'delete' && entry) {
        await client.fileDelete(entry.path)
        toast({ kind: 'ok', title: '已删除', desc: entry.name })
      }
      onClose()
      onDone()
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const isDelete = kind === 'delete'
  const isDirDelete = isDelete && !!entry?.dir

  return (
    <Modal
      open={kind !== null}
      onClose={close}
      title={kind === 'mkdir' ? '新建目录' : kind === 'rename' ? '重命名' : '删除'}
      desc={
        kind === 'mkdir'
          ? `在 ${dir} 下创建新目录`
          : kind === 'rename'
            ? entry?.path
            : entry
              ? `${entry.path}`
              : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            variant={isDelete ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void submit()}
          >
            {kind === 'mkdir' ? '创建' : kind === 'rename' ? '保存' : '删除'}
          </Button>
        </>
      }
    >
      {kind === 'delete' ? (
        <div
          className={clsx(
            'space-y-1.5 rounded-xl border px-3.5 py-3',
            isDirDelete ? 'border-danger/30 bg-danger/12' : 'border-warn/25 bg-warn/10',
          )}
        >
          <div
            className={clsx(
              'flex items-center gap-1.5 text-[12px] font-medium',
              isDirDelete ? 'text-danger' : 'text-warn',
            )}
          >
            <Trash size={13} />
            {isDirDelete ? '目录会被整个删除' : '文件将被删除'}
          </div>
          <p className="text-[11.5px] leading-relaxed text-fg-soft">
            {isDirDelete
              ? '目录内所有内容都会被删除，且无法从本页面恢复。'
              : '删除后无法从本页面恢复，请确认没有需要保留的内容。'}
          </p>
          <p className="truncate text-[11.5px] text-fg" title={entry?.name}>
            {entry?.name}
          </p>
        </div>
      ) : (
        <Field
          label={kind === 'mkdir' ? '目录名' : '新名称'}
          error={error ?? undefined}
          hint={kind === 'mkdir' ? '不能包含路径分隔符' : '不能包含路径分隔符，扩展名请一并修改'}
        >
          <Input
            value={name}
            autoFocus
            placeholder={kind === 'mkdir' ? '例如 备份' : '例如 new-name.txt'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </Field>
      )}
    </Modal>
  )
}

/** 新建按钮：外部只关心「点了要开弹窗」 */
export function MkdirButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      variant="secondary"
      aria-label="新建目录"
      icon={<FolderPlus size={15} />}
      onClick={onClick}
      disabled={disabled}
      className="px-2.5 sm:px-4"
    >
      <span className="hidden sm:inline">新建目录</span>
    </Button>
  )
}
