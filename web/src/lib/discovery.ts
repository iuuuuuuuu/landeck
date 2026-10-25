import { probeNode } from './api'
import { detectRuntime } from './runtime'
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
  // 0.x / 127.x / 169.254.x（链路本地）/ 100.64-127.x（运营商 CGNAT）都不是
  // 「用户自己的局域网」—— 安卓蜂窝网最常见的就是这两种，扫它们纯属浪费时间。
  if (a === 0 || a === 127) return false
  if (a === 169 && b === 254) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** 兜底网段：主流家用/办公私有网段，按命中概率排序 */
export const FALLBACK_SUBNETS = [
  '192.168.1',
  '192.168.0',
  '192.168.31',
  '10.0.0',
  '172.16.0',
]

/** 某个 /24 里 1..254 的主机地址，可跳过指定末位 */
function slash24Hosts(base: string, skipHost?: number): string[] {
  const list: string[] = []
  for (let i = 1; i <= 254; i++) {
    if (i === skipHost) continue
    list.push(`${base}.${i}`)
  }
  return list
}

/** 不知道自己在哪个网段时，退化成扫几个常见内网 /24 */
export function fallbackCandidates(): string[] {
  return FALLBACK_SUBNETS.flatMap((base) => slash24Hosts(base))
}

/**
 * 由提示地址推导待扫列表（/24），提示主机排最前。
 *
 * 拿不到提示地址时不再返回空表：安卓原生壳里 `local_ip` 可能失败
 * （只连了蜂窝/VPN、网卡名不认识、权限被限制），返回空表就等于「一台上网设备都扫不到」。
 * 这时退化成扫常见私有网段的 /24，至少还有机会命中用户家里的路由器网段。
 */
export function candidatesFromHint(hintHost?: string): string[] {
  if (!hintHost || !isPrivateV4(hintHost)) return fallbackCandidates()
  const base = hintHost.split('.').slice(0, 3).join('.')
  const self = Number(hintHost.split('.')[3])
  return [hintHost, ...slash24Hosts(base, self)]
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

/**
 * 查出「本机正在运行的那个 Agent」的 id，用来把这一条从扫描结果里排掉。
 *
 * 为什么不按 IP 排：同一台机器上可能既跑 Agent 又要被自己控制，
 * 按 IP 排除会把这台机器上的 Agent 全部藏起来，表现为「第一次能扫到，之后再扫就没了」。
 */
async function probeSelfId(invoke: TauriInvoke | null): Promise<string | null> {
  // 原生壳：直接问 Rust（一次 UDP 探测，几百毫秒内出结果，不受 WebView 网络策略影响）
  if (invoke) {
    try {
      const id = await invoke('self_agent_id')
      if (typeof id === 'string' && id) return id
      return null
    } catch {
      /* 命令不存在（老版本壳）就退回下面的 HTTP 探测 */
    }
  }
  // 纯浏览器：只能试同源的 /api/v1/hello。同源一定通（页面就是从它加载的），
  // 所以这里不再遍历 127.0.0.1 的各个端口 —— 那些跨源请求在手机浏览器上会被拦，
  // 挂到超时反而拖慢整轮扫描。
  if (typeof location === 'undefined') return null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 900)
    const res = await fetch('/api/v1/hello', {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json()) as { id?: unknown }
    return typeof data.id === 'string' && data.id ? data.id : null
  } catch {
    return null
  }
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
  // 网段提示：URL 优先，其次问原生层（Tauri 下 hostname 是 tauri.localhost，推不出网段）
  const localIP = await nativeLocalIP()
  const hintHost = opts.hintHost ?? resolveHint(localIP)
  const exactHint = !!hintHost && isPrivateV4(hintHost)
  const invoke = tauriInvoke()
  // 本机 Agent 的 id：只用来排掉「我自己」这一条，不影响同机器上的其它 Agent。
  // 拿不到就不排除（宁可多显示一条，也不要扫不到）。
  const selfId = await probeSelfId(invoke)

  const emit = (n: NodeInfo) => {
    if (!n || typeof n.id !== 'string' || !n.id) return
    // 只排除「页面所在的这台机器上那个 Agent」，不能按 IP 整段排除。
    //
    // 踩过的坑：之前按 IP 比对 selfIPs，把整台机器的所有 Agent 都排掉了。
    // 结果用户第一次扫描能看到自己的 PC，配对/刷新之后再扫就永远扫不到 ——
    // 因为那个 Agent 恰好就跑在同一台机器上。
    // 正确判据是「这条记录是不是我自己正在用的那个 Agent」：用 selfId 比 ID。
    if (n.self) return
    if (selfId && n.id === selfId) return
    if (n.ip === '127.0.0.1' || n.ip === '::1') return
    if (found.has(n.id)) return
    found.set(n.id, n)
    onNode(n)
  }


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
  // 兜底网段只在「原生壳里确实拿不到本机 IP」时才扫（安卓/iOS 才需要）：
  // 纯浏览器打开一个非内网地址（localhost / 域名）时盲扫内网没有意义，仍交给手动添加；
  // 桌面端 local_ip 正常时也不会走到这里，行为与之前一致。
  const runtime = detectRuntime()
  const mobileShell = runtime === 'android' || runtime === 'ios'
  const sweep = hosts.length > 0 && (exactHint || (!!invoke && mobileShell))

  if (sweep) {
    // 兜底网段命中率低，只探默认端口：否则手机上要发 2500+ 个请求，
    // 拖十几秒还没结果，用户只会觉得「扫描卡住了」。
    const ports = exactHint ? COMMON_PORTS : [COMMON_PORTS[0]]
    jobs.push(
      (async () => {
        const tasks: { host: string; port: number; tls: boolean }[] = []
        for (const host of hosts) {
          for (const p of ports) tasks.push({ host, ...p })
        }
        let done = 0
        let cursor = 0
        let lastTick = 0
        onProgress?.(0, tasks.length)
        // 节流：每 120ms 或每 16 个任务才汇报一次。
        // 之前每个任务都 setState，700+ 次重渲染会把切页拖到卡死。
        const tick = (force = false) => {
          const now = Date.now()
          if (!force && now - lastTick < 120 && done % 16 !== 0) return
          lastTick = now
          onProgress?.(done, tasks.length)
        }
        async function worker() {
          while (cursor < tasks.length) {
            if (opts.signal?.aborted) return
            const t = tasks[cursor++]
            const node = await probeNode(t.host, t.port, t.tls, timeoutMs, opts.signal)
            done++
            if (node) emit({ ...node, ip: node.ip || t.host, port: t.port, tls: t.tls })
            tick()
          }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
        tick(true)
      })(),
    )
  } else {
    // 没有可用网段（纯浏览器打开 localhost / 域名）：0/0 告诉页面「扫不了段」，
    // 界面会给出「手动填 IP」的兜底。
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
