import type {
  ActionResult,
  MediaInfo,
  ProcessInfo,
  ActionMeta,
  ActivityItem,
  AgentSettings,
  HardwareInfo,
  NodeInfo,
  PairedClient,
  PairingState,
  PairResponse,
  Schedule,
  SessionInfo,
  StatusSnapshot,
  SystemInfo,
  UptimeHistory,
} from './types'

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface Target {
  host: string
  port: number
  tls: boolean
}

export function baseUrl(t: Pick<Target, 'host' | 'port' | 'tls'>): string {
  return `${t.tls ? 'https' : 'http'}://${t.host}:${t.port}/api/v1`
}

export function wsUrl(t: Pick<Target, 'host' | 'port' | 'tls'>, token: string): string {
  return `${t.tls ? 'wss' : 'ws'}://${t.host}:${t.port}/api/v1/ws?token=${encodeURIComponent(token)}`
}

interface RequestOptions {
  token?: string
  body?: unknown
  method?: string
  timeoutMs?: number
  signal?: AbortSignal
}

async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { token, body, method = 'GET', timeoutMs = 12000, signal } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    if (!res.ok) {
      const err = (parsed ?? {}) as { error?: string; message?: string }
      throw new ApiError(
        err.error ?? `http_${res.status}`,
        err.message ?? `请求失败（HTTP ${res.status}）`,
        res.status,
      )
    }
    return parsed as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if ((e as Error).name === 'AbortError') {
      throw new ApiError('timeout', '设备无响应，可能已离线', 0)
    }
    throw new ApiError('network', '连接失败，请确认设备在线且在同一局域网', 0)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 无鉴权探测：发现与配对前握手 */
export async function probeNode(
  host: string,
  port: number,
  tls: boolean,
  timeoutMs = 700,
  signal?: AbortSignal,
): Promise<NodeInfo | null> {
  try {
    return await request<NodeInfo>(`${baseUrl({ host, port, tls })}/hello`, {
      timeoutMs,
      signal,
    })
  } catch {
    return null
  }
}

export class AgentClient {
  readonly target: Target
  readonly token?: string

  constructor(target: Target, token?: string) {
    this.target = target
    this.token = token
  }

  private req<T>(path: string, opts: Omit<RequestOptions, 'token'> = {}) {
    return request<T>(`${baseUrl(this.target)}${path}`, { ...opts, token: this.token })
  }

  session() {
    return this.req<SessionInfo>('/session')
  }

  system() {
    return this.req<SystemInfo>('/system')
  }

  status() {
    return this.req<StatusSnapshot>('/status', { timeoutMs: 6000 })
  }

  hardware() {
    return this.req<HardwareInfo>('/hardware', { timeoutMs: 20000 })
  }

  uptime(days = 14) {
    return this.req<UptimeHistory>(`/uptime/history?days=${days}`, { timeoutMs: 20000 })
  }

  mediaState() {
    return this.req<MediaInfo>('/media', { timeoutMs: 8000 })
  }

  volume() {
    return this.req<{ level: number; muted: boolean; known: boolean }>('/volume', { timeoutMs: 6000 })
  }

  actions() {
    return this.req<{ actions: ActionMeta[] }>('/actions')
  }

  run(action: string, params: Record<string, unknown> = {}) {
    return this.req<ActionResult>('/actions', { method: 'POST', body: { action, params } })
  }

  schedules() {
    return this.req<{ items: Schedule[] }>('/schedules')
  }

  createSchedule(s: Omit<Schedule, 'id'>) {
    return this.req<Schedule>('/schedules', { method: 'POST', body: s })
  }

  updateSchedule(s: Schedule) {
    return this.req<Schedule>(`/schedules/${s.id}`, { method: 'PUT', body: s })
  }

  deleteSchedule(id: string) {
    return this.req<{ ok: boolean }>(`/schedules/${id}`, { method: 'DELETE' })
  }

  clients() {
    return this.req<{ items: PairedClient[] }>('/clients')
  }

  revokeClient(id: string) {
    return this.req<{ ok: boolean }>(`/clients/${id}`, { method: 'DELETE' })
  }

  pairing() {
    return this.req<PairingState>('/pairing')
  }

  updatePairing(patch: { fixedKey?: string; randomEnabled?: boolean }) {
    return this.req<PairingState>('/pairing', { method: 'PUT', body: patch })
  }

  rotateCode() {
    return this.req<{ code: string; codeExpiresAt: string }>('/pairing/code/rotate', {
      method: 'POST',
    })
  }

  settings() {
    return this.req<AgentSettings>('/settings')
  }

  updateSettings(patch: Partial<AgentSettings>) {
    return this.req<AgentSettings>('/settings', { method: 'PUT', body: patch })
  }

  processes(opts: { sort?: 'cpu' | 'mem' | 'name' | 'pid'; limit?: number; q?: string } = {}) {
    const params = new URLSearchParams()
    if (opts.sort) params.set('sort', opts.sort)
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.q) params.set('q', opts.q)
    return this.req<{ items: ProcessInfo[]; total: number }>(`/processes?${params}`, {
      timeoutMs: 15000,
    })
  }

  killProcess(target: { pid?: number; name?: string; force?: boolean }) {
    return this.req<{ ok: boolean; pid: number }>('/processes/kill', {
      method: 'POST',
      body: target,
    })
  }

  activity(limit = 100, before?: string) {
    const q = new URLSearchParams({ limit: String(limit) })
    if (before) q.set('before', before)
    return this.req<{ items: ActivityItem[] }>(`/activity?${q}`)
  }

  streamUrl() {
    return this.token ? wsUrl(this.target, this.token) : ''
  }
}

export async function pairDevice(args: {
  target: Target
  key: string
  kind: 'fixed' | 'random'
  clientName: string
  clientId: string
}): Promise<PairResponse> {
  return request<PairResponse>(`${baseUrl(args.target)}/pair`, {
    method: 'POST',
    body: {
      key: args.key.trim(),
      kind: args.kind,
      clientName: args.clientName,
      clientId: args.clientId,
    },
    timeoutMs: 12000,
  })
}
