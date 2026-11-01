/**
 * 插件市场（十期 A4 MVP）。
 *
 * 读固定 URL 的 catalog JSON：默认取 webui 同源 `/plugins-catalog.json`
 * （占位内容 = 仓库 docs/plugins-catalog.json 的运行时副本）。agent 侧
 * /plugins/install 端点后续批次上线前，市场「安装」= 浏览器导入（受限）。
 */
import type { Catalog, CatalogEntry } from './types'
import { validateManifest } from './host'

/** catalog 默认地址（同源静态占位；后续可换 agent 提供的正式市场） */
export const DEFAULT_CATALOG_URL = '/plugins-catalog.json'

/** 拉取 + 校验 catalog：坏条目剔除不炸整页；返回条目与错误说明 */
export async function fetchCatalog(url = DEFAULT_CATALOG_URL): Promise<{
  entries: CatalogEntry[]
  error: string | null
}> {
  try {
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) return { entries: [], error: `HTTP ${resp.status}` }
    const raw = (await resp.json()) as Catalog
    if (!raw || !Array.isArray(raw.plugins)) return { entries: [], error: 'catalog 格式不符（缺 plugins 数组）' }
    const entries: CatalogEntry[] = []
    for (const p of raw.plugins) {
      if (validateManifest(p) === null) entries.push(p)
    }
    return { entries, error: null }
  } catch (e) {
    return { entries: [], error: (e as Error).message }
  }
}
