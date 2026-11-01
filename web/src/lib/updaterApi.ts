/**
 * A7 自动检查更新：前端 API 封装。
 *
 * 分层：
 *  - check/安装/重启走 @tauri-apps/plugin-updater 与 plugin-process 官方插件
 *    （签名校验由 agent… 不，由 Tauri updater 核心做：latest.json 里的
 *    signature 用 tauri.conf.json 的 pubkey 验证，验签失败直接报错）。
 *  - 「自动检查更新」开关走 prefs（Rust 侧 update_auto_get/set 命令，
 *    启动 10s 后 Rust 静默查一次并发 update-available 事件，这里监听）。
 *
 * 降级约定（见 tauri.conf.json 注释）：mac/linux 的 CI 产物没有签名条目时，
 * latest.json 的 platforms 不含它们 → check() 返回 null →「已是最新」。
 * 浏览器/Android 无 updater 概念：调用方（AboutCard）用 runtime 判断后再调。
 */
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { listen } from '@tauri-apps/api/event'

export interface UpdateInfo {
  version: string
  notes?: string
}

/** 最近一次 check 拿到的 Update 对象（含下载安装方法，不可序列化，留模块内）。 */
let lastUpdate: Update | null = null

/** 当前客户端版本（tauri.conf.json 的 version）。非 Tauri 壳返回 null。 */
export async function getAppVersion(): Promise<string | null> {
  try {
    return await getVersion()
  } catch {
    return null
  }
}

/**
 * 检查更新。返回 null = 已是最新（或当前平台在 latest.json 里没有条目）。
 * 抛错 = 网络/服务端失败（调用方显示「检查失败」可重试）。
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const u = await check()
  if (u == null) {
    lastUpdate = null
    return null
  }
  lastUpdate = u
  return { version: u.version, notes: u.body ?? undefined }
}

/** 下载并安装（Windows passive：进度条 + 完成自动重启）。 */
export async function installUpdate(): Promise<void> {
  if (!lastUpdate) throw new Error('no-pending-update')
  await lastUpdate.downloadAndInstall()
  await relaunch()
}

/** 启动静默检查的结果事件（Rust 侧发出）。返回解绑函数。 */
export async function listenUpdateAvailable(
  cb: (info: UpdateInfo) => void,
): Promise<() => void> {
  const un = await listen<UpdateInfo>('update-available', (e) => cb(e.payload))
  return () => void un()
}

// ---------- 「自动检查更新」开关（prefs，走 Rust 命令） ----------

/**
 * 与 discovery.ts 的 tauriInvoke 同款解析（那文件不在本任务范围，这里
 * 复制最小实现并注明出处；两处将来可合并）。
 */
function tauriInvoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: unknown } }
    __TAURI_INTERNALS__?: { invoke?: unknown }
  }
  const fn =
    (w.__TAURI__?.core as { invoke?: unknown } | undefined)?.invoke ??
    w.__TAURI_INTERNALS__?.invoke ??
    null
  return typeof fn === 'function' ? (fn.bind(w.__TAURI_INTERNALS__) as (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) : null
}

export async function updateAutoGet(): Promise<boolean | null> {
  const invoke = tauriInvoke()
  if (!invoke) return null
  try {
    const v = await invoke('update_auto_get')
    return typeof v === 'boolean' ? v : null
  } catch {
    return null
  }
}

export async function updateAutoSet(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const invoke = tauriInvoke()
  if (!invoke) return { ok: false, error: '当前环境不支持（需要在桌面端 App 里操作）' }
  try {
    await invoke('update_auto_set', { enabled })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
