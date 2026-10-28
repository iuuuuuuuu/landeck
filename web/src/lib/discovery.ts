import { probeNode, probeNodeDetailed } from './api'
import { detectRuntime, isPhoneOS } from './runtime'
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

/**
 * 当前平台实际使用的扫描参数。界面要把它们如实显示出来 ——
 * 之前页脚写死「并发 64 · 8420/8443」，与手机端实际（8 并发、只探 8420）不符，
 * 排查「扫不到设备」时这类假信息会把人带偏。
 */
export function scanProfile(hintHost: string | null): {
  concurrency: number
  ports: number[]
  subnet: string | null
  mobile: boolean
} {
  const runtime = detectRuntime()
  const mobile = runtime === 'android' || runtime === 'ios' || isPhoneOS()
  const concurrency = mobile ? 8 : runtime === 'desktop' ? 24 : 48
  const exact = !!hintHost && isPrivateV4(hintHost)
  const ports = exact ? COMMON_PORTS.map((p) => p.port) : [COMMON_PORTS[0].port]
  const parts = exact && hintHost ? hintHost.split('.') : null
  const subnet = parts && parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : null
  return { concurrency, ports, subnet, mobile }
}

export async function scanLan(opts: ScanOptions): Promise<NodeInfo[]> {
  // concurrency 已按平台在下面定（手机 8 / 桌面 24 / 浏览器 48），这里不再从参数取
  const { onNode, onProgress, timeoutMs = 620 } = opts
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


  // ===== 扫描策略：手机与桌面走不同的路 =====
  //
  // 手机切页卡顿的根因就在这里：以前无论有没有原生扫描，都会**并行**跑一遍 HTTP 扫段，
  // 兜底时最多 1270 个地址 × 每 620ms 超时，几十条并发 fetch 同时占着 WebView 的
  // socket 池。用户一离开发现页，这些请求还在排队完成/中止，主线程被反复唤醒 →
  // 「切页非常卡」。而手机原生壳本来就有 unicast 扫描（Agent 直接回包给对方地址），
  // 这才是手机上真正有效的那条路，前端再扫一遍纯属重复劳动。
  const runtime = detectRuntime()
  const mobileShell = runtime === 'android' || runtime === 'ios' || isPhoneOS()

  // 并发与超时：手机收窄到 8 并发 / 450ms，桌面 24 / 620ms，纯浏览器 48 / 620ms
  const CONC = mobileShell ? 8 : runtime === 'desktop' ? 24 : 48
  const PER_TIMEOUT = mobileShell ? 450 : timeoutMs

  const hosts = candidatesFromHint(hintHost)
  const exactHintOk = exactHint
  // 兜底网段只在「原生壳里确实拿不到本机 IP」时才扫（安卓/iOS 才需要）；
  // 纯浏览器打开非内网地址时盲扫没有意义，交给手动添加。
  const sweepAllowed = hosts.length > 0 && (exactHintOk || (!!invoke && mobileShell))

  /** 扫段作业：phoneFallback=true 时只扫一个 /24、单端口、低并发 */
  const runSweep = (phoneFallback: boolean) =>
    (async () => {
      const hostList = phoneFallback ? hosts.slice(0, 254) : hosts
      const ports = phoneFallback || !exactHintOk ? [COMMON_PORTS[0]] : COMMON_PORTS
      const tasks: { host: string; port: number; tls: boolean }[] = []
      for (const host of hostList) {
        for (const p of ports) tasks.push({ host, ...p })
      }
      let done = 0
      let cursor = 0
      let lastTick = 0
      onProgress?.(0, tasks.length)
      // 节流：每 120ms 或每 16 个任务才汇报一次（每个任务都 setState 会拖死切页）
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
          const node = await probeNode(t.host, t.port, t.tls, PER_TIMEOUT, opts.signal)
          done++
          if (opts.signal?.aborted) return
          if (node) emit({ ...node, ip: node.ip || t.host, port: t.port, tls: t.tls })
          tick()
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONC, tasks.length) }, worker))
      tick(true)
    })()

  const jobs: Promise<void>[] = []

  if (invoke) {
    if (mobileShell) {
      // 手机：先等原生结果。有结果就完全不扫段（省电、省 socket、切页不卡）。
      const nativeNodes = await scanNative(invoke)
      if (opts.signal?.aborted) return [...found.values()]
      nativeNodes.forEach(emit)
      if (nativeNodes.length === 0 && sweepAllowed) {
        // 原生一台都没扫到才兜底，且只扫一个 /24、单端口、8 并发
        jobs.push(runSweep(true))
      }
    } else {
      // 桌面原生壳：两条路并行，谁先出结果都不影响另一条
      jobs.push(
        (async () => {
          const nativeNodes = await scanNative(invoke)
          nativeNodes.forEach(emit)
        })(),
      )
      if (sweepAllowed) jobs.push(runSweep(false))
    }
  } else if (sweepAllowed) {
    jobs.push(runSweep(false))
  } else {
    // 没有可用网段（纯浏览器打开 localhost / 域名）：0/0 告诉页面「扫不了段」，
    // 界面会给出「手动填 IP」的兜底。
    onProgress?.(0, 0)
  }

  await Promise.all(jobs)
  return [...found.values()]
}

