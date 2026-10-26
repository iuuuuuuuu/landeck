import type {
  ActionResult,
  AppGroup,
  FileEntry,
  FileRoot,
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
  StatsOverview,
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
  /** 本机自身：走同源相对路径，不需要令牌 */
  local?: boolean
}

export function baseUrl(t: Pick<Target, 'host' | 'port' | 'tls'> & { local?: boolean }): string {
  // 本机：固定打 127.0.0.1。不能用相对路径 —— Tauri 壳里 location.origin 是
  // tauri.localhost，相对路径会指向 WebView 自己而不是 Agent。
  if (t.local) return `http://127.0.0.1:${t.port}/api/v1`
  return `${t.tls ? 'https' : 'http'}://${t.host}:${t.port}/api/v1`
}

export function wsUrl(
  t: Pick<Target, 'host' | 'port' | 'tls'> & { local?: boolean },
  token: string,
): string {
  if (t.local) {
    return `ws://127.0.0.1:${t.port}/api/v1/ws?token=${encodeURIComponent(token)}`
  }
  return `${t.tls ? 'wss' : 'ws'}://${t.host}:${t.port}/api/v1/ws?token=${encodeURIComponent(token)}`
}

/**
 * 应用图标地址（给 <img src> 用）。
 *
 * 为什么单独拼 URL：<img> 发不出 Authorization 头，所以令牌只能走 query ——
 * 服务端 bearer() 本来就兼容 ?token=（本机请求还免令牌）。
 * 提取失败服务端返回 404，前端 onError 回退到字母占位。
 */
export function appIconUrl(
  target: Pick<Target, 'host' | 'port' | 'tls' | 'local'>,
  token: string | undefined,
  exe: string,
): string {
  if (!exe) return ''
  let url = `${baseUrl(target)}/apps/icon?exe=${encodeURIComponent(exe)}`
  if (token) url += `&token=${encodeURIComponent(token)}`
  return url
}

/**
 * 同源图标地址：浏览器里这个 SPA 就是由 Agent 自己提供的，
 * 直接打 /api/v1/apps/icon 即可（本机/同一台机器上免令牌）。
 *
 * 只在「页面确实由 Agent 提供」时才成立：Tauri 壳里 origin 是 tauri.localhost，
 * 那是 WebView 自己的资源服务器，打过去只会拿到 index.html，所以直接返回空。
 */
export function sameOriginIconUrl(exe: string): string {
  if (!exe || typeof location === 'undefined') return ''
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return ''
  const host = location.hostname
  const privateHost =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === 'localhost'
  // 桌面 App 的页面源是 tauri.localhost，它不是 Agent，同源取不到图标。
  // 这时回落到本机 Agent（被控端随客户端安装、固定听 127.0.0.1）。
  if (host === 'tauri.localhost') {
    // 8420 是被控端默认端口（api.ts 不引 discovery 以免循环依赖）
    return `http://127.0.0.1:8420/api/v1/apps/icon?exe=${encodeURIComponent(exe)}`
  }
  if (!privateHost && location.port !== '8420') return ''
  return `${location.origin}/api/v1/apps/icon?exe=${encodeURIComponent(exe)}`
}

interface RequestOptions {
  token?: string
  body?: unknown
  method?: string
  timeoutMs?: number
  signal?: AbortSignal
}async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
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

  /** 从 PairedDevice 构造（自动带上 local 标记） */
  static fromDevice(d: {
    host: string
    port: number
    tls: boolean
    token: string
    local?: boolean
  }): AgentClient {
    return new AgentClient(
      { host: d.host, port: d.port, tls: d.tls, local: d.local },
      d.local ? undefined : d.token,
    )
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

  uptime(days = 90) {
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

  apps(opts: { sort?: 'cpu' | 'mem' | 'name' | 'count'; limit?: number; q?: string } = {}) {
    const params = new URLSearchParams()
    if (opts.sort) params.set('sort', opts.sort)
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.q) params.set('q', opts.q)
    return this.req<{ items: AppGroup[]; total: number }>(`/apps?${params}`, { timeoutMs: 15000 })
  }

  killApp(key: string, force = true) {
    return this.req<{ ok: boolean; killed: number }>('/apps/kill', {
      method: 'POST',
      body: { key, force },
    })
  }

  /** 应用图标地址：本机走 127.0.0.1 且不带令牌，远程设备把令牌放进 query */
  appIconUrl(exe: string): string {
    return appIconUrl(this.target, this.target.local ? undefined : this.token, exe)
  }

  fileRoots() {
    return this.req<{ roots: FileRoot[]; allowWrite: boolean }>('/files/roots')
  }

  files(path: string) {
    return this.req<{ path: string; items: FileEntry[]; count: number }>(
      `/files/list?path=${encodeURIComponent(path)}`,
      { timeoutMs: 15000 },
    )
  }

  filePreview(path: string) {
    return this.req<{ text: string; truncated: boolean }>(
      `/files/preview?path=${encodeURIComponent(path)}`,
      { timeoutMs: 15000 },
    )
  }

  fileMkdir(parent: string, name: string) {
    return this.req<FileEntry>('/files/mkdir', { method: 'POST', body: { parent, name } })
  }

  fileRename(path: string, newName: string) {
    return this.req<FileEntry>('/files/rename', { method: 'POST', body: { path, newName } })
  }

  fileDelete(path: string) {
    return this.req<{ ok: boolean }>('/files/delete', { method: 'POST', body: { path } })
  }

  fileDownloadUrl(path: string) {
    const base = baseUrl(this.target)
    return `${base}/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(this.token ?? '')}`
  }

  async fileUpload(dir: string, file: File, overwrite = false, onProgress?: (pct: number) => void) {
    const url = `${baseUrl(this.target)}/files/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}&overwrite=${overwrite ? 1 : 0}`
    return new Promise<FileEntry>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url)
      xhr.setRequestHeader('Authorization', `Bearer ${this.token ?? ''}`)
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as FileEntry)
          } catch {
            reject(new ApiError('parse', '返回内容无法解析', xhr.status))
          }
        } else {
          let msg = `上传失败（HTTP ${xhr.status}）`
          try {
            const body = JSON.parse(xhr.responseText) as { message?: string }
            if (body.message) msg = body.message
          } catch {
            /* 保持默认文案 */
          }
          reject(new ApiError('upload', msg, xhr.status))
        }
      }
      xhr.onerror = () => reject(new ApiError('network', '上传失败，请检查网络', 0))
      xhr.send(file)
    })
  }

  killProcess(target: { pid?: number; name?: string; force?: boolean }) {
    return this.req<{ ok: boolean; pid: number }>('/processes/kill', {
      method: 'POST',
      body: target,
    })
  }

  stats(days = 14) {
    return this.req<StatsOverview>(`/stats?days=${days}`, { timeoutMs: 20000 })
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
