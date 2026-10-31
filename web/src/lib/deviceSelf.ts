/**
 * 「当前设备自身」的信息采集（纯 Web API，不依赖被控端）。
 *
 * 为什么需要它：手机上打开「本机」页时，这台手机既跑不了被控端，127.0.0.1 上也没有
 * Agent —— 桌面端那套 system()/hardware() 请求必然失败。但用户仍然想看**这台手机**
 * 自己的屏幕、核心数、存储、网络等统计，而这些浏览器/WebView 就能读到。
 * 所以单独在这里采集，不经过 api.ts，也不碰 discovery.ts。
 *
 * 本文件的铁律：**不拿近似值冒充精确值**。
 *   - navigator.hardwareConcurrency 是浏览器上报的逻辑核心数，安卓 WebView 常年固定 4；
 *   - navigator.deviceMemory 是分档值（0.25/0.5/1/2/4/8），不是真实容量；
 *   - navigator.connection 的 downlink/rtt 是估值，不是链路实测；
 *   - screen.width/height 是 CSS 逻辑像素，乘 DPR 得到的「物理像素」也是推算法，
 *     不等于面板原生分辨率；
 *   - getBattery / connection 在安卓 WebView 大面积缺失 → 一律返回 null，由 UI 说
 *     「此设备不支持读取」，绝不填 0 或空串。
 * 想更准只有一条路：Tauri 移动端用原生命令读，然后通过 setNativeSelfProvider() 注入。
 */

/** 屏幕：CSS 逻辑像素 + DPR；physical 部分是由 CSS×DPR 推算的，不是面板原生值 */
export interface SelfScreen {
  /** 逻辑分辨率（CSS px，浏览器按页面缩放给出的值） */
  cssWidth: number
  cssHeight: number
  dpr: number
  /** 由 css×dpr 四舍五入推算出的物理像素，标注用途见 UI */
  pixelWidth: number
  pixelHeight: number
  /** 数据来源：browser=浏览器 API 报告，native=移动端原生命令注入 */
  source: SelfDataSource
}

/** 存储估算：来自 navigator.storage.estimate()，单位字节；拿不到的项为 null */
export interface SelfStorage {
  usage: number | null
  quota: number | null
  source: SelfDataSource
}

/** 网络估算：来自 navigator.connection（Network Information API），全是估值 */
export interface SelfNetwork {
  effectiveType: string | null
  /** Mbps，Chrome 只给 25/50/100 之类的档位 */
  downlink: number | null
  /** ms，同样是估值 */
  rtt: number | null
  saveData: boolean | null
  source: SelfDataSource
}

/** 电池：来自 navigator.getBattery()，多数移动 WebView 不实现 */
export interface SelfBattery {
  /** 0~1，null = 读不到 */
  level: number | null
  charging: boolean | null
  source: SelfDataSource
}

/** 单个字段的来源，UI 用它决定要不要加「≈」与说明 */
export type SelfDataSource = 'browser' | 'native'

export type SelfOS = 'android' | 'ios' | 'other'

export interface DeviceSelfInfo {
  /** 系统给的人话名称：Android 14 / iOS 17.2 / 未知系统 */
  system: string
  os: SelfOS
  /** 型号：安卓取 UA 里 Build/ 前那段；iOS 只有 iPhone/iPad 这类粗粒度 */
  model: string
  /** 型号是否可信；UA 里是隐私占位符（如 K）或缺失时为 false */
  modelKnown: boolean
  screen: SelfScreen | null
  /** CPU 逻辑核心数：navigator.hardwareConcurrency（浏览器上报，可能被钳制） */
  cpuCores: number | null
  cpuCoresSource: SelfDataSource
  /** 内存（GB）：navigator.deviceMemory 是分档近似值（0.25/0.5/1/2/4/8） */
  memoryGb: number | null
  memorySource: SelfDataSource
  storage: SelfStorage | null
  network: SelfNetwork | null
  battery: SelfBattery | null
  /** 原始 UA，折叠展示用 */
  ua: string
  /** 被原生命令补全过的字段名，UI 可打「系统 API」徽标 */
  nativeFields: string[]
}

/* ------------------------------------------------------------------ *
 * 原生命令注入点（Tauri 移动端）
 *
 * 本文件不调用任何具体命令、不新增 Rust 代码。壳层（src-tauri 移动端）只要在启动时
 * 挨一句即可接管：
 *
 *   import { setNativeSelfProvider } from '@/lib/deviceSelf'
 *   setNativeSelfProvider(async () => {
 *     const raw = await invoke('device_self')   // 由壳层自己实现，字段见 NativeSelfPatch
 *     return raw as NativeSelfPatch
 *   })
 *
 * 注入后：能读到的字段覆盖浏览器值并标记 native（UI 显示「系统 API」），
 * 读不到的字段保持 null，仍然走「此设备不支持读取」。
 * 注意每次 collectDeviceSelf() 只调用一次 provider，抛错即整体退化为纯浏览器数据。
 * ------------------------------------------------------------------ */

