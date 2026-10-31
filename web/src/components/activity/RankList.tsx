import { catLabel } from '../../lib/activityApi'
import type { RankItem } from '../../lib/activityApi'
import { AppIcon, CategoryIcon, InlineBar, fmtDur } from './bits'

/**
 * 排行列表（最常用应用 / 最常用分类共用一套行样式）。
 * 行结构对齐参考截图：序号 → 图标（分类排行用色点）→ 名称 + 类别副文本
 * → 内联类别色条 → 右对齐时长。行可点（打开应用详情浮层）。
 * cat 收 string 以兼容自建类别；cats 用于解析自建类别的显示名。
 */
export function RankList({
  items,
  target,
  token,
  cats,
  onSelectApp,
}: {
  items: RankItem[]
  /** 当前目标设备（拿真实应用图标）；不传则用首字母块 */
  target?: { host: string; port: number; tls: boolean }
  token?: string
  cats?: { key: string; label: string }[]
  onSelectApp?: (app: string, cat: string) => void
}) {
  const max = Math.max(...items.map((i) => i.sec), 1)
  if (items.length === 0) {
    return <p className="px-3 py-8 text-center text-[12.5px] text-muted">这段时间没有记录到活动。</p>
  }
  return (
    <ul className="px-1.5 pb-1.5">
      {items.map((it, i) => (
        <li key={it.app}>
          <button
            type="button"
            onClick={() => onSelectApp?.(it.app, it.cat)}
            className={
              'flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left transition-colors ' +
              (onSelectApp
                ? 'cursor-pointer hover:bg-hover focus-visible:bg-hover'
                : 'cursor-default') +
              (i > 0 ? ' mt-0.5' : '')
            }
          >
            <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-faint">{i + 1}</span>
            <AppIcon app={it.app} cat={it.cat} target={target} token={token} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-fg">{it.app}</span>
              <span className="block text-[11px] text-muted">{catLabel(it.cat, cats)}</span>
            </span>
            <InlineBar sec={it.sec} max={max} cat={it.cat} />
            <span className="w-[96px] shrink-0 text-right text-[13.5px] font-medium tabular-nums text-fg">{fmtDur(it.sec)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 分类排行（结构相同但图标位是色点，不可点击下钻）。 */
export function CategoryRankList({ items, cats }: { items: { cat: string; sec: number }[]; cats?: { key: string; label: string }[] }) {
  const max = Math.max(...items.map((i) => i.sec), 1)
  if (items.length === 0) {
    return <p className="px-3 py-8 text-center text-[12.5px] text-muted">这段时间没有记录到活动。</p>
  }
  return (
    <ul className="px-1.5 pb-1.5">
      {items.map((it, i) => (
        <li
          key={it.cat}
          className={'flex items-center gap-3 rounded-xl px-2.5 py-3' + (i > 0 ? ' mt-0.5' : '')}
        >
          <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-faint">{i + 1}</span>
          <CategoryIcon cat={it.cat} size={18} />
          <span className="min-w-0 flex-1 text-[13.5px] text-fg">{catLabel(it.cat, cats)}</span>
          <InlineBar sec={it.sec} max={max} cat={it.cat} />
          <span className="w-[96px] shrink-0 text-right text-[13.5px] font-medium tabular-nums text-fg">{fmtDur(it.sec)}</span>
        </li>
      ))}
    </ul>
  )
}
