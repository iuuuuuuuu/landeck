import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkAreaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { CATEGORIES, catColor, CAT_LABEL } from '../../lib/activityApi'
import type { CatKey, SummarySlot } from '../../lib/activityApi'
import { fmtDur } from './bits'

echarts.use([BarChart, GridComponent, TooltipComponent, MarkAreaComponent, CanvasRenderer])

/**
 * 类别堆叠柱状图（Hindsight 日/周/月统计的主图内胆）。
 *
 * - 每个类别一条 series、同一 stack，柱内自下而上按 CATEGORIES 顺序堆叠；
 * - 只有每根柱**最顶上的那段**给圆角，中间段直角 —— 对所有段都加圆角会出现
 *   "柱子中间也鼓包"的假象；
 * - mode='share' 时把每槽归一成百分比（Hindsight 的「占比」视图）；
 * - workband（仅日视图）：用 markArea 在工作时段铺一层淡色 + 虚线边，
 *   对齐参考截图里"工作时段"的整段标出。
 *
 * echarts 按需注册（照 UptimeBarChart 的 lazy 模式），不引全量包。
 */
export function StackedBarChart({
  slots,
  theme,
  mode = 'hours',
  height = 300,
  workband,
  showEveryLabel = false,
}: {
  slots: SummarySlot[]
  theme: 'dark' | 'light'
  /** hours=绝对时长；share=占比（每槽归一到 100%） */
  mode?: 'hours' | 'share'
  height?: number
  /** 日视图的工作时段（小时下标，含头含尾） */
  workband?: { from: number; to: number }
  /** 周视图槽少，显示每个标签；月视图 30+ 个槽只让 echarts 自动稀疏 */
  showEveryLabel?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const dark = theme === 'dark'
    const axisColor = dark ? 'rgba(255,255,255,0.28)' : 'rgba(19,22,35,0.28)'
    const labelColor = dark ? '#9aa2b8' : '#5f677d'
    const splitColor = dark ? 'rgba(255,255,255,0.06)' : 'rgba(19,22,35,0.06)'
    const tooltipBg = dark ? 'rgba(12,14,22,0.96)' : 'rgba(255,255,255,0.98)'
    const tooltipBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(19,22,35,0.10)'
    const tooltipFg = dark ? '#edeff8' : '#111423'

    // 只出现的类别才建 series：全 8 条都建的话图例和 tooltip 会有一排 0 值
    const present = CATEGORIES.filter((c) => slots.some((s) => (s.sec[c.key] ?? 0) > 0))

    const valueOf = (s: SummarySlot, key: CatKey): number => {
      const sec = s.sec[key] ?? 0
      if (mode === 'hours') return Math.round((sec / 60) * 10) / 10 // 分钟为单位，刻度可读
      const denom = s.total || 1
      return Math.round((sec / denom) * 1000) / 10 // 百分比，一位小数
    }

    const series = present.map((c, ci) => {
      const isTopOf = (s: SummarySlot): boolean => {
        // 这一段是否为该槽堆叠的最上段（更大的类别都为 0）
        const idx = CATEGORIES.findIndex((x) => x.key === c.key)
        return CATEGORIES.slice(idx + 1).every((x) => (s.sec[x.key] ?? 0) === 0)
      }
      return {
        name: CAT_LABEL[c.key],
        type: 'bar' as const,
        stack: 'total',
        // barMaxWidth 只约束宽度；日视图 24 根 / 月视图 31 根都能放下
        barMaxWidth: slots.length > 20 ? 18 : 30,
        emphasis: { focus: 'series' as const },
        data: slots.map((s) => ({
          value: valueOf(s, c.key),
          itemStyle: {
            // 顶段圆角 + 类别色；非顶段直角
            borderRadius: isTopOf(s) ? [3, 3, 0, 0] : 0,
            color: catColor(c.key),
            // 同槽多段时给非顶段降一点点透明度，叠色更干净
            opacity: isTopOf(s) ? 1 : 0.92,
          },
        })),
        // 工作时段色带挂在第一条 series 上就够（markArea 是坐标系级的）
        ...(ci === 0 && workband
          ? {
              markArea: {
                silent: true,
                itemStyle: {
                  color: dark ? 'rgba(167,139,250,0.10)' : 'rgba(139,107,255,0.08)',
                  borderColor: dark ? 'rgba(167,139,250,0.45)' : 'rgba(139,107,255,0.40)',
                  borderWidth: 1,
                  borderType: 'dashed' as const,
                },
                data: [[{ xAxis: String(workband.from).padStart(2, '0') }, { xAxis: String(workband.to).padStart(2, '0') }]],
              },
            }
          : {}),
      }
    })

    const yName = mode === 'hours' ? '分钟' : '%'
    const option: EChartsOption = {
      animationDuration: 380,
      grid: { left: 44, right: 8, top: 14, bottom: 24 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: tooltipFg, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number; seriesName: string; value: number }[]
          const i = arr?.[0]?.dataIndex ?? 0
          const s = slots[i]
          if (!s) return ''
          const head =
            mode === 'hours'
              ? fmtDur(s.total)
              : `${Math.round(((arr.reduce((a, p) => a + (p.value ?? 0), 0) as number) / arr.length) || 0)}%`
          const lines = present
            .map((c) => ({ c, v: s.sec[c.key] ?? 0 }))
            .filter((x) => x.v > 0)
            .sort((a, b) => b.v - a.v)
            .slice(0, 4)
            .map((x) => {
              const val = mode === 'hours' ? fmtDur(x.v) : `${Math.round((x.v / (s.total || 1)) * 100)}%`
              return `<div>${CAT_LABEL[x.c.key]}：${val}</div>`
            })
            .join('')
          return `<div style="font-weight:600;margin-bottom:3px">${s.key}</div>${lines}<div style="margin-top:2px;opacity:.75">合计 ${head}</div>`
        },
      },
      xAxis: {
        type: 'category',
        data: slots.map((s) => s.label),
        axisLine: { lineStyle: { color: axisColor } },
        axisTick: { show: false },
        axisLabel: {
          color: labelColor,
          fontSize: 10.5,
          margin: 8,
          interval: showEveryLabel ? 0 : 'auto',
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: splitColor, type: 'dashed' as const } },
        axisLabel: {
          color: labelColor,
          fontSize: 10.5,
          formatter: (v: number) =>
            mode === 'hours'
              ? v >= 60
                ? `${Math.round(v / 6) / 10}h`
                : `${v}m`
              : `${v}%`,
        },
        name: yName,
        nameTextStyle: { color: labelColor, fontSize: 10 },
        nameGap: 8,
      },
      series: series as unknown as EChartsOption['series'],
    }
    chart.setOption(option, true)
    requestAnimationFrame(() => chart.resize())
  }, [slots, theme, mode, workband, showEveryLabel])

  return <div ref={ref} style={{ width: '100%', height }} />
}
