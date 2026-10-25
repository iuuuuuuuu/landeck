import { probeNode } from './api'
import type { NodeInfo } from './types'

/**
 * 局域网发现：三条路，谁可用走谁。
 * 1. Tauri 壳：原生 UDP 广播，最快最准（invoke('scan_lan')）。
 * 2. 浏览器：对同网段 /24 逐个 HTTP 探测 —— 页面本身由某台 Agent 提供，
 *    所以拿 location.hostname 当网段提示；跨源靠 Agent 端 CORS 放行。
 * 3. 手动：用户直接填 IP:PORT。
 */

export const DEFAULT_PORT = 8420

const COMMON_PORTS: { port: number; tls: boolean }[] = [
  { port: 8420, tls: false },
  { port: 8443, tls: true },
]

interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>
}

function tauriInvoke(): TauriInvoke | null {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvoke }; invoke?: TauriInvoke }
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke }
  }
  // Tauri v2：withGlobalTauri 打开时是 __TAURI__.core.invoke；
  // 即使没开，__TAURI_INTERNALS__.invoke 也存在，两条都认。
  const fn =
    w.__TAURI__?.core?.invoke ??
    w.__TAURI__?.invoke ??
    w.__TAURI_INTERNALS__?.invoke ??
    null
  return fn ? fn.bind(w.__TAURI__?.core ?? w.__TAURI_INTERNALS__ ?? w) : null
}

