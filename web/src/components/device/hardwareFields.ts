/**
 * 硬件信息的读取层。
 *
 * Windows / macOS / 旧版 Agent / 开发环境给出的字段名并不完全一致
 * （memory 与 mem、gpus 与 gpu、sizeBytes 与 size、speedMbps 与 speed…），
 * 渲染层只认这里的规整结果，避免某一台机器整块空白。
 * 约定：拿不到的数值一律返回 0，由展示函数转成「—」，绝不伪造 0。
 */
import { bytes } from '../../lib/format'

export type Obj = Record<string, unknown>

export function objOf(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
}

/** 按候选顺序取第一个非空字段 */
export function pick(src: unknown, ...keys: string[]): unknown {
  const raw = objOf(src)
  if (!raw) return undefined
  for (const k of keys) {
    const v = raw[k]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/** 数组字段：非数组/null 一律当空数组 */
export function list(v: unknown): Obj[] {
  if (!Array.isArray(v)) return []
  return v.map(objOf).filter((x): x is Obj => x !== null)
}

export function strOf(src: unknown, ...keys: string[]): string {
  const raw = objOf(src)
  if (!raw) return ''
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

export function numOf(src: unknown, ...keys: string[]): number {
  const raw = objOf(src)
  if (!raw) return 0
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
    if (typeof v === 'string') {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return 0
}

export function strList(src: unknown, ...keys: string[]): string[] {
  const raw = objOf(src)
  if (!raw) return []
  for (const k of keys) {
    const v = raw[k]
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && !!x.trim())
  }
  return []
}

/** 0 / 缺失一律破折号（核显 vramMb=0 是常态） */
export function nz(v: number, unit = ''): string {
  return Number.isFinite(v) && v > 0 ? `${Math.round(v)}${unit}` : '—'
}

export function sizeOf(v: number): string {
  return Number.isFinite(v) && v > 0 ? bytes(v) : '—'
}

/** 「0 核 / 0 线程」这类组合整条降级为破折号 */
export function ratio(a: number, b: number): string {
  if (!(a > 0) && !(b > 0)) return '—'
  return `${a > 0 ? a : '—'} / ${b > 0 ? b : '—'}`
}

export function vramLabel(mb: number): string {
  if (!(mb > 0)) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

export function healthLabel(v: string): string {
  const k = v.toLowerCase()
  if (!k) return '—'
  if (k === 'ok' || k === 'healthy' || k === 'good') return '正常'
  if (k === 'warning' || k === 'degraded') return '警告'
  if (k === 'unhealthy' || k === 'bad') return '异常'
  return v
}

/** 整份数据都是空壳（采集失败时后端会回零值对象）——直接说清楚，不渲染六页破折号 */
export function isBlankHardware(hw: unknown): boolean {
  return (
    !strOf(pick(hw, 'cpu'), 'model', 'name', 'vendor') &&
    !numOf(pick(hw, 'memory', 'mem'), 'totalBytes', 'total') &&
    list(pick(hw, 'gpus', 'gpu')).length === 0 &&
    list(pick(hw, 'disks', 'disk')).length === 0 &&
    list(pick(hw, 'nics', 'nic')).length === 0
  )
}
