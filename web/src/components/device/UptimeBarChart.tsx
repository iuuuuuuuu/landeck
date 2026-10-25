import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkLineComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

echarts.use([BarChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer])

/**
 * 开机统计柱状图。
 * 用 echarts 而不是手写：手写版本每根柱的基线/刻度/悬浮提示都要自己算，
 * 数据一多就露馅（之前 14 根柱看着等高，就是因为缺 y 轴参照）。
 *
 * 关键点：y 轴固定 0–24 小时，柱高才是真实占比；否则 echarts 会按最大值自适应，
 * 又会变成「都差不多高」。
 */
export function UptimeBarChart({
  monthly = false,
  data,
  height = 190,
  theme,
}: {
  data: { date: string; label: string; onSec: number; boots: number }[]
  height?: number
  theme: 'dark' | 'light'
  monthly?: boolean
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
    const tooltipBg = dark ? 'rgba(12,14,22,0.96)' : 'rgba(255,255,255,0.98)'
    const tooltipBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(19,22,35,0.10)'
    const tooltipFg = dark ? '#edeff8' : '#111423'

    const option: EChartsOption = {
      animationDuration: 480,
      grid: { left: 34, right: 10, top: 14, bottom: 26 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: tooltipFg, fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number }[]
          const i = arr?.[0]?.dataIndex ?? 0
          const d = data[i]
          if (!d) return ''
          const h = Math.floor(d.onSec / 3600)
          const m = Math.round((d.onSec % 3600) / 60)
          const text = d.onSec > 0 ? `${h} 小时 ${m} 分` : '未开机'
          return `<div style="font-weight:600;margin-bottom:2px">${d.date}</div>${text}<br/>启动 ${d.boots} 次`
        },
      },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.label),
        axisLine: { lineStyle: { color: axisColor } },
        axisTick: { show: false },
        axisLabel: { color: labelColor, fontSize: 10.5 },
      },
      // 按天视图固定 24 小时（柱高才是当天占比）；按月视图累计值远超 24h，
      // 若仍固定 24 会把柱子全部截平 —— 所以按月时交给 echarts 自适应，刻度按天显示。
      yAxis: monthly
        ? {
            type: 'value',
            min: 0,
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(19,22,35,0.06)' } },
            axisLabel: {
              color: labelColor,
              fontSize: 10.5,
              formatter: (v: number) => `${Math.round(v / 24)}d`,
            },
          }
        : {
            type: 'value',
            min: 0,
            max: 24,
            interval: 6,
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(19,22,35,0.06)' } },
            axisLabel: {
              color: labelColor,
              fontSize: 10.5,
              formatter: (v: number) => `${v}h`,
            },
          },
      series: [
        {
          type: 'bar',
          name: '开机时长',
          data: data.map((d) => Math.round((d.onSec / 3600) * 100) / 100),
          barMaxWidth: 26,
          itemStyle: {
            borderRadius: [5, 5, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: dark ? '#a78bfa' : '#8b6bff' },
              { offset: 1, color: dark ? '#7c5cff' : '#a78bfa' },
            ]),
          },
          emphasis: { itemStyle: { color: dark ? '#c4b5fd' : '#7c5cff' } },
        },
      ],
    }
    chart.setOption(option, true)
    // 容器尺寸变化（切主题、切布局）后需要 resize
    requestAnimationFrame(() => chart.resize())
  }, [data, theme])

  return <div ref={ref} style={{ width: '100%', height }} />
}
