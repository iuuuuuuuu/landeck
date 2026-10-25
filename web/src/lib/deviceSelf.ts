/**
 * 「当前设备自身」的信息采集（纯 Web API，不依赖被控端）。
 *
 * 为什么需要它：手机上打开「本机」页时，这台手机既跑不了被控端，127.0.0.1 上也没有
 * Agent —— 桌面端那套 system()/hardware() 请求必然失败。但用户仍然想看**这台手机**
 * 自己的屏幕、核心数、存储、网络等统计，而这些浏览器/WebView 就能读到。
 * 所以单独在这里采集，不经过 api.ts，也不碰 discovery.ts。
 *
 * 原则：所有字段可空。WebView 差异极大（电池、deviceMemory、connection 尤其如此），
 * 拿不到就返回 null，让 UI 标注「不可用」，任何一步都不抛异常打断页面。
 */

/** 屏幕：CSS 像素 + 设备像素比（物理分辨率 = width×dpr / height×dpr） */
export interface SelfScreen {
  width: number
  height: number
  dpr: number
}

/** 存储估算：来自 navigator.storage.estimate()，单位字节 */
export interface SelfStorage {
  usage: number
  quota: number
}

/** 网络估算：来自 navigator.connection（Network Information API） */
export interface SelfNetwork {
  effectiveType: string | null
  downlink: number | null
  rtt: number | null
  saveData: boolean | null
}

/** 电池：来自 navigator.getBattery()，多数 WebView 不实现 */
export interface SelfBattery {
  /** 0~1 */
  level: number | null
  charging: boolean | null
}

export type SelfOS = 'android' | 'ios' | 'other'

export interface DeviceSelfInfo {
  /** 系统给的人话名称：Android 14 / iOS 17.2 / 未知系统 */
  system: string
  os: SelfOS
  /** 型号：安卓取 Build 前的型号，iOS 只有 iPhone/iPad 这类粗粒度 */
  model: string
  screen: SelfScreen | null
  /** CPU 逻辑核心数：navigator.hardwareConcurrency */
  cpuCores: number | null
  /** 内存（GB）：navigator.deviceMemory 是分档近似值（0.25/0.5/1/2/4/8） */
  memoryGb: number | null
  storage: SelfStorage | null
  network: SelfNetwork | null
  battery: SelfBattery | null
  /** 原始 UA，折叠展示用 */
  ua: string
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

/** 安卓 UA 里夹在语言标记 / wv 标记之外的那段才是型号 */
const UA_NOISE = /^(wv|u|k|[a-z]{2}([-_][a-z]{2,4})?)$/i

function parseAndroid(ua: string): { version: string; model: string } | null {
  if (!/android/i.test(ua)) return null
  // 形如 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv)
  const paren = ua.match(/\(([^)]*Android[^)]*)\)/i)
  if (!paren) return { version: '', model: '' }
  const segs = paren[1]
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  const idx = segs.findIndex((s) => /^android\b/i.test(s))
  const version = text(segs[idx]?.match(/Android\s+([\d.]+)/i)?.[1]) ?? ''
  let model = ''
  for (const seg of segs.slice(Math.max(0, idx) + 1)) {
    // 去掉 Build/XXX 尾巴；安卓 10+ 起部分 WebView 把型号隐私化成 "K"
    const candidate = seg.replace(/\s*Build\/.*$/i, '').trim()
    if (!candidate || UA_NOISE.test(candidate)) continue
    model = candidate
    break
  }
  return { version, model }
}

function parseIOS(ua: string): { version: string; model: string } | null {
  if (!/iphone|ipad|ipod/i.test(ua)) return null
  const version = text(ua.match(/(?:iPhone OS|CPU OS|CPU iPhone OS)\s+([\d_.]+)/i)?.[1])?.replace(/_/g, '.') ?? ''
  const model = /ipad/i.test(ua) ? 'iPad' : /ipod/i.test(ua) ? 'iPod touch' : 'iPhone'
  return { version, model }
}

/* ------------------------------------------------------------------ *
 * 采集
 * ------------------------------------------------------------------ */

function readScreen(): SelfScreen | null {
  if (typeof screen === 'undefined') return null
  const width = positive(screen.width)
  const height = positive(screen.height)
  if (!width || !height) return null
  return { width: Math.round(width), height: Math.round(height), dpr: positive(window.devicePixelRatio) ?? 1 }
}

function readNetwork(n: NavigatorExtras): SelfNetwork | null {
  const c = n.connection
  if (!c) return null
  const net: SelfNetwork = {
    effectiveType: text(c.effectiveType),
    downlink: positive(c.downlink),
    rtt: positive(c.rtt),
    saveData: typeof c.saveData === 'boolean' ? c.saveData : null,
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
    if (usage === null && quota === null) return null
    return { usage: usage ?? 0, quota: quota ?? 0 }
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
    return { level, charging }
  } catch {
    return null
  }
}

/** 同步部分：UA / 屏幕 / CPU / 内存 / 网络 / 原始 UA */
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

  const model = android
    ? android.model || 'Android 设备'
    : ios
      ? ios.model
      : '当前设备'

  return {
    system,
    os,
    model,
    screen: readScreen(),
    cpuCores: positive(n?.hardwareConcurrency),
    memoryGb: positive(n?.deviceMemory),
    storage: null,
    network: n ? readNetwork(n) : null,
    battery: null,
    ua,
  }
}

/**
 * 完整采集：同步字段 + 存储/电池两个异步字段。
 * 任一项失败只影响该项（为 null），整体永不 reject。
 */
export async function collectDeviceSelf(): Promise<DeviceSelfInfo> {
  const base = readDeviceSelfSync()
  const n = nav()
  const [storage, battery] = await Promise.all([
    readStorage(),
    n ? readBattery(n) : Promise.resolve(null),
  ])
  return { ...base, storage, battery }
}
