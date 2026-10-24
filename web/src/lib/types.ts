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

export interface UptimeHistory {
  days: UptimeDay[]
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
  | {
      type: 'event'
      data: { event: string; action: string; ok: boolean; clientName: string; at: string }
    }
  | { type: 'pairing'; data: { code: string; expiresAt: string } }
  | { type: 'pong' }