export interface NativeSelfPatch {
  system?: string | null
  os?: SelfOS | null
  model?: string | null
  screen?: { width: number; height: number; dpr?: number } | null
  cpuCores?: number | null
  memoryGb?: number | null
  storage?: { usage?: number | null; quota?: number | null } | null
  network?: {
    effectiveType?: string | null
    downlink?: number | null
    rtt?: number | null
    saveData?: boolean | null
  } | null
  battery?: { level?: number | null; charging?: boolean | null } | null
}

export type NativeSelfProvider = () =>
  | NativeSelfPatch
  | null
  | undefined
  | Promise<NativeSelfPatch | null | undefined>

let nativeProvider: NativeSelfProvider | null = null

/** 注册/清除原生数据提供者；传 null 恢复纯浏览器模式 */
export function setNativeSelfProvider(fn: NativeSelfProvider | null): void {
  nativeProvider = fn
}

/* ------------------------------------------------------------------ *
 * 标准库里没有的字段（Battery / Device Memory / Network Information），
 * 只在本文件内声明，不做全局 augment，避免影响别处。
 * ------------------------------------------------------------------ */

interface BatteryLike {
  level?: number
  charging?: boolean
}

interface NetworkLike {
  effectiveType?: string
  downlink?: number
  rtt?: number
  saveData?: boolean
}

interface NavigatorExtras extends Navigator {
  deviceMemory?: number
  connection?: NetworkLike
  getBattery?: () => Promise<BatteryLike>
}

function nav(): NavigatorExtras | null {
  if (typeof navigator === 'undefined') return null
  return navigator as NavigatorExtras
}

/** 有限正数才收，其余一律 null —— UA/WebView 会给 0、NaN、负数 */
function positive(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/* ------------------------------------------------------------------ *
 * UA 解析
 * ------------------------------------------------------------------ */

/**
 * UA 里那段"型号"经常是垃圾：`wv`（WebView 标记）、`K`（安卓 10+ 的隐私占位符）、
 * 语言标记 `zh-CN`、或者干脆是 `Android`。这些都不算型号。
 */
const MODEL_NOISE = /^(wv|u|k|unknown|android|mobile|generic|sdk|linux)$/i
const LOCALE_LIKE = /^[a-z]{2}([-_][a-z]{2,4})?$/i

function cleanModel(raw: string | undefined | null): string | null {
  const v = text(raw)
  if (!v) return null
  // 去掉 Build/XXX 尾巴再判断
  const candidate = v.replace(/\s*Build\/.*$/i, '').trim()
  if (!candidate) return null
  if (MODEL_NOISE.test(candidate)) return null
  if (LOCALE_LIKE.test(candidate)) return null
  // 单字符（如 "K"）一律当隐私占位符
  if (candidate.length < 2) return null
  return candidate
}

function parseAndroid(ua: string): { version: string; model: string | null } | null {
  if (!/android/i.test(ua)) return null
  const version = text(ua.match(/Android\s+([\d.]+)/i)?.[1]) ?? ''
  // 首选标准写法："; SM-G991B Build/TP1A.220624.014"
  const buildForm = ua.match(/;\s*([^;()]+?)\s+Build\//i)
  const model = cleanModel(buildForm?.[1])
  if (model) return { version, model }
  // 退路：括号段里 Android x.y 之后的第一段非噪声内容
  const paren = ua.match(/\(([^)]*Android[^)]*)\)/i)
  if (!paren) return { version, model: null }
  const segs = paren[1]
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  const idx = segs.findIndex((s) => /^android\b/i.test(s))
  for (const seg of segs.slice(Math.max(0, idx) + 1)) {
    const candidate = cleanModel(seg)
    if (candidate) return { version, model: candidate }
  }
  return { version, model: null }
}

function parseIOS(ua: string): { version: string; model: string } | null {
  if (!/iphone|ipad|ipod/i.test(ua)) return null
  const version =
    text(ua.match(/(?:iPhone OS|CPU OS|CPU iPhone OS)\s+([\d_.]+)/i)?.[1])?.replace(/_/g, '.') ?? ''
  const model = /ipad/i.test(ua) ? 'iPad' : /ipod/i.test(ua) ? 'iPod touch' : 'iPhone'
  return { version, model }
}

