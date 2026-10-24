import type { AgentSettings } from '../../lib/types'

/**
 * 把 `/settings` 的响应补成完整结构。
 *
 * 为什么需要：这个页面直接读 `draft.tls.enabled` 之类的深层字段，
 * 一旦后端因为版本差异、字段改名或异常响应少给一层，整个页面就会
 * `Cannot read properties of undefined` 白屏（实测踩过）。
 * 前端不该假设服务端一定返回全部字段 —— 缺什么补什么，缺的用保守默认值。
 */
export function normalizeSettings(raw: unknown, fallbackName = ''): AgentSettings {
  const src = (raw ?? {}) as Partial<AgentSettings> & {
    tls?: Partial<AgentSettings['tls']>
    features?: Partial<AgentSettings['features']>
    files?: Partial<AgentSettings['files']>
  }
  return {
    deviceName: typeof src.deviceName === 'string' && src.deviceName ? src.deviceName : fallbackName,
    port: Number.isFinite(src.port) && Number(src.port) > 0 ? Number(src.port) : 8420,
    tls: {
      enabled: Boolean(src.tls?.enabled),
      cert: typeof src.tls?.cert === 'string' ? src.tls.cert : '',
      key: typeof src.tls?.key === 'string' ? src.tls.key : '',
    },
    features: {
      allowWol: Boolean(src.features?.allowWol),
      allowSchedules: Boolean(src.features?.allowSchedules),
      allowShell: Boolean(src.features?.allowShell),
      allowProcessKill: Boolean(src.features?.allowProcessKill),
    },
    files: {
      enabled: Boolean(src.files?.enabled),
      allowWrite: Boolean(src.files?.allowWrite),
      allowSystemDirs: Boolean(src.files?.allowSystemDirs),
      roots: Array.isArray(src.files?.roots) ? src.files!.roots! : [],
    },
    locale: typeof src.locale === 'string' && src.locale ? src.locale : 'zh-CN',
    theme: typeof src.theme === 'string' && src.theme ? src.theme : 'aurora',
  }
}
