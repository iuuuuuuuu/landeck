/** 展示层格式化。UI 只调这里，别在组件里重复写 1024 除除法。 */

export function bytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  const v = n / 1024 ** i
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`
}

export function gbFromMb(mb: number): string {
  return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`
}

export function bps(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 时长：63s → 1 分 3 秒；90061 → 1 天 1 小时 */
export function duration(sec: number, style: 'full' | 'short' = 'full'): string {
  if (!Number.isFinite(sec) || sec <= 0) return style === 'short' ? '0m' : '0 分钟'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (style === 'short') {
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }
  const parts: string[] = []
  if (d) parts.push(`${d} 天`)
  if (h) parts.push(`${h} 小时`)
  if (m) parts.push(`${m} 分`)
  if (!d && !h && !m) parts.push(`${s} 秒`)
  return parts.join(' ')
}

export function hours(sec: number): string {
  const h = sec / 3600
  return h >= 10 ? h.toFixed(0) : h.toFixed(1)
}

export function timeOfDay(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function dateLabel(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function dateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

export function relative(iso?: string | null): string {
  if (!iso) return '从未'
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return '—'
  const diff = Date.now() - d
  if (diff < 0) {
    const ahead = -diff
    if (ahead < 60_000) return `${Math.round(ahead / 1000)} 秒后`
    if (ahead < 3_600_000) return `${Math.round(ahead / 60_000)} 分钟后`
    return `${Math.round(ahead / 3_600_000)} 小时后`
  }
  if (diff < 5000) return '刚刚'
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`
  return `${Math.round(diff / 86_400_000)} 天前`
}

export function weekdaysLabel(days?: number[]): string {
  if (!days || days.length === 0) return '每天'
  if (days.length === 7) return '每天'
  const names = ['一', '二', '三', '四', '五', '六', '日']
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return '工作日'
  if (days.length === 2 && days.includes(6) && days.includes(0)) return '周末'
  return days.map((d) => `周${names[d % 7]}`).join(' ')
}

export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

export function percentColor(p: number): string {
  if (p >= 90) return 'var(--color-danger)'
  if (p >= 70) return 'var(--color-warn)'
  return 'var(--color-ok)'
}

export function osLabel(os?: string): string {
  switch (os) {
    case 'windows':
      return 'Windows'
    case 'linux':
      return 'Linux'
    case 'darwin':
      return 'macOS'
    case 'android':
      return 'Android'
    default:
      return os ?? '未知系统'
  }
}

export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    'power.shutdown': '关机',
    'power.restart': '重启',
    'power.sleep': '睡眠',
    'power.hibernate': '休眠',
    'power.lock': '锁屏',
    'power.logoff': '注销',
    'power.screen_off': '关闭屏幕',
    'power.cancel': '取消关机',
    'volume.set': '调节音量',
    'volume.up': '音量 +',
    'volume.down': '音量 −',
    'volume.mute': '静音',
    'volume.unmute': '取消静音',
    'volume.toggle_mute': '切换静音',
    'media.play_pause': '播放/暂停',
    'media.next': '下一首',
    'media.prev': '上一首',
    'media.stop': '停止播放',
    'wake.on_lan': '网络唤醒',
    'app.launch': '启动应用',
  }
  return map[action] ?? action
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}
