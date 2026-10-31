import { useState } from 'react'
import { Camera } from 'lucide-react'
import { memoryImageUrl } from '../../lib/activityApi'
import type { Target } from '../../lib/api'

/**
 * 屏幕记忆缩略图。
 *
 * - 原生 loading="lazy"：结果列表几十行，未滚到的行不发请求（agent 是本地服务，
 *   但 PNG 解码仍占资源，懒加载顺手省掉）；
 * - 拿不到图（未截过/文件已被清理/旧 agent 无此路由）→ 相机占位块，
 *   保持行高一致，排版不跳；
 * - 远程设备必须用 ?token= 查询串（<img> 带不了 Authorization 头，agent 对齐 appicon 模式）。
 */
export function MemoryThumb({
  target,
  token,
  id,
  alt,
}: {
  target: Target
  token: string | undefined
  id: number
  alt: string
}) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <span
        className="flex h-[54px] w-24 shrink-0 items-center justify-center rounded-lg bg-elevated text-faint"
        title="缩略图不可用（可能已被保留期清理）"
      >
        <Camera size={18} />
      </span>
    )
  }
  return (
    <img
      src={memoryImageUrl(target, token, id)}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className="h-[54px] w-24 shrink-0 rounded-lg border border-line-soft object-cover"
    />
  )
}

/** 检索命中高亮：按关键词（不分大小写）切段，命中段包 <mark>。 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const parts: { t: string; hit: boolean }[] = []
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  let i = 0
  while (i < text.length) {
    const hit = lower.indexOf(ql, i)
    if (hit === -1) {
      parts.push({ t: text.slice(i), hit: false })
      break
    }
    if (hit > i) parts.push({ t: text.slice(i, hit), hit: false })
    parts.push({ t: text.slice(hit, hit + q.length), hit: true })
    i = hit + q.length
  }
  return (
    <>
      {parts.map((p, idx) =>
        p.hit ? <mark key={idx} className="rounded bg-accent/25 px-0.5 text-fg">{p.t}</mark> : <span key={idx}>{p.t}</span>,
      )}
    </>
  )
}
