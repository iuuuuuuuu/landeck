import { useMemo } from 'react'
import { fmtDur } from './bits'

/**
 * GitHub 风格的年度热力图（全部历史页主视图）。
 *
 * 纯 CSS grid 而不是 echarts：53 列 × 7 行的方阵用 div 排最省，
 * 悬停提示靠 title 属性即可（细节提示没有图表级价值），点选整天靠 onClick。
 *
 * 颜色分档：0 → 无活动灰；其余按当日总时长相对年内最大值分 4 档 accent 透明度。
 * 不做连续映射 —— 人眼对"有无/多少"的分档比对连续色阶敏感，GitHub 也是这么做的。
 */
export function HeatMap({
  days,
  selectedDate,
  onSelect,
  accent = '139,107,255',
}: {
  /** 一整年的天：{ date: 'YYYY-MM-DD', sec }，允许缺天（缺 = 无数据） */
  days: { date: string; sec: number }[]
  selectedDate: string | null
  onSelect: (date: string) => void
  /** 用于色阶的 accent RGB（与主题主色一致），默认品牌紫 */
  accent?: string
}) {
  const { cols, max, monthMarks } = useMemo(() => {
    if (days.length === 0) return { cols: [] as { date: string; sec: number }[][], max: 0, monthMarks: [] as { col: number; label: string }[] }
    // 以第一天的周一为起点对齐网格（周一在最上行）
    const first = new Date(`${days[0].date}T12:00:00`)
    const lead = (first.getDay() + 6) % 7
    const flat: { date: string; sec: number }[] = []
    for (let i = 0; i < lead; i++) flat.push({ date: '', sec: -1 })
    flat.push(...days)
    while (flat.length % 7 !== 0) flat.push({ date: '', sec: -1 })
    const cols: { date: string; sec: number }[][] = []
    for (let i = 0; i < flat.length; i += 7) cols.push(flat.slice(i, i + 7))
    const maxSec = Math.max(...days.map((d) => d.sec), 1)
    // 月份标记：每列取该列第一天的月份，月份变化处打标
    const marks: { col: number; label: string }[] = []
    let lastMonth = -1
    cols.forEach((col, ci) => {
      const real = col.find((c) => c.date)
      if (!real) return
      const m = Number(real.date.slice(5, 7))
      if (m !== lastMonth) {
        marks.push({ col: ci, label: `${m}月` })
        lastMonth = m
      }
    })
    return { cols, max: maxSec, monthMarks: marks }
  }, [days])

  function level(sec: number): number {
    if (sec <= 0) return 0
    const r = sec / max
    if (r < 0.25) return 1
    if (r < 0.5) return 2
    if (r < 0.75) return 3
    return 4
  }

  function cellStyle(sec: number): React.CSSProperties {
    const l = level(sec)
    if (l === 0) return { backgroundColor: 'var(--line-soft, rgba(128,128,128,0.15))' }
    const alphas = [0, 0.28, 0.5, 0.72, 0.95]
    return { backgroundColor: `rgba(${accent},${alphas[l]})` }
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* 月份标记行 */}
        <div className="mb-1 flex gap-[3px] pl-7 text-[10px] text-faint">
          {cols.map((_, ci) => {
            const mark = monthMarks.find((m) => m.col === ci)
            return (
              <div key={ci} className="w-3 shrink-0">
                {mark ? mark.label : ''}
              </div>
            )
          })}
        </div>
        <div className="flex gap-[3px]">
          {/* 星期标记列 */}
          <div className="mr-1 flex w-6 shrink-0 flex-col gap-[3px] text-[9px] leading-3 text-faint">
            {['一', '', '三', '', '五', '', '日'].map((w, i) => (
              <div key={i} className="h-3">{w}</div>
            ))}
          </div>
          {cols.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map((cell, ri) =>
                cell.date ? (
                  <button
                    key={ri}
                    type="button"
                    title={`${cell.date} · ${cell.sec > 0 ? fmtDur(cell.sec) : '无记录'}`}
                    onClick={() => onSelect(cell.date)}
                    className={
                      'h-3 w-3 rounded-[3px] transition-transform hover:scale-125 ' +
                      (selectedDate === cell.date ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg' : '')
                    }
                    style={cellStyle(cell.sec)}
                  />
                ) : (
                  <span key={ri} className="h-3 w-3" />
                ),
              )}
            </div>
          ))}
        </div>
        {/* 图例 */}
        <div className="mt-2 flex items-center gap-1 pl-7 text-[10px] text-faint">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="h-3 w-3 rounded-[3px]" style={cellStyle(l === 0 ? 0 : (max * l) / 4 + 1)} />
          ))}
          <span>多</span>
        </div>
      </div>
    </div>
  )
}

/**
 * 月历（全部历史页副视图）：当月每天一格，时长作角标，点选与热力图联动。
 */
export function MonthCalendar({
  year,
  month,
  days,
  selectedDate,
  onSelect,
  accent = '139,107,255',
}: {
  year: number
  month: number // 1-12
  days: { date: string; sec: number }[]
  selectedDate: string | null
  onSelect: (date: string) => void
  accent?: string
}) {
  const map = useMemo(() => new Map(days.map((d) => [d.date, d.sec])), [days])
  const max = useMemo(() => Math.max(...days.map((d) => d.sec), 1), [days])
  const first = new Date(year, month - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const n = new Date(year, month, 0).getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`),
  ]

  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[10px] text-faint">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((ds, i) => {
          if (!ds) return <span key={`e${i}`} />
          const sec = map.get(ds) ?? 0
          const day = Number(ds.slice(8, 10))
          const alpha = sec > 0 ? Math.max(0.15, 0.15 + (sec / max) * 0.8) : 0
          const isSel = selectedDate === ds
          return (
            <button
              key={ds}
              type="button"
              title={sec > 0 ? fmtDur(sec) : '无记录'}
              onClick={() => onSelect(ds)}
              className={
                'relative rounded-lg py-1.5 text-[12px] transition-colors ' +
                (isSel ? 'ring-2 ring-accent font-semibold' : 'hover:bg-elevated')
              }
              style={sec > 0 ? { backgroundColor: `rgba(${accent},${alpha})` } : { backgroundColor: 'var(--line-soft, rgba(128,128,128,0.12))' }}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}