/* ------------------------------------------------------------------ *
 * 采集（浏览器）
 * ------------------------------------------------------------------ */

function readScreen(): SelfScreen | null {
  if (typeof screen === 'undefined') return null
  const cssWidth = positive(screen.width)
  const cssHeight = positive(screen.height)
  if (!cssWidth || !cssHeight) return null
  const dpr = positive(typeof window === 'undefined' ? null : window.devicePixelRatio) ?? 1
  return {
    cssWidth: Math.round(cssWidth),
    cssHeight: Math.round(cssHeight),
    dpr: Math.round(dpr * 100) / 100,
    pixelWidth: Math.round(cssWidth * dpr),
    pixelHeight: Math.round(cssHeight * dpr),
    source: 'browser',
  }
}

function readNetwork(n: NavigatorExtras): SelfNetwork | null {
  const c = n.connection
  if (!c) return null
  const net: SelfNetwork = {
    effectiveType: text(c.effectiveType),
    downlink: positive(c.downlink),
    rtt: positive(c.rtt),
    saveData: typeof c.saveData === 'boolean' ? c.saveData : null,
    source: 'browser',
  }
  // 四项全空 = 浏览器给了个空对象，等同于不可用
  const any = net.effectiveType || net.downlink !== null || net.rtt !== null || net.saveData !== null
  return any ? net : null
}

async function readStorage(): Promise<SelfStorage | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    const usage = typeof est?.usage === 'number' && Number.isFinite(est.usage) ? est.usage : null
    const quota = typeof est?.quota === 'number' && Number.isFinite(est.quota) ? est.quota : null
    // 两项都没有 = 不可用；只有一项也给，另一项由 UI 说「未知」，不要补 0
    if (usage === null && quota === null) return null
    return { usage, quota, source: 'browser' }
  } catch {
    return null
  }
}

async function readBattery(n: NavigatorExtras): Promise<SelfBattery | null> {
  // 安卓 WebView / iOS Safari 基本都没有 getBattery，直接当作不可用
  if (typeof n.getBattery !== 'function') return null
  try {
    const b = await n.getBattery()
    const level = typeof b?.level === 'number' && Number.isFinite(b.level) ? b.level : null
    const charging = typeof b?.charging === 'boolean' ? b.charging : null
    if (level === null && charging === null) return null
    return { level, charging, source: 'browser' }
  } catch {
    return null
  }
}

/** 同步部分：UA / 屏幕 / CPU / 内存 / 网络 / 原始 UA（异步字段一律 null） */
export function readDeviceSelfSync(): DeviceSelfInfo {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const n = nav()
  const android = parseAndroid(ua)
  const ios = parseIOS(ua)
  const os: SelfOS = android ? 'android' : ios ? 'ios' : 'other'

  const system = android
    ? `Android${android.version ? ` ${android.version}` : ''}`
    : ios
      ? `iOS${ios.version ? ` ${ios.version}` : ''}`
      : '未知系统'

  // 型号拿不到就说「Android 设备」，不要拿隐私占位符（K）当型号
  const model = android ? (android.model ?? 'Android 设备') : ios ? ios.model : '当前设备'

  return {
    system,
    os,
    model,
    modelKnown: android ? Boolean(android.model) : Boolean(ios),
    screen: readScreen(),
    cpuCores: positive(n?.hardwareConcurrency),
    cpuCoresSource: 'browser',
    memoryGb: positive(n?.deviceMemory),
    memorySource: 'browser',
    storage: null,
    network: n ? readNetwork(n) : null,
    battery: null,
    ua,
    nativeFields: [],
  }
}

/* ------------------------------------------------------------------ *
 * 原生注入合并
 * ------------------------------------------------------------------ */

interface TauriInvokeFn {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>
}

function nativeInvokeFn(): TauriInvokeFn | null {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvokeFn }; invoke?: TauriInvokeFn }
    __TAURI_INTERNALS__?: { invoke?: TauriInvokeFn }
  }
  return w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null
}

/**
 * 读原生设备真值（系统版本 / 机型 / 真实内存 / 真实核心数）。
 *
 * 浏览器侧只能拿到 `deviceMemory` 分档值（上限 8）与常被钳在 4 的
 * `hardwareConcurrency`，用来展示"我的手机配置"是不准的。
 */
