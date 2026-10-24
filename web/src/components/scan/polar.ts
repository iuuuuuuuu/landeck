/**
 * 雷达坐标：由设备 id 的哈希推出固定方位，同一台设备每次扫码都落在同一处，
 * 不随列表顺序抖动。viewBox 为 0..100，圆心 (50,50)。
 */
const RADIUS_MIN = 24
const RADIUS_SPAN = 20

export interface Blip {
  id: string
  x: number
  y: number
  angle: number
  r: number
}

export function hash32(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

export function blipFor(id: string): Blip {
  const h = hash32(id)
  const angle = (h % 3600) / 10
  const r = RADIUS_MIN + (((h >>> 12) % 1000) / 1000) * RADIUS_SPAN
  const rad = (angle * Math.PI) / 180
  return {
    id,
    x: 50 + Math.cos(rad) * r,
    y: 50 + Math.sin(rad) * r,
    angle,
    r,
  }
}
