/**
 * 活动统计的缓存 key 构造器。
 *
 * 与 lib/keys.ts 同一纪律：key 必须带 host|port|token 身份维度，漏一个就会
 * 把 A 设备的统计当成 B 设备的。不直接放进 keys.ts 是因为那是本次
 * activity-pages 与 web-shell 的文件分界（web-shell 拥有 keys.ts），避免同文件冲突。
 */
import type { Target } from './api'
import { cacheKey, invalidateCachePrefix } from './queryCache'
import type { Scope } from './activityApi'

/**
 * 身份来源：直接用 Target + token（活动 API 层的新签名）。
 * 不再从 AgentClient 挑字段 —— 本机伪设备（PairedDevice）没有 target 包装。
 */
type C = (Target & { token?: string }) | null | undefined

function ident(c: C): Array<string | number | undefined> {
  if (!c) return []
  return [c.host, c.port, c.token]
}

/** 统计汇总（含 demo 标记一起缓存，TTL 与服务端对齐 3 分钟） */
export function activitySummaryKey(c: C, scope: Scope, date: string): string {
  return cacheKey(['activity-summary', scope, date, ...ident(c)])
}

/** 应用/分类排行 */
export function activityRankKey(c: C, scope: Scope, date: string): string {
  return cacheKey(['activity-rank', scope, date, ...ident(c)])
}

/** 应用详情 */
export function activityAppKey(c: C, app: string, date: string): string {
  return cacheKey(['activity-app', app, date, ...ident(c)])
}

/** 分类规则 */
export function activityCategoriesKey(c: C): string {
  return cacheKey(['activity-categories', ...ident(c)])
}

/** 采集设置 */
export function activitySettingsKey(c: C): string {
  return cacheKey(['activity-settings', ...ident(c)])
}

/**
 * 让这台设备的活动数据缓存全部失效（设置/清理保存后调）。
 *
 * 用前缀而不是精确 key：设置改变影响全部日期（日视图色带）、清理改变全部历史，
 * 逐 key 枚举不现实。queryCache 的 key 形如 'activity-summary|day|<date>|<host>|<port>|<token尾>'，
 * 按类别前缀清会跨设备多清一点 —— 可接受（保存设置是低频操作，重新拉一次成本低）。
 */
export function activityInvalidateAll(_c?: C): void {
  for (const prefix of [
    'activity-summary|',
    'activity-rank|',
    'activity-app|',
    'activity-year|',
    'activity-settings|',
    'activity-categories|',
    'memory-status|',
    'memory-search|',
  ]) {
    invalidateCachePrefix(prefix)
  }
}

/** 屏幕记忆：状态（TTL 5 分钟由 useAsync 侧给） */
export function memoryStatusKey(c: C): string {
  return cacheKey(['memory-status', ...ident(c)])
}

/** 全年按天总时长（全部历史页） */
export function activityYearKey(c: C, year: number): string {
  return cacheKey(['activity-year', year, ...ident(c)])
}

/** 屏幕记忆：检索结果（TTL 30 秒由 useAsync 侧给） */
export function memorySearchKey(c: C, q: string, from: string, to: string): string {
  return cacheKey(['memory-search', q, from, to, ...ident(c)])
}