export async function readNativeDeviceProfile(): Promise<NativeSelfPatch | null> {
  const invoke = nativeInvokeFn()
  if (!invoke) return null
  try {
    const p = (await invoke('device_profile')) as {
      os?: string
      os_version?: string
      model?: string
      vendor?: string
      mem_total_mb?: number
      cpu_cores?: number
    } | null
    if (!p) return null
    const memGb = p.mem_total_mb && p.mem_total_mb > 0 ? Math.round((p.mem_total_mb / 1024) * 10) / 10 : null
    const os = p.os === 'android' || p.os === 'ios' ? p.os : null
    const system =
      p.os === 'android'
        ? `Android ${p.os_version || '?'}`
        : p.os === 'ios'
          ? 'iOS'
          : undefined
    return {
      os,
      system,
      model: (p.model || '').trim() || undefined,
      memoryGb: memGb,
      cpuCores: p.cpu_cores && p.cpu_cores > 0 ? p.cpu_cores : null,
    }
  } catch {
    return null
  }
}

/** 原生值覆盖浏览器值；只有校验通过的字段才算数，并记进 nativeFields */
function applyNative(base: DeviceSelfInfo, patch: NativeSelfPatch | null | undefined): DeviceSelfInfo {
  if (!patch || typeof patch !== 'object') return base
  const out: DeviceSelfInfo = { ...base, nativeFields: [...base.nativeFields] }
  const mark = (key: string) => {
    if (!out.nativeFields.includes(key)) out.nativeFields.push(key)
  }

  const sys = text(patch.system)
  if (sys) {
    out.system = sys
    mark('system')
  }
  if (patch.os === 'android' || patch.os === 'ios' || patch.os === 'other') {
    out.os = patch.os
    mark('os')
  }
  const model = cleanModel(patch.model)
  if (model) {
    out.model = model
    out.modelKnown = true
    mark('model')
  }

  const sc = patch.screen
  if (sc) {
    const w = positive(sc.width)
    const h = positive(sc.height)
    if (w && h) {
      const dpr = positive(sc.dpr) ?? base.screen?.dpr ?? 1
      out.screen = {
        cssWidth: Math.round(w),
        cssHeight: Math.round(h),
        dpr: Math.round(dpr * 100) / 100,
        pixelWidth: Math.round(w * dpr),
        pixelHeight: Math.round(h * dpr),
        source: 'native',
      }
      mark('screen')
    }
  }

  const cores = positive(patch.cpuCores)
  if (cores) {
    out.cpuCores = Math.round(cores)
    out.cpuCoresSource = 'native'
    mark('cpuCores')
  }

  const memGb = positive(patch.memoryGb)
  if (memGb) {
    out.memoryGb = Math.round(memGb * 10) / 10
    out.memorySource = 'native'
    mark('memoryGb')
  }

  const st = patch.storage
  if (st) {
    const usage = typeof st.usage === 'number' && Number.isFinite(st.usage) && st.usage >= 0 ? st.usage : null
    const quota = positive(st.quota)
    if (usage !== null || quota !== null) {
      out.storage = { usage, quota, source: 'native' }
      mark('storage')
    }
  }

  const net = patch.network
  if (net) {
    const merged: SelfNetwork = {
      effectiveType: text(net.effectiveType),
      downlink: positive(net.downlink),
      rtt: positive(net.rtt),
      saveData: typeof net.saveData === 'boolean' ? net.saveData : null,
      source: 'native',
    }
    if (
      merged.effectiveType ||
      merged.downlink !== null ||
      merged.rtt !== null ||
      merged.saveData !== null
    ) {
      out.network = merged
      mark('network')
    }
  }

  const bat = patch.battery
  if (bat) {
    const level =
      typeof bat.level === 'number' && Number.isFinite(bat.level) && bat.level >= 0 && bat.level <= 1
        ? bat.level
        : null
    const charging = typeof bat.charging === 'boolean' ? bat.charging : null
    if (level !== null || charging !== null) {
      out.battery = { level, charging, source: 'native' }
      mark('battery')
    }
  }

  return out
}

/**
 * 完整采集：同步字段 + 存储/电池两个异步字段 + 可选原生命令补全。
 * 任一项失败只影响该项（为 null），整体永不 reject。
 */
export async function collectDeviceSelf(): Promise<DeviceSelfInfo> {
  const base = readDeviceSelfSync()
  const n = nav()
  const [storage, battery] = await Promise.all([
    readStorage(),
    n ? readBattery(n) : Promise.resolve(null),
  ])
  let patch: NativeSelfPatch | null = null
  if (nativeProvider) {
    try {
      patch = (await nativeProvider()) ?? null
    } catch {
      // 原生命令不可用（桌面壳、权限不足、命令未注册）→ 静默退化为纯浏览器数据
      patch = null
    }
  }
  return applyNative({ ...base, storage, battery }, patch)
}
