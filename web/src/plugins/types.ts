/**
 * 插件系统类型（十期 A4 MVP，纯前端）。
 *
 * 契约（docs/design/phase10-sync-plugins.md A4）：
 *   manifest = {id, name, version, entry, permissions: ['activity.read'], author}
 *   entry 是 ESM JS 模块；上线 agent 端点后从 agent dataDir `/plugins/<id>/entry.js`
 *   动态装载。MVP：内置 Focus 走完整装载链；市场安装 = 浏览器导入（受限）。
 */

export type PluginPermission = 'activity.read'

/** v1 已知权限位白名单——manifest 校验用，未知权限位直接拒 */
export const KNOWN_PERMISSIONS: readonly PluginPermission[] = ['activity.read']

export interface PluginManifest {
  /** slug，全局唯一 */
  id: string
  name: string
  version: string
  /** ESM entry（agent dataDir 相对路径或绝对 URL） */
  entry: string
  permissions: PluginPermission[]
  author: string
}

export interface PluginRecord {
  manifest: PluginManifest
  importedAt: number
  source: 'bundled' | 'import'
}

/** 插件运行上下文——API 面最小化：只暴露 activity.query（权限位校验） */
export interface PluginContext {
  activity: {
    /** 当日 summary（slots 求和 = 各分类用时秒数）；未授权时抛错 */
    query(p: { scope: 'day'; date: string }): Promise<{ totalSec: number; byCategory: Record<string, number> }>
  }
  ui: {
    toast(msg: string): void
  }
}

/** 插件 entry 模块的缺省导出形态 */
export interface PluginModule {
  activate(ctx: PluginContext): Promise<{ el: HTMLElement; dispose?: () => void }>
}

/** 市场目录条目 = manifest + 展示字段 */
export interface CatalogEntry extends PluginManifest {
  description?: string
  bundled?: boolean
}

export interface Catalog {
  version: number
  plugins: CatalogEntry[]
}
