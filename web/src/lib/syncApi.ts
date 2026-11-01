import { baseUrl, type Target } from './api'

/**
 * 十期 A1 云同步（WebDAV）前端契约封装。
 *
 * 后端由 agent-activity 并行实现（docs/design/phase10-sync-plugins.md A1 表）。
 * mock 先行：后端未上线时 GET 返回 404/501——UI 按「功能未上线」降级展示，
 * 不阻塞设置页其余部分。
 *
 * 口径（与契约一致）：
 *  - GET  /sync/settings → {enabled, url, username, password(打码), intervalSec, lastSyncAt, lastError}
 *  - PUT  /sync/settings → 部分更新；password 字段出现即改（留空/缺省不动）
 *  - POST /sync/now      → {pushed, pulled, errors}（立即同步一次）
 *  - GET  /sync/status   → {enabled, lastSyncAt, lastError, devices:[{deviceId,name,segments,lastSeenAt}]}
 */

export interface SyncSettings {
  enabled: boolean
  url: string
  username: string
  /** GET 时是打码值（如 ••••••）；只有用户重新输入才回传新值 */
  password: string
  intervalSec: number
  lastSyncAt: string | null
  lastError: string | null
}

export interface SyncNowResult {
  pushed: number
  pulled: number
  errors: string[]
}

export interface SyncDeviceStatus {
  deviceId: string
  name: string
  segments: number
  lastSeenAt: string | null
}

export interface SyncStatus {
  enabled: boolean
  lastSyncAt: string | null
  lastError: string | null
  devices: SyncDeviceStatus[]
}

type SyncTarget = Target & { token?: string }

async function req<T>(target: SyncTarget, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl(target)}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return (await res.json()) as T
}

export function fetchSyncSettings(target: Target): Promise<SyncSettings> {
  return req<SyncSettings>(target, '/sync/settings')
}

/** 部分更新：只带变更字段；password 为空串时**不带上**（避免把打码值写回）。 */
export async function putSyncSettings(
  target: Target,
  patch: Partial<Omit<SyncSettings, 'password'>> & { password?: string },
): Promise<SyncSettings> {
  const body: Record<string, unknown> = { ...patch }
  if (!body.password) delete body.password
  return req<SyncSettings>(target, '/sync/settings', { method: 'PUT', body: JSON.stringify(body) })
}

export function postSyncNow(target: Target): Promise<SyncNowResult> {
  return req<SyncNowResult>(target, '/sync/now', { method: 'POST', body: '{}' })
}

export function fetchSyncStatus(target: Target): Promise<SyncStatus> {
  return req<SyncStatus>(target, '/sync/status')
}