export interface ScanOptions {
  hintHost?: string
  onNode: (node: NodeInfo) => void
  onProgress?: (done: number, total: number) => void
  concurrency?: number
  timeoutMs?: number
  signal?: AbortSignal
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** 由提示地址推导待扫列表（/24），提示主机排最前 */
export function candidatesFromHint(hintHost?: string): string[] {
  if (!hintHost || !isPrivateV4(hintHost)) return []
  const base = hintHost.split('.').slice(0, 3).join('.')
  const self = Number(hintHost.split('.')[3])
  const list: string[] = [hintHost]
  for (let i = 1; i <= 254; i++) {
    if (i === self) continue
    list.push(`${base}.${i}`)
  }
  return list
}

export function ownHint(): string | undefined {
  if (typeof location === 'undefined') return undefined
  const h = location.hostname
  return isPrivateV4(h) ? h : undefined
}

/**
 * 推断要扫的网段。
 * 浏览器里 location.hostname 是被控机 IP，直接可用；
 * Tauri 壳里是 tauri.localhost（或 localhost），推不出网段 —— 这时用原生层拿到的本机地址。
 */
export function resolveHint(nativeHint?: string): string | undefined {
  const fromUrl = ownHint()
  if (fromUrl) return fromUrl
  if (nativeHint && isPrivateV4(nativeHint)) return nativeHint
  return undefined
}

/** 原生层给的本机地址（Tauri 下才有；浏览器返回 undefined） */
export async function nativeLocalIP(): Promise<string | undefined> {
  const invoke = tauriInvoke()
  if (!invoke) return undefined
  try {
    const ip = await invoke('local_ip')
    if (typeof ip === 'string' && isPrivateV4(ip)) return ip
  } catch {
    /* 老版本壳没有这个命令 */
  }
  return undefined
}

async function scanNative(invoke: TauriInvoke): Promise<NodeInfo[]> {
  try {
    const res = await invoke('scan_lan')
    if (!Array.isArray(res)) return []
    return (res as NodeInfo[]).filter((n) => n && typeof n.id === 'string')
  } catch {
    return []
  }
}

export async function scanLan(opts: ScanOptions): Promise<NodeInfo[]> {
  const { onNode, onProgress, concurrency = 64, timeoutMs = 620 } = opts
  const found = new Map<string, NodeInfo>()
  const emit = (n: NodeInfo) => {
    if (!n || typeof n.id !== 'string' || !n.id) return
    // 本机（运行 Agent 的这台机器）不放进「局域网设备」列表：
    // 它由「本机」页单独承载，混在待配对列表里只会让用户困惑。
    if (n.self) return
    if (n.ip && (selfIPs.has(n.ip) || n.ip === '127.0.0.1' || n.ip === '::1')) return
    if (found.has(n.id)) return
    found.set(n.id, n)
    onNode(n)
  }

  // 网段提示：URL 优先，其次问原生层（Tauri 下 hostname 是 tauri.localhost，推不出网段）
  const localIP = await nativeLocalIP()
  const hintHost = opts.hintHost ?? resolveHint(localIP)
  const invoke = tauriInvoke()
  // 本机地址：URL 主机名 / 原生 IP 都算。用于把「自己」排除出待配对列表 ——
  // 原生 UDP 帧里没有 self 字段，只能比 IP。
  const selfIPs = new Set<string>()
  if (localIP) selfIPs.add(localIP)
  if (typeof location !== 'undefined' && location.hostname) selfIPs.add(location.hostname)

  // 1) 原生 UDP 广播 + 2) HTTP 扫段，两条路并行跑，谁有结果都不影响另一条。
  //    早期版本在广播有结果时直接 return，导致「广播收到一半」就漏掉整段扫描。
  const jobs: Promise<void>[] = []

  if (invoke) {
    jobs.push(
      (async () => {
        const nodes = await scanNative(invoke)
        nodes.forEach(emit)
      })(),
    )
  }

  const hosts = candidatesFromHint(hintHost)
  if (hosts.length > 0) {
    jobs.push(
      (async () => {
        const tasks: { host: string; port: number; tls: boolean }[] = []
        for (const host of hosts) {
          for (const p of COMMON_PORTS) tasks.push({ host, ...p })
        }
        let done = 0
        let cursor = 0
        onProgress?.(0, tasks.length)
        async function worker() {
          while (cursor < tasks.length) {
            if (opts.signal?.aborted) return
            const t = tasks[cursor++]
            const node = await probeNode(t.host, t.port, t.tls, timeoutMs, opts.signal)
            done++
            if (node) emit({ ...node, ip: node.ip || t.host, port: t.port, tls: t.tls })
            onProgress?.(done, tasks.length)
          }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
      })(),
    )
  } else if (!invoke) {
    // 浏览器里打开的不是内网地址（localhost / 域名），无网段可扫 —— 交给页面提示手动填 IP
    onProgress?.(0, 0)
  }

  await Promise.all(jobs)
  return [...found.values()]
}

/** 手动添加 / 刷新单台设备 */
export async function probeTarget(host: string, port = DEFAULT_PORT, tls = false) {
  return probeNode(host, port, tls, 2500)
}

/** 桌面端自启开关（浏览器里没有，返回 null 表示不支持） */
export async function autostartGet(): Promise<boolean | null> {
  const invoke = tauriInvoke()
  if (!invoke) return null
  try {
    const v = await invoke('autostart_get')
    return typeof v === 'boolean' ? v : null
  } catch {
    return null
  }
}

export async function autostartSet(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const invoke = tauriInvoke()
  if (!invoke) return { ok: false, error: '当前环境不支持（需要在桌面端 App 里操作）' }
  try {
    await invoke('autostart_set', { enabled })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** 桌面端主题偏好（磁盘持久化）；浏览器返回 null */
export async function themeGet(): Promise<string | null> {
  const invoke = tauriInvoke()
  if (!invoke) return null
  try {
    const v = await invoke('theme_get')
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

/** 写桌面端主题偏好；浏览器里是空操作 */
export async function themeSet(mode: string): Promise<void> {
  const invoke = tauriInvoke()
  if (!invoke) return
  try {
    await invoke('theme_set', { mode })
  } catch {
    /* 写失败不影响本次会话的显示 */
  }
}

/** 桌面端：本机端口上有没有被控端在应答（浏览器返回 null） */
export async function agentStatus(port: number): Promise<boolean | null> {
  const invoke = tauriInvoke()
  if (!invoke) return null
  try {
    const v = await invoke('agent_status', { port })
    return typeof v === 'boolean' ? v : null
  } catch {
    return null
  }
}

/** 桌面端：启动随安装包附带的被控端 */
export async function agentStart(port: number): Promise<{ ok: boolean; error?: string }> {
  const invoke = tauriInvoke()
  if (!invoke) return { ok: false, error: '只有桌面端 App 能启动本机被控端' }
  try {
    const ok = await invoke('agent_start', { port })
    return { ok: ok === true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
