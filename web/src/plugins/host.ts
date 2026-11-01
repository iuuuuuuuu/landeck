/**
 * PluginHost（十期 A4 MVP）。
 *
 * 职责：插件注册表（内置 bundled + 浏览器导入）、manifest 校验（字段 +
 * 权限位白名单）、上下文装配（activity.query 走 activityApi，权限位不齐直接拒）。
 *
 * 安全边界（A4 v1）：插件 JS 同源运行；v1 只装可信来源——市场目录占位、
 * 安装 = 浏览器导入（agent /plugins/install 端点后续批次）；导入的 manifest
 * 必须通过校验才入册。
 */
import { fetchSummary } from '../lib/activityApi'
import type { Target } from '../lib/api'
import type { CatalogEntry, PluginManifest, PluginModule, PluginPermission, PluginRecord } from './types'
import { KNOWN_PERMISSIONS } from './types'
import { focusPlugin } from './focus'

const STORE_KEY = 'landeck.plugins.v1'

/** manifest 校验：字段齐 + 权限位全部在白名单内。返回错误文案，null = 通过 */
export function validateManifest(m: unknown): string | null {
  if (!m || typeof m !== 'object') return 'manifest 不是对象'
  const x = m as Record<string, unknown>
  if (typeof x.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(x.id)) return 'id 非法（小写字母数字连字符）'
  if (typeof x.name !== 'string' || !x.name) return 'name 缺失'
  if (typeof x.version !== 'string' || !/^\d+\.\d+\.\d+/.test(x.version)) return 'version 非法'
  if (typeof x.entry !== 'string' || !x.entry) return 'entry 缺失'
  if (typeof x.author !== 'string' || !x.author) return 'author 缺失'
  if (!Array.isArray(x.permissions)) return 'permissions 缺失'
  for (const p of x.permissions) {
    if (!KNOWN_PERMISSIONS.includes(p as PluginPermission)) return `未知权限位：${String(p)}`
  }
  return null
}

// ---------- 浏览器导入的插件注册表（localStorage） ----------

export function listInstalled(): PluginRecord[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const arr = raw ? (JSON.parse(raw) as PluginRecord[]) : []
    return Array.isArray(arr) ? arr.filter((r) => r && r.manifest) : []
  } catch {
    return []
  }
}

export function saveInstalled(records: PluginRecord[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(records))
}

/** 导入 manifest（浏览器导入 v1）：校验通过才入册；重复 id 覆盖 */
export function importManifest(raw: string): { ok: true; record: PluginRecord } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: 'JSON 解析失败：' + (e as Error).message }
  }
  const err = validateManifest(parsed)
  if (err) return { ok: false, error: err }
  const manifest = parsed as PluginManifest
  const record: PluginRecord = { manifest, importedAt: Date.now(), source: 'import' }
  const rest = listInstalled().filter((r) => r.manifest.id !== manifest.id)
  saveInstalled([record, ...rest])
  return { ok: true, record }
}

export function removeInstalled(id: string): void {
  saveInstalled(listInstalled().filter((r) => r.manifest.id !== id))
}

// ---------- 上下文装配（权限位校验） ----------

export interface HostEnv {
  target: Target
  token: string | undefined
  toast(msg: string): void
}

export function createContext(manifest: PluginManifest, env: HostEnv) {
  const canActivity = manifest.permissions.includes('activity.read')
  return {
    activity: {
      async query(p: { scope: 'day'; date: string }) {
        if (!canActivity) throw new Error(`插件 ${manifest.id} 没有 activity.read 权限`)
        const { data } = await fetchSummary(env.target, env.token, { scope: p.scope, date: p.date })
        const byCategory: Record<string, number> = {}
        let totalSec = 0
        for (const slot of data.slots) {
          for (const [k, v] of Object.entries(slot.sec)) {
            byCategory[k] = (byCategory[k] ?? 0) + (v ?? 0)
            totalSec += v ?? 0
          }
        }
        return { totalSec, byCategory }
      },
    },
    ui: {
      toast: env.toast,
    },
  }
}

// ---------- 内置插件（bundled） ----------

export function bundledRecords(): PluginRecord[] {
  return [
    {
      manifest: focusPlugin.manifest,
      importedAt: 0,
      source: 'bundled',
    },
  ]
}

/** 装载插件 entry：内置走打包模块；导入的 v1 从 agent dataDir 动态 import（未上线前标记未部署） */
export async function loadModule(rec: PluginRecord, agentUrl: string | undefined): Promise<PluginModule> {
  if (rec.source === 'bundled') return focusPlugin
  // entry.js 由 agent dataDir /plugins/<id>/ 提供（A4 后续批次上端点）
  const base = agentUrl ?? ''
  const url = rec.manifest.entry.startsWith('http') ? rec.manifest.entry : `${base}/plugins/${rec.manifest.id}/entry.js`
  return (await import(/* @vite-ignore */ url)) as PluginModule
}

/** 市场条目 → 展示（bundled 标记的条目不在市场重复提供安装） */
export function isBundledEntry(e: CatalogEntry): boolean {
  return e.bundled === true || focusPlugin.manifest.id === e.id
}

export type { PluginManifest, PluginRecord, PluginModule }
