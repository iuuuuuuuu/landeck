import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, EmptyState, Skeleton } from '../ui'
import { ShieldAlert, TriangleAlert } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { FileEntry } from '../../lib/types'
import { errText, isAuthError } from '../device/apiHelpers'
import { FileListHead, FileRow, RootCard, type FileAction } from './FileRow'
import { FilePreview } from './FilePreview'
import { FileOpsModal, MkdirButton, type EditKind } from './FileOpsModal'
import { UploadButton } from './UploadButton'
import { PathBar } from './PathBar'
import { parentOf } from './paths'

/** 文件浏览器：根目录卡片视图 → 目录列表视图；预览/改名/删除/上传都在这里编排 */
export function FileBrowser({
  client,
  allowWrite,
  roots,
  onAuthError,
}: {
  client: AgentClient
  allowWrite: boolean
  roots: { path: string; label: string; kind: 'home' | 'drive' | 'custom' }[]
  onAuthError?: () => void
}) {
  const [dir, setDir] = useState<string | null>(null)
  const [items, setItems] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<FileEntry | null>(null)
  const [ops, setOps] = useState<{ kind: EditKind; entry: FileEntry | null } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  /** 只有最后一次请求能写回状态 */
  const seq = useRef(0)

  const load = useCallback(
    async (path: string, quiet = false) => {
      const my = ++seq.current
      if (!quiet) setLoading(true)
      setError(null)
      try {
        const res = await client.files(path)
        if (my !== seq.current) return
        const sorted = [...(res.items ?? [])].sort((a, b) => {
          if (a.dir !== b.dir) return a.dir ? -1 : 1
          return a.name.localeCompare(b.name, 'zh-CN')
        })
        setItems(sorted)
      } catch (e) {
        if (my !== seq.current) return
        if (isAuthError(e)) onAuthError?.()
        setError(errText(e))
        setItems([])
      } finally {
        if (my === seq.current) setLoading(false)
      }
    },
    [client, onAuthError],
  )

  useEffect(() => {
    if (dir !== null) void load(dir, false)
  }, [dir, load])

  const up = dir ? parentOf(dir) : null

  const openEntry = (entry: FileEntry) => {
    if (entry.dir) {
      setSelected(null)
      setDir(entry.path)
    } else {
      setSelected(entry.path)
    }
  }

  const download = (entry: FileEntry) => {
    window.open(client.fileDownloadUrl(entry.path), '_blank', 'noopener')
  }

  const onAction = (entry: FileEntry, action: FileAction) => {
    if (action === 'download') download(entry)
    else if (action === 'preview') setPreview(entry)
    else if (action === 'rename') setOps({ kind: 'rename', entry })
    else setOps({ kind: 'delete', entry })
  }

  const refresh = () => {
    if (dir) void load(dir, true)
  }

  return (
    <Card className="flex h-full flex-col">
      <PathBar
        dir={dir}
        loading={loading}
        onRoot={() => {
          setDir(null)
          setSelected(null)
          setItems([])
          setError(null)
        }}
        onUp={() => {
          if (!up) return
          setDir(up)
          setSelected(null)
        }}
        onGo={(path) => {
          setDir(path)
          setSelected(null)
        }}
        onRefresh={refresh}
        actions={
          allowWrite && dir !== null ? (
            <>
              <MkdirButton
                onClick={() => {
                  setUploadOpen(false)
                  setOps({ kind: 'mkdir', entry: null })
                }}
                disabled={loading}
              />
              <UploadButton
                key={dir}
                client={client}
                dir={dir}
                open={uploadOpen}
                onOpenChange={setUploadOpen}
                onDone={refresh}
                onAuthError={onAuthError}
              />
            </>
          ) : null
        }
      />

      {!allowWrite && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl border border-line bg-elevated px-3 py-2 text-[11.5px] text-muted">
          <ShieldAlert size={12} className="shrink-0 text-warn" />
          被控端处于只读模式：只能浏览、预览与下载。
        </p>
      )}

      <div className="mt-3.5 min-h-0 flex-1">
        {dir === null ? (
          <Roots roots={roots} onEnter={(p) => setDir(p)} />
        ) : loading && items.length === 0 ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={<TriangleAlert size={22} />}
            title="目录读取失败"
            desc={error}
            action={
              <Button variant="secondary" onClick={() => dir && void load(dir, false)}>
                重试
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="空目录"
            desc={allowWrite ? '这里还没有文件，点右上角「上传」放点东西进来。' : '这里还没有文件。'}
          />
        ) : (
          <>
            <FileListHead allowWrite={allowWrite} />
            <ul className="space-y-0.5">
              {items.map((entry) => (
                <FileRow
                  key={entry.path}
                  entry={entry}
                  selected={selected === entry.path}
                  allowWrite={allowWrite}
                  onSelect={() => setSelected(entry.path)}
                  onOpen={() => openEntry(entry)}
                  onAction={(a) => onAction(entry, a)}
                />
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-faint">
              双击文件夹进入，单击选中；共 <span className="num">{items.length}</span> 项
            </p>
          </>
        )}
      </div>

      <FilePreview
        client={client}
        entry={preview}
        onClose={() => setPreview(null)}
        onDownload={(e) => download(e)}
      />

      <FileOpsModal
        client={client}
        kind={ops?.kind ?? null}
        entry={ops?.entry ?? null}
        dir={dir ?? ''}
        onClose={() => setOps(null)}
        onDone={refresh}
        onAuthError={onAuthError}
      />

    </Card>
  )
}

function Roots({
  roots,
  onEnter,
}: {
  roots: { path: string; label: string; kind: 'home' | 'drive' | 'custom' }[]
  onEnter: (path: string) => void
}) {
  if (roots.length === 0) {
    return (
      <EmptyState
        title="没有被允许访问的目录"
        desc="在被控端「设置 → 文件管理」里添加允许访问的根目录后再试。"
      />
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-faint">选择要浏览的位置</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {roots.map((r) => (
          <RootCard
            key={r.path}
            label={r.label}
            path={r.path}
            kind={r.kind}
            onClick={() => onEnter(r.path)}
          />
        ))}
      </div>
    </div>
  )
}
