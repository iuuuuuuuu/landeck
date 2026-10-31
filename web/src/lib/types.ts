/**
 * 与 docs/API.md 一一对应的类型。改字段先改文档。
 */

export type PowerAction =
  | 'power.shutdown'
  | 'power.restart'
  | 'power.sleep'
  | 'power.hibernate'
  | 'power.lock'
  | 'power.logoff'
  | 'power.screen_off'
  | 'power.cancel'
  | 'volume.set'
  | 'volume.up'
  | 'volume.down'
  | 'volume.mute'
  | 'volume.unmute'
  | 'volume.toggle_mute'
  | 'media.play_pause'
  | 'media.next'
  | 'media.prev'
  | 'media.stop'
  | 'wake.on_lan'
  | 'app.launch'

export interface NodeInfo {
  v: number
  id: string
  name: string
  ip: string
  port: number
  tls: boolean
  ver: string
  os: string
  arch: string
  paired: boolean
  /** 请求来自被控机本机时为真：前端据此免配对直接进入 */
  self?: boolean
  pairing?: { fixed: boolean; random: boolean; codeExpiresAt: string }
}

export interface PairResponse {
  token: string
  clientId: string
  clientName: string
  role: 'owner' | 'controller' | 'viewer'
  server: { id: string; name: string; port: number; tls: boolean; ver: string }
}

export interface SessionInfo {
  clientId: string
  clientName: string
  role: 'owner' | 'controller' | 'viewer'
  createdAt: string
  lastSeenAt: string
}

export interface SystemInfo {
  id: string
  name: string
  hostname: string
  os: string
  platform: string
  arch: string
  kernel: string
  agentVersion: string
  bootTime: string
  uptimeSec: number
  time: string
  timezone: string
  features: Record<
    | 'power'
    | 'media'
    | 'volume'
    | 'wol'
    | 'schedules'
    | 'hardware'
    | 'shell'
    | 'processes'
    | 'files'
    | 'battery',
    boolean
  >
  capabilities: Record<'sleep' | 'hibernate' | 'wake' | 'screenOff', boolean>
}

export interface StatusSnapshot {
  time: string
  cpu: {
    percent: number
    model: string
    cores: number
    threads: number
    freqMhz: number
    perCore: number[]
    load: [number, number, number]
  }
  mem: { used: number; total: number; percent: number; swapUsed: number; swapTotal: number }
  disks: { mount: string; fs: string; used: number; total: number; percent: number }[]
  net: { rxBps: number; txBps: number; iface: string; ip: string; mac: string }
  battery: { percent: number; charging: boolean; timeLeftMin: number | null } | null
  temps: { name: string; c: number }[]
  processes: { total: number; top: { name: string; cpu: number; memMb: number }[] }
  uptimeSec: number
  bootTime: string
}

export interface HardwareInfo {
  cpu: {
    model: string
    vendor: string
    cores: number
    threads: number
    baseMhz: number
    cacheKb: number
    socket: string
  }
  memory: {
    totalBytes: number
    type: string
    speedMhz: number
    slots: {
      bank: string
      sizeBytes: number
      speedMhz: number
      manufacturer: string
      partNumber: string
    }[]
  }
  gpus: { name: string; vramMb: number; driver: string }[]
  disks: { name: string; type: string; sizeBytes: number; serial: string; health: string }[]
  nics: { name: string; mac: string; speedMbps: number; ipv4: string[] }[]
  board: { manufacturer: string; model: string; bios: string }
  os: { name: string; version: string; installedAt: string }
}

/** 当前媒体会话（Windows 走 SMTC，Linux 走 MPRIS） */
export interface MediaInfo {
  known: boolean
  active: boolean
  playing: boolean
  title: string
  artist: string
  album: string
  app: string
  status: string
  positionSec: number
  durationSec: number
  updatedAt: number
}

