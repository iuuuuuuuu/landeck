import { useEffect, useState } from 'react'
import { Button, Modal, Skeleton } from '../ui'
import { Download } from 'lucide-react'
import type { AgentClient } from '../../lib/api'
import type { FileEntry } from '../../lib/types'
import { bytes } from '../../lib/format'
import { errText } from '../device/apiHelpers'
import { extOf, isImageExt, isTextExt } from './paths'

/** 预览弹窗：文本走 filePreview，图片直接吃 download URL，其余引导下载 */
export function FilePreview({
  client,
  entry,
  onClose,
  onDownload,
}: {
  client: AgentClient
  entry: FileEntry | null
  onClose: () => void
  onDownload: (entry: FileEntry) => void
}) {
  const ext = entry ? entry.ext || extOf(entry.name) : ''
  const kind = !entry ? 'none' : isImageExt(ext) ? 'image' : isTextExt(ext) ? 'text' : 'other'

  const [text, setText] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 当前已加载的路径：换文件时用它判断要不要清空旧内容 */
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!entry || kind !== 'text') {
      setText(null)
      setTruncated(false)
      setError(null)
      setLoadedFor(null)
      setLoading(false)
      return
    }
    if (loadedFor !== entry.path) {
      setText(null)
      setTruncated(false)
      setError(null)
    }
    let alive = true
    setLoading(true)
    client
      .filePreview(entry.path)
      .then((res) => {
        if (!alive) return
        setText(res.text ?? '')
        setTruncated(!!res.truncated)
        setLoadedFor(entry.path)
      })
      .catch((e: unknown) => {
        if (alive) setError(errText(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // loadedFor 只用于判断是否需要清空，不作为触发条件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, entry, kind])

  return (
    <Modal
      open={entry !== null}
      onClose={onClose}
      width={760}
      title={entry ? entry.name : '预览'}
      desc={
        entry ? (
          <>
            <span className="num">{bytes(entry.size)}</span>
            {kind === 'text' ? ' · 只读预览' : kind === 'image' ? ' · 图片预览' : ''}
          </>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
          {entry && (
            <Button variant="primary" icon={<Download size={14} />} onClick={() => onDownload(entry)}>
              下载
            </Button>
          )}
        </>
      }
    >
      {kind === 'image' && entry ? (
        <div className="grid max-h-[62vh] place-items-center overflow-auto rounded-xl border border-line bg-elevated p-2">
          <img
            src={client.fileDownloadUrl(entry.path)}
            alt={entry.name}
            className="max-h-[58vh] max-w-full rounded-lg object-contain"
          />
        </div>
      ) : kind === 'other' ? (
        <div className="rounded-xl border border-line bg-elevated px-4 py-8 text-center text-[12.5px] text-muted">
          不支持预览，点下载
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3 text-[12.5px] text-danger">
          {error}
        </div>
      ) : (
        <>
          <pre className="scroll-area max-h-[62vh] overflow-auto rounded-xl border border-line bg-elevated px-3.5 py-3 font-mono text-[11.5px] leading-relaxed text-fg-soft whitespace-pre-wrap break-all">
            {text && text.length > 0 ? text : '（空文件）'}
          </pre>
          {truncated && (
            <p className="mt-2 text-[11.5px] text-warn">
              内容超过预览上限，只显示前面一部分，完整内容请下载查看。
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
