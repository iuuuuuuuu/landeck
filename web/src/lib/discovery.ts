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

interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>
}

function tauriInvoke(): TauriInvoke | null {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvoke }; invoke?: TauriInvoke }
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke }
  }
  return w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null
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
  const { hintHost = ownHint(), onNode, onProgress, concurrency = 64, timeoutMs = 620 } = opts
  const found = new Map<string, NodeInfo>()

  const emit = (n: NodeInfo) => {
    if (found.has(n.id)) return
    found.set(n.id, n)
    onNode(n)
  }

  // 1) 原生广播
  const invoke = tauriInvoke()
  if (invoke) {
    const nodes = await scanNative(invoke)
    nodes.forEach(emit)
    if (nodes.length > 0) return [...found.values()]
  }

  // 2) HTTP 扫段
  const hosts = candidatesFromHint(hintHost)
  if (hosts.length === 0) return [...found.values()]

  const tasks: { host: string; port: number; tls: boolean }[] = []
  for (const host of hosts) {
    for (const p of COMMON_PORTS) tasks.push({ host, ...p })
  }

  let done = 0
  let cursor = 0
  const total = tasks.length
  onProgress?.(0, total)

  async function worker() {
    while (cursor < tasks.length) {
      if (opts.signal?.aborted) return
      const t = tasks[cursor++]
      const node = await probeNode(t.host, t.port, t.tls, timeoutMs, opts.signal)
      done++
      if (node) {
        emit({ ...node, ip: node.ip || t.host, port: t.port, tls: t.tls })
      }
      onProgress?.(done, total)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return [...found.values()]
}

/** 手动添加 / 刷新单台设备 */
export async function probeTarget(host: string, port = DEFAULT_PORT, tls = false) {
  return probeNode(host, port, tls, 2500)
}
