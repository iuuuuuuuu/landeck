import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { catColor, CAT_LABEL } from '../../lib/activityApi'
import type { CatKey } from '../../lib/activityApi'
import { fmtDur } from './bits'

echarts.use([PieChart, TooltipComponent, CanvasRenderer])

/**
 * 月统计的双环占比图（对齐 Hindsight 月统计的占比视图）。
 *
 * 环的语义：内环 = 类别占比；外环 = 应用占比（按所属类别着色）。
 * Hindsight 原版是"外圈大类、内圈小类"，LanDeck 一期只有一层扁平类别，
 * 所以把外环让给应用 —— 点选某个类别后外环只显示该类别下的应用构成，
 * 交互语义与原版一致（选中大类看构成）。应用多于 8 个时其余并成「其他应用」。
 */
export function DonutChart({
  categories,
  apps,
  selected,
  onSelect,
  theme,
  height = 300,
}: {
  /** 类别合计秒数（降序） */
  categories: { cat: CatKey; sec: number }[]
  /** 应用明细（用于外环），需带 cat */
  apps: { app: string; cat: CatKey; sec: number }[]
  /** 当前选中的类别（null = 未选中，外环显示全部应用） */
  selected: CatKey | null
  onSelect: (cat: CatKey | null) => void
  theme: 'dark' | 'light'
  height?: number
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
    const tooltipBg = dark ? 'rgba(12,14,22,0.96)' : 'rgba(255,255,255,0.98)'
    const tooltipBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(19,22,35,0.10)'
    const tooltipFg = dark ? '#edeff8' : '#111423'
    const labelColor = dark ? '#9aa2b8' : '#5f677d'

    const total = categories.reduce((a, c) => a + c.sec, 0)
    if (total <= 0) {
      chart.clear()
      return
    }

    // 内环：类别
    const inner = categories.map((c) => ({
      name: CAT_LABEL[c.cat],
      value: c.sec,
      itemStyle: { color: catColor(c.cat) },
      cat: c.cat,
    }))

    // 外环：应用（选中类别时只看该类别下的应用）
    const pool = selected ? apps.filter((a) => a.cat === selected) : apps
    const top = [...pool].sort((a, b) => b.sec - a.sec).slice(0, 8)
    const topSec = top.reduce((a, x) => a + x.sec, 0)
    const rest = pool.reduce((a, x) => a + x.sec, 0) - topSec
    const outer = [
      ...top.map((a) => ({ name: a.app, value: a.sec, itemStyle: { color: catColor(a.cat) } })),
      ...(rest > 0 ? [{ name: '其他应用', value: rest, itemStyle: { color: dark ? '#3b4256' : '#cbd2e1' } }] : []),
    ]

    const option: EChartsOption = {
      animationDuration: 380,
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: tooltipFg, fontSize: 12 },
        formatter: (p: unknown) => {
          const d = p as { name: string; value: number; percent: number }
          return `<div style="font-weight:600">${d.name}</div>${fmtDur(d.value)} · ${d.percent}%`
        },
      },
      // 中心文字用 title 叠加：比 graphic 简单且随容器居中
      title: {
        text: fmtDur(total),
        subtext: selected ? CAT_LABEL[selected] : '全部类别',
        left: 'center',
        top: '42%',
        textStyle: { color: dark ? '#edeff8' : '#111423', fontSize: 20, fontWeight: 600 },
        subtextStyle: { color: labelColor, fontSize: 12 },
      },
      series: [
        {
          type: 'pie',
          radius: ['34%', '50%'],
          center: ['50%', '50%'],
          label: { show: false },
          data: inner,
          // 点内环切片 = 选中该类别（再点一次取消）
          selectedMode: 'single',
          selectedOffset: 6,
          select: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.25)' } },
        },
        {
          type: 'pie',
          radius: ['58%', '74%'],
          center: ['50%', '50%'],
          label: { show: false },
          data: outer,
          itemStyle: { borderRadius: 2, borderColor: dark ? '#0c0e16' : '#ffffff', borderWidth: 1 },
        },
      ],
    }
    chart.setOption(option, true)
    chart.off('click')
    chart.on('click', (p) => {
      const d = p as { data?: { cat?: CatKey }; seriesIndex?: number }
      if (d?.seriesIndex === 0 && d?.data?.cat) {
        onSelect(selected === d.data.cat ? null : d.data.cat)
      }
    })
    requestAnimationFrame(() => chart.resize())
  }, [categories, apps, selected, onSelect, theme])

  return <div ref={ref} style={{ width: '100%', height }} />
}