/**
 * 手动按网段/区间批量探测（只走 HTTP，不做原生广播）。
 *
 * 用户在网络环境特殊（双 Wi-Fi、VLAN、跨网段）时，自动扫段可能拿不到结果，
 * 这时"我自己填网段 + 端口"是最可靠的路子。所以这里做成一个可复用的批量探测：
 * 只要给出主机列表与端口，就并发探测并把命中实时回调出去。
 */
export async function probeRange(
  hosts: string[],
  port: number,
  opts: {
    onNode?: (n: NodeInfo) => void
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): Promise<NodeInfo[]> {
  const runtime = detectRuntime()
  const concurrency = runtime === 'android' || runtime === 'ios' || isPhoneOS() ? 8 : 24
  const timeoutMs = opts.timeoutMs ?? 700
  const total = hosts.length
  const hits: NodeInfo[] = []
  // 记录失败原因分布：全都失败时界面能直接说出"为什么"，而不是只显示 0 台
  const errorKinds: Record<string, number> = {}
  let done = 0
  let cursor = 0
  opts.onProgress?.(0, total)

  async function worker() {
    while (cursor < total) {
      if (opts.signal?.aborted) return
      const host = hosts[cursor++]
      const { node, error } = await probeNodeDetailed(host, port, false, timeoutMs, opts.signal)
      if (!node && error && !opts.signal?.aborted) {
        errorKinds[error] = (errorKinds[error] ?? 0) + 1
      }
      done++
      if (node && !opts.signal?.aborted) {
        const full = { ...node, ip: node.ip || host, port: node.port || port }
        hits.push(full)
        opts.onNode?.(full)
      }
      opts.onProgress?.(done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
  opts.onProgress?.(total, total)
  const top = Object.entries(errorKinds).sort((a, b) => b[1] - a[1])[0]
  if (top) {
    // 把最常见的原因挂到返回值上（调用方拿来展示）
    ;(hits as unknown as { topError?: { message: string; count: number } }).topError = {
      message: top[0],
      count: top[1],
    }
  }
  return hits
}

/** 把 `192.168.1` / `192.168.1.` / `192.168.1.1-80` 解析成主机列表 */
export function expandHostSpec(raw: string): { hosts: string[]; subnet: string } | null {
  const v = raw.trim().replace(/\/$/, '')
  // 网段：三段 + 可选点，或四段最后一段留空
  const seg = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.?(?:\*)?$/.exec(v)
  if (seg) {
    const base = `${Number(seg[1])}.${Number(seg[2])}.${Number(seg[3])}`
    const hosts: string[] = []
    for (let i = 1; i <= 254; i++) hosts.push(`${base}.${i}`)
    return { hosts, subnet: `${base}.0/24` }
  }
  // 区间：a.b.c.x-y
  const rng = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})-(\d{1,3})$/.exec(v)
  if (rng) {
    const base = rng[1]
    const from = Number(rng[2])
    const to = Number(rng[3])
    if (from >= 1 && to <= 254 && from <= to) {
      const hosts: string[] = []
      for (let i = from; i <= to; i++) hosts.push(`${base}.${i}`)
      return { hosts, subnet: `${base}.${from}-${to}` }
    }
  }
  return null
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

/**
 * 开机自启时是否静默启动（不显示窗口，直接进托盘）。
 *
 * 浏览器里没有这个概念，返回 null 表示不支持。
 * 注意：这个值只在「开机自启」开启时才有意义 —— 手动双击图标启动
 * 永远会显示窗口，否则用户点了图标却看不到界面会以为没启动。
 */
export async function silentAutostartGet(): Promise<boolean | null> {
  const invoke = tauriInvoke()
  if (!invoke) return null
  try {
    const v = await invoke('silent_autostart_get')
    return typeof v === 'boolean' ? v : null
  } catch {
    return null
  }
}

/**
 * 设置「静默启动」。后端会在自启已开启时立即重写自启项，
 * 所以改完不用让用户重新开关一次自启才生效。
 */
export async function silentAutostartSet(
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const invoke = tauriInvoke()
  if (!invoke) return { ok: false, error: '当前环境不支持（需要在桌面端 App 里操作）' }
  try {
    await invoke('silent_autostart_set', { enabled })
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