/** 统计页：一次拿全的总览数据 */
export interface StatsOverview {
  generatedAt: string
  device: {
    id: string
    name: string
    platform: string
    arch: string
    agentVersion: string
    bootTime: string
    uptimeSec: number
  }
  realtime: {
    cpu: number
    mem: number
    memUsed: number
    memTotal: number
    rxBps: number
    txBps: number
    disks: { mount: string; fs: string; used: number; total: number; percent: number }[]
    battery: { percent: number; charging: boolean; timeLeftMin: number | null } | null
    temps: { name: string; c: number }[]
  }
  counts: {
    apps: number
    processes: number
    clients: number
    schedules: number
  }
  uptime: UptimeHistory
  activity: {
    total: number
    failed: number
    actions: { action: string; label: string; total: number; ok: number; failed: number }[]
    days: { date: string; total: number; failed: number }[]
    clients: { name: string; total: number; lastSeen: string }[]
    firstAt: string
    lastAt: string
    busiestDay: string
  }
}

/** 按应用聚合后的进程组（用户只认应用，不认 PID） */
export interface AppGroup {
  key: string
  name: string
  pids: number[]
  mainPid: number
  count: number
  cpu: number
  memMb: number
  user: string
  exe: string
  protected: boolean
}

export interface FileEntry {
  name: string
  path: string
  dir: boolean
  size: number
  modTime: string
  ext: string
  hidden: boolean
}

export interface FileRoot {
  path: string
  label: string
  kind: 'home' | 'drive' | 'custom'
}

export interface ProcessInfo {
  pid: number
  parent: number
  name: string
  cpu: number
  memMb: number
  user: string
  status: string
  exe: string
  startedAt: string
}

export interface UptimeDay {
  date: string
  onSec: number
  boots: number
  firstOn: string | null
  lastOff: string | null
}

export interface BootEvent {
  at: string
  kind: 'boot' | 'shutdown' | 'sleep' | 'wake' | 'crash'
  uptimeSec: number
}

/** 按月聚合的开机统计 */
export interface UptimeMonth {
  month: string
  onSec: number
  boots: number
  avgUptimeSec: number
  longestSec: number
}

export interface UptimeHistory {
  days: UptimeDay[]
  months?: UptimeMonth[]
  boots: BootEvent[]
  totals: { onSec7d: number; boots7d: number; avgUptimeSec: number; longestSec: number }
}

export type ScheduleKind = 'daily' | 'weekly' | 'once'

export interface Schedule {
  id: string
  name: string
  enabled: boolean
  action: PowerAction
  params: Record<string, unknown>
  when: {
    kind: ScheduleKind
    time: string
    weekdays?: number[]
    at?: string
  }
  wake: { enabled: boolean; leadSec: number }
  lastRunAt?: string
  nextRunAt?: string
}

export interface ActivityItem {
  id: string
  at: string
  clientName: string
  action: string
  params?: Record<string, unknown>
  ok: boolean
  detail: string
}

export interface PairedClient {
  id: string
  name: string
  role: 'owner' | 'controller' | 'viewer'
  ip: string
  createdAt: string
  lastSeenAt: string
}

export interface PairingState {
  fixedKeyMasked: string
  fixedKeySet: boolean
  randomEnabled: boolean
  code: string
  codeExpiresAt: string
  requireLocalCode: boolean
}

export interface AgentSettings {
  deviceName: string
  port: number
  tls: { enabled: boolean; cert: string; key: string }
  features: {
    allowWol: boolean
    allowSchedules: boolean
    allowShell: boolean
    allowProcessKill: boolean
  }
  files: {
    enabled: boolean
    allowWrite: boolean
    allowSystemDirs: boolean
    roots: string[]
  }
  locale: string
  theme: string
}

export interface ActionResult {
  ok: boolean
  action: string
  detail: string
  durationMs: number
}

export interface ActionMeta {
  action: string
  supported: boolean
  params: Record<string, string>
}

export type WsFrame =
  | { type: 'status'; data: StatusSnapshot }
  | { type: 'media'; data: MediaInfo }
  | {
      type: 'event'
      data: { event: string; action: string; ok: boolean; clientName: string; at: string }
    }
  | { type: 'pairing'; data: { code: string; expiresAt: string } }
  | { type: 'pong' }
